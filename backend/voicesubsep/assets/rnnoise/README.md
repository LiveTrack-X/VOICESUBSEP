# Pinned RNNoise standard model

`std.rnnn` is the original Xiph RNNoise v0.1 model, serialized for FFmpeg's
`arnndn` filter. It is not one of Gregor Richards' separately trained models.
The upstream Xiph copyright and redistribution terms are preserved verbatim in
`COPYING` in this directory. Keep that file with redistributed model data.

- Serialized model: [richardpl/arnndn-models at 0fda24c46d78f0207d820bb970fbe85c1971b39c](https://github.com/richardpl/arnndn-models/tree/0fda24c46d78f0207d820bb970fbe85c1971b39c).
- Exact download: [std.rnnn](https://raw.githubusercontent.com/richardpl/arnndn-models/0fda24c46d78f0207d820bb970fbe85c1971b39c/std.rnnn).
- Size: **302,903 bytes**; SHA-256: **`6b8943dc4a9b6b24425873992a44f29c0577503276456af46a8854774faeb294`**.
- Original arrays: [Xiph RNNoise v0.1 rnn_data.c at cdf196b1e9de2f8ff1003328ebf9a4316477429d](https://github.com/xiph/rnnoise/blob/cdf196b1e9de2f8ff1003328ebf9a4316477429d/src/rnn_data.c).
- Original terms: [COPYING at the same Xiph commit](https://github.com/xiph/rnnoise/blob/cdf196b1e9de2f8ff1003328ebf9a4316477429d/COPYING).
- `COPYING` SHA-256: **`e2f59ff41d9d03adc3dcf3deff170f8c8cf4a6eb4a9b174762a7656d23200ffa`**.

The serialized weight/bias arrays were compared numerically against every
corresponding `rnn_data.c` array on 2026-09-25 and matched exactly: input dense,
VAD GRU, noise GRU, denoise GRU, denoise output and VAD output. Six model header
rows encode their corresponding input/output sizes and activation functions.
No weights were trained or changed by this project.

The application verifies the model's size/hash before use, copies it into the
private processing directory and runs the locally installed/bundled FFmpeg.
It does not download this model at runtime. FFmpeg's own license is separate.
The application compensates `arnndn`'s fixed 480-sample (10 ms at 48 kHz) buffer
delay and validates the original sample count. This is not a claim of improved
recognition accuracy or of retaining all quiet speech; use the original versus
processed preview before enabling the optional filter.

## 한국어

이 파일은 Xiph RNNoise v0.1 원모델의 FFmpeg용 직렬화입니다. Gregor Richards가
별도로 학습한 모델로 표시하지 않습니다. 원본 배열 전체와 수치 일치를 확인했으며
가중치를 변경하지 않았습니다. 원본 저작권·재배포 조건은 같은 폴더의 `COPYING`에
그대로 보존됩니다. 모델 배포 시 함께 유지해야 합니다.

실행할 때마다 크기·SHA-256을 확인하고 로컬 FFmpeg로만 처리합니다. 실행 중 모델을
다운로드하지 않습니다. 필터의 고정 10 ms 지연을 보정하고 원본 샘플 수를 검사합니다.
약한 발화가 손상될 수 있으므로 인식률 개선을 보장하지 않으며, 기본값은 꺼짐이고
원본/처리본 비교 후 사용합니다. FFmpeg 자체의 배포 조건은 별도입니다.
