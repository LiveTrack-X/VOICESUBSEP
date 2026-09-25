"""Shared file/preview order: optional built-in denoising, then VST effects."""
from __future__ import annotations

from pathlib import Path
import tempfile


def process_preprocessing(source: Path, destination: Path, chain: list[dict], cancelled, progress,
                          noise_reduction: dict | None = None) -> dict:
    from .vst_host import VSTCancelled, process_chain
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or (destination.exists() and source.samefile(destination)):
        raise ValueError("Audio preprocessing must preserve the original source file.")
    if noise_reduction is None:
        return process_chain(source, destination, chain, cancelled, progress)
    from .noise_reduction import denoise_rnnoise, validate_noise_reduction, NoiseReductionCancelled
    options = validate_noise_reduction(noise_reduction)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # The noise stage is app-owned and separate from both the original and the
    # final staged VST output. A failure never promotes an incomplete result.
    with tempfile.TemporaryDirectory(prefix="noise-preprocess-", dir=destination.parent) as directory:
        denoised = Path(directory) / "denoised.wav"
        try:
            noise_report = denoise_rnnoise(source, denoised, options["mix"], cancelled,
                lambda stage, fraction: progress(stage, .5 * fraction))
        except NoiseReductionCancelled as error:
            raise VSTCancelled("Audio preprocessing was cancelled.") from error
        if cancelled():
            raise VSTCancelled("Audio preprocessing was cancelled.")
        report = process_chain(denoised, destination, chain, cancelled,
            lambda stage, fraction: progress(stage, .5 + .5 * fraction))
        report["noiseReduction"] = noise_report
        report["bypassed"] = False
        report["warnings"] = [*noise_report.get("warnings", []), *report.get("warnings", [])]
        return report
