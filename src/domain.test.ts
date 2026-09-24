import { describe, expect, it } from "vitest";
import {
  createProject,
  demoProject,
  exportNotesCsv,
  exportNotesMarkdown,
  exportSrt,
  formatTime,
  MAX_CAPTIONS,
  MAX_NOTES,
  MAX_PROJECT_BYTES,
  parseProject,
  parseSrt,
  parseTime,
  safeFilename,
  type Caption,
  type Project,
} from "./domain";

function caption(
  id: string,
  start: number,
  end: number,
  text: string,
  speakerId: string | null,
): Caption {
  return { id, start, end, text, speakerId, reasons: [], reviewed: false };
}

function changedProject(change: (project: Project) => void): string {
  const project = demoProject();
  change(project);
  return JSON.stringify(project);
}

describe("portable projects", () => {
  it("starts empty with four distinct editable speakers and no imaginary media", () => {
    const project = createProject();
    expect(project.captions).toEqual([]);
    expect(project.notes).toEqual([]);
    expect(project.mediaName).toBeNull();
    expect(project.duration).toBe(0);
    expect(project.speakers).toHaveLength(4);
    expect(new Set(project.speakers.map((speaker) => speaker.color)).size).toBe(
      4,
    );
    expect(createProject(1).speakers).toHaveLength(1);
    expect(() => createProject(5)).toThrow();
  });

  it("roundtrips exact source times, optional word confidence, Unicode, and timed notes", () => {
    const project = demoProject();
    project.captions[0]!.words = [
      { start: 3.2, end: 3.52, text: "좋아🦊", probability: 0.94 },
    ];
    expect(project.name).toContain("샘플");
    expect(project.mediaName).toBeNull();
    expect(project.duration).toBe(92);
    expect(project.notes).toHaveLength(3);
    const copy = parseProject(`\uFEFF${JSON.stringify(project)}`);
    expect(copy).toEqual(project);
    expect(copy).not.toBe(project);
    expect(copy.captions[0]!.start).toBe(3.2);
  });

  it("preserves extra detected speakers independently of the expected count", () => {
    const project = demoProject();
    project.speakerCount = 2;
    project.speakers.push({
      id: "detected-extra",
      name: "추가 감지 인물",
      color: "#ffffff",
    });
    project.captions[0]!.speakerId = "detected-extra";
    const restored = parseProject(JSON.stringify(project));
    expect(restored.speakerCount).toBe(2);
    expect(restored.speakers).toHaveLength(5);
    expect(restored.captions[0]!.speakerId).toBe("detected-extra");
  });

  it("restores names cleared during editing and supplies export labels without altering saved data", () => {
    const project = demoProject();
    project.name = "";
    project.speakers[0]!.name = " \t";
    const restored = parseProject(JSON.stringify(project));
    expect(restored).toEqual(project);
    expect(restored.captions).toEqual(project.captions);
    expect(restored.notes).toEqual(project.notes);
    expect(exportSrt(restored, restored.speakers[0]!.id)).toContain(
      "인물 1: 좋아,",
    );
    expect(exportNotesMarkdown(restored)).toContain(
      "# 이름 없는 프로젝트 · 편집 메모",
    );
    expect(safeFilename(restored.name)).toBe("voicesubsep");
    expect(safeFilename(restored.name, "")).toBe("voicesubsep");
    expect(restored.name).toBe("");
    expect(restored.speakers[0]!.name).toBe(" \t");
  });

  it.each([
    [
      "duplicate caption ID",
      (p: Project) => {
        p.captions[1]!.id = p.captions[0]!.id;
      },
    ],
    [
      "duplicate speaker ID",
      (p: Project) => {
        p.speakers[1]!.id = p.speakers[0]!.id;
      },
    ],
    [
      "duplicate note ID",
      (p: Project) => {
        p.notes[1]!.id = p.notes[0]!.id;
      },
    ],
    [
      "unknown speaker",
      (p: Project) => {
        p.captions[0]!.speakerId = "does-not-exist";
      },
    ],
    [
      "NaN becomes null",
      (p: Project) => {
        p.captions[0]!.start = Number.NaN;
      },
    ],
    [
      "infinite duration",
      (p: Project) => {
        p.duration = Number.POSITIVE_INFINITY;
      },
    ],
    [
      "negative start",
      (p: Project) => {
        p.captions[0]!.start = -1;
      },
    ],
    [
      "reversed interval",
      (p: Project) => {
        p.captions[0]!.end = 1;
      },
    ],
    [
      "unknown mode",
      (p: Project) => {
        p.mode = "invalid" as Project["mode"];
      },
    ],
    [
      "unknown reason",
      (p: Project) => {
        p.captions[0]!.reasons = ["fake" as never];
      },
    ],
    [
      "unknown tag",
      (p: Project) => {
        p.notes[0]!.tag = "fake" as never;
      },
    ],
    [
      "not a boolean",
      (p: Project) => {
        p.notes[0]!.done = "false" as never;
      },
    ],
    [
      "oversized field",
      (p: Project) => {
        p.notes[0]!.text = "가".repeat(10_001);
      },
    ],
    [
      "unsafe color",
      (p: Project) => {
        p.speakers[0]!.color = "red";
      },
    ],
    [
      "noninteger count",
      (p: Project) => {
        p.speakerCount = 2.5;
      },
    ],
    [
      "invalid probability",
      (p: Project) => {
        p.captions[0]!.words = [
          { start: 3.2, end: 3.6, text: "좋아", probability: 2 },
        ];
      },
    ],
  ])("rejects %s", (_label, change) => {
    expect(() => parseProject(changedProject(change))).toThrow();
  });

  it("rejects malformed and malicious structures without polluting Object.prototype", () => {
    expect(() => parseProject('{"start":NaN}')).toThrow();
    expect(() => parseProject("null")).toThrow();
    expect(() => parseProject("[]")).toThrow();
    const malicious = JSON.stringify(demoProject()).replace(
      "{",
      '{"__proto__":{"polluted":true},',
    );
    expect(() => parseProject(malicious)).toThrow(/지원하지 않는 필드/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const exponent = JSON.stringify(demoProject()).replace(
      '"duration":92',
      '"duration":1e999',
    );
    expect(() => parseProject(exponent)).toThrow();
  });

  it("caps actual UTF-8 byte size, not just JavaScript string length", () => {
    const tooLarge = "가".repeat(Math.floor(MAX_PROJECT_BYTES / 3) + 1);
    expect(tooLarge.length).toBeLessThan(MAX_PROJECT_BYTES);
    expect(() => parseProject(tooLarge)).toThrow(/8 MiB/);
  });

  it("bounds array counts before attempting item validation", () => {
    expect(() =>
      parseProject(
        changedProject((project) => {
          project.captions = Array.from(
            { length: MAX_CAPTIONS + 1 },
            () => null as never,
          );
        }),
      ),
    ).toThrow(/최대 20000/);
    expect(() =>
      parseProject(
        changedProject((project) => {
          project.notes = Array.from(
            { length: MAX_NOTES + 1 },
            () => null as never,
          );
        }),
      ),
    ).toThrow(/최대 5000/);
  });
});

describe("time and SRT import", () => {
  it("rounds milliseconds with carry and preserves hours beyond 24", () => {
    expect(formatTime(59.9996)).toBe("00:01:00.000");
    expect(formatTime(25 * 3600 + 0.001)).toBe("25:00:00.001");
    expect(parseTime("01:02:03,456")).toBe(3723.456);
    expect(parseTime("02:03.456")).toBe(123.456);
    expect(parseTime("123.456")).toBe(123.456);
    for (const text of [
      "-1",
      "NaN",
      "1:60",
      "00:61:00",
      "1e3",
      "00:00:02.1234",
    ]) {
      expect(() => parseTime(text)).toThrow();
    }
  });

  it("imports BOM, CRLF, multiline Korean, and overlapping cues losslessly", () => {
    const input =
      "\uFEFF1\r\n00:00:10,125 --> 00:00:12,875\r\n안녕 👋\r\n두 번째 줄 你好\r\n\r\n2\r\n00:00:11,000 --> 00:00:13,000\r\n겹친 말\r\n";
    const parsed = parseSrt(input);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.text).toBe("안녕 👋\n두 번째 줄 你好");
    expect(parsed[0]!.start).toBe(10.125);
    expect(parsed[0]!.end).toBe(12.875);
    expect(parsed.every((cue) => cue.reasons.includes("overlap"))).toBe(true);
    expect(parsed.every((cue) => cue.speakerId === null)).toBe(true);
  });

  it("does not silently discard malformed cues", () => {
    for (const text of [
      "1\n00:00:03,000 --> 00:00:02,000\n역순",
      "1\n00:00:03,000 --> 00:00:03,000\n동일",
      "1\n00:00:01,000 --> 00:00:02,000",
      "not an SRT file",
    ])
      expect(() => parseSrt(text)).toThrow();
    expect(parseSrt(" \n")).toEqual([]);
  });
});

describe("SRT output", () => {
  it("flattens overlaps into disjoint boundary intervals with names and all dialogue", () => {
    const project = createProject(2);
    project.captions = [
      caption("c1", 10, 14, "먼저 말함", "speaker-1"),
      caption("c2", 12, 16, "동시에 말함", "speaker-2"),
      caption("c3", 20, 21, "누군지 확인", null),
    ];
    const before = JSON.stringify(project);
    const output = parseSrt(exportSrt(project));
    expect(output.map(({ start, end }) => [start, end])).toEqual([
      [10, 12],
      [12, 14],
      [14, 16],
      [20, 21],
    ]);
    expect(output[1]!.text).toBe("인물 A: 먼저 말함\n인물 B: 동시에 말함");
    expect(output[3]!.text).toBe("미지정: 누군지 확인");
    for (let i = 1; i < output.length; i++)
      expect(output[i]!.start).toBeGreaterThanOrEqual(output[i - 1]!.end);
    expect(JSON.stringify(project)).toBe(before);
  });

  it("preserves original gaps and overlapping same-speaker source times on filtered exports", () => {
    const project = createProject(2);
    project.captions = [
      caption("a", 5.123, 8.456, "하나", "speaker-1"),
      caption("b", 7, 9, "둘", "speaker-1"),
      caption("other", 10, 11, "다른 사람", "speaker-2"),
      caption("c", 82.123, 87.321, "나중 대사", "speaker-1"),
    ];
    const parsed = parseSrt(exportSrt(project, "speaker-1", false));
    expect(parsed.map(({ start, end }) => [start, end])).toEqual([
      [5.123, 8.456],
      [7, 9],
      [82.123, 87.321],
    ]);
    expect(parsed.map((cue) => cue.text)).toEqual(["하나", "둘", "나중 대사"]);
    expect(() => exportSrt(project, "unknown")).toThrow();
  });

  it("exports null as only unassigned captions while preserving their overlapping source times", () => {
    const project = createProject(1);
    project.captions = [
      caption("assigned", 10, 11, "배정된 대사", "speaker-1"),
      caption("unknown-a", 12.345, 16.789, "누군지 확인할 말", null),
      caption("unknown-b", 15.123, 18.456, "겹친 미배정 대사", null),
      caption("unknown-c", 81.001, 83.002, "나중에 나온 말", null),
    ];
    const parsed = parseSrt(exportSrt(project, null, false));
    expect(parsed.map(({ start, end, text }) => [start, end, text])).toEqual([
      [12.345, 16.789, "누군지 확인할 말"],
      [15.123, 18.456, "겹친 미배정 대사"],
      [81.001, 83.002, "나중에 나온 말"],
    ]);
    expect(exportSrt(project, null)).toContain("미지정: 누군지 확인할 말");
    expect(exportSrt(project, null)).not.toContain("배정된 대사");
  });

  it("emits a valid minimum interval when real source times round to the same millisecond", () => {
    const project = createProject(1);
    project.captions = [caption("short", 1.0001, 1.0002, "앗", "speaker-1")];
    const exported = exportSrt(project, "speaker-1", false);
    expect(exported).toContain("00:00:01,000 --> 00:00:01,001");
    expect(parseSrt(exported)).toHaveLength(1);
    expect(exportSrt(createProject())).toBe("");
  });

  it("retains identical dialogue from distinct speakers rather than deduplicating it", () => {
    const project = createProject(2);
    project.captions = [
      caption("a", 1, 2, "안 돼!", "speaker-1"),
      caption("b", 1, 2, "안 돼!", "speaker-2"),
    ];
    expect(parseSrt(exportSrt(project))[0]!.text).toBe(
      "인물 A: 안 돼!\n인물 B: 안 돼!",
    );
  });

  it("bounds the expansion of adversarial nested overlaps", () => {
    const project = createProject(1);
    project.captions = Array.from({ length: 150 }, (_, i) =>
      caption(`c${i}`, i, 400 - i, "가".repeat(1_000), "speaker-1"),
    );
    expect(() => exportSrt(project)).toThrow(/통합 출력이 너무 큽니다/);
  });
});

describe("note exports", () => {
  it("escapes Markdown structure and HTML while keeping timed ranges and task state", () => {
    const project = createProject();
    project.name = "테스트 <script>\n# 제목";
    project.notes = [
      {
        id: "note-1",
        start: 12.345,
        end: 18.2,
        text: "[링크](javascript:alert(1))\n<script>alert(1)</script>",
        tag: "edit",
        done: true,
      },
    ];
    const output = exportNotesMarkdown(project);
    expect(output).toContain("- [x] **00:00:12.345 → 00:00:18.200** · 편집");
    expect(output).not.toContain("<script>");
    expect(output).not.toContain("[링크](");
    expect(output).toContain("&lt;script&gt;");
  });

  it("quotes CSV commas, quotes and newlines; neutralizes spreadsheet formulas", () => {
    const project = createProject();
    project.notes = [
      {
        id: "n1",
        start: 1.234,
        end: null,
        text: '=HYPERLINK("https://example.com","클릭")',
        tag: "check",
        done: false,
      },
      {
        id: "n2",
        start: 20,
        end: 21,
        text: '일반 메모, "인용"\n다음 줄',
        tag: "edit",
        done: true,
      },
      {
        id: "n3",
        start: 30,
        end: null,
        text: "  @SUM(1,2)",
        tag: "check",
        done: false,
      },
    ];
    const csv = exportNotesCsv(project);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"",""클릭"")"');
    expect(csv).toContain('"일반 메모, ""인용""\n다음 줄"');
    expect(csv).toContain('"\'  @SUM(1,2)"');
    expect(csv).toContain('"00:00:01.234","","check","false"');
    expect(csv).toContain('"00:00:20.000","00:00:21.000","edit","true"');
  });

  it("provides portable filenames without Windows reserved names or separators", () => {
    expect(safeFilename("CON")).toBe("voicesubsep");
    expect(safeFilename("이름/자막:초안.srt")).toBe("이름_자막_초안.srt");
  });
});
