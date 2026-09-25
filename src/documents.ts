import type { Caption, Project } from "./domain";

export type InterviewRole = "questioner" | "respondent" | "participant";
export type InterviewTag = "question" | "answer" | "other";
export type MinutesKind = "summary" | "discussion" | "decision" | "action";
export type Evidence = { id: string; text: string; start: number; end: number; speakerId: string | null };
export type MinutesItem = {
  id: string; kind: MinutesKind; text: string; owner: string; due: string;
  evidence: Evidence[]; status: "draft" | "reviewed";
};
export type ProjectDocuments = {
  roles: Record<string, InterviewRole>;
  tags: Record<string, InterviewTag>;
  items: MinutesItem[];
};
export const emptyDocuments = (): ProjectDocuments => ({ roles: {}, tags: {}, items: [] });
const identifier = /^[a-zA-Z0-9_.-]{1,128}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid document object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 8000): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new Error("Invalid document text.");
  return value;
}
function id(value: unknown): string {
  const result = text(value, 128);
  if (!identifier.test(result) || ["__proto__", "constructor", "prototype"].includes(result)) throw new Error("Invalid document ID.");
  return result;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unknown document field.");
}
export function parseDocuments(value: unknown): ProjectDocuments {
  const root = record(value); keys(root, ["roles", "tags", "items"]);
  const roles = record(root.roles), tags = record(root.tags);
  if (Object.keys(roles).length > 32 || Object.keys(tags).length > 20000) throw new Error("Too many document labels.");
  const parsed = emptyDocuments();
  for (const [key, role] of Object.entries(roles)) {
    if (typeof role !== "string" || !["questioner", "respondent", "participant"].includes(role)) throw new Error("Invalid interview role.");
    parsed.roles[id(key)] = role as InterviewRole;
  }
  for (const [key, tag] of Object.entries(tags)) {
    if (typeof tag !== "string" || !["question", "answer", "other"].includes(tag)) throw new Error("Invalid interview tag.");
    parsed.tags[id(key)] = tag as InterviewTag;
  }
  if (!Array.isArray(root.items) || root.items.length > 1000) throw new Error("Too many document items.");
  const ids = new Set<string>();
  parsed.items = root.items.map(raw => {
    const item = record(raw); keys(item, ["id", "kind", "text", "owner", "due", "evidence", "status"]);
    const itemId = id(item.id);
    if (ids.has(itemId)) throw new Error("Duplicate document item.");
    ids.add(itemId);
    if (typeof item.kind !== "string" || !["summary", "discussion", "decision", "action"].includes(item.kind) ||
      typeof item.status !== "string" || !["draft", "reviewed"].includes(item.status)) throw new Error("Invalid document kind/status.");
    if (!Array.isArray(item.evidence) || item.evidence.length > 24) throw new Error("Invalid document evidence.");
    const evidence = item.evidence.map(rawEvidence => {
      const e = record(rawEvidence); keys(e, ["id", "text", "start", "end", "speakerId"]);
      if (typeof e.start !== "number" || typeof e.end !== "number" || !Number.isFinite(e.start) || !Number.isFinite(e.end) || e.start < 0 || e.end <= e.start || e.end > 604800) throw new Error("Invalid evidence time.");
      return { id: id(e.id), text: text(e.text, 10000), start: e.start, end: e.end, speakerId: e.speakerId == null ? null : id(e.speakerId) };
    });
    return { id: itemId, kind: item.kind as MinutesKind, text: text(item.text), owner: text(item.owner, 160), due: text(item.due, 160), evidence, status: item.status as MinutesItem["status"] };
  });
  return parsed;
}
export function evidenceFor(caption: Caption): Evidence {
  return { id: caption.id, text: caption.text, start: caption.start, end: caption.end, speakerId: caption.speakerId };
}
export function evidenceIsCurrent(item: MinutesItem, captions: readonly Caption[]): boolean {
  return item.evidence.length > 0 && item.evidence.every(e => captions.some(c => c.id === e.id && c.text === e.text && c.start === e.start && c.end === e.end && c.speakerId === e.speakerId));
}
export function interviewTag(caption: Caption, documents: ProjectDocuments): InterviewTag {
  return documents.tags[caption.id] ?? (caption.speakerId && documents.roles[caption.speakerId] === "questioner" ? "question" : caption.speakerId && documents.roles[caption.speakerId] === "respondent" ? "answer" : "other");
}
export function documentBatches(captions: readonly Caption[]): Caption[][] {
  const batches: Caption[][] = []; let batch: Caption[] = []; let size = 0;
  for (const caption of [...captions].sort((a, b) => a.start - b.start)) {
    if (!caption.text.trim()) continue;
    text(caption.text, 10000);
    if (batch.length && (batch.length >= 80 || size + caption.text.length > 12000)) { batches.push(batch); batch = []; size = 0; }
    batch.push(caption); size += caption.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
/** Bound native select DOM size while retaining its currently selected caption. */
export function documentSourceOptions(captions: readonly Caption[], search: string, selectedId: string, limit = 100): { captions: Caption[]; total: number } {
  const needle = search.trim().toLowerCase();
  const maximum = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 100));
  const matches = captions.filter((caption) => !needle || `${stamp(caption.start)} ${caption.text}`.toLowerCase().includes(needle));
  const options = matches.slice(0, maximum);
  const selected = captions.find((caption) => caption.id === selectedId);
  if (selected && !options.some((caption) => caption.id === selectedId)) {
    if (options.length === maximum) options.pop();
    options.unshift(selected);
  }
  return { captions: options, total: matches.length };
}
export function acceptMinutesResponse(value: unknown, captions: readonly Caption[], expectedProvider: "local" | "groq" | "xai" = "local"): MinutesItem[] {
  const root = record(value);
  if (expectedProvider === "local") {
    if (root.localOnly !== undefined && root.localOnly !== true) throw new Error("Minutes must be generated locally.");
  } else if (root.localOnly !== false || root.provider !== expectedProvider) throw new Error("Minutes provider does not match the explicit request.");
  if (!Array.isArray(root.items) || root.items.length > 64) throw new Error("Invalid minutes response.");
  return root.items.map(raw => {
    const item = record(raw);
    if (typeof item.text !== "string" || !item.text.trim()) throw new Error("Empty generated minutes text.");
    if (!Array.isArray(item.evidenceIds) || !item.evidenceIds.length || item.evidenceIds.length > 24) throw new Error("Minutes need source evidence.");
    const evidence = [...new Set(item.evidenceIds)].map(captionId => {
      const caption = captions.find(c => c.id === captionId);
      if (!caption) throw new Error("Unknown source evidence.");
      return evidenceFor(caption);
    });
    const candidate = { id: crypto.randomUUID(), kind: item.kind, text: item.text, owner: item.owner, due: item.due, evidence, status: "draft" };
    return parseDocuments({ ...emptyDocuments(), items: [candidate] }).items[0]!;
  });
}
function stamp(seconds: number) {
  return `${Math.floor(seconds / 3600).toString().padStart(2,"0")}:${Math.floor(seconds / 60 % 60).toString().padStart(2,"0")}:${Math.floor(seconds % 60).toString().padStart(2,"0")}`;
}
function markdown(value: string, oneLine = false): string {
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]()#+\-.!|])/g, "\\$1").replace(/\r\n?/g, "\n");
  return oneLine ? escaped.replace(/\n/g, " ") : escaped;
}
export function exportDocument(project: Project, mode: "interview" | "minutes", label: (key: string) => string): string {
  const docs = project.documents ?? emptyDocuments();
  const lines = [`# ${markdown(project.name, true)}`, "", `## ${label(mode === "interview" ? "인터뷰" : "회의록")}`, ""];
  if (mode === "interview") for (const c of [...project.captions].sort((a,b)=>a.start-b.start)) {
    const tag = interviewTag(c, docs);
    const who = project.speakers.find(s=>s.id===c.speakerId)?.name ?? label("미배정");
    lines.push(`### [${stamp(c.start)}] ${markdown(who, true)} · ${label(tag === "question" ? "질문" : tag === "answer" ? "답변" : "기타")}`, "", markdown(c.text), "");
  }
  else for (const item of docs.items) {
    const kind = { summary:"요약", discussion:"논의", decision:"결정", action:"할 일" }[item.kind];
    const state = !evidenceIsCurrent(item, project.captions) ? label("근거 재확인 필요") : label(item.status === "reviewed" ? "확인 완료" : "초안");
    lines.push(`### ${label(kind)} · ${state}`, "", markdown(item.text), "", `${label("담당자")}: ${markdown(item.owner || label("미정"), true)} · ${label("기한")}: ${markdown(item.due || label("미정"), true)}`);
    for (const e of item.evidence) lines.push(`> [${stamp(e.start)}] ${markdown(e.text).replace(/\n/g, "\n> ")}`);
    lines.push("");
  }
  return lines.join("\n");
}
