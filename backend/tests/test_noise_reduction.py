from __future__ import annotations

import hashlib
from pathlib import Path
import random
import shutil
import struct
import subprocess
import wave

import pytest

from voicesubsep import noise_reduction as noise


def make_wav(path: Path, *, frames=481, channels=1, rate=48000) -> bytes:
    randomizer = random.Random(5729)
    samples = [randomizer.randint(-24000, 24000) for _ in range(frames * channels)]
    raw = struct.pack("<" + "h" * len(samples), *samples)
    with wave.open(str(path), "wb") as writer:
        writer.setparams((channels, 2, rate, 0, "NONE", "not compressed"))
        writer.writeframes(raw)
    return raw


@pytest.mark.parametrize("value", [False, True, 1, [], {}, {"engine": "afftdn"},
                                  {"engine": "rnnoise", "extra": 1},
                                  {"engine": "rnnoise", "mix": False},
                                  {"engine": "rnnoise", "mix": "0.5"},
                                  {"engine": "rnnoise", "mix": -0.01},
                                  {"engine": "rnnoise", "mix": 1.01},
                                  {"engine": "rnnoise", "mix": float("nan")},
                                  {"engine": "rnnoise", "mix": float("inf")}])
def test_strict_optional_settings(value):
    with pytest.raises(ValueError):
        noise.validate_noise_reduction(value)


def test_off_default_and_copy_preserving_valid_settings():
    assert noise.validate_noise_reduction(None) is None
    assert noise.validate_noise_reduction({"engine": "rnnoise"}) == {"engine": "rnnoise", "mix": 1.0}
    source = {"engine": "rnnoise", "mix": 0.25}
    result = noise.validate_noise_reduction(source)
    result["mix"] = 1.0
    assert source["mix"] == 0.25


def test_bundled_model_and_original_license_have_pinned_hashes():
    assert len(noise._model_bytes()) == 302903
    assert hashlib.sha256(noise.MODEL_PATH.with_name("COPYING").read_bytes()).hexdigest() == (
        "e2f59ff41d9d03adc3dcf3deff170f8c8cf4a6eb4a9b174762a7656d23200ffa")


@pytest.mark.parametrize("kind", ["missing", "changed-same-size", "too-large", "truncated"])
def test_model_integrity_fails_closed_without_starting_ffmpeg(tmp_path, monkeypatch, kind):
    model = tmp_path / "model.rnnn"
    original = noise._model_bytes()
    variants = {"changed-same-size": b"X" + original[1:], "too-large": original + b"x", "truncated": original[:-1]}
    if kind != "missing":
        model.write_bytes(variants[kind])
    monkeypatch.setattr(noise, "MODEL_PATH", model)
    monkeypatch.setattr(noise.subprocess, "Popen", lambda *a, **kw: pytest.fail("must not launch FFmpeg"))
    source, destination = tmp_path / "in.wav", tmp_path / "existing.wav"
    make_wav(source)
    destination.write_bytes(b"keep existing destination")
    with pytest.raises(noise.NoiseReductionError):
        noise.denoise_rnnoise(source, destination, 0.5, lambda: False, lambda *_: None)
    assert destination.read_bytes() == b"keep existing destination"
    assert not list(tmp_path.glob("rnnoise-output-*"))
    assert not noise.noise_reduction_status()["available"]


def test_missing_ffmpeg_is_actionable_without_optional_libraries(monkeypatch):
    monkeypatch.setattr(noise.shutil, "which", lambda _: None)
    assert noise.noise_reduction_status() == {
        "available": False, "engine": "rnnoise", "model": noise.MODEL_ID,
        "issue": "FFmpeg is required for built-in RNNoise."}


def test_filter_probe_rejects_missing_filter_and_uses_no_shell(monkeypatch):
    calls = []
    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0, b"Unknown filter arnndn")
    monkeypatch.setattr(noise.subprocess, "run", fake_run)
    noise._filter_available.cache_clear()
    assert not noise._filter_available("fake-ffmpeg", 1, 1)
    assert not noise._filter_available("fake-ffmpeg", 1, 1)
    assert len(calls) == 1
    assert calls[0][1]["timeout"] == 5 and calls[0][1]["shell"] is False
    noise._filter_available.cache_clear()


def test_command_pads_full_tail_and_never_interpolates_paths_in_filter(tmp_path):
    source, destination = tmp_path / "한글's input.wav", tmp_path / "processed.wav"
    command = noise._command("ffmpeg", source, destination, 481, 0.5)
    assert command[command.index("-i") + 1] == str(source)
    assert command[command.index("-af") + 1] == (
        "apad=pad_len=959,arnndn=m=std.rnnn:mix=0.5,atrim=start_sample=480:end_sample=961,asetpts=PTS-STARTPTS")
    assert command[-1] == str(destination)
    assert command[command.index("-protocol_whitelist") + 1] == "file,pipe"


@pytest.mark.parametrize("frames", [1, 479, 480, 481, 48017])
@pytest.mark.parametrize("channels", [1, 2])
def test_actual_ffmpeg_dry_mix_is_sample_exact_including_short_and_last_frames(tmp_path, frames, channels):
    if not noise.noise_reduction_available():
        pytest.skip("This optional integration case requires FFmpeg arnndn; unit boundaries remain tested.")
    source, destination = tmp_path / "원본's.wav", tmp_path / "처리.wav"
    samples = make_wav(source, frames=frames, channels=channels)
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    updates = []
    result = noise.denoise_rnnoise(source, destination, 0, lambda: False, lambda *values: updates.append(values))
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before
    with wave.open(str(destination), "rb") as reader:
        assert reader.getnframes() == frames and reader.getnchannels() == channels and reader.getframerate() == 48000
        assert reader.readframes(frames) == samples
    assert result["compensatedLatencySamples"] == 480
    assert result["inputFrames"] == result["outputFrames"] == frames
    assert updates[0][1] == 0 and updates[-1][1] == 1
    assert not list(tmp_path.glob("rnnoise-output-*"))


def test_actual_ffmpeg_wet_mix_changes_samples_but_not_duration_or_source(tmp_path):
    if not noise.noise_reduction_available():
        pytest.skip("This optional integration case requires FFmpeg arnndn.")
    source, destination = tmp_path / "in.wav", tmp_path / "out.wav"
    original = make_wav(source, frames=48017, channels=2)
    before = source.read_bytes()
    noise.denoise_rnnoise(source, destination, 1, lambda: False, lambda *_: None)
    assert source.read_bytes() == before
    with wave.open(str(destination), "rb") as reader:
        assert reader.getnframes() == 48017
        assert reader.getnchannels() == 2
        processed = reader.readframes(48017)
        assert processed != original
    # Broadband deterministic synthetic data avoids the ambiguous peaks of a
    # periodic tone. This verifies the wet path's fixed buffer delay too; it
    # does not assess speech quality or claim an ASR accuracy improvement.
    import numpy as np
    dry = np.frombuffer(original, dtype="<i2").reshape(-1, 2)[:, 0].astype(np.float64)
    wet = np.frombuffer(processed, dtype="<i2").reshape(-1, 2)[:, 0].astype(np.float64)
    correlations = [dry[1000:-1000] @ wet[1000 + lag:len(wet) - 1000 + lag] for lag in range(-600, 601)]
    assert int(np.argmax(correlations)) - 600 == 0


def test_source_path_and_invalid_rate_rejected(tmp_path):
    source = tmp_path / "original.wav"
    make_wav(source)
    before = source.read_bytes()
    with pytest.raises(ValueError, match="preserve"):
        noise.denoise_rnnoise(source, source, 1, lambda: False, lambda *_: None)
    assert source.read_bytes() == before
    make_wav(source, rate=16000)
    with pytest.raises(ValueError, match="48 kHz"):
        noise.denoise_rnnoise(source, tmp_path / "out.wav", 1, lambda: False, lambda *_: None)


def test_cancel_before_launch_does_not_create_output(tmp_path, monkeypatch):
    monkeypatch.setattr(noise.subprocess, "Popen", lambda *a, **kw: pytest.fail("must not launch"))
    with pytest.raises(noise.NoiseReductionCancelled):
        noise.denoise_rnnoise(tmp_path / "missing.wav", tmp_path / "out.wav", 1, lambda: True, lambda *_: None)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("kill_required", [False, True])
def test_cancel_running_child_reaps_and_keeps_existing_destination(tmp_path, monkeypatch, kill_required):
    source, destination = tmp_path / "source.wav", tmp_path / "out.wav"
    make_wav(source)
    before = source.read_bytes()
    destination.write_bytes(b"old valid result")
    state = {"cancel": False, "terminated": False, "killed": False, "reaped": False}
    class FakeProcess:
        def __init__(self, command, **kwargs):
            assert kwargs["shell"] is False
            assert Path(kwargs["cwd"]).joinpath("std.rnnn").read_bytes() == noise._model_bytes()
            Path(command[-1]).write_bytes(b"partial")
            state["cancel"] = True
        def poll(self):
            return None
        def terminate(self):
            state["terminated"] = True
        def kill(self):
            state["killed"] = True
        def wait(self, timeout=None):
            if kill_required and timeout is not None:
                raise subprocess.TimeoutExpired("fake-ffmpeg", timeout)
            state["reaped"] = True
    monkeypatch.setattr(noise.shutil, "which", lambda _: "fake-ffmpeg")
    monkeypatch.setattr(noise.subprocess, "Popen", FakeProcess)
    with pytest.raises(noise.NoiseReductionCancelled):
        noise.denoise_rnnoise(source, destination, 1, lambda: state["cancel"], lambda *_: None)
    assert state["terminated"] and state["reaped"] and state["killed"] == kill_required
    assert source.read_bytes() == before and destination.read_bytes() == b"old valid result"
    assert not list(tmp_path.glob("rnnoise-output-*"))


@pytest.mark.parametrize("failure", ["truncated", "wrong-frames", "wrong-channels", "late-cancel"])
def test_output_checks_and_late_cancel_preserve_old_result(tmp_path, monkeypatch, failure):
    source, destination = tmp_path / "source.wav", tmp_path / "out.wav"
    make_wav(source)
    destination.write_bytes(b"old result")
    cancelled = False
    def run(command, *_):
        nonlocal cancelled
        output = Path(command[-1])
        if failure == "truncated":
            output.write_bytes(b"bad WAV")
        elif failure == "wrong-frames":
            make_wav(output, frames=480)
        elif failure == "wrong-channels":
            make_wav(output, channels=2)
        else:
            shutil.copyfile(source, output)
            cancelled = True
    monkeypatch.setattr(noise, "_run", run)
    monkeypatch.setattr(noise.shutil, "which", lambda _: "fake-ffmpeg")
    with pytest.raises(noise.NoiseReductionError):
        noise.denoise_rnnoise(source, destination, 1, lambda: cancelled, lambda *_: None)
    assert destination.read_bytes() == b"old result"
    assert not list(tmp_path.glob("rnnoise-output-*"))
