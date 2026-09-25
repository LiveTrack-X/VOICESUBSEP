# Qwen source runtime / Qwen 소스 실행 환경

**Status, 2026-09-25:** implemented and tested with synthetic audio/fake models in the development
environment. **Not included in the frozen desktop installer.** No Qwen speech weights were downloaded,
and real recognition/alignment quality, GPU memory, throughput and frozen runtime execution were not verified.

**2026-09-25 상태:** 개발 환경의 소스 어댑터와 합성 음원·모의 모델 검증을 완료했습니다.
**동결 설치본에는 포함하지 않습니다.** Qwen 음성 가중치를 받지 않았으며 실제 인식·정렬 품질,
GPU 메모리·속도·설치본 실행 검증은 하지 않았습니다. 기본 분석은 Whisper + Nemotron입니다.

## Runtime contract / 실행 계약

- Optional source dependency group: `backend[qwen]`. It is separate from the default `diarization` extra.
  / 선택 소스 의존성은 `backend[qwen]`이며 기본 `diarization` extra와 분리합니다.
- Native Transformers commit: `4b28d51d0d5f17ec20c23a187d0475a8e68810c8`; local-only loading,
  no remote model code, no Ollama. / 고정 네이티브 Transformers를 사용하며 로컬 경로만 로드합니다.
- 16kHz mono PCM16, at most 30 seconds per recognition/alignment chunk. Real forced-aligned endpoints
  are shifted by the source offset. Punctuation/spacing and Japanese width normalization preserve the
  original text. Invalid/truncated/mismatched output fails; no equal-time word approximation is used.
  / 30초 이하 구간을 실제 forced aligner로 정렬하고 원본 시점을 더합니다. 원문·문장부호를 보존하며
  잘린 출력·텍스트 불일치·유효하지 않은 시간은 오류로 처리합니다. 임의의 균등 시간은 만들지 않습니다.
- The aligner's native 80ms quantization can produce zero-length tokens. Those tokens are joined to
  adjacent aligned tokens using existing endpoints; an end within one 80ms tick beyond the audio is clipped.
  / 80ms 양자화로 길이 0인 토큰은 인접 정렬 토큰의 실제 경계로 합치고, 음원 끝 1틱 이내 초과는 잘라냅니다.
- Supported alignment languages: Korean, English, Japanese, Chinese, Cantonese, French, German, Italian,
  Portuguese, Russian, Spanish. AUTO must detect one of these; unsupported/unknown results fail explicitly.
  / 정렬은 한국어·영어·일본어·중국어·광둥어·프랑스어·독일어·이탈리아어·포르투갈어·러시아어·스페인어입니다.
  AUTO가 지원 밖 언어를 감지하면 임의 언어를 대신 사용하지 않습니다.
- Completed chunk text is an optional recognition preview, not the final saved caption result.
  / 완료 구간의 진행 미리보기와 최종 자막 저장 결과는 구분됩니다.

Primary API reference / 공식 API:
[Transformers native Qwen3 ASR](https://github.com/huggingface/transformers/blob/4b28d51d0d5f17ec20c23a187d0475a8e68810c8/docs/source/en/model_doc/qwen3_asr.md).

## Fixed snapshots / 고정 모델

| Model / 모델 | Revision | Weight bytes / 가중치 크기 |
| --- | --- | --- |
| [ASR 1.7B](https://huggingface.co/Qwen/Qwen3-ASR-1.7B-hf/tree/bcd2b5b7f32b480ab5790554cfa8347f246a14f3) | `bcd2b5b7f32b480ab5790554cfa8347f246a14f3` | 4,076,193,080 |
| [ASR 0.6B](https://huggingface.co/Qwen/Qwen3-ASR-0.6B-hf/tree/7f1569a48a89f3e3f4dc3a5c9d28bddd903bc76c) | `7f1569a48a89f3e3f4dc3a5c9d28bddd903bc76c` | 1,564,928,088 |
| [Forced aligner 0.6B](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B-hf/tree/c07281df297b9905d24a508279258cccf987a064) | `c07281df297b9905d24a508279258cccf987a064` | 1,835,545,960 |

Only an explicitly selected analysis resolves/downloads these snapshots. Startup/health does not.
New caches use ordinary files (`local_dir`, one worker), validate configuration, pinned weight length
and the safetensors data table. This completeness check is **not a separate full-weight SHA-256 audit**;
same-length payload corruption is not detected by the local header/length check. Offline incomplete caches fail.

가중치는 사용자가 선택한 분석에서만 준비하며 시작·health 조회에서는 받지 않습니다. 일반 파일·단일 작업자로
다운로드하고 구성·고정 크기·safetensors 데이터 범위를 검사합니다. **별도의 전체 가중치 SHA-256 검증은 아닙니다.**
같은 크기의 데이터 비트 손상까지 로컬 헤더 검사로 검출하지는 않습니다. 불완전한 오프라인 캐시는 실행하지 않습니다.

## Distribution audit gate / 배포 감사 보류

The source extra pins `soynlp==0.0.493`, `nagisa==0.3.0`, `DyNet38==2.2`.
The following evidence prevents silently treating the PyPI soynlp wheel as a cleared desktop dependency:

소스 extra는 위 세 패키지 버전을 고정합니다. 다음 실제 불일치를 확인했으므로 soynlp wheel을
검토 완료된 설치본 의존성으로 간주하지 않습니다.

| Evidence / 근거 | Observed / 관찰 결과 |
| --- | --- |
| [PyPI soynlp 0.0.493](https://pypi.org/project/soynlp/0.0.493/) wheel metadata | GPLv3 classifier; package `__init__.py` declares `GPL v3` / GPLv3로 명시 |
| Wheel SHA-256 | `2aed0ced1f0f74f7bdd0bdc24a979c5cb9ee4a28393642db52a83d174ed65b7a` |
| [Upstream fixed LICENSE](https://github.com/lovit/soynlp/blob/4b8cc5bfb111d3bd4b000e2e6e18eee9c29f9925/LICENSE) | LGPLv3 text / LGPLv3 원문 |
| [Same source setup.py](https://github.com/lovit/soynlp/blob/4b8cc5bfb111d3bd4b000e2e6e18eee9c29f9925/setup.py) and [package declaration](https://github.com/lovit/soynlp/blob/4b8cc5bfb111d3bd4b000e2e6e18eee9c29f9925/soynlp/__init__.py) | setup GPLv3; package LGPL / 소스 내부 표기도 불일치 |
| [Newer 0.1.1 tag setup.py](https://github.com/lovit/soynlp/blob/47c5b6edd9298cfa4fab2da2a3ed19532c9e9617/setup.py) | Still GPLv3 classifier with LGPLv3 LICENSE / 최신 태그도 불일치 |

This records conflicting upstream declarations, **not a legal ruling about which declaration controls**.
A source pin alone does not resolve the observed mismatch. No declarations or library algorithms were rewritten.
The application's license declarations were not changed. A feature being optional in the UI would not remove obligations
for a library actually shipped in the installer.

이는 상충하는 upstream 표시의 기록이며 **어느 선언이 법적으로 우선한다는 판단이 아닙니다**.
소스 commit 고정만으로 이 불일치가 해소되지는 않았습니다. 라이선스 선언·토큰화 알고리즘을 고치지 않았으며
앱의 라이선스 선언도 바꾸지 않았습니다. UI에서 선택 기능이어도 설치본에 실제 포함한 라이브러리의 조건은 남습니다.

Default `build-backend.ps1` explicitly excludes Qwen, soynlp, nagisa and DyNet modules. An explicit
`-IncludeQwenRuntime` request fails immediately with this audit reason; it does not weaken the original notice gate.
The health response consequently cannot advertise the excluded Qwen runtime as installed.
Before any future Qwen desktop distribution, resolve the license provenance, preserve the corresponding
source/notices and test the actual frozen runtime. The [fixed DyNet38 Apache notice](../third-party/DyNet38-2.2/SOURCE.md)
is separately preserved and hash-checked because its 2.2 wheel omits that notice; it does not clear soynlp.

기본 동결 빌드는 해당 모듈을 명시적으로 제외합니다. `-IncludeQwenRuntime` 요청만 감사 사유로 즉시 실패하며
기존 원본 고지 검사를 완화하지 않습니다. 향후 Qwen 설치본 배포 전에는 출처·조건 확인, 대응 소스·고지 보존,
실제 동결 실행 검증이 필요합니다. DyNet38의 확인된 원본 Apache 고지는 별도 보존하며 soynlp의 해소를 뜻하지 않습니다.
