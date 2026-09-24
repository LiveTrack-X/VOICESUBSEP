/** Portable editing data. All times are seconds on the original source media. */
export type Mode = "standard" | "overlap";
export type ReviewReason =
  "overlap" | "unassigned" | "speaker_count" | "timing";
export type Speaker = { id: string; name: string; color: string };
export type Word = {
  start: number;
  end: number;
  text: string;
  probability?: number;
};
export type Caption = {
  id: string;
  start: number;
  end: number;
  text: string;
  speakerId: string | null;
  reasons: ReviewReason[];
  reviewed: boolean;
  words?: Word[];
};
export type NoteTag = "edit" | "highlight" | "subtitle" | "check";
export type Note = {
  id: string;
  start: number;
  end: number | null;
  text: string;
  tag: NoteTag;
  done: boolean;
};
export type Project = {
  schemaVersion: 1;
  id: string;
  name: string;
  mediaName: string | null;
  duration: number;
  mode: Mode;
  speakerCount: number;
  speakers: Speaker[];
  captions: Caption[];
  notes: Note[];
  updatedAt: string;
};

export const MAX_PROJECT_BYTES = 8 * 1024 * 1024;
export const MAX_CAPTIONS = 20_000;
export const MAX_NOTES = 5_000;
export const MAX_TIME_SECONDS = 7 * 24 * 60 * 60;
const MAX_WORDS = 300_000;
const COLORS = ["#a78bfa", "#fbbf24", "#2dd4bf", "#60a5fa"];
const REASONS: ReviewReason[] = [
  "overlap",
  "unassigned",
  "speaker_count",
  "timing",
];
const TAGS: NoteTag[] = ["edit", "highlight", "subtitle", "check"];

function makeId(prefix: string): string {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function createProject(speakerCount = 4): Project {
  if (!Number.isInteger(speakerCount) || speakerCount < 1 || speakerCount > 4) {
    throw new Error("인물 수는 1~4명이어야 합니다.");
  }
  return {
    schemaVersion: 1,
    id: makeId("project"),
    name: "새 자막 프로젝트",
    mediaName: null,
    duration: 0,
    mode: "standard",
    speakerCount,
    speakers: Array.from({ length: speakerCount }, (_, i) => ({
      id: `speaker-${i + 1}`,
      name: `인물 ${String.fromCharCode(65 + i)}`,
      color: COLORS[i]!,
    })),
    captions: [],
    notes: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Explicitly synthetic sample; no audio file or completed analysis is implied. */
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

function invalid(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function object(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid(path, "객체가 필요합니다.");
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result))
    if (!keys.includes(key)) invalid(path, `지원하지 않는 필드: ${key}`);
  return result;
}

function string(
  value: unknown,
  path: string,
  max: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  ) {
    invalid(
      path,
      `문자열 길이는 ${allowEmpty ? "0" : "1"}~${max}자여야 합니다.`,
    );
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))
    invalid(path, "지원하지 않는 제어 문자가 있습니다.");
  return value;
}

function id(value: unknown, path: string): string {
  const result = string(value, path, 128);
  if (!/^[a-zA-Z0-9_.-]+$/.test(result))
    invalid(path, "ID 형식이 올바르지 않습니다.");
  return result;
}

function number(value: unknown, path: string, max = MAX_TIME_SECONDS): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max
  ) {
    invalid(path, `0~${max} 사이의 유한한 숫자가 필요합니다.`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean")
    invalid(path, "참 또는 거짓 값이 필요합니다.");
  return value;
}

function choice<T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
): T {
  if (typeof value !== "string" || !values.includes(value as T))
    invalid(path, "지원하지 않는 값입니다.");
  return value as T;
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    invalid(path, `최대 ${max}개의 목록이 필요합니다.`);
  return value;
}

function uniqueId(value: unknown, path: string, seen: Set<string>): string {
  const result = id(value, path);
  if (seen.has(result)) invalid(path, `중복 ID: ${result}`);
  seen.add(result);
  return result;
}

function boundedInput(text: string, path: string): void {
  if (
    typeof text !== "string" ||
    text.length > MAX_PROJECT_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES
  ) {
    invalid(path, "파일은 UTF-8 기준 8 MiB 이하여야 합니다.");
  }
}

/** Validate before constructing a fresh object; unrecognized fields never enter state. */
export function parseProject(text: string): Project {
  boundedInput(text, "프로젝트");
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch {
    invalid("프로젝트", "올바른 JSON 파일이 아닙니다.");
  }
  const root = object(value, "프로젝트", [
    "schemaVersion",
    "id",
    "name",
    "mediaName",
    "duration",
    "mode",
    "speakerCount",
    "speakers",
    "captions",
    "notes",
    "updatedAt",
  ]);
  if (root.schemaVersion !== 1)
    invalid("schemaVersion", "프로젝트 버전 1만 지원합니다.");
  const speakerCount = number(root.speakerCount, "speakerCount", 4);
  if (!Number.isInteger(speakerCount) || speakerCount < 1)
    invalid("speakerCount", "인물 수는 1~4명이어야 합니다.");
  const speakerIds = new Set<string>();
  // Expected count is a user hint, independent of the engine's detected inventory.
  const speakers = array(root.speakers, "speakers", 32).map(
    (value, i): Speaker => {
      const path = `speakers[${i}]`;
      const item = object(value, path, ["id", "name", "color"]);
      const color = string(item.color, `${path}.color`, 7);
      if (!/^#[0-9a-fA-F]{6}$/.test(color))
        invalid(`${path}.color`, "#RRGGBB 색상이 필요합니다.");
      return {
        id: uniqueId(item.id, `${path}.id`, speakerIds),
        name: string(item.name, `${path}.name`, 80, true),
        color,
      };
    },
  );
  if (speakers.length === 0)
    invalid("speakers", "최소 한 명의 인물이 필요합니다.");
  const captionIds = new Set<string>();
  let wordCount = 0;
  const captions = array(root.captions, "captions", MAX_CAPTIONS).map(
    (value, i): Caption => {
      const path = `captions[${i}]`;
      const item = object(value, path, [
        "id",
        "start",
        "end",
        "text",
        "speakerId",
        "reasons",
        "reviewed",
        "words",
      ]);
      const start = number(item.start, `${path}.start`);
      const end = number(item.end, `${path}.end`);
      if (end <= start) invalid(path, "자막 끝은 시작보다 늦어야 합니다.");
      const speakerId =
        item.speakerId === null
          ? null
          : id(item.speakerId, `${path}.speakerId`);
      if (speakerId !== null && !speakerIds.has(speakerId))
        invalid(path, "존재하지 않는 인물입니다.");
      const reasons = array(
        item.reasons,
        `${path}.reasons`,
        REASONS.length,
      ).map((reason) => choice(reason, `${path}.reasons`, REASONS));
      if (new Set(reasons).size !== reasons.length)
        invalid(path, "검수 사유가 중복되었습니다.");
      const caption: Caption = {
        id: uniqueId(item.id, `${path}.id`, captionIds),
        start,
        end,
        text: string(item.text, `${path}.text`, 10_000, true),
        speakerId,
        reasons,
        reviewed: boolean(item.reviewed, `${path}.reviewed`),
      };
      if (item.words !== undefined) {
        const words = array(item.words, `${path}.words`, 10_000);
        wordCount += words.length;
        if (wordCount > MAX_WORDS)
          invalid("words", "전체 단어 수가 제한을 초과했습니다.");
        caption.words = words.map((value, j): Word => {
          const wordPath = `${path}.words[${j}]`;
          const word = object(value, wordPath, [
            "start",
            "end",
            "text",
            "probability",
          ]);
          const start = number(word.start, `${wordPath}.start`);
          const end = number(word.end, `${wordPath}.end`);
          if (end < start)
            invalid(wordPath, "단어 끝은 시작보다 빠를 수 없습니다.");
          const result: Word = {
            start,
            end,
            text: string(word.text, `${wordPath}.text`, 1_000, true),
          };
          if (word.probability !== undefined)
            result.probability = number(
              word.probability,
              `${wordPath}.probability`,
              1,
            );
          return result;
        });
      }
      return caption;
    },
  );
  const noteIds = new Set<string>();
  const notes = array(root.notes, "notes", MAX_NOTES).map((value, i): Note => {
    const path = `notes[${i}]`;
    const item = object(value, path, [
      "id",
      "start",
      "end",
      "text",
      "tag",
      "done",
    ]);
    const start = number(item.start, `${path}.start`);
    const end = item.end === null ? null : number(item.end, `${path}.end`);
    if (end !== null && end < start)
      invalid(path, "메모 끝은 시작보다 빠를 수 없습니다.");
    return {
      id: uniqueId(item.id, `${path}.id`, noteIds),
      start,
      end,
      text: string(item.text, `${path}.text`, 10_000, true),
      tag: choice(item.tag, `${path}.tag`, TAGS),
      done: boolean(item.done, `${path}.done`),
    };
  });
  const updatedAt = string(root.updatedAt, "updatedAt", 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      updatedAt,
    ) ||
    !Number.isFinite(Date.parse(updatedAt))
  ) {
    invalid("updatedAt", "ISO 8601 날짜가 필요합니다.");
  }
  return {
    schemaVersion: 1,
    id: id(root.id, "id"),
    name: string(root.name, "name", 160, true),
    mediaName:
      root.mediaName === null ? null : string(root.mediaName, "mediaName", 512),
    duration: number(root.duration, "duration"),
    mode: choice(root.mode, "mode", ["standard", "overlap"]),
    speakerCount,
    speakers,
    captions,
    notes,
    updatedAt,
  };
}

function milliseconds(seconds: number): number {
  number(seconds, "시간");
  return Math.round(seconds * 1000);
}

function formatMilliseconds(ms: number, separator = "."): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1_000) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(ms % 1000).padStart(3, "0")}`;
}

export function formatTime(seconds: number): string {
  return formatMilliseconds(milliseconds(seconds));
}

export function parseTime(value: string): number {
  const text = value.trim().replace(",", ".");
  if (!/^(?:\d+:){0,2}\d+(?:\.\d{1,3})?$/.test(text))
    invalid("시간", "초, 분:초 또는 시:분:초 형식이 필요합니다.");
  const parts = text.split(":").map(Number);
  if (parts.length > 1 && parts[parts.length - 1]! >= 60)
    invalid("시간", "초는 60 미만이어야 합니다.");
  if (parts.length === 3 && parts[1]! >= 60)
    invalid("시간", "분은 60 미만이어야 합니다.");
  return number(
    parts.reduce((total, part) => total * 60 + part, 0),
    "시간",
  );
}

export function parseSrt(text: string): Caption[] {
  boundedInput(text, "SRT");
  const normalized = text
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n[\t ]*\n+/);
  if (blocks.length > MAX_CAPTIONS)
    invalid("SRT", `자막은 최대 ${MAX_CAPTIONS}개입니다.`);
  const captions = blocks.map((block, i): Caption => {
    const lines = block.split("\n");
    if (/^\d+\s*$/.test(lines[0] ?? "")) lines.shift();
    const timing = lines
      .shift()
      ?.match(
        /^\s*(\d{2,}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,.]\d{1,3})\s*$/,
      );
    if (!timing) invalid(`SRT ${i + 1}`, "자막 시간 형식이 올바르지 않습니다.");
    const start = parseTime(timing[1]!);
    const end = parseTime(timing[2]!);
    if (end <= start)
      invalid(`SRT ${i + 1}`, "자막 끝은 시작보다 늦어야 합니다.");
    if (lines.length === 0) invalid(`SRT ${i + 1}`, "자막 내용이 없습니다.");
    return {
      id: makeId("caption"),
      start,
      end,
      text: string(lines.join("\n"), `SRT ${i + 1}`, 10_000),
      speakerId: null,
      reasons: ["unassigned"],
      reviewed: false,
    };
  });
  let furthest: Caption | undefined;
  for (const caption of [...captions].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    if (furthest && caption.start < furthest.end) {
      if (!furthest.reasons.includes("overlap"))
        furthest.reasons.push("overlap");
      caption.reasons.push("overlap");
    }
    if (!furthest || caption.end > furthest.end) furthest = caption;
  }
  return captions;
}

type Cue = { start: number; end: number; text: string };

function serializeSrt(cues: Cue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatMilliseconds(cue.start, ",")} --> ${formatMilliseconds(cue.end, ",")}\n${cue.text}\n`,
    )
    .join("\n");
}

/** Undefined exports all; null exports unassigned. Filtered cues keep source intervals. */
export function exportSrt(
  project: Project,
  speakerId?: string | null,
  includeNames = true,
): string {
  const names = new Map(
    project.speakers.map((speaker, index) => [
      speaker.id,
      speaker.name.trim() || `인물 ${index + 1}`,
    ]),
  );
  if (speakerId !== undefined && speakerId !== null && !names.has(speakerId))
    invalid("SRT", "존재하지 않는 인물입니다.");
  const captions = project.captions
    .filter(
      (caption) => speakerId === undefined || caption.speakerId === speakerId,
    )
    .map((caption, order) => {
      const start = milliseconds(caption.start);
      if (caption.end <= caption.start)
        invalid("SRT", "자막 끝은 시작보다 늦어야 합니다.");
      if (!caption.text.trim())
        invalid(
          "SRT",
          "빈 자막 내용을 입력하거나 해당 자막을 삭제한 뒤 내보내세요.",
        );
      const end = Math.max(start + 1, milliseconds(caption.end));
      // Blank lines delimit SRT cues. Fold only empty lines, preserving Unicode and real line breaks.
      const text = caption.text
        .replace(/\r\n?/g, "\n")
        .replace(/\n[\t ]*\n+/g, "\n");
      const name =
        caption.speakerId === null
          ? "미지정"
          : (names.get(caption.speakerId) ?? "미지정");
      return {
        start,
        end,
        order,
        text: includeNames ? `${name}: ${text}` : text,
      };
    })
    .sort((a, b) => a.start - b.start || a.order - b.order);
  if (speakerId !== undefined) return serializeSrt(captions);

  type Event = { added: number[]; removed: number[] };
  const events = new Map<number, Event>();
  const eventAt = (time: number): Event => {
    let event = events.get(time);
    if (!event) {
      event = { added: [], removed: [] };
      events.set(time, event);
    }
    return event;
  };
  captions.forEach((caption, i) => {
    eventAt(caption.start).added.push(i);
    eventAt(caption.end).removed.push(i);
  });
  const times = [...events.keys()].sort((a, b) => a - b);
  const active = new Set<number>();
  const cues: Cue[] = [];
  let outputCharacters = 0;
  for (let i = 0; i < times.length - 1; i++) {
    const start = times[i]!;
    const end = times[i + 1]!;
    const event = events.get(start)!;
    event.removed.forEach((index) => active.delete(index));
    event.added.forEach((index) => active.add(index));
    if (active.size === 0) continue;
    const indices = [...active].sort((a, b) => a - b);
    outputCharacters += indices.reduce(
      (total, index) => total + captions[index]!.text.length + 1,
      80,
    );
    if (outputCharacters > MAX_PROJECT_BYTES)
      invalid(
        "SRT",
        "겹친 자막으로 통합 출력이 너무 큽니다. 인물별로 내보내세요.",
      );
    const text = indices.map((index) => captions[index]!.text).join("\n");
    cues.push({ start, end, text });
  }
  return serializeSrt(cues);
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]()#+\-.!|])/g, "\\$1")
    .replace(/\r\n?/g, "\n");
}

const TAG_LABELS: Record<NoteTag, string> = {
  edit: "편집",
  highlight: "하이라이트",
  subtitle: "자막",
  check: "확인",
};

export function exportNotesMarkdown(project: Project): string {
  const heading = escapeMarkdown(
    project.name.trim() || "이름 없는 프로젝트",
  ).replace(/\n/g, " ");
  const lines = [
    `# ${heading} · 편집 메모`,
    "",
    "시간은 원본 미디어 기준입니다.",
    "",
  ];
  for (const note of [...project.notes].sort((a, b) => a.start - b.start)) {
    const range = `${formatTime(note.start)}${note.end === null ? "" : ` → ${formatTime(note.end)}`}`;
    lines.push(
      `- [${note.done ? "x" : " "}] **${range}** · ${TAG_LABELS[note.tag]}`,
    );
    for (const line of escapeMarkdown(note.text).split("\n"))
      lines.push(`  ${line || "  "}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function csvCell(value: string): string {
  // Spreadsheet software may evaluate formulas even inside quoted CSV cells.
  const safe =
    /^[\s\uFEFF]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value)
      ? `'${value}`
      : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function exportNotesCsv(project: Project): string {
  const rows: string[][] = [["id", "start", "end", "tag", "done", "text"]];
  for (const note of [...project.notes].sort((a, b) => a.start - b.start)) {
    rows.push([
      note.id,
      formatTime(note.start),
      note.end === null ? "" : formatTime(note.end),
      note.tag,
      note.done ? "true" : "false",
      note.text,
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function safeFilename(value: string, fallback = "voicesubsep"): string {
  const name = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/g, "");
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    return fallback.trim() || "voicesubsep";
  return name;
}
