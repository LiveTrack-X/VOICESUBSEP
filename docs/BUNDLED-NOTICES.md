# Bundled dependency notices / 번들 의존성 고지

This page identifies notices shipped in the Windows backend and the upstream source locations checked for the **v0.2.0 Windows preview** on **2026-09-25**. It supplements the unchanged installer artifacts; updating this page does not replace the notice file already inside those artifacts. Link to this page beside the release downloads.

이 문서는 Windows 백엔드에 포함된 고지와 **v0.2.0 Windows Preview**에 대해 **2026-09-25** 확인한 원본 소스 위치를 안내합니다. 기존 설치 파일은 변경하지 않았으며, 이 문서의 수정이 이미 배포된 설치 파일 안의 고지를 바꾸지는 않습니다. 릴리즈 다운로드 옆에서 이 문서로 연결합니다.

## Notices included in the installer / 설치 파일에 포함된 고지

The Windows backend build preserves original installed notices without editing the source files:

- PyTorch, Transformers, librosa, Numba, llvmlite, SciPy, SoundFile, soxr, safetensors and NumPy: complete installed `*.dist-info` directories, including their original license and notice files, under `_internal/`. Runtime dependency metadata for PyTorch, Transformers and librosa is also retained.
- Optional Pedalboard VST3 runtime: when installed in the build environment, its Python package, `pedalboard_native` extension and original `*.dist-info` license/notice files are included. Pedalboard is GPL-3.0; retaining notices alone does not satisfy all redistribution/source obligations. Third-party VST3 plugins and their licenses are not bundled.
- CUDA libraries: when the installed `torch/lib` contains every DLL required by the backend's GPU probe, the build uses that copy for both PyTorch and CTranslate2 and preserves the actual PyTorch wheel's original `LICENSE` and `NOTICE`. It does not add a second cuBLAS/cuDNN runtime from separately installed NVIDIA packages. If the torch copy is incomplete, the NVIDIA cuBLAS, cuDNN, CUDA Runtime and NVRTC package directories and complete `*.dist-info` directories, including `licenses/License.txt`, are included instead.
- FFmpeg and FFprobe: original `LICENSE`/`COPYING`, `README` and other notice files found beside the executables or in their installation root, under `_internal/third-party/ffmpeg/`. A separately installed FFprobe uses `_internal/third-party/ffprobe/`.

한국어 안내:

- PyTorch·Transformers·librosa·Numba·llvmlite·SciPy·SoundFile·soxr·safetensors·NumPy의 설치된 `*.dist-info` 원본 라이선스·고지를 `_internal/`에 보존합니다.
- v0.2.0에는 **Pedalboard 0.9.25** VST3 실행 환경과 원본 GPLv3 라이선스·고지가 포함됩니다. CLEAR·RX 등 사용자가 설치한 외부 VST3 플러그인과 그 라이선스는 포함하지 않습니다.
- CUDA DLL은 필요한 파일이 모두 있을 때 PyTorch의 `torch/lib`에서 가져오며, 실제 PyTorch wheel의 `LICENSE`·`NOTICE`를 함께 보존합니다. 별도 NVIDIA 패키지를 사용하는 경우에는 해당 패키지의 원본 고지도 보존합니다. PyTorch의 라이선스만 보고 모든 CUDA 구성요소의 조건이 같다고 해석하지 않습니다.
- FFmpeg·FFprobe 원본 `LICENSE`·`README`는 `_internal/third-party/ffmpeg/` 아래에 있습니다.

The copied FFmpeg README preserves the installed distributor's version, source reference and build information. The build fails if required notices are missing or if a bundled notice's SHA256 differs from its installed original. Do not remove these files when copying or packaging the backend folder.

FFmpeg README에는 실제 배포자의 버전·소스 참조·빌드 정보가 보존됩니다. 필수 고지가 없거나 설치된 원본과 복사본의 SHA256이 다르면 빌드는 실패합니다. 백엔드 폴더를 복사하거나 패키징할 때 이 파일들을 제거하지 않습니다.

## Pedalboard 0.9.25 source / Pedalboard 0.9.25 소스

The official `v0.9.25` tag resolves to **`d4e18fcf822e1602e014a24ddd670d8a9bf8a3f9`**. The packaged runtime is `pedalboard 0.9.25`; its license is GPLv3. Installed notice paths are `resources/backend/_internal/pedalboard-0.9.25.dist-info/licenses/LICENSE` and `NOTICE`.

공식 `v0.9.25` 태그의 커밋은 **`d4e18fcf822e1602e014a24ddd670d8a9bf8a3f9`**이며, 설치 파일의 Pedalboard 실행 환경 버전은 `0.9.25`, 라이선스는 GPLv3입니다. 고지는 위 경로의 `LICENSE`와 `NOTICE`에서 확인할 수 있습니다.

| Material / 자료 | Version-pinned upstream location / 버전 고정 원본 위치 |
| --- | --- |
| Source tree / 소스 트리 | [Pedalboard 0.9.25 commit](https://github.com/spotify/pedalboard/tree/d4e18fcf822e1602e014a24ddd670d8a9bf8a3f9) |
| License and notices / 라이선스·고지 | [LICENSE](https://raw.githubusercontent.com/spotify/pedalboard/d4e18fcf822e1602e014a24ddd670d8a9bf8a3f9/LICENSE), [NOTICE](https://raw.githubusercontent.com/spotify/pedalboard/d4e18fcf822e1602e014a24ddd670d8a9bf8a3f9/NOTICE) |
| Build inputs / 빌드 입력 | [CMakeLists.txt](https://raw.githubusercontent.com/spotify/pedalboard/d4e18fcf822e1602e014a24ddd670d8a9bf8a3f9/CMakeLists.txt), [pyproject.toml](https://raw.githubusercontent.com/spotify/pedalboard/d4e18fcf822e1602e014a24ddd670d8a9bf8a3f9/pyproject.toml), [upstream build workflow](https://raw.githubusercontent.com/spotify/pedalboard/d4e18fcf822e1602e014a24ddd670d8a9bf8a3f9/.github/workflows/all.yml) |
| Source checkout instructions / 소스 준비 안내 | [CONTRIBUTING.md](https://raw.githubusercontent.com/spotify/pedalboard/d4e18fcf822e1602e014a24ddd670d8a9bf8a3f9/CONTRIBUTING.md), [.gitmodules](https://raw.githubusercontent.com/spotify/pedalboard/d4e18fcf822e1602e014a24ddd670d8a9bf8a3f9/.gitmodules) |
| Published distribution metadata / 배포 메타데이터 | [PyPI 0.9.25](https://pypi.org/project/pedalboard/0.9.25/), [version-specific JSON metadata](https://pypi.org/pypi/pedalboard/0.9.25/json) |

**A plain GitHub source ZIP is not a complete recursive checkout.** PyPI's 0.9.25 metadata listed wheels but **no source distribution** when checked. Obtain the pinned repository with its submodules, following the upstream instructions. The upstream `.gitmodules` uses an SSH URL for pybind11; an HTTPS equivalent is linked below for users without GitHub SSH configuration.

**GitHub 소스 ZIP만으로 재귀 하위 모듈까지 준비되지는 않습니다.** 확인 당시 PyPI 0.9.25에는 wheel만 있고 **소스 배포본(sdist)은 없었습니다**. 공식 안내에 따라 고정 커밋과 하위 모듈을 함께 준비해야 합니다. `.gitmodules`의 pybind11 주소는 SSH 형식이므로 SSH 설정이 없는 경우 아래의 동일 공식 HTTPS 저장소를 사용할 수 있습니다.

The five submodule commits below were read from the pinned Pedalboard tree and confirmed available through the corresponding upstream repositories. / 아래 다섯 커밋은 고정 Pedalboard 트리에서 읽고 각 원본 저장소에서 존재를 확인했습니다.

| Submodule / 하위 모듈 | Pinned source / 고정 소스 |
| --- | --- |
| `JUCE` | [juce-framework/JUCE · ddaa09110392a4419fecbb6d3022bede89b7e841](https://github.com/juce-framework/JUCE/tree/ddaa09110392a4419fecbb6d3022bede89b7e841) |
| `vendors/lame` | [lameproject/lame · 1f5cc9487284d5950343aa5d4f70de433468070a](https://github.com/lameproject/lame/tree/1f5cc9487284d5950343aa5d4f70de433468070a) |
| `vendors/libgsm` | [timothytylee/libgsm · 98f1708fb5e06a0dfebd58a3b40d610823db9715](https://github.com/timothytylee/libgsm/tree/98f1708fb5e06a0dfebd58a3b40d610823db9715) |
| `vendors/pybind11` | [pybind/pybind11 · 0c69e1eb2177fa8f8580632c7b1f97fdb606ce8f](https://github.com/pybind/pybind11/tree/0c69e1eb2177fa8f8580632c7b1f97fdb606ce8f) |
| `vendors/rubberband` | [BreakfastQuay/Rubberband · 2be46b0dffb13273a67396c77bc9278736bb03d2](https://github.com/BreakfastQuay/Rubberband/tree/2be46b0dffb13273a67396c77bc9278736bb03d2) |

## FFmpeg / FFprobe 8.0.1 source / FFmpeg·FFprobe 8.0.1 소스

The actual bundled distributor README identifies **`8.0.1-essentials_build-www.gyan.dev`**, **GPLv3**, and `https://github.com/FFmpeg/FFmpeg/commit/894da5ca7d`. GitHub resolves that reference to **`894da5ca7d742e4429ffb2af534fcda0103ef593`**. The distributor's 8.0.1 release independently points to the same source commit.

실제 번들의 배포자 README는 **`8.0.1-essentials_build-www.gyan.dev`**, **GPLv3**, `https://github.com/FFmpeg/FFmpeg/commit/894da5ca7d`를 명시합니다. 이 참조의 전체 커밋은 **`894da5ca7d742e4429ffb2af534fcda0103ef593`**이며, 배포자의 8.0.1 릴리즈도 같은 소스 커밋을 안내합니다.

| Material / 자료 | Location / 위치 |
| --- | --- |
| Exact FFmpeg source / 정확한 FFmpeg 소스 | [FFmpeg commit 894da5ca7d742e4429ffb2af534fcda0103ef593](https://github.com/FFmpeg/FFmpeg/commit/894da5ca7d742e4429ffb2af534fcda0103ef593) |
| GPLv3 license / GPLv3 라이선스 | [COPYING.GPLv3 at that commit](https://raw.githubusercontent.com/FFmpeg/FFmpeg/894da5ca7d742e4429ffb2af534fcda0103ef593/COPYING.GPLv3) |
| Upstream build inputs / 원본 빌드 입력 | [configure](https://raw.githubusercontent.com/FFmpeg/FFmpeg/894da5ca7d742e4429ffb2af534fcda0103ef593/configure), [Makefile](https://raw.githubusercontent.com/FFmpeg/FFmpeg/894da5ca7d742e4429ffb2af534fcda0103ef593/Makefile) |
| Exact distributor release / 해당 배포자 릴리즈 | [GyanD/codexffmpeg 8.0.1](https://github.com/GyanD/codexffmpeg/releases/tag/8.0.1) |
| Distributor build information / 배포자 빌드 안내 | [Gyan FFmpeg builds](https://www.gyan.dev/ffmpeg/builds/) — this page changes; use the pinned 8.0.1 release above for this installer. / 이 페이지는 갱신되므로 이 설치본에는 위의 고정 8.0.1 릴리즈를 기준으로 합니다. |
| Shipped license and build configuration / 포함 라이선스·빌드 설정 | `resources/backend/_internal/third-party/ffmpeg/LICENSE` and `README.txt`; the README's `release-essentials build configuration` section preserves the distributor's original settings. / README의 해당 절에 배포자 원본 설정을 보존합니다. |

The Gyan essentials binaries statically include external libraries. The FFmpeg commit alone does not identify every external library's exact source revision or the distributor's complete build environment. Those inputs have not been independently reconstructed by this project. / Gyan essentials 바이너리는 외부 라이브러리를 정적으로 포함합니다. FFmpeg 커밋 하나로 모든 외부 라이브러리의 정확한 소스 버전이나 배포자의 전체 빌드 환경까지 식별되지는 않으며, 이 프로젝트는 그 입력을 독립적으로 재구성하지 않았습니다.

## Optional RNNoise model / 선택 RNNoise 모델

Current source adds the 302,903-byte Xiph RNNoise v0.1 standard model for FFmpeg
`arnndn`. This is a new source addition after v0.3.2, not a claim that the public
v0.3.2 installer already contains it. Future bundles include the model, original
Xiph `COPYING` and provenance README under
`_internal/voicesubsep/assets/rnnoise/`; the build verifies each copied hash.
The package license does not replace these upstream redistribution terms.

현재 소스에 FFmpeg `arnndn`용 Xiph RNNoise v0.1 원모델 302,903바이트를 추가했습니다.
공개 v0.3.2 설치본 이후의 변경이며, 기존 설치본에 포함됐다는 뜻은 아닙니다.
새 번들은 `_internal/voicesubsep/assets/rnnoise/`에 모델과 원본 `COPYING`, 출처
README를 함께 포함하고 복사본 해시를 검사합니다. 앱 라이선스가 원본 재배포 조건을
대체하지 않습니다.

- Serialized model / 직렬화 모델: [std.rnnn at 0fda24c46d78f0207d820bb970fbe85c1971b39c](https://github.com/richardpl/arnndn-models/blob/0fda24c46d78f0207d820bb970fbe85c1971b39c/std.rnnn), SHA-256 `6b8943dc4a9b6b24425873992a44f29c0577503276456af46a8854774faeb294`.
- Original arrays and terms / 원본 배열과 조건: [Xiph RNNoise v0.1 rnn_data.c](https://github.com/xiph/rnnoise/blob/cdf196b1e9de2f8ff1003328ebf9a4316477429d/src/rnn_data.c), [COPYING](https://github.com/xiph/rnnoise/blob/cdf196b1e9de2f8ff1003328ebf9a4316477429d/COPYING).
- The serialized weight/bias values were compared against every corresponding original array and matched. Attribution identifies Xiph's standard model, not Gregor Richards' other trained models. / 원본 전체 가중치·편향 배열과 수치 일치를 확인했으며, Gregor Richards의 별도 학습 모델이 아닌 Xiph 원모델로 표기합니다.
- Full provenance / 전체 출처: [bundled model README](../backend/voicesubsep/assets/rnnoise/README.md). FFmpeg licensing above still applies; this addition is not a comprehensive legal audit of all bundled dependencies. / 위 FFmpeg 배포 조건도 적용되며, 이번 확인이 전체 번들 의존성의 법률 감사를 뜻하지는 않습니다.

## Verification and remaining scope / 검증과 남은 범위

`powershell -ExecutionPolicy Bypass -File scripts/build-backend.ps1 -CheckDependenciesOnly` checks the required Nemotron module files, CUDA source selection and original notice inventory without running PyInstaller. The build selects the Nemotron diarization model, processor, configuration, streaming feature extractor and AutoFeatureExtractor imports explicitly. A generated build-directory hook retains the installed Transformers hook's metadata/source rules and excludes unrelated model families; it does not modify the installed Transformers package. Standard PyInstaller hooks preserve librosa's lazy-loader data, llvmlite and SciPy native libraries, and SoundFile's bundled libsndfile notice. The build also preserves the sibling `llvmlite.libs` directory used by newer Windows wheels. A complete runtime bundle still needs a separate frozen-server health and inference check; source dependency checks alone do not prove it works.

`-CheckDependenciesOnly`는 PyInstaller를 실행하지 않고 Nemotron 모듈, CUDA DLL 제공 위치, 원본 고지 목록을 확인합니다. 빌드는 필요한 Transformers 모듈·원본 메타데이터와 네이티브 라이브러리를 선택해 보존합니다. 이것만으로 동결된 실행 파일의 작동을 증명하지는 않으므로 준비 검사와 실제 추론 검증은 별도로 수행합니다.

The public source-location check used small upstream text/API requests only; no dependency source archive was downloaded or rebuilt during this check. It confirms version references and source availability, **not a complete redistribution/legal audit or a byte-for-byte rebuild**. In particular:

- Pedalboard's pinned source and five submodule revisions are identified, but the installed wheel was not rebuilt from that recursive source tree.
- The full source/version inventory and build recipe for FFmpeg's statically linked external libraries remain unverified.
- Keep the source directions available beside binary downloads and maintain the referenced source availability. GPLv3 section 6(d), included in the linked original license, addresses network distribution and equivalent access to Corresponding Source; copying license texts alone does not establish that every obligation is met.
- VOICESUBSEP's own licensing choice and other bundled components' conditions remain separate; this notice does not grant additional rights over them. Whisper/Nemotron model weights and third-party VST plugins are not included in the installer.

공개 소스 위치 검사는 원본 텍스트·API의 작은 요청으로 수행했으며 의존성 소스 압축파일 다운로드나 재빌드는 하지 않았습니다. 버전 참조와 접근 가능성을 확인한 것이며 **전체 재배포·법률 검토 또는 동일 바이너리 재현 완료를 뜻하지 않습니다**. 구체적으로:

- Pedalboard 원본과 다섯 하위 모듈의 커밋을 식별했지만, 그 재귀 소스로 설치된 wheel을 다시 빌드하지는 않았습니다.
- FFmpeg에 정적으로 연결된 외부 라이브러리 전체의 소스·버전 목록과 배포자 빌드 절차는 아직 독립 검증하지 않았습니다.
- 바이너리 다운로드 옆에 소스 안내를 유지하고, 참조한 소스의 제공 가능성을 계속 관리해야 합니다. 연결된 GPLv3 원문 6(d)는 네트워크 배포 시 대응 소스에 대한 동등한 접근을 다룹니다. 라이선스 문서 복사만으로 모든 의무가 충족됐다고 보지는 않습니다.
- VOICESUBSEP 자체의 라이선스 선택과 다른 포함 구성요소의 조건은 별도이며 이 고지가 추가 권리를 부여하지는 않습니다. Whisper/Nemotron 모델 가중치와 외부 VST 플러그인은 설치 파일에 포함하지 않습니다.
