from __future__ import annotations

import io
import sys
from pathlib import Path
from types import SimpleNamespace
import wave

import numpy as np
import pytest

from voicesubsep import vst_latency as latency
from voicesubsep import vst_worker as worker
from voicesubsep import vst_host as host


class Reader:
    def __init__(self, data):
        self.data = np.asarray(data, np.float32)
        self.num_channels, self.frames = self.data.shape
        self.offset = 0

    def seek(self, position):
        self.offset = position

    def read(self, frames):
        result = self.data[:, self.offset:self.offset + frames]
        self.offset += result.shape[1]
        return result


def noise(seconds=5, channels=1):
    return np.random.default_rng(713).normal(0, .08, (channels, int(48000 * seconds))).astype(np.float32)


def delayed(data, lag):
    if lag >= 0:
        return np.pad(data, ((0, 0), (lag, latency.MAX_RESIDUAL_FRAMES)))[:, :data.shape[1] + latency.MAX_RESIDUAL_FRAMES]
    return np.pad(data[:, -lag:], ((0, 0), (0, latency.MAX_RESIDUAL_FRAMES - lag)))


@pytest.mark.parametrize("lag", [0, 2238, 11999])
def test_strong_consistent_residual_after_reported_compensation(lag):
    data = noise(channels=2)
    result = latency.measure_residual(Reader(data), Reader(delayed(data, lag) * .6))
    assert result["status"] == ("corrected" if lag else "verified")
    assert result["appliedSamples"] == result["measuredSamples"] == lag
    assert result["matchedWindows"] == 7 and result["confidence"] > .99


@pytest.mark.parametrize("kind", ["silence", "dc", "gated", "periodic", "changed", "negative", "variable", "boundary", "short"])
def test_ambiguous_or_unsupported_input_never_guesses_a_shift(kind):
    data = noise()
    output = delayed(data, 2238)
    if kind == "silence":
        data *= 0; output *= 0
    elif kind == "dc":
        data[:] = .25; output[:] = .25
    elif kind == "gated":
        output[:, 48000:96000] = 0
    elif kind == "periodic":
        data = np.sin(np.arange(data.shape[1])[None, :] * 2 * np.pi * 1000 / 48000).astype(np.float32) / 4
        output = delayed(data, 2238)
    elif kind == "changed":
        output = np.random.default_rng(14).normal(0, .1, output.shape).astype(np.float32)
    elif kind == "negative":
        output = delayed(data, -700)
    elif kind == "variable":
        output[:, 120000:] = delayed(data, 4000)[:, 120000:]
    elif kind == "boundary":
        output = delayed(data, latency.MAX_RESIDUAL_FRAMES)
    elif kind == "short":
        data = data[:, :48000]; output = delayed(data, 2238)
    result = latency.measure_residual(Reader(data), Reader(output))
    assert result["status"] == "uncertain", result
    assert result["measuredSamples"] is None and result["appliedSamples"] == 0


def test_opposite_stereo_polarity_does_not_cancel_measurement():
    data = noise()
    data = np.concatenate((data, -data))
    result = latency.measure_residual(Reader(data), Reader(-delayed(data, 2238)))
    assert result["appliedSamples"] == 2238


def test_different_channel_delays_are_not_treated_as_one_shift():
    data = noise(channels=2)
    output = np.concatenate((delayed(data[:1], 2238), delayed(data[1:], 3000)))
    result = latency.measure_residual(Reader(data), Reader(output))
    assert result["reason"] == "inconsistent" and result["appliedSamples"] == 0


def test_long_input_has_bounded_nonoverlapping_reads():
    class GeneratedReader:
        frames, num_channels = 48000 * 60 * 60, 1
        def __init__(self):
            self.position, self.reads = 0, []
        def seek(self, position):
            self.position = position
        def read(self, count):
            self.reads.append((self.position, count))
            return np.zeros((1, count), np.float32)
    original, output = GeneratedReader(), GeneratedReader()
    latency.measure_residual(original, output)
    assert len(original.reads) == len(output.reads) == 7
    assert all(count == 24000 for _, count in original.reads)
    assert all(count == 48000 for _, count in output.reads)
    assert all(right[0] >= left[0] + left[1] for left, right in zip(original.reads, original.reads[1:]))


class DelayBoard:
    """Native delay plus host removal of reported frames, no real plugin load."""
    def __init__(self, plugin):
        self.plugin = plugin
        self.reset()
    def reset(self):
        self.pending = None
        self.drop = self.plugin.reported_latency_samples
    def __call__(self, part, *args, **kwargs):
        if self.pending is None:
            self.pending = np.zeros((part.shape[0], self.plugin.actual_delay), np.float32)
        self.pending = np.concatenate((self.pending, part * self.plugin.gain), axis=1)
        result, self.pending = self.pending[:, :part.shape[1]], self.pending[:, part.shape[1]:]
        drop = min(self.drop, result.shape[1]); self.drop -= drop
        return result[:, drop:]


def test_float_stream_flush_preserves_unreported_tail_and_original_count():
    data = noise()
    plugin = SimpleNamespace(reported_latency_samples=1000, actual_delay=3238, gain=1)
    out = io.BytesIO()
    report = worker._stream(Reader(data), out.write, DelayBoard(plugin), lambda _:None,
                            latency_plugins=[plugin], float_output=True, tail_frames=latency.MAX_RESIDUAL_FRAMES)
    rendered = np.frombuffer(out.getvalue(), "<f4").reshape(-1, 1).T
    assert report["compensatedLatencySamples"] == 1000
    np.testing.assert_array_equal(rendered[:, 2238:2238+data.shape[1]], data)
    assert rendered.shape[1] == data.shape[1] + latency.MAX_RESIDUAL_FRAMES


class WaveReader(Reader):
    def __init__(self, filename):
        with wave.open(filename, "rb") as source:
            self.samplerate = source.getframerate()
            samples = np.frombuffer(source.readframes(source.getnframes()), "<i2").reshape(-1, source.getnchannels()).T / 32768
        super().__init__(samples)
    def __enter__(self): return self
    def __exit__(self, *args): return False


def setup_process(tmp_path, monkeypatch, plugins, data=None):
    data = noise(channels=2) if data is None else data
    source, destination = tmp_path / "source.wav", tmp_path / "destination.wav"
    quantized = np.rint(data * 32768).astype("<i2")
    source.write_bytes(worker._wav_header(data.shape[1], data.shape[0]) + quantized.T.tobytes())
    chain=[]
    for index in range(len(plugins)):
        path=tmp_path/f"fake-{index}.vst3"; path.touch()
        chain.append({"path":str(path),"enabled":True,"parameters":{}})
    monkeypatch.setitem(sys.modules, "pedalboard.io", SimpleNamespace(AudioFile=WaveReader))
    monkeypatch.setattr(worker, "_pedalboard", lambda:SimpleNamespace(Pedalboard=lambda effects:DelayBoard(effects[0])))
    remaining=iter(plugins)
    monkeypatch.setattr(worker, "_load_effect", lambda *args:next(remaining))
    monkeypatch.setattr(worker, "_apply_parameters", lambda *args:{})
    return source, destination, chain, quantized


def plugin(reported, actual, gain=1):
    return SimpleNamespace(name="Fake effect", reported_latency_samples=reported, actual_delay=actual, gain=gain)


def test_per_plugin_chain_compensation_keeps_samples_tail_and_single_quantization(tmp_path, monkeypatch):
    source, destination, chain, quantized = setup_process(tmp_path, monkeypatch,
        [plugin(0, 2238, .7), plugin(1024, 1024, 1/.7), plugin(300, 1077)])
    unchanged=source.read_bytes(); progress=[]
    report=worker.process(source, destination, chain, lambda stage,fraction:progress.append(fraction))
    with wave.open(str(destination), "rb") as result:
        pcm=np.frombuffer(result.readframes(result.getnframes()),"<i2").reshape(-1,2).T
    np.testing.assert_array_equal(pcm,quantized)
    assert source.read_bytes() == unchanged
    assert report["inputFrames"] == report["outputFrames"] == quantized.shape[1]
    assert [p["residualMeasurement"]["appliedSamples"] for p in report["plugins"]] == [2238,0,777]
    assert [p["residualMeasurement"]["status"] for p in report["plugins"]] == ["corrected","verified","corrected"]
    assert report["compensatedLatencySamples"] == report["totalReportedLatencySamples"] == 1324
    assert report["totalMeasuredResidualSamples"] == 3015
    assert report["totalCompensatedLatencySamples"] == 4339
    assert progress == sorted(progress) and progress[-1] == 1
    assert not list(tmp_path.glob("vst-measure-*"))


def test_uncertain_render_keeps_only_reported_compensation_and_warns(tmp_path, monkeypatch):
    data=np.sin(np.arange(240000)[None,:]*2*np.pi*1000/48000).astype(np.float32)/4
    source,destination,chain,original=setup_process(tmp_path,monkeypatch,[plugin(0,2238)],data)
    report=worker.process(source,destination,chain,lambda *_:None)
    with wave.open(str(destination),"rb") as result:
        pcm=np.frombuffer(result.readframes(result.getnframes()),"<i2")[None,:]
    np.testing.assert_array_equal(pcm,delayed(original,2238)[:,:original.shape[1]])
    assert report["totalMeasuredResidualSamples"] == 0
    assert report["plugins"][0]["residualMeasurement"]["status"] == "uncertain"
    assert any("could not be verified" in warning for warning in report["warnings"])


def test_failure_or_cancellation_cleans_float_stages_and_preserves_source(tmp_path, monkeypatch):
    source,destination,chain,_=setup_process(tmp_path,monkeypatch,[plugin(0,2238)])
    unchanged=source.read_bytes()
    class Cancelled(Exception): pass
    def cancel(stage,fraction):
        if "Verifying" in stage: raise Cancelled()
    with pytest.raises(Cancelled):worker.process(source,destination,chain,cancel)
    assert source.read_bytes() == unchanged and not destination.exists()
    assert not list(tmp_path.glob("vst-measure-*"))


def test_insufficient_space_never_deletes_or_writes_output(tmp_path,monkeypatch):
    source,destination,chain,_=setup_process(tmp_path,monkeypatch,[plugin(0,2238)])
    monkeypatch.setattr(worker.shutil,"disk_usage",lambda _:SimpleNamespace(free=1))
    with pytest.raises(ValueError,match="free disk space"):worker.process(source,destination,chain,lambda *_:None)
    assert source.exists() and not destination.exists() and not list(tmp_path.glob("vst-measure-*"))


def test_actual_audiofile_reader_accepts_float_stage_alignment(tmp_path,monkeypatch):
    audio = pytest.importorskip("pedalboard.io")
    source,destination,chain,quantized=setup_process(tmp_path,monkeypatch,[plugin(1024,3262)])
    monkeypatch.setitem(sys.modules,"pedalboard.io",audio)
    report=worker.process(source,destination,chain,lambda *_:None)
    # Compare PCM bytes independently: AudioFile scales int16 using 32767,
    # whereas the worker's final writer uses the existing 32768 convention.
    with wave.open(str(destination),"rb") as reader:
        result=np.frombuffer(reader.readframes(reader.getnframes()),"<i2").reshape(-1,2).T
    np.testing.assert_array_equal(result,quantized)
    assert report["totalMeasuredResidualSamples"] == 2238


def valid_report():
    return {"latencyCompensation":"plugin-reported+verified-residual", "plugins":[{
        "reportedLatencySamples":1000,"residualMeasurement":{"status":"corrected","reason":"consistent",
        "measuredSamples":2238,"appliedSamples":2238,"confidence":.98,"matchedWindows":7,"examinedWindows":7,"maxSearchSamples":12000}}],
        "totalReportedLatencySamples":1000,"compensatedLatencySamples":1000,
        "totalMeasuredResidualSamples":2238,"totalCompensatedLatencySamples":3238}


@pytest.mark.parametrize("change",[{"status":"unknown"},{"status":"uncertain"},{"status":"verified"},{"confidence":.89},
    {"confidence":float("nan")},{"matchedWindows":2},{"matchedWindows":8},{"examinedWindows":6},{"appliedSamples":-1},
    {"appliedSamples":12000},{"measuredSamples":None},{"measuredSamples":True},{"maxSearchSamples":24000}])
def test_host_refuses_inconsistent_measurement_before_committing(change):
    report=valid_report();host._validate_residual_report(report)
    report["plugins"][0]["residualMeasurement"].update(change)
    with pytest.raises(host.VSTError,match="verification report"):host._validate_residual_report(report)


@pytest.mark.parametrize("change",[{"plugins":[]},{"totalReportedLatencySamples":0},{"compensatedLatencySamples":2238},
    {"totalMeasuredResidualSamples":0},{"totalCompensatedLatencySamples":1000}])
def test_host_refuses_inconsistent_compensation_total(change):
    report=valid_report();report.update(change)
    with pytest.raises(host.VSTError,match="verification report"):host._validate_residual_report(report)


def test_host_accepts_explicit_uncertainty_with_no_additional_shift():
    report=valid_report()
    report["plugins"][0]["residualMeasurement"].update(status="uncertain",reason="ambiguous",measuredSamples=None,appliedSamples=0,matchedWindows=0,confidence=0)
    report.update(totalMeasuredResidualSamples=0,totalCompensatedLatencySamples=1000)
    host._validate_residual_report(report)


def test_rejected_residual_report_preserves_existing_destination(tmp_path,monkeypatch):
    source,destination,chain,_=setup_process(tmp_path,monkeypatch,[plugin(0,2238)])
    destination.write_bytes(b"previous result")
    def fake_worker(request,**kwargs):
        Path(request["destination"]).write_bytes(source.read_bytes())
        report=valid_report()
        return {**report,"sampleRate":48000,"inputFrames":240000,"outputFrames":240000,"totalCompensatedLatencySamples":1}
    monkeypatch.setattr(host,"_run_worker",fake_worker)
    with pytest.raises(host.VSTError):host.process_chain(source,destination,chain,lambda:False,lambda *_:None)
    assert destination.read_bytes() == b"previous result"
    assert not list(tmp_path.glob("vst-output-*"))
