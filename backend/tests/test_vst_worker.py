from __future__ import annotations

import io
import json
from pathlib import Path
import struct
from types import SimpleNamespace
import wave

import numpy as np
import pytest

from voicesubsep import vst_host as host
from voicesubsep import vst_worker as worker


class Reader:
    def __init__(self, data):
        self.data = np.asarray(data, dtype=np.float32)
        self.num_channels, self.frames = self.data.shape
        self.offset = 0

    def read(self, frames):
        part = self.data[:, self.offset:self.offset + frames]
        self.offset += part.shape[1]
        return part


class BufferedBoard:
    """Model the host compensation API: initial short output, then queued tail."""
    def __init__(self, channels, latency, transform=lambda audio: audio):
        self.pending = np.empty((channels, 0), dtype=np.float32)
        self.latency = latency
        self.transform = transform
        self.calls = []

    def __call__(self, part, sample_rate, buffer_size, reset):
        self.calls.append((sample_rate, buffer_size, reset, part.shape))
        self.pending = np.concatenate([self.pending, self.transform(part)], axis=1)
        count = max(0, self.pending.shape[1] - self.latency)
        output, self.pending = self.pending[:, :count], self.pending[:, count:]
        return output


def render_samples(data, board, chunk=2048, latency_plugins=None, progress=None):
    output = io.BytesIO()
    report = worker._stream(Reader(data), output.write, board, progress or (lambda *_: None), chunk_frames=chunk,
                            latency_plugins=latency_plugins)
    pcm = np.frombuffer(output.getvalue(), dtype="<i2").reshape(-1, data.shape[0]).T
    return pcm, report


@pytest.mark.parametrize("frames,channels,latency", [(1, 2, 0), (4097, 2, 300), (5000, 1, 4100), (48001, 2, 10000)])
def test_stream_compensated_buffer_keeps_sample_zero_tail_and_exact_count(frames, channels, latency):
    random = np.random.default_rng(17)
    expected = random.integers(-10000, 10000, (channels, frames), dtype=np.int16)
    data = expected.astype(np.float32) / 32768
    board = BufferedBoard(channels, latency)
    actual, report = render_samples(data, board)
    np.testing.assert_array_equal(actual, expected)
    assert report["inputFrames"] == report["outputFrames"] == frames
    assert all(call[:3] == (48000, 1024, False) for call in board.calls)


def test_serial_effects_order_and_buffered_tails():
    data = np.full((2, 8197), 0.125, np.float32)
    first = BufferedBoard(2, 100, lambda part: part + 0.125)
    second = BufferedBoard(2, 200, lambda part: part * 2)

    def chain(part, *args, **kwargs):
        return second(first(part, *args, **kwargs), *args, **kwargs)

    actual, report = render_samples(data, chain)
    np.testing.assert_array_equal(actual, np.full((2, 8197), 16384, dtype=np.int16))
    assert report["outputFrames"] == 8197


def test_initialization_audio_is_reset_once_before_dynamic_latency_stream():
    class ProbedPluginBoard(BufferedBoard):
        # Model a VST host whose initialization has already advanced its sample
        # counter. Without a fresh reset it returns the initial delay as audio.
        def __init__(self):
            super().__init__(2, 2238)
            self.pending = np.zeros((2, 2238), np.float32)
            self.reset_count = 0

        def reset(self):
            self.reset_count += 1
            self.pending = np.empty((2, 0), np.float32)

    board = ProbedPluginBoard()
    expected = np.random.default_rng(18).integers(-8000, 8000, (2, 48001), dtype=np.int16)
    output, report = render_samples(expected.astype(np.float32) / 32768, board)
    np.testing.assert_array_equal(output, expected)
    assert board.reset_count == 1
    assert all(call[2] is False for call in board.calls)
    assert report["flushFrames"] > 0


def test_latency_is_recomputed_at_first_48khz_processing_then_reported_per_plugin():
    plugins = [SimpleNamespace(reported_latency_samples=91), SimpleNamespace(reported_latency_samples=45)]
    first = BufferedBoard(2, 200)
    second = BufferedBoard(2, 100)

    def chain(part, *args, **kwargs):
        # The first prepare call changes reported latency from its load rate.
        plugins[0].reported_latency_samples = 200
        plugins[1].reported_latency_samples = 100
        return second(first(part, *args, **kwargs), *args, **kwargs)

    expected = np.full((2, 8197), 0.125, np.float32)
    output, report = render_samples(expected, chain, latency_plugins=plugins)
    np.testing.assert_array_equal(output, np.full((2, 8197), 4096, dtype=np.int16))
    assert report["totalReportedLatencySamples"] == report["compensatedLatencySamples"] == 300
    assert report["latencyReports"] == [
        {"reportedLatencyBeforeProcessingSamples": 91, "reportedLatencySamples": 200},
        {"reportedLatencyBeforeProcessingSamples": 45, "reportedLatencySamples": 100}]


@pytest.mark.parametrize("change_between", [False, True])
def test_midstream_latency_change_fails_instead_of_misaligning(change_between):
    plugin = SimpleNamespace(reported_latency_samples=100)
    board = BufferedBoard(2, 100)
    calls = 0

    def changing(part, *args, **kwargs):
        nonlocal calls
        calls += 1
        output = board(part, *args, **kwargs)
        if calls == 2 and not change_between:
            plugin.reported_latency_samples = 200
        return output

    def after_call(_):
        if calls == 1 and change_between:
            plugin.reported_latency_samples = 200

    with pytest.raises(ValueError, match="changed its reported latency"):
        render_samples(np.zeros((2, 8192)), changing, latency_plugins=[plugin], progress=after_call)
    assert calls == (1 if change_between else 2)


def test_per_plugin_latency_change_rejected_even_when_total_is_unchanged():
    plugins = [SimpleNamespace(reported_latency_samples=100), SimpleNamespace(reported_latency_samples=200)]
    board = BufferedBoard(2, 300)
    calls = 0

    def swapping(part, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            plugins[0].reported_latency_samples = 200
            plugins[1].reported_latency_samples = 100
        return board(part, *args, **kwargs)

    with pytest.raises(ValueError, match="changed its reported latency"):
        render_samples(np.zeros((2, 8192)), swapping, latency_plugins=plugins)


def test_reported_delay_without_actual_host_compensation_rejected():
    plugin = SimpleNamespace(reported_latency_samples=2238)
    with pytest.raises(ValueError, match="did not match"):
        render_samples(np.zeros((2, 8192)), lambda part, *args, **kwargs: part, latency_plugins=[plugin])


def test_latency_larger_than_one_chunk_compensates_until_full_delay_consumed():
    plugin = SimpleNamespace(reported_latency_samples=5000)
    data = np.full((2, 8192), 0.125, np.float32)
    output, report = render_samples(data, BufferedBoard(2, 5000), latency_plugins=[plugin])
    np.testing.assert_array_equal(output, np.full((2, 8192), 4096, dtype=np.int16))
    assert report["compensatedLatencySamples"] == 5000


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), -float("inf")])
def test_invalid_output_samples_fail_without_silent_fallback(invalid):
    data = np.ones((2, 4096), np.float32) / 4
    with pytest.raises(ValueError, match="non-finite"):
        render_samples(data, lambda part, *args, **kwargs: np.full_like(part, invalid))


def test_invalid_input_samples_fail_before_plugin_call():
    data = np.full((1, 4096), np.nan, np.float32)
    with pytest.raises(ValueError, match="source WAV contains invalid"):
        render_samples(data, lambda *_args, **_kwargs: pytest.fail("Plugin should not receive NaN"))


@pytest.mark.parametrize("output", [np.zeros((3, 2048)), np.zeros((2, 2049)), np.zeros(2048)])
def test_plugin_invalid_channel_shape_or_frame_count_rejected(output):
    with pytest.raises(ValueError, match="invalid"):
        render_samples(np.zeros((2, 4096)), lambda *_args, **_kwargs: output)


def test_nonemitting_plugin_has_bounded_flush(monkeypatch):
    monkeypatch.setattr(worker, "MAX_FLUSH_FRAMES", 4096)
    calls = []

    def no_output(part, *args, **kwargs):
        calls.append(part.shape[-1])
        return part[:, :0]

    with pytest.raises(ValueError, match="failed to emit"):
        render_samples(np.zeros((1, 4096)), no_output)
    assert sum(calls) == 8192


def test_clipped_samples_are_counted_and_limited():
    data = np.array([[2, -2, 0.5]], np.float32)
    output, report = render_samples(data, lambda part, *args, **kwargs: part)
    np.testing.assert_array_equal(output, [[32767, -32768, 16384]])
    assert report["clippedSamples"] == 2


def parameter(kind, **kwargs):
    return SimpleNamespace(type=kind, name="Display name", label=None, **kwargs)


class FakePlugin:
    name = "Fake"
    is_effect = True
    is_instrument = False
    parameters = {"gain": parameter(float, min_value=-60, max_value=12, step_size=0.1),
                  "enabled": parameter(bool), "program": parameter(str, valid_values=["Default", "Preset"])}

    def __init__(self):
        self.gain, self.enabled, self.program = 0.0, False, "Default"
        self.events = []

    def __setattr__(self, key, value):
        if hasattr(self, "events"):
            self.events.append(key)
            if key == "program":
                self.gain = 0.0
        super().__setattr__(key, value)


def test_parameter_schema_has_native_values_and_ordered_preset_before_overrides():
    plugin = FakePlugin()
    result = worker._apply_parameters(plugin, {"gain": -12, "enabled": True, "program": "Preset"})
    assert result == {"gain": -12.0, "enabled": True, "program": "Preset"}
    assert plugin.events[0] == "program"
    metadata = worker._parameter_metadata(plugin)
    assert metadata[0] == {"key": "gain", "label": "Display name", "type": "number", "value": -12,
                           "min": -60.0, "max": 12.0, "step": 0.1}


@pytest.mark.parametrize("values", [{"raw_state": "danger"}, {"gain": True}, {"gain": float("nan")},
                                    {"gain": 13}, {"enabled": 1}, {"program": "Unknown"}])
def test_invalid_parameter_changes_rejected(values):
    with pytest.raises(ValueError):
        worker._apply_parameters(FakePlugin(), values)


def test_instrument_rejected_before_audio(monkeypatch):
    monkeypatch.setattr(worker, "_pedalboard", lambda: SimpleNamespace(load_plugin=lambda *args, **kwargs:
                        SimpleNamespace(is_effect=False, is_instrument=True)))
    with pytest.raises(ValueError, match="instruments"):
        worker._load_effect("unused", None)


def test_multiplugin_bundle_requires_explicit_name(tmp_path, monkeypatch):
    bundle = tmp_path / "Bundle.vst3"
    bundle.mkdir()
    monkeypatch.setattr(worker, "_pedalboard", lambda: SimpleNamespace(VST3Plugin=SimpleNamespace(
                        get_plugin_names_for_file=lambda path: ["Mono", "Stereo"])))
    assert worker.inspect(str(bundle)) == {"path": str(bundle), "plugins": ["Mono", "Stereo"]}
    with pytest.raises(ValueError, match="does not exist"):
        worker.inspect(str(bundle), "No such plugin")


def test_pcm_and_rf64_headers_preserve_64bit_sample_count(tmp_path):
    header = worker._wav_header(3000, 2)
    source = tmp_path / "small.wav"
    source.write_bytes(header + b"\x00" * 12000)
    with wave.open(str(source), "rb") as reader:
        assert (reader.getnframes(), reader.getnchannels(), reader.getsampwidth(), reader.getframerate()) == (3000, 2, 2, 48000)
    assert host._pcm_wav_info(source)["inputFrames"] == 3000
    frames = 2 ** 31
    large = worker._wav_header(frames, 2)
    assert large[:4] == b"RF64" and len(large) == 80
    assert struct.unpack("<QQQI", large[20:48]) == (frames * 4 + 72, frames * 4, frames, 0)


def test_small_rf64_can_be_read_by_bypass_parser(tmp_path):
    size, frames = 12000, 3000
    header = (b"RF64\xff\xff\xff\xffWAVE" + struct.pack("<4sIQQQI", b"ds64", 28, size + 72, size, frames, 0)
              + worker._wav_header(frames, 2)[12:36] + b"data\xff\xff\xff\xff")
    path = tmp_path / "rf64.wav"
    path.write_bytes(header + bytes(size))
    assert host._pcm_wav_info(path)["inputFrames"] == frames


def test_worker_error_is_bounded_json_not_stdout(tmp_path):
    request, response = tmp_path / "request.json", tmp_path / "response.json"
    request.write_text(json.dumps({"operation": "unknown", "progressPath": str(tmp_path / "progress.json")}), encoding="utf-8")
    assert worker.main(["--request", str(request), "--response", str(response)]) == 1
    result = json.loads(response.read_text(encoding="utf-8"))
    assert result["ok"] is False and "Unknown" in result["error"]


def test_worker_response_json_is_atomic_and_finite(tmp_path):
    target = tmp_path / "response.json"
    worker._write_json(target, {"ok": True, "result": {"name": "한글"}})
    assert json.loads(target.read_text(encoding="utf-8"))["result"]["name"] == "한글"
    assert not target.with_suffix(".json.tmp").exists()
    with pytest.raises(ValueError):
        worker._write_json(target, {"value": float("nan")})


def test_real_pedalboard_builtin_stream_preserves_frame_count_without_external_plugin():
    pedalboard = pytest.importorskip("pedalboard")
    data = np.full((2, 48001), 0.25, np.float32)
    output, report = render_samples(data, pedalboard.Pedalboard([pedalboard.Gain(gain_db=6.020599913)]))
    np.testing.assert_array_equal(output, np.full((2, 48001), 16384, dtype=np.int16))
    assert report["inputFrames"] == report["outputFrames"] == 48001
