# Optional speech tool model provenance

Weights are separate, user-prepared local downloads. No weight is bundled in the installer.

| Model | Immutable revision | Original declaration |
| --- | --- | --- |
| [WeSpeaker ResNet34-LM](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM) | `f0c48c298fd835726c27956a5d617bad7115627e` | CC-BY-4.0 model weights; the inference implementation is Apache-2.0 |
| [SpeechBrain SepFormer WSJ0-2Mix](https://huggingface.co/speechbrain/sepformer-wsj02mix) | `3a2826343a10e2d2e8a75f79aeab5ff3a2473531` | Apache-2.0 model and runtime |

The original pinned cards are retained verbatim in this directory. WeSpeaker card SHA-256: `af2f6592a73d1333b872f75c6047f24bd1bb53346c0597edc1544140aa9c7e73`. SepFormer card SHA-256: `839e9b410929ccea560c75640438e8c8145ef812ebfe1ecd2ffbcf461edd8829`.

Attribution: WeNet/WeSpeaker contributors for the pretrained speaker model, and SpeechBrain contributors for SepFormer. This application performs preprocessing, similarity scoring, short-window separation and retranscription; it does not modify their weight files. Preserve original attribution and license references when redistributing these model files. Model outputs are experimental candidates, not identity or transcription guarantees.

License references: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/), [pinned WeSpeaker pretrained-model declarations](https://github.com/wenet-e2e/wespeaker/blob/9fecd6cb4f47475d01761d87c826298dff4ef18c/docs/pretrained.md), and the original SpeechBrain 1.1.2 Apache license preserved as `SpeechBrain-LICENSE.txt` (SHA-256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`).

Weights are loaded only after exact byte-length and SHA-256 verification; the manifests live in `voice_embedding_cache.py` and `overlap_model_cache.py`. The application executes no downloaded Python or model YAML.
