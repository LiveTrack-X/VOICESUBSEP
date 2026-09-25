"""Main-thread VST3 subprocess. Only the host should invoke this module.

Pedalboard 0.9.25 ExternalPlugin.h automatically discards reported latency.
After one explicit reset (plugin initialization itself can process test audio),
streaming uses reset=False on every call and feeds silence at EOF until the
source frame count has been emitted. Resetting at EOF would destroy the buffered
tail. Strong, consistent residual-delay evidence can correct additional delay;
ambiguous audio is reported as uncertain and is never shifted by a guess.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import shutil
import struct
import tempfile
import threading
import time
from typing import Callable

from .vst_host import MAX_JSON_BYTES, MAX_PARAMETERS, validate_chain, validate_plugin_path
from .vst_latency import MAX_RESIDUAL_FRAMES, measure_residual
from .vst_state import decode_plugin_state, encode_plugin_state

SAMPLE_RATE = 48000
CHUNK_FRAMES = 48000
BUFFER_FRAMES = 1024
MAX_FLUSH_FRAMES = SAMPLE_RATE * 10


def _write_json(path: Path, value: dict, *, best_effort: bool = False) -> bool:
    data = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(data) > MAX_JSON_BYTES:
        raise ValueError("VST worker response exceeded its size limit.")
    temporary = path.with_suffix(path.suffix + ".tmp")
    # Windows readers/antivirus can briefly hold a delete-denying handle on
    # the previous snapshot. A missed progress update must not abort the audio
    # stream; the final response, in contrast, must be durably published.
    attempts = 3 if best_effort else 21
    try:
        for attempt in range(attempts):
            try:
                temporary.write_bytes(data)
                os.replace(temporary, path)
                return True
            except PermissionError:
                if attempt == attempts - 1:
                    if best_effort:
                        return False
                    raise RuntimeError("Could not save the VST worker response because Windows kept the result file locked.") from None
                time.sleep(.02 if best_effort else .05)
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
    return False


def _pedalboard():
    import pedalboard
    if pedalboard.__version__ != "0.9.25":
        raise RuntimeError("This VST host requires Pedalboard 0.9.25.")
    return pedalboard


def _load_effect(path: str, plugin_name: str | None):
    module = _pedalboard()
    plugin = module.load_plugin(path, plugin_name=plugin_name, initialization_timeout=10)
    if not plugin.is_effect or plugin.is_instrument:
        raise ValueError("Only audio effect VST3 plugins are supported; instruments are not supported.")
    return plugin


def _parameter_metadata(plugin) -> list[dict]:
    parameters = plugin.parameters
    if len(parameters) > MAX_PARAMETERS:
        raise ValueError("This plugin exposes too many parameters for the minimal VST host.")
    result = []
    for key, parameter in parameters.items():
        if not key or len(key) > 256 or key.startswith("_"):
            raise ValueError("The plugin exposes an unsupported parameter key.")
        record = {"key": key, "label": str(getattr(parameter, "name", key))[:256]}
        value = getattr(plugin, key)
        if parameter.type is bool:
            record.update(type="boolean", value=bool(value))
        elif parameter.type is str:
            choices = [str(item) for item in parameter.valid_values]
            if len(choices) > 2048 or any(len(item) > 1024 for item in choices):
                raise ValueError("The plugin exposes an oversized parameter choice list.")
            record.update(type="string", value=str(value), choices=choices)
        elif parameter.type in (float, int):
            value = float(value)
            if not math.isfinite(value):
                raise ValueError("The plugin exposes a non-finite parameter value.")
            record.update(type="number", value=value)
            for source, target in (("min_value", "min"), ("max_value", "max"), ("step_size", "step")):
                number = getattr(parameter, source, None)
                if number is not None and math.isfinite(float(number)) and (target != "step" or number > 0):
                    record[target] = float(number)
        else:
            raise ValueError("The plugin exposes an unsupported parameter type.")
        unit = getattr(parameter, "label", None)
        if unit:
            record["label"] = f"{record['label']} ({str(unit)[:40]})"
        result.append(record)
    return result


def inspect(path: str, plugin_name: str | None = None) -> dict:
    path = validate_plugin_path(path)
    module = _pedalboard()
    names = module.VST3Plugin.get_plugin_names_for_file(path)
    if not names or len(names) > 128 or any(not isinstance(name, str) or len(name) > 512 for name in names):
        raise ValueError("The VST3 bundle returned an invalid plugin list.")
    if plugin_name is None and len(names) > 1:
        return {"path": path, "plugins": names}
    selected = plugin_name or names[0]
    if selected not in names:
        raise ValueError("The selected plugin does not exist in this VST3 bundle.")
    plugin = _load_effect(path, selected)
    return {"path": path, "pluginName": selected, "name": str(plugin.name)[:512],
            "parameters": _parameter_metadata(plugin)}


def _apply_parameters(plugin, values: dict) -> dict:
    metadata = {item["key"]: item for item in _parameter_metadata(plugin)}
    # A VST's exposed program selector can reset other controls. Set it first,
    # then explicit controls; never let an unchanged default program erase the
    # user's denoise gain. Linked master controls precede individual bands.
    ordered = sorted(values, key=lambda key: (0 if key == "program" else 1 if key.startswith("master_") else 2))
    for key in ordered:
        value = values[key]
        if key not in metadata:
            raise ValueError(f"Unknown VST parameter: {key}")
        item = metadata[key]
        kind = item["type"]
        if kind == "boolean" and not isinstance(value, bool):
            raise ValueError(f"VST parameter {key} requires a boolean.")
        if kind == "string" and (not isinstance(value, str) or value not in item["choices"]):
            raise ValueError(f"VST parameter {key} requires one of its exposed choices.")
        if kind == "number":
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"VST parameter {key} requires a finite number.")
            if ("min" in item and value < item["min"]) or ("max" in item and value > item["max"]):
                raise ValueError(f"VST parameter {key} is outside its exposed range.")
        # Only exposed parameter keys pass this gate: attributes such as
        # preset_data or raw_state cannot be injected through this API.
        # Re-selecting an unchanged program (or linked master control) can erase
        # opaque settings restored from raw_state. Compare the current native
        # value after preceding writes, rather than the stale metadata snapshot.
        if getattr(plugin, key) != value:
            setattr(plugin, key, value)
    # Record the actual values after the plugin's quantization/normalization.
    return {item["key"]: item["value"] for item in _parameter_metadata(plugin)}


def _apply_effect(plugin, effect: dict) -> dict:
    if "state" in effect:
        raw = decode_plugin_state(effect["state"])
        try:
            plugin.raw_state = raw
        except Exception:
            raise ValueError("The plugin could not restore its saved state.") from None
    return _apply_parameters(plugin, effect["parameters"])


def edit(effect: dict, close_path: Path) -> dict:
    """Only the dedicated worker's main thread may own a native editor."""
    if threading.current_thread() is not threading.main_thread():
        raise RuntimeError("The VST editor must run on the worker main thread.")
    effect = validate_chain([effect])[0]
    path = validate_plugin_path(effect["path"])
    names = _pedalboard().VST3Plugin.get_plugin_names_for_file(path)
    if not names or len(names) > 128 or any(not isinstance(name, str) or len(name) > 512 for name in names):
        raise ValueError("The VST3 bundle returned an invalid plugin list.")
    selected = effect["pluginName"]
    if selected is None:
        if len(names) != 1:
            raise ValueError("Select a plugin from this VST3 bundle before opening its editor.")
        selected = names[0]
    if selected not in names:
        raise ValueError("The selected plugin does not exist in this VST3 bundle.")
    plugin = _load_effect(path, selected)
    _apply_effect(plugin, effect)
    close_event, finished = threading.Event(), threading.Event()

    def watch_close():
        while not finished.wait(.05):
            if close_path.exists():
                close_event.set()
                return

    def place_window():
        from .vst_window import position_editor
        for _ in range(100):
            if finished.wait(.05) or close_event.is_set():
                return
            try:
                if position_editor(selected):
                    return
            except (OSError, ValueError):
                return  # Placement is optional; the close watcher is independent.

    watcher = threading.Thread(target=watch_close, name="vst-editor-close", daemon=True)
    watcher.start()
    placement = threading.Thread(target=place_window, name="vst-editor-position", daemon=True)
    placement.start()
    try:
        if close_path.exists():
            close_event.set()
        plugin.show_editor(close_event=close_event)
        try:
            state = encode_plugin_state(plugin.raw_state)
        except Exception:
            raise ValueError("The plugin state is unavailable or exceeds 256 KiB; changes were not saved.") from None
        return {"path": path, "pluginName": selected, "name": str(plugin.name)[:512],
                "parameters": _parameter_metadata(plugin), "state": state}
    finally:
        finished.set()
        watcher.join(timeout=1)


def _wav_header(frames: int, channels: int) -> bytes:
    """Known-length PCM16 WAV/RF64: support multi-hour streams without a 4GB wrap."""
    size = frames * channels * 2
    fmt = struct.pack("<4sIHHIIHH", b"fmt ", 16, 1, channels, SAMPLE_RATE,
                      SAMPLE_RATE * channels * 2, channels * 2, 16)
    if size + 36 <= 0xFFFFFFFF:
        return struct.pack("<4sI4s", b"RIFF", size + 36, b"WAVE") + fmt + struct.pack("<4sI", b"data", size)
    # ds64 payload: riffSize, dataSize, sampleCount, tableLength.
    ds64 = struct.pack("<4sIQQQI", b"ds64", 28, size + 72, size, frames, 0)
    return b"RF64\xff\xff\xff\xffWAVE" + ds64 + fmt + b"data\xff\xff\xff\xff"


def _stream(reader, write: Callable, board, progress: Callable[[float], None], *,
            chunk_frames: int = CHUNK_FRAMES, latency_plugins: list | None = None,
            float_output: bool = False, tail_frames: int = 0) -> dict:
    import numpy as np
    # ExternalPlugin initialization probes reset behavior with audio, leaving
    # sample counters advanced. CLEAR then emitted its initial 2238-sample delay
    # despite reset=False and a valid reported latency. Reset exactly once here
    # to start a fresh stream, preserving the selected parameter values.
    reset = getattr(board, "reset", None)
    if reset is not None:
        reset()
    def latencies() -> list[int]:
        values = [int(plugin.reported_latency_samples) for plugin in latency_plugins or []]
        if any(value < 0 for value in values) or sum(values) > MAX_FLUSH_FRAMES:
            raise ValueError("The VST chain reports unsupported latency (maximum ten seconds in total).")
        return values

    initial_latencies = latencies() if latency_plugins is not None else None
    baseline_latencies = None
    compensated_frames = 0
    total, channels = int(reader.frames), int(reader.num_channels)
    if not 0 <= tail_frames <= MAX_RESIDUAL_FRAMES:
        raise ValueError("Invalid VST verification tail length.")
    target = total + tail_frames
    received = consumed = flush_frames = clipped = 0
    input_peak = output_peak = 0.0
    while consumed < total or received < target:
        if consumed < total:
            part = reader.read(min(chunk_frames, total - consumed))
            count = part.shape[-1]
            if count <= 0 or count > total - consumed:
                raise ValueError("The source WAV ended before its declared frame count.")
            if part.shape != (channels, count) or not np.isfinite(part).all():
                raise ValueError("The source WAV contains invalid audio samples.")
            consumed += count
            input_peak = max(input_peak, float(np.max(np.abs(part))))
        else:
            count = min(chunk_frames, MAX_FLUSH_FRAMES + tail_frames - flush_frames)
            if count <= 0:
                raise ValueError("The VST chain buffered more than ten seconds or failed to emit its tail.")
            part = np.zeros((channels, count), dtype=np.float32)
            flush_frames += count
        # Keep the plugin's prepared maximum block size constant, even at EOF;
        # some plugins reset when their process spec changes. This also avoids
        # Pedalboard's ambiguous channel layout for one-frame stereo inputs.
        # Padding is discarded at the source-length boundary below.
        if part.shape[1] < BUFFER_FRAMES:
            part = np.pad(part, ((0, 0), (0, BUFFER_FRAMES - part.shape[1])))
        if baseline_latencies is not None and latencies() != baseline_latencies:
            raise ValueError("A VST plugin changed its reported latency during processing. Use stable settings and restart preprocessing.")
        output = np.asarray(board(part, SAMPLE_RATE, buffer_size=BUFFER_FRAMES, reset=False))
        if (output.ndim != 2 or output.shape[0] != channels or output.shape[1] > part.shape[1]
                or not np.isfinite(output).all()):
            raise ValueError("The VST chain returned invalid or non-finite audio.")
        if latency_plugins is not None:
            current = latencies()
            # The first prepare call changes a plugin from its load sample rate
            # to 48 kHz; accept that initialization change, then require stable
            # per-plugin latency for the remainder of this immutable render.
            if baseline_latencies is None:
                baseline_latencies = current
            elif current != baseline_latencies:
                raise ValueError("A VST plugin changed its reported latency during processing. Use stable settings and restart preprocessing.")
            missing = part.shape[1] - output.shape[1]
            expected_missing = min(part.shape[1], max(0, sum(baseline_latencies) - compensated_frames))
            if missing != expected_missing:
                raise ValueError("VST latency compensation did not match the plugins' reported delay. This chain cannot be aligned reliably.")
            compensated_frames += missing
        output = output[:, :max(0, target - received)]
        if output.size:
            output_peak = max(output_peak, float(np.max(np.abs(output))))
            clipped += int(np.count_nonzero((output < -1) | (output > 32767 / 32768)))
            if float_output:
                write(output.astype("<f4").T.tobytes())
            else:
                pcm = np.rint(np.clip(output, -1, 32767 / 32768) * 32768).astype("<i2")
                write(pcm.T.tobytes())
            received += output.shape[1]
        progress(min(0.99, received / target))
    report = {"inputFrames": total, "outputFrames": received, "sampleRate": SAMPLE_RATE,
              "channels": channels, "flushFrames": flush_frames, "inputPeak": input_peak,
              "outputPeak": output_peak, "clippedSamples": clipped}
    if initial_latencies is not None:
        baseline_latencies = baseline_latencies or []
        report.update(totalReportedLatencySamples=sum(baseline_latencies), compensatedLatencySamples=compensated_frames,
                      latencyReports=[{"reportedLatencyBeforeProcessingSamples": before, "reportedLatencySamples": after}
                                      for before, after in zip(initial_latencies, baseline_latencies)])
    return report


class _FloatReader:
    """Bounded reads of an interleaved float stage with a logical trimmed view."""
    def __init__(self, path: Path, frames: int, channels: int, offset: int = 0):
        self.frames, self.num_channels, self.offset = frames, channels, offset
        self.stream = path.open("rb")
        self.position = 0
        self.seek(0)

    def seek(self, position: int):
        if not 0 <= position <= self.frames:
            raise ValueError("Invalid VST verification position.")
        self.position = position
        self.stream.seek((self.offset + position) * self.num_channels * 4)

    def read(self, count: int):
        import numpy as np
        count = min(count, self.frames - self.position)
        raw = self.stream.read(count * self.num_channels * 4)
        if len(raw) != count * self.num_channels * 4:
            raise ValueError("The VST verification stage ended early.")
        self.position += count
        return np.frombuffer(raw, dtype="<f4").reshape(count, self.num_channels).T

    def close(self):
        self.stream.close()


def _finish_pcm(reader, destination: Path, progress: Callable[[float], None]) -> dict:
    import numpy as np
    reader.seek(0)
    received = clipped = 0
    peak = 0.0
    with destination.open("wb") as writer:
        writer.write(_wav_header(reader.frames, reader.num_channels))
        while received < reader.frames:
            output = reader.read(min(CHUNK_FRAMES, reader.frames - received))
            if output.shape != (reader.num_channels, min(CHUNK_FRAMES, reader.frames - received)) or not np.isfinite(output).all():
                raise ValueError("The processed VST audio is invalid.")
            peak = max(peak, float(np.max(np.abs(output))))
            clipped += int(np.count_nonzero((output < -1) | (output > 32767 / 32768)))
            pcm = np.rint(np.clip(output, -1, 32767 / 32768) * 32768).astype("<i2")
            writer.write(pcm.T.tobytes())
            received += output.shape[1]
            progress(received / reader.frames)
    return {"outputFrames": received, "outputPeak": peak, "clippedSamples": clipped}


def process(source: Path, destination: Path, chain: list[dict],
            progress: Callable[[str, float], None]) -> dict:
    from pedalboard.io import AudioFile
    module = _pedalboard()
    effects = validate_chain(chain)
    enabled = [effect for effect in effects if effect["enabled"]]
    if source.resolve() == destination.resolve():
        raise ValueError("The source WAV must not be overwritten.")
    loaded, reports = [], []
    for index, effect in enumerate(enabled):
        progress(f"Loading VST effect {index + 1}/{len(enabled)}", 0.01 * (index + 1))
        plugin = _load_effect(effect["path"], effect["pluginName"])
        actual = _apply_effect(plugin, effect)
        loaded.append(plugin)
        reports.append({"path": effect["path"], "pluginName": str(plugin.name)[:512], "parameters": actual})
    with AudioFile(str(source)) as reader:
        if reader.samplerate != SAMPLE_RATE or reader.num_channels not in (1, 2) or reader.frames <= 0:
            raise ValueError("VST preprocessing requires nonempty 48 kHz mono or stereo WAV audio.")
        if not enabled:
            shutil.copyfile(source, destination)
            return {"inputFrames": reader.frames, "outputFrames": reader.frames, "sampleRate": SAMPLE_RATE,
                    "channels": reader.num_channels, "plugins": [], "bypassed": True, "warnings": [],
                    "totalReportedLatencySamples": 0, "compensatedLatencySamples": 0}
        frames, channels = int(reader.frames), int(reader.num_channels)
        # At most two float stages coexist, plus the final PCM16. Files live
        # inside the host-owned output folder, so terminating this subprocess
        # also lets the host remove them. Never evict user data to make room.
        required = (frames + MAX_RESIDUAL_FRAMES) * channels * 8 + frames * channels * 2 + 1024 * 1024
        if shutil.disk_usage(destination.parent).free < required:
            raise ValueError("Not enough free disk space for safe VST latency verification.")
        report = {"inputFrames": frames, "sampleRate": SAMPLE_RATE, "channels": channels,
                  "flushFrames": 0, "totalReportedLatencySamples": 0, "compensatedLatencySamples": 0,
                  "totalMeasuredResidualSamples": 0, "inputPeak": 0.0}
        current, current_path = reader, None
        with tempfile.TemporaryDirectory(prefix="vst-measure-", dir=destination.parent) as temporary:
            try:
                for index, (plugin, description) in enumerate(zip(loaded, reports)):
                    stage_path = Path(temporary) / f"stage-{index}.float"
                    start, portion = 0.05 + index * 0.85 / len(loaded), 0.85 / len(loaded)
                    current.seek(0)
                    with stage_path.open("wb") as writer:
                        stage = _stream(current, writer.write, module.Pedalboard([plugin]),
                                        lambda fraction: progress("Applying VST preprocessing", start + fraction * portion * 0.9),
                                        latency_plugins=[plugin], float_output=True, tail_frames=MAX_RESIDUAL_FRAMES)
                    rendered = _FloatReader(stage_path, frames + MAX_RESIDUAL_FRAMES, channels)
                    try:
                        measurement = measure_residual(current, rendered,
                            lambda fraction: progress("Verifying residual VST latency", start + portion * (0.9 + fraction * 0.1)))
                    finally:
                        rendered.close()
                    latency = stage["latencyReports"][0]
                    if int(plugin.reported_latency_samples) != latency["reportedLatencySamples"]:
                        raise ValueError("A VST plugin changed its reported latency during processing. Use stable settings and restart preprocessing.")
                    description.update(latency, residualMeasurement=measurement)
                    for name in ("flushFrames", "totalReportedLatencySamples", "compensatedLatencySamples"):
                        report[name] += stage[name]
                    if report["totalReportedLatencySamples"] > MAX_FLUSH_FRAMES:
                        raise ValueError("The VST chain reports unsupported latency (maximum ten seconds in total).")
                    if index == 0:
                        report["inputPeak"] = stage["inputPeak"]
                    report["totalMeasuredResidualSamples"] += measurement["appliedSamples"]
                    if current_path is not None:
                        current.close()
                        current_path.unlink()
                    current = _FloatReader(stage_path, frames, channels, measurement["appliedSamples"])
                    current_path = stage_path
                report.update(_finish_pcm(current, destination,
                    lambda fraction: progress("Writing verified VST audio", 0.9 + fraction * 0.09)))
            finally:
                if current is not reader:
                    current.close()
    # Read back using an independent file handle before the host commits it.
    with AudioFile(str(destination)) as checked:
        if checked.frames != report["inputFrames"] or checked.samplerate != SAMPLE_RATE:
            raise ValueError("The processed WAV failed its sample-count verification.")
    for plugin, description in zip(loaded, reports):
        if int(plugin.reported_latency_samples) != description["reportedLatencySamples"]:
            raise ValueError("A VST plugin changed its reported latency during processing. Use stable settings and restart preprocessing.")
    warnings = []
    if report["clippedSamples"]:
        warnings.append("The chain exceeded full scale; clipped samples were limited when writing PCM16.")
    if report["inputPeak"] > 0.001 and report["outputPeak"] < 0.00001:
        warnings.append("The chain output is silent or nearly silent. Review the effect settings before transcription.")
    if any(item["residualMeasurement"]["status"] == "uncertain" for item in reports):
        warnings.append("Some residual delays could not be verified. No additional shift was guessed for those effects.")
    report.update(plugins=reports, bypassed=False, warnings=warnings, latencyCompensation="plugin-reported+verified-residual",
                  totalCompensatedLatencySamples=report["compensatedLatencySamples"] + report["totalMeasuredResidualSamples"])
    progress("VST preprocessing complete", 1.0)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    arguments = parser.parse_args(argv)
    response_path = Path(arguments.response)
    request = None
    try:
        request_path = Path(arguments.request)
        if request_path.stat().st_size > MAX_JSON_BYTES:
            raise ValueError("VST request exceeded its size limit.")
        request = json.loads(request_path.read_text(encoding="utf-8"),
                             parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite JSON")))
        progress_path = Path(request["progressPath"])
        last_write = 0.0

        def progress(stage: str, fraction: float) -> None:
            nonlocal last_write
            now = time.monotonic()
            if now - last_write >= 0.2 or fraction >= 1:
                _write_json(progress_path, {"stage": stage, "fraction": fraction}, best_effort=True)
                last_write = now

        if request["operation"] == "inspect":
            result = inspect(request["path"], request.get("pluginName"))
        elif request["operation"] == "process":
            result = process(Path(request["source"]), Path(request["destination"]), request["chain"], progress)
        elif request["operation"] == "editor":
            close_path = Path(request["closePath"])
            if close_path.parent.resolve() != request_path.parent.resolve() or close_path.name != "close-editor":
                raise ValueError("Invalid private editor close marker.")
            start_path = Path(request["startPath"])
            if start_path.parent.resolve() != request_path.parent.resolve() or start_path.name != "start-editor":
                raise ValueError("Invalid private editor start marker.")
            deadline = time.monotonic() + 10
            while not start_path.exists():
                if time.monotonic() > deadline:
                    raise ValueError("The VST editor was not attached to its host process.")
                time.sleep(.02)
            result = edit(request["effect"], close_path)
        else:
            raise ValueError("Unknown VST worker operation.")
        _write_json(response_path, {"ok": True, "result": result})
        return 0
    except Exception as exc:
        carries_state = isinstance(request, dict) and (request.get("operation") == "editor"
            or any(isinstance(effect, dict) and "state" in effect for effect in request.get("chain", [])))
        error = (f"VST operation failed while using plugin settings ({type(exc).__name__})."
                 if carries_state else f"{type(exc).__name__}: {str(exc)[:1800]}")
        _write_json(response_path, {"ok": False, "error": error})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
