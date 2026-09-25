# Advanced providers / 고급 공급자 설정

Local processing remains the default. Speech recognition, speaker diarization, subtitle translation and meeting draft generation are separate choices. A cloud speech recognizer can be combined with local Nemotron; selecting a cloud recognizer does not turn all processing into cloud processing.

기본은 로컬 처리입니다. 음성 인식·화자 구분·자막 번역·회의록 초안 생성은 서로 다른 선택입니다. 클라우드 음성 인식과 로컬 Nemotron을 조합할 수 있으며, 인식 공급자를 바꾸었다고 모든 처리가 클라우드로 전환되지는 않습니다.

| Stage / 단계 | Default / 기본 | Optional / 선택 |
| --- | --- | --- |
| Speech recognition / 음성 인식 | Local faster-whisper / 로컬 faster-whisper | Groq Whisper large-v3 or turbo; xAI Grok Voice Transcribe / Groq Whisper large-v3·turbo, xAI Grok Voice Transcribe |
| Speaker activity / 화자 구분 | Local NVIDIA Nemotron when enabled / 사용 시 로컬 NVIDIA Nemotron | Disable automatic diarization and assign names manually / 자동 구분을 끄고 수동 인물 배정 |
| Subtitle translation / 자막 번역 | Installed local Ollama model / 설치된 로컬 Ollama 모델 | Groq or xAI text model / Groq·xAI 텍스트 모델 |
| Meeting drafts / 회의록 초안 | Installed local Ollama model / 설치된 로컬 Ollama 모델 | Groq or xAI text model / Groq·xAI 텍스트 모델 |

## Connect and run / 연결과 실행

Open advanced settings in the relevant analysis/translation/document dialog. Select a provider and a supported model, enter that provider's API key, and keep it for this session. A configured key only means the app has it in memory; it does not prove account credit or model access. Review the external transmission notice before starting. Audio recognition sends audio; translation and meeting drafts send transcript text. Requests remain separate, and failed cloud requests do not silently switch provider or start paid retries.

분석·번역·문서 창에서 고급 설정을 열고 공급자와 모델을 선택합니다. 해당 공급자의 API 키를 입력해 이번 세션에서 사용합니다. 키가 등록되었다는 표시는 앱의 메모리에 보관되었다는 뜻이며, 잔액·모델 접근 권한을 보증하지 않습니다. 실행 전 외부 전송 안내를 확인하세요. 음성 인식은 음성을 보내고 번역·회의록은 전사 텍스트를 보냅니다. 각 단계는 별도로 선택하며 실패 시 다른 공급자로 자동 전환하거나 유료 요청을 자동 재시도하지 않습니다.

Keys are not saved in project JSON, settings backups or job records. Closing the backend clears them; removing a key prevents subsequent requests using it. A request already sent may still complete or be billed by the provider. Stopping a job cannot retract data already transmitted. Models, availability, rate limits and prices depend on the provider/account; use their console for spending limits.

키는 프로젝트 JSON·설정 백업·작업 기록에 저장하지 않습니다. 백엔드가 종료되면 사라지고, 키를 제거하면 이후 요청에 사용할 수 없습니다. 이미 보낸 요청은 공급자에서 완료되거나 과금될 수 있으며 작업 중지로 이미 전송된 데이터를 회수할 수는 없습니다. 모델·가용성·요청 제한·요금은 공급자와 계정에 따라 달라지므로 비용 한도는 공급자 콘솔에서 관리하세요.

Local Nemotron still needs its local runtime/model even when recognition uses an API. Cloud transcription does not provide stable cross-file speaker identities in this release. xAI's API `language` option is a formatting hint, not the same input-language constraint as Whisper. Review mixed-language and overlapping speech against the source.

인식에 API를 사용하더라도 로컬 Nemotron을 켜면 해당 로컬 실행 환경과 모델이 필요합니다. 이번 릴리즈의 클라우드 전사는 여러 파일에 걸친 화자 ID 연결을 제공하지 않습니다. xAI의 API `language` 옵션은 표기 보조이며 Whisper의 입력 언어 지정과 의미가 다릅니다. 혼합 언어·겹친 발화는 원본과 비교해 검수하세요.

## ChatGPT OAuth / ChatGPT 로그인

This app does not reuse ChatGPT/Codex login tokens. The public authentication documentation describes ChatGPT subscription sign-in for supported OpenAI clients and directs general OpenAI API calls to Platform API keys. An official OAuth contract for this independent app's ASR/translation calls was not established. This release implements Groq/xAI API-key providers; it does not claim ChatGPT subscription access or an OpenAI API adapter. [OpenAI authentication documentation](https://developers.openai.com/codex/auth).

이 앱은 ChatGPT/Codex 로그인 토큰을 재사용하지 않습니다. 공개 인증 문서는 지원되는 OpenAI 클라이언트의 ChatGPT 구독 로그인을 설명하고, 일반 OpenAI API 호출에는 Platform API 키를 사용하도록 안내합니다. 이 독립 앱의 음성 인식·번역 호출에 사용할 공식 OAuth 계약은 확인하지 못했습니다. 이번 릴리즈는 Groq·xAI API 키 공급자를 구현하며 ChatGPT 구독 사용이나 OpenAI API 어댑터를 제공한다고 표시하지 않습니다. [OpenAI 인증 문서](https://developers.openai.com/codex/auth).

## Models and verification / 모델과 검증

Groq's Whisper endpoint and xAI's speech endpoint have different request/response formats. They are implemented separately; xAI is not labelled as Whisper. Their official contracts are [Groq speech to text](https://console.groq.com/docs/speech-to-text), [xAI speech to text](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text), [Groq text generation](https://console.groq.com/docs/text-chat), and [xAI text generation](https://docs.x.ai/developers/model-capabilities/text/generate-text).

Groq Whisper와 xAI 음성 API는 요청·응답 형식이 달라 각각 처리합니다. xAI를 Whisper라고 표시하지 않습니다. 위 공식 문서에서 지원 형식과 최신 조건을 확인하세요. 자동 테스트의 모의 응답 통과는 실제 계정의 접근 가능성·서비스 속도·인식/번역 품질을 입증하지 않습니다. 실제 유료 호출 검증 여부는 [릴리즈 기록](releases/v0.2.1.md)을 따릅니다.

The local speaker model is the regular [`nvidia/Nemotron-3-Diarization`](https://huggingface.co/nvidia/Nemotron-3-Diarization), pinned at `f667ed73aee57d40cc39428eb768b4fd87a0a29e`, under [OpenMDW 1.1](https://openmdw.ai/license/1-1/). The pinned revision was public and ungated when checked on 2026-09-25. It is not the separately licensed `-preview` model. Weights are downloaded separately, not bundled in the installer. Redistribution of model materials requires preserving the license and relevant notices; this is separate from the app and bundled dependency licensing.

로컬 화자 모델은 정식 `nvidia/Nemotron-3-Diarization`의 위 고정 버전이며 OpenMDW 1.1을 적용합니다. 2026-09-25 확인 당시 공개·동의 제한 없는 버전이었으며 별도 평가용 `-preview`가 아닙니다. 가중치는 설치기에 포함하지 않고 별도로 다운로드합니다. 모델 자료를 재배포할 때는 라이선스·관련 고지를 보존해야 하며, 앱·포함 의존성의 라이선스는 별개입니다. [포함 의존성 고지](BUNDLED-NOTICES.md)를 함께 확인하세요.
