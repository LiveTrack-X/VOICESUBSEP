import { createProject, type Project, type ReviewReason } from "../domain";

/** Synthetic fixture for domain/session regression tests only. */
export function demoProject(): Project {
  const project = createProject();
  project.name = "샘플 · 4인 게임 대화";
  project.mode = "overlap";
  project.duration = 92;
  project.speakers.forEach((speaker, i) => {
    speaker.name = ["민준", "서연", "도윤", "지우"][i]!;
  });
  const lines: Array<[number, number, string, number | null, ReviewReason[]]> =
    [
      [3.2, 6.4, "좋아, 이번에는 오른쪽으로 같이 가자.", 0, []],
      [7.1, 9.8, "잠깐, 저 앞에 한 팀 더 있어!", 1, []],
      [10.2, 13.6, "내가 먼저 들어갈게. 뒤에서 봐 줘.", 2, ["overlap"]],
      [11.4, 14.8, "아니, 아직 들어가면 안 돼!", 3, ["overlap"]],
      [19.8, 22.2, "방금 누가 문 닫았어?", 0, []],
      [22.7, 25.5, "나 아니야! 나는 여기 있었는데?", 1, ["overlap"]],
      [23.4, 26.1, "미안, 내가 잘못 눌렀어.", 2, ["overlap"]],
      [40.3, 43.7, "이 장면은 꼭 다시 봐야겠다.", 3, []],
      [57.2, 58.9, "와, 이걸 살았네!", null, ["unassigned"]],
      [84.5, 89.2, "다음 판에는 문부터 확인하고 들어가자.", 0, []],
    ];
  project.captions = lines.map(([start, end, text, speaker, reasons], i) => ({
    id: `sample-caption-${i + 1}`,
    start,
    end,
    text,
    speakerId: speaker === null ? null : project.speakers[speaker]!.id,
    reasons,
    reviewed: reasons.length === 0,
  }));
  project.notes = [
    {
      id: "sample-note-1",
      start: 10.2,
      end: 14.8,
      text: "두 사람의 대사가 겹치는 샘플 구간. 인물별 자막 위치 확인.",
      tag: "check",
      done: false,
    },
    {
      id: "sample-note-2",
      start: 22.7,
      end: 26.1,
      text: "문 닫는 장면에 리플레이를 넣을 편집 포인트.",
      tag: "highlight",
      done: false,
    },
    {
      id: "sample-note-3",
      start: 57.2,
      end: null,
      text: "샘플의 미지정 화자를 직접 배정해 보기.",
      tag: "subtitle",
      done: false,
    },
  ];
  return project;
}
