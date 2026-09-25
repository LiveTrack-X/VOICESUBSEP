"""Native Qwen adapter contracts with synthetic PCM and fake models only."""
from contextlib import nullcontext
from pathlib import Path
from types import ModuleType, SimpleNamespace
import wave
import sys

import numpy as np
import pytest

from voicesubsep import qwen_asr as qwen
from voicesubsep.inference import AnalysisCancelled


def mark(text, start, end):
    return {"text": text, "start_time": start, "end_time": end}


def test_restores_all_korean_punctuation_spacing_and_real_offset():
    text = '“오늘 회의는,”  여기서 끝납니다!'
    aligned = [mark('오늘', .16, .40), mark('회의는', .40, .8),
               mark('여기서', 1.12, 1.44), mark('끝납니다', 1.44, 2.16)]
    words = qwen.aligned_words(text, aligned, offset=30, duration=3)
    assert ''.join(word['text'] for word in words) == text
    assert words[0]['start'] == 30.16
    assert words[-1]['end'] == 32.16
    assert all('probability' not in word for word in words)


def test_zero_tick_tokens_merge_using_existing_endpoints_without_invented_times():
    words = qwen.aligned_words('The cat sat!', [mark('The', .08, .08), mark('cat', .16, .32),
                                              mark('sat', .4, .4)], offset=0, duration=1)
    assert words == [{'start': .08, 'end': .4, 'text': 'The cat sat!'}]


def test_japanese_width_normalization_keeps_original_text():
    words = qwen.aligned_words('ＡＩとｶﾞｲﾄﾞ。', [mark('AI', 0, .2), mark('と', .2, .3),
                                               mark('ガイド', .3, .8)], offset=0, duration=1)
    assert ''.join(word['text'] for word in words) == 'ＡＩとｶﾞｲﾄﾞ。'
    assert words[-1]['text'] == 'ｶﾞｲﾄﾞ。'


def test_accent_combining_mark_is_not_lost_by_tokenizer_normalization():
    text = 'cafe\u0301!'
    assert qwen.aligned_words(text, [mark('café', 0, .5)], offset=0, duration=1)[0]['text'] == text


def test_one_quantization_tick_at_audio_end_is_clipped():
    assert qwen.aligned_words('끝.', [mark('끝', .8, 1.04)], offset=0, duration=1)[0]['end'] == 1


@pytest.mark.parametrize('alignment', [
    [], [mark('lost', 0, 1)], [mark('one', 0, 0)], [mark('one', -1, .2)],
    [mark('one', 0, 1.2)], [mark('one', float('nan'), 1)], [mark('one', True, 1)],
    [mark('one', .8, .4)], [mark('', 0, 1)], [None],
], ids=['empty', 'text-mismatch', 'all-zero', 'negative', 'outside', 'nan', 'bool', 'reverse', 'empty-token', 'invalid-item'])
def test_invalid_alignment_never_falls_back_to_estimated_times(alignment):
    with pytest.raises(ValueError):
        qwen.aligned_words('one', alignment, offset=0, duration=1)


def test_rejects_overlapping_out_of_order_words():
    with pytest.raises(ValueError, match='역순'):
        qwen.aligned_words('one two', [mark('one', 0, .5), mark('two', .4, .9)], offset=0, duration=1)


@pytest.mark.parametrize('language,expected', [('ko', 'ko'), ('Korean', 'ko'), ('Japanese', 'ja'),
                                             ('ENGLISH', 'en'), ('yue', 'yue'), ('Portuguese', 'pt')])
def test_normalizes_actual_supported_alignment_language(language, expected):
    assert qwen.alignment_language(language) == expected


@pytest.mark.parametrize('language', [None, 'auto', 'Arabic', 'unknown'])
def test_auto_unknown_or_unsupported_detected_language_is_not_assumed_english(language):
    with pytest.raises(ValueError):
        qwen.alignment_language(language)


def test_exact_chunk_and_clip_coverage():
    assert qwen._sample_windows(61 * 16000, None) == [(0, 480000), (480000, 960000), (960000, 976000)]
    assert qwen._sample_windows(40 * 16000, [0, 10, 10, 40]) == [(0, 160000), (160000, 640000)]
    # A video's silent tail is not turned into invented audio or captions.
    assert qwen._sample_windows(31 * 16000, [0, 20, 20, 40, 40, 50], duration=50) == [
        (0, 320000), (320000, 496000)]


@pytest.mark.parametrize('clips', [[0, 1], [0, 1, 2, 3], [0, 2, 1, 3], [0, float('inf')], [True, 3], [0]])
def test_rejects_missing_or_duplicate_source_coverage(clips):
    with pytest.raises(ValueError):
        qwen._sample_windows(3 * 16000, clips)


class Inputs(dict):
    def __init__(self):
        super().__init__(input_ids=np.array([[1, 2, 3]]))

    def to(self, *args):
        return self


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    # This is an adapter unit test, not a Transformers integration test. Fake
    # the small generation-control import as well as the heavy model loader,
    # so the ordinary backend[test] CI environment needs no speech packages.
    transformers = ModuleType('transformers')
    transformers.StoppingCriteria = object
    transformers.StoppingCriteriaList = list
    monkeypatch.setitem(sys.modules, 'transformers', transformers)
    state = SimpleNamespace(events=[], transcript='Hello!', language='English', align=[mark('Hello', .08, .48)],
                            generated=np.array([[1, 2, 3, 8, 9]]), fail_align=False, generate_hook=None)

    class Processor:
        def apply_transcription_request(self, *, audio, language):
            state.events.append(('audio', len(audio), language))
            return Inputs()

        def decode(self, generated, **kwargs):
            return [{'transcription': state.transcript, 'language': state.language}]

    class Model:
        device = 'cpu'
        dtype = 'float32'
        generation_config = SimpleNamespace(eos_token_id=9)

        def generate(self, **kwargs):
            state.events.append(('generate',))
            if state.generate_hook:
                state.generate_hook(kwargs)
            return state.generated

    class AlignerProcessor:
        def prepare_forced_aligner_inputs(self, **kwargs):
            state.events.append(('align_language', kwargs['language']))
            if state.fail_align:
                raise ValueError('simulated alignment failure')
            return Inputs(), [['Hello']]

        def decode_forced_alignment(self, **kwargs):
            return [state.align]

    class Aligner:
        device = 'cpu'
        dtype = 'float32'
        config = SimpleNamespace(timestamp_token_id=151705)

        def __call__(self, **kwargs):
            return SimpleNamespace(logits=None)

    fake_torch = SimpleNamespace(inference_mode=nullcontext)
    monkeypatch.setattr(qwen, '_load_models', lambda *args: (fake_torch, Processor(), Model(), AlignerProcessor(), Aligner()))
    state.kwargs = dict(model_path=tmp_path, aligner_path=tmp_path, language='auto', device='cpu',
                        duration=1, progress=lambda *args: state.events.append(('progress', *args)), cancelled=lambda: False)
    state.path = tmp_path / 'synthetic.wav'
    return state


def pcm(path: Path, seconds: float, *, channels=1):
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(channels)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b'\0\0' * round(seconds * 16000) * channels)


def test_preview_precedes_next_chunk_and_aligned_words_keep_offsets(runtime):
    pcm(runtime.path, 31)
    runtime.kwargs['duration'] = 31
    runtime.kwargs['recognition_preview'] = lambda text: runtime.events.append(('preview', text))
    result = qwen.transcribe_qwen(runtime.path, **runtime.kwargs)
    assert len(result) == 2
    assert result[1]['words'][0]['start'] == 30.08
    kinds = [event[0] for event in runtime.events]
    assert kinds.index('preview') < [index for index, kind in enumerate(kinds) if kind == 'generate'][1]
    assert [event[1] for event in runtime.events if event[0] == 'audio'] == [480000, 16000]
    assert result[0]['text'] == result[0]['words'][0]['text'] == 'Hello!'


def test_video_longer_than_audio_is_supported_without_invented_tail(runtime):
    pcm(runtime.path, 1)
    result = qwen.transcribe_qwen(runtime.path, **{**runtime.kwargs, 'duration': 12,
                                                'clip_timestamps': [0, 6, 6, 12]})
    assert len(result) == 1
    assert [event[1] for event in runtime.events if event[0] == 'audio'] == [16000]


def test_forced_language_works_when_generated_language_marker_is_absent(runtime):
    pcm(runtime.path, 1)
    runtime.language = None
    assert qwen.transcribe_qwen(runtime.path, **{**runtime.kwargs, 'language': 'ko'})
    assert ('align_language', 'ko') in runtime.events


def test_silence_does_not_create_captions_or_fake_preview(runtime):
    pcm(runtime.path, 1)
    runtime.transcript = ''
    runtime.language = None
    assert qwen.transcribe_qwen(runtime.path, **runtime.kwargs, recognition_preview=lambda _: pytest.fail('No preview')) == []
    assert not any(event[0] == 'align_language' for event in runtime.events)


def test_alignment_failure_has_no_partial_caption_fallback_or_preview(runtime):
    pcm(runtime.path, 1)
    runtime.fail_align = True
    with pytest.raises(ValueError, match='simulated'):
        qwen.transcribe_qwen(runtime.path, **runtime.kwargs, recognition_preview=lambda _: pytest.fail('Not aligned'))


def test_cancellation_criteria_stops_generation_and_prevents_alignment(runtime):
    pcm(runtime.path, 1)
    cancellation = {'value': False}
    runtime.kwargs['cancelled'] = lambda: cancellation['value']

    def cancel_during_generate(kwargs):
        cancellation['value'] = True
        assert kwargs['stopping_criteria'][0](None, None) is True

    runtime.generate_hook = cancel_during_generate
    with pytest.raises(AnalysisCancelled):
        qwen.transcribe_qwen(runtime.path, **runtime.kwargs)
    assert not any(event[0] == 'align_language' for event in runtime.events)


def test_token_limit_rejects_incomplete_text(runtime, monkeypatch):
    pcm(runtime.path, 1)
    monkeypatch.setattr(qwen, 'MAX_NEW_TOKENS', 2)
    runtime.generated = np.array([[1, 2, 3, 7, 8]])
    with pytest.raises(ValueError, match='출력 한도'):
        qwen.transcribe_qwen(runtime.path, **runtime.kwargs)


def test_unconverted_input_is_rejected_before_loading_models(runtime, monkeypatch):
    pcm(runtime.path, 1, channels=2)
    monkeypatch.setattr(qwen, '_load_models', lambda *args: pytest.fail('Invalid input must not load models'))
    with pytest.raises(ValueError, match='PCM16'):
        qwen.transcribe_qwen(runtime.path, **runtime.kwargs)


def test_native_loading_is_local_only_and_never_uses_remote_code_or_device_map(monkeypatch, tmp_path):
    calls = []

    class Model:
        @staticmethod
        def from_pretrained(path, **kwargs):
            calls.append(('model', path, kwargs))
            return Model()

        def to(self, device):
            calls.append(('device', device))
            return self

        def eval(self):
            return self

    class Processor:
        @staticmethod
        def from_pretrained(path, **kwargs):
            calls.append(('processor', path, kwargs))
            return Processor()

    monkeypatch.setitem(sys.modules, 'torch', SimpleNamespace(float16='float16', float32='float32'))
    monkeypatch.setattr(qwen, 'load_qwen_classes', lambda: (Model, Model, Processor))
    qwen._load_models(tmp_path / 'asr', tmp_path / 'aligner', 'cuda')
    assert len(calls) == 6
    for kind, _path, kwargs in [call for call in calls if call[0] != 'device']:
        assert kwargs['local_files_only'] is True and kwargs['trust_remote_code'] is False
        assert 'device_map' not in kwargs
        if kind == 'model':
            assert kwargs['dtype'] == 'float16'
