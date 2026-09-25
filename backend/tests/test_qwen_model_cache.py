"""Pinned cache routing/completeness using tiny fixtures; no model downloads."""
from dataclasses import replace
import json
from pathlib import Path
import struct

import pytest

from voicesubsep import qwen_model_cache as cache


def weights():
    header = json.dumps({'fixture.weight': {'dtype': 'F32', 'shape': [4], 'data_offsets': [0, 16]}}).encode()
    return struct.pack('<Q', len(header)) + header + b'\0' * 16


def complete(directory: Path, snapshot):
    directory.mkdir(parents=True, exist_ok=True)
    files = {
        'config.json': {'model_type': 'qwen3_asr', 'architectures': [snapshot.architecture],
                        'timestamp_token_id': 151705, 'audio_config': {'num_mel_bins': 128},
                        'text_config': {'model_type': 'qwen3'}},
        'processor_config.json': {'processor_class': 'Qwen3ASRProcessor', 'timestamp_segment_time': 80,
                                  'feature_extractor': {'feature_extractor_type': 'Qwen3ASRFeatureExtractor',
                                                        'sampling_rate': 16000, 'feature_size': 128}},
        'tokenizer_config.json': {'tokenizer_class': 'TokenizersBackend'},
        'tokenizer.json': {'model': {'vocab': {'hello': 1}}},
        'generation_config.json': {'eos_token_id': 151645},
    }
    for filename in cache._files(snapshot):
        if filename == 'model.safetensors':
            (directory / filename).write_bytes(weights())
        elif filename == 'chat_template.jinja':
            (directory / filename).write_text('{{ messages }}', encoding='utf-8')
        else:
            (directory / filename).write_text(json.dumps(files[filename]), encoding='utf-8')
    return directory


@pytest.fixture
def fixture_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(cache, '_model_root', lambda: tmp_path)
    snapshot = replace(cache.QWEN_MODELS['qwen3-asr-0.6b'], weights_size=len(weights()))
    monkeypatch.setitem(cache.QWEN_MODELS, 'qwen3-asr-0.6b', snapshot)
    directory = tmp_path / snapshot.repo.split('/')[1] / snapshot.revision
    for name in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
        monkeypatch.delenv(name, raising=False)
    return directory, snapshot


def test_complete_cache_is_reused_without_hub_or_mutation(fixture_cache, monkeypatch):
    directory, snapshot = fixture_cache
    complete(directory, snapshot)
    before = {file.name: file.read_bytes() for file in directory.iterdir()}
    monkeypatch.setattr(cache, '_download', lambda *args, **kwargs: pytest.fail('No download'))
    assert cache.resolve_qwen_model('qwen3-asr-0.6b') == str(directory.resolve())
    assert before == {file.name: file.read_bytes() for file in directory.iterdir()}


def test_first_selected_inference_downloads_missing_files_once(fixture_cache, monkeypatch):
    directory, snapshot = fixture_cache
    calls = []

    def download(spec, path, files, **kwargs):
        calls.append((spec, path, files, kwargs))
        complete(path, spec)

    monkeypatch.setattr(cache, '_download', download)
    assert cache.resolve_qwen_model('qwen3-asr-0.6b') == str(directory.resolve())
    assert calls == [(snapshot, directory, list(cache._files(snapshot)), {'force_download': False})]


def test_download_uses_only_pinned_allowlist_single_worker_ordinary_local_files(monkeypatch, tmp_path):
    import huggingface_hub
    calls = []
    monkeypatch.setattr(huggingface_hub, 'snapshot_download', lambda *args, **kwargs: calls.append((args, kwargs)))
    spec = cache.QWEN_ALIGNER
    cache._download(spec, tmp_path, ['config.json'], force_download=False)
    assert calls == [((spec.repo,), {'revision': spec.revision, 'local_dir': str(tmp_path),
                                  'allow_patterns': ['config.json'], 'max_workers': 1, 'force_download': False})]


def test_incomplete_weights_are_refetched_even_when_hub_metadata_exists(fixture_cache, monkeypatch):
    directory, snapshot = fixture_cache
    complete(directory, snapshot)
    (directory / 'model.safetensors').write_bytes(weights()[:-1])
    calls = []

    def repair(spec, path, files, **kwargs):
        calls.append((files, kwargs))
        (path / 'model.safetensors').write_bytes(weights())

    monkeypatch.setattr(cache, '_download', repair)
    assert cache.resolve_qwen_model('qwen3-asr-0.6b') == str(directory.resolve())
    assert calls == [(['model.safetensors'], {'force_download': True})]


@pytest.mark.parametrize('name', ['HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'])
def test_offline_missing_model_never_calls_hub_or_makes_directories(fixture_cache, monkeypatch, name):
    directory, _ = fixture_cache
    monkeypatch.setenv(name, '1')
    monkeypatch.setattr(cache, '_download', lambda *args, **kwargs: pytest.fail('Offline'))
    with pytest.raises(RuntimeError, match='오프라인'):
        cache.resolve_qwen_model('qwen3-asr-0.6b')
    assert not directory.exists()


def test_download_failure_preserves_partial_files(fixture_cache, monkeypatch):
    directory, _ = fixture_cache

    def failed(_spec, path, *args, **kwargs):
        (path / 'partial.incomplete').write_bytes(b'preserve')
        raise OSError('fixture error')

    monkeypatch.setattr(cache, '_download', failed)
    with pytest.raises(RuntimeError, match='부분 다운로드'):
        cache.resolve_qwen_model('qwen3-asr-0.6b')
    assert (directory / 'partial.incomplete').read_bytes() == b'preserve'


def test_invalid_postdownload_never_returns_path(fixture_cache, monkeypatch):
    monkeypatch.setattr(cache, '_download', lambda *args, **kwargs: None)
    with pytest.raises(RuntimeError, match='불완전'):
        cache.resolve_qwen_model('qwen3-asr-0.6b')


def test_model_name_cannot_escape_known_registry(fixture_cache, monkeypatch):
    monkeypatch.setattr(cache, '_download', lambda *args, **kwargs: pytest.fail('Invalid model'))
    with pytest.raises(ValueError):
        cache.resolve_qwen_model('../../other')


@pytest.mark.parametrize('filename,content', [
    ('config.json', {'model_type': 'qwen3_asr', 'architectures': ['RemoteCode']}),
    ('processor_config.json', {'processor_class': 'Qwen3ASRProcessor', 'feature_extractor': {'sampling_rate': 8000}}),
    ('tokenizer.json', {'model': {'vocab': {}}}),
    ('generation_config.json', {}),
])
def test_wrong_runtime_configs_are_not_treated_as_complete(fixture_cache, filename, content):
    directory, snapshot = fixture_cache
    complete(directory, snapshot)
    (directory / filename).write_text(json.dumps(content), encoding='utf-8')
    assert cache._invalid_files(directory, snapshot) == [filename]


def test_wrong_safetensors_offset_or_shape_fails_completeness(tmp_path):
    content = weights()
    path = tmp_path / 'model.safetensors'
    path.write_bytes(content)
    assert cache._weights_complete(path, len(content))
    damaged = content.replace(b'[0, 16]', b'[1, 16]')
    assert len(damaged) == len(content)
    path.write_bytes(damaged)
    assert not cache._weights_complete(path, len(content))


def test_asr_and_aligner_revisions_are_separate_and_fixed():
    specs = [*cache.QWEN_MODELS.values(), cache.QWEN_ALIGNER]
    assert len({spec.revision for spec in specs}) == 3
    assert all(len(spec.revision) == 40 and int(spec.revision, 16) for spec in specs)
    assert 'generation_config.json' not in cache._files(cache.QWEN_ALIGNER)
