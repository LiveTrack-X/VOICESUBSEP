"""Main-thread VST3 subprocess. Only the host should invoke this module.

Pedalboard 0.9.25 ExternalPlugin.h automatically discards reported latency.
After one explicit reset (plugin initialization itself can process test audio),
streaming uses reset=False on every call and feeds silence at EOF until the
source frame count has been emitted. Resetting at EOF would destroy the buffered
tail. We cannot correct latency a third-party plugin misreports.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import shutil
import struct
import time
from typing import Callable

from .vst_host import MAX_JSON_BYTES, MAX_PARAMETERS, validate_chain, validate_plugin_path

SAMPLE_RATE = 48000
CHUNK_FRAMES = 48000
BUFFER_FRAMES = 1024
MAX_FLUSH_FRAMES = SAMPLE_RATE * 10


def _write_json(path: Path, value: dict) -> None:
    data = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(data) > MAX_JSON_BYTES:
        raise ValueError("VST worker response exceeded its size limit.")
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


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
        setattr(plugin, key, value)
    # Record the actual values after the plugin's quantization/normalization.
    return {item["key"]: item["value"] for item in _parameter_metadata(plugin)}


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
            chunk_frames: int = CHUNK_FRAMES, latency_plugins: list | None = None) -> dict:
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
    received = consumed = flush_frames = clipped = 0
    input_peak = output_peak = 0.0
    while consumed < total or received < total:
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
            count = min(chunk_frames, MAX_FLUSH_FRAMES - flush_frames)
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
        output = output[:, :max(0, total - received)]
        if output.size:
            output_peak = max(output_peak, float(np.max(np.abs(output))))
            clipped += int(np.count_nonzero((output < -1) | (output > 32767 / 32768)))
            pcm = np.rint(np.clip(output, -1, 32767 / 32768) * 32768).astype("<i2")
            write(pcm.T.tobytes())
            received += output.shape[1]
        progress(min(0.99, received / total))
    report = {"inputFrames": total, "outputFrames": received, "sampleRate": SAMPLE_RATE,
              "channels": channels, "flushFrames": flush_frames, "inputPeak": input_peak,
              "outputPeak": output_peak, "clippedSamples": clipped}
    if initial_latencies is not None:
        baseline_latencies = baseline_latencies or []
        report.update(totalReportedLatencySamples=sum(baseline_latencies), compensatedLatencySamples=compensated_frames,
                      latencyReports=[{"reportedLatencyBeforeProcessingSamples": before, "reportedLatencySamples": after}
                                      for before, after in zip(initial_latencies, baseline_latencies)])
    return report


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
        actual = _apply_parameters(plugin, effect["parameters"])
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
        board = module.Pedalboard(loaded)
        with destination.open("wb") as writer:
            writer.write(_wav_header(reader.frames, reader.num_channels))
            report = _stream(reader, writer.write, board,
                             lambda fraction: progress("Applying VST preprocessing", 0.05 + fraction * 0.94),
                             latency_plugins=loaded)
    # Read back using an independent file handle before the host commits it.
    with AudioFile(str(destination)) as checked:
        if checked.frames != report["inputFrames"] or checked.samplerate != SAMPLE_RATE:
            raise ValueError("The processed WAV failed its sample-count verification.")
    for plugin, description, latency in zip(loaded, reports, report.pop("latencyReports")):
        if int(plugin.reported_latency_samples) != latency["reportedLatencySamples"]:
            raise ValueError("A VST plugin changed its reported latency during processing. Use stable settings and restart preprocessing.")
        description.update(latency)
    warnings = []
    if report["clippedSamples"]:
        warnings.append("The chain exceeded full scale; clipped samples were limited when writing PCM16.")
    if report["inputPeak"] > 0.001 and report["outputPeak"] < 0.00001:
        warnings.append("The chain output is silent or nearly silent. Review the effect settings before transcription.")
    report.update(plugins=reports, bypassed=False, warnings=warnings, latencyCompensation="plugin-reported")
    progress("VST preprocessing complete", 1.0)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    arguments = parser.parse_args(argv)
    response_path = Path(arguments.response)
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
                _write_json(progress_path, {"stage": stage, "fraction": fraction})
                last_write = now

        if request["operation"] == "inspect":
            result = inspect(request["path"], request.get("pluginName"))
        elif request["operation"] == "process":
            result = process(Path(request["source"]), Path(request["destination"]), request["chain"], progress)
        else:
            raise ValueError("Unknown VST worker operation.")
        _write_json(response_path, {"ok": True, "result": result})
        return 0
    except Exception as exc:
        _write_json(response_path, {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:1800]}"})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
