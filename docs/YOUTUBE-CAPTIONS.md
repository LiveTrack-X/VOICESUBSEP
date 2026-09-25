# YouTube styled captions / YouTube 스타일 CC

**0.3.2 development guide: the exporter is implemented in source; validation is in progress. The release is not published or installed yet.** This guide covers caption files, not text burned into a video. No video or captions are automatically uploaded to YouTube.

**0.3.2 개발 가이드: 내보내기 소스 구현 후 검증 중이며 아직 게시·설치하지 않았습니다.** 영상에 글자를 합성하는 기능이 아니라 CC 파일 출력 범위입니다. YouTube에 영상·자막을 자동 업로드하지 않습니다.

## Initial scope / 첫 지원 범위

The exporter writes **SRV3 XML in a `.ytt` file** using speaker subtitle defaults and individual caption style overrides. The optional speaker-name prefix uses that person's color; body text uses the caption's text color. Size, bold, outline on/off, background color/opacity, top/middle/bottom position and left/center/right alignment are represented. Sans/serif/mono map to font categories, not embedded font files; sizing and placement are approximate across players.

**`.ytt` 파일의 SRV3 XML**로 인물 기본 자막 스타일과 개별 자막 스타일을 출력합니다. 이름 표시를 켜면 이름 접두사는 인물 색, 대사 본문은 자막 글자색을 사용합니다. 크기·굵게·외곽선 켜기/끄기·배경색/투명도·위/중간/아래·좌/중앙/우 정렬을 표현합니다. Sans/Serif/Mono는 글꼴 계열이며 글꼴 파일을 넣지 않고, 크기·배치는 플레이어마다 달라질 수 있습니다.

## Export / 내보내기

1. Review text, speaker assignments and subtitle styles, then open **Export subtitles and notes → YouTube styled CC**.
2. Choose **Original video time** for the unchanged source, including excluded cut ranges; choose **Edited video time with cuts** only for video edited with the same project cuts.
3. Click **Save YouTube CC (.ytt)**. Edited-time export stops if a caption crosses a cut without reliable word timing. Blank/invalid cues and layouts too large for the estimated screen must be corrected first.
4. Save project JSON separately. Any upload is a separate manual action; check the actual player before using the captions publicly.

1. 내용·인물 배정·자막 스타일을 검수하고 **자막과 노트 내보내기 → 유튜브 스타일 CC**를 엽니다.
2. 변경하지 않은 원본용이면 **원본 영상 시간**을 고릅니다. 제외 컷 구간도 포함합니다. 프로젝트와 같은 컷을 적용한 영상에만 **컷 적용한 편집본 시간**을 고릅니다.
3. **YouTube CC (.ytt) 저장**을 누릅니다. 컷 경계에 걸친 대사에 신뢰할 단어 시간이 없으면 편집본 출력을 막습니다. 빈/잘못된 구간과 예상 화면에 들어가지 않는 배치는 먼저 고쳐야 합니다.
4. 프로젝트 JSON을 별도로 보관합니다. 업로드는 사용자가 따로 진행하며 공개 사용 전에 실제 플레이어 표시를 확인하세요.

Exports do not change saved caption times or bake text into media. The filename ends in `-source.ytt` or `-edited.ytt` to distinguish the timebase. Overlapping cues receive estimated placement; exact wrapping and collision-free display on every player are not guaranteed.

출력은 저장된 자막 시간을 바꾸거나 영상에 글자를 굽지 않습니다. 파일 끝의 `-source.ytt`·`-edited.ytt`로 시간 기준을 구분합니다. 동시 구간에는 예상 배치를 적용하지만 모든 플레이어의 정확한 줄바꿈·겹침 없는 표시를 보장하지 않습니다.

This release does not provide karaoke word timing, animation, arbitrary ASS effects, full font portability or exact reproduction of a reference video's effects. No reference-video rendering was verified for this work.

이번 범위에 단어별 노래방 타이밍·애니메이션·임의 ASS 효과·모든 글꼴 전달·참고 영상 효과의 정확한 재현은 포함하지 않습니다. 이번 작업에서 참고 영상의 실제 표시를 검증하지 않았습니다.

## Format and platform boundary / 형식과 플랫폼 한계

YouTube's public [supported caption formats](https://support.google.com/youtube/answer/2734698?hl=en) document lists TTML styling/positioning and plain SRT, but does not list YTT. Therefore this app does not describe YTT as a documented official YouTube upload contract. The SRV3/YTT structure follows the maintainer's [YTSubConverter format reference](https://github.com/arcusmaximus/YTSubConverter/blob/master/ytt.ytt) and [project documentation](https://github.com/arcusmaximus/YTSubConverter). References checked on 2026-09-25.

YouTube 공식 [지원 자막 형식](https://support.google.com/youtube/answer/2734698?hl=en)은 TTML 스타일·위치와 평문 SRT를 설명하지만 YTT는 목록에 없습니다. 따라서 YTT를 공식 문서화된 업로드 계약으로 보장하지 않습니다. SRV3/YTT 구조는 유지관리자의 [YTSubConverter 형식 자료](https://github.com/arcusmaximus/YTSubConverter/blob/master/ytt.ytt)와 [프로젝트 설명](https://github.com/arcusmaximus/YTSubConverter)을 참고합니다. 2026-09-25 확인했습니다.

Local XML generation and escaping tests do **not** prove that YouTube accepts the file or renders every style on desktop, mobile and TV. Upload acceptance, line wrapping, overlap, font substitution and viewer preferences require a separate private/unlisted-video check before relying on the result. Those platform checks have not been performed here. SRT remains a plain-text fallback; ASS is the existing styled editing export. This feature does not add a TTML exporter.

로컬 XML 생성·이스케이프 검사는 YouTube 업로드 성공이나 PC·모바일·TV의 모든 스타일 표시를 입증하지 않습니다. 실제 사용 전 비공개·일부 공개 영상에서 업로드 수용·줄바꿈·동시 발화·글꼴 대체·시청자 설정을 별도로 확인해야 하며, 이번 작업에서는 그 플랫폼 검사를 수행하지 않았습니다. 평문 대안은 SRT, 기존 편집용 스타일 출력은 ASS입니다. 이 기능으로 TTML 출력까지 추가되는 것은 아닙니다.

See [feature status](FEATURE-STATUS.md), [the 0.3.2 preparation record](releases/v0.3.2.md) and [the user guide](USER-GUIDE.md). / [기능 현황](FEATURE-STATUS.md), [0.3.2 준비 기록](releases/v0.3.2.md), [사용자 가이드](USER-GUIDE.md)를 함께 확인하세요.
