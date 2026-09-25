# DyNet38 2.2 upstream notice / 원본 고지

`LICENSE.txt` is an unchanged copy of the upstream Apache-2.0 license at
[commit 79e80bfa56867319f35e14d8a7098d0da93ab243](https://github.com/taishi-i/dynet/blob/79e80bfa56867319f35e14d8a7098d0da93ab243/LICENSE.txt).
That commit's [setup.py](https://github.com/taishi-i/dynet/blob/79e80bfa56867319f35e14d8a7098d0da93ab243/setup.py)
declares version 2.2; the installed wheel's `dynet.py` reports the matching git suffix `79e80bfa`.

`LICENSE.txt`는 위 고정 커밋의 Apache-2.0 원본 그대로입니다. `setup.py`의 2.2 버전과
설치 wheel의 `dynet.py` git suffix가 일치합니다. wheel에 빠진 고지를 보완하며 원본을 수정하지 않았습니다.

- Notice SHA-256: `08aded6d3bf7635e55b2f6f15d13fd442afd7069826bf7dc52f57824c7f08625`
- [Official PyPI release / 공식 릴리즈](https://pypi.org/project/DyNet38/2.2/)
- Windows CPython 3.12 wheel: `dynet38-2.2-cp312-cp312-win_amd64.whl`
- Wheel SHA-256: `fd9967ed3ec071cc4c0c084d758ab44dac34cb37beb625ea9fcf2221c2085975`
- [Pinned source archive / 고정 소스](https://github.com/taishi-i/dynet/archive/79e80bfa56867319f35e14d8a7098d0da93ab243.zip)

The default desktop build currently excludes DyNet38 with the Qwen runtime. This notice does not authorize
or claim a complete audit of that future bundle; see [Qwen runtime status](../../docs/QWEN-RUNTIME.md).

현재 기본 설치본은 Qwen 실행 환경과 함께 DyNet38을 제외합니다. 이 고지 보존은 향후 번들의
배포조건 전체 검토가 완료됐다는 뜻이 아닙니다.
