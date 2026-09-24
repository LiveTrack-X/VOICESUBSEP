import { describe, expect, it } from "vitest";
import { createProject, parseProject, type Caption, type Project } from "./domain";
import { acceptMinutesResponse, documentBatches, documentSourceOptions, emptyDocuments, evidenceFor, evidenceIsCurrent,
  exportDocument, interviewTag, parseDocuments, type MinutesItem } from "./documents";

function fixture(): Project {
  const project = createProject();
  const a: Caption = { id: "a", start: 0, end: 3, text: "Can Min send it by Friday?", speakerId: project.speakers[0]!.id, reasons: [], reviewed: true };
  const b: Caption = { ...a, id: "b", start: 3, end: 6, text: "Yes, Min will send it by Friday.", speakerId: project.speakers[1]!.id };
  const item: MinutesItem = { id: "item", kind: "action", text: "Send it", owner: "Min", due: "Friday", evidence: [evidenceFor(b)], status: "reviewed" };
  return { ...project, duration: 6, captions: [a, b], documents: {
    roles: { [project.speakers[0]!.id]: "questioner", [project.speakers[1]!.id]: "respondent" }, tags: {}, items: [item],
  } };
}

describe("portable interview and meeting documents", () => {
  it("round-trips roles, explicit tags, reviewed items, and speaker-linked evidence in project JSON", () => {
    const project = fixture(); project.documents!.tags.a = "other";
    const restored = parseProject(JSON.stringify(project));
    expect(restored.documents).toEqual(project.documents);
    expect(restored.documents).not.toBe(project.documents);
    expect(evidenceIsCurrent(restored.documents!.items[0]!, restored.captions)).toBe(true);
    expect(interviewTag(restored.captions[0]!, restored.documents!)).toBe("other");
    expect(interviewTag(restored.captions[1]!, restored.documents!)).toBe("answer");
  });
  it("opens older projects without documents and provides role-based defaults", () => {
    expect(parseProject(JSON.stringify(createProject())).documents).toBeUndefined();
    const project = fixture();
    expect(interviewTag(project.captions[0]!, project.documents!)).toBe("question");
    expect(interviewTag({ ...project.captions[0]!, speakerId: null }, project.documents!)).toBe("other");
  });
  it.each([
    { text: "Changed original" }, { start: 3.1 }, { end: 6.1 }, { speakerId: null },
  ])("requires evidence recheck after a source change: %j", (change) => {
    const project = fixture(); const item = project.documents!.items[0]!;
    const changed = project.captions.map((caption) => caption.id === "b" ? { ...caption, ...change } : caption);
    expect(evidenceIsCurrent(item, changed)).toBe(false);
    expect(item.status).toBe("reviewed"); // Stored confirmation never overrides freshness.
    expect(evidenceIsCurrent(item, project.captions)).toBe(true);
  });
  it("requires evidence for confirmation and marks deleted source references stale", () => {
    const project = fixture(); const item = project.documents!.items[0]!;
    expect(evidenceIsCurrent(item, [project.captions[0]!])).toBe(false);
    expect(evidenceIsCurrent({ ...item, evidence: [] }, project.captions)).toBe(false);
    expect(evidenceIsCurrent(item, project.captions.map((caption) => ({ ...caption, reviewed: false })))).toBe(true);
  });
  it("rejects enum arrays, duplicate items, unsafe IDs and unknown fields", () => {
    const project = fixture();
    expect(() => parseDocuments({ ...project.documents, roles: { one: ["questioner"] } })).toThrow(/role/);
    expect(() => parseDocuments({ ...project.documents, tags: { a: ["question"] } })).toThrow(/tag/);
    expect(() => parseDocuments({ ...project.documents, items: [project.documents!.items[0], project.documents!.items[0]] })).toThrow(/Duplicate/);
    expect(() => parseDocuments({ ...project.documents, roles: JSON.parse('{"__proto__":"questioner"}') })).toThrow(/ID/);
    expect(() => parseDocuments({ ...project.documents, remoteUrl: "https://invalid" })).toThrow(/Unknown/);
    expect(() => parseDocuments({ ...project.documents, items: [{ ...project.documents!.items[0], status: ["reviewed"] }] })).toThrow(/status/);
  });
  it("rejects invalid or oversized evidence while allowing manual empty drafts", () => {
    const item = fixture().documents!.items[0]!;
    expect(() => parseDocuments({ ...emptyDocuments(), items: [{ ...item, evidence: [{ ...item.evidence[0], end: 0 }] }] })).toThrow(/time/);
    expect(() => parseDocuments({ ...emptyDocuments(), items: [{ ...item, evidence: Array.from({ length: 25 }, () => item.evidence[0]) }] })).toThrow(/evidence/);
    expect(parseDocuments({ ...emptyDocuments(), items: [{ ...item, text: "", owner: "", due: "", evidence: [], status: "draft" }] }).items[0]!.text).toBe("");
  });
});

describe("bounded evidence-linked document generation", () => {
  it("limits source choices to 100 while retaining a selection beyond the first page or outside a search", () => {
    const caption = fixture().captions[0]!;
    const captions = Array.from({ length: 2404 }, (_, index) => ({ ...caption, id: `c-${index}`, start: index, end: index + 1, text: `line ${index}` }));
    const choices = documentSourceOptions(captions, "", "c-2403");
    expect(choices.captions).toHaveLength(100); expect(choices.total).toBe(2404);
    expect(choices.captions.some((source) => source.id === "c-2403")).toBe(true);
    const search = documentSourceOptions(captions, "line 42", "c-2403");
    expect(search.captions[0]!.id).toBe("c-2403");
    expect(search.captions.slice(1).every((source) => source.text.includes("line 42"))).toBe(true);
    expect(documentSourceOptions(captions, "00:00:03", "").captions[0]!.id).toBe("c-3");
  });
  it("sorts captions, skips blanks, and enforces 80-caption batches without splitting cues", () => {
    const source = fixture().captions[0]!;
    const captions = Array.from({ length: 161 }, (_, index) => ({ ...source, id: `c-${index}`, start: index * 2, end: index * 2 + 1 }));
    const reversed = [...captions].reverse(); reversed.push({ ...source, id: "blank", text: "  " });
    const batches = documentBatches(reversed);
    expect(batches.map((batch) => batch.length)).toEqual([80, 80, 1]);
    expect(batches.flat().map((caption) => caption.id)).toEqual(captions.map((caption) => caption.id));
    expect(reversed[0]!.id).toBe("c-160");
  });
  it("uses JavaScript character units for exact 12,000-character boundaries and rejects oversized source cues", () => {
    const caption = fixture().captions[0]!;
    const captions = [{ ...caption, text: "😀".repeat(4_000) }, { ...caption, id: "b", start: 1, text: "😀".repeat(2_000) }, { ...caption, id: "c", start: 2, text: "tail" }];
    expect(documentBatches(captions).map((batch) => batch.length)).toEqual([2, 1]);
    expect(() => documentBatches([{ ...caption, text: "a".repeat(10_001) }])).toThrow(/text/);
  });
  it("binds generated items to exact local evidence snapshots and always creates drafts", () => {
    const project = fixture();
    const response = { model: "local", localOnly: true, items: [{ kind: "action", text: "Send it", owner: "Min", due: "Friday", evidenceIds: ["b", "b"] }] };
    const accepted = acceptMinutesResponse(response, project.captions);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ status: "draft", evidence: [evidenceFor(project.captions[1]!)] });
    expect(accepted[0]!.id).not.toBe("item");
    expect(project.documents!.items).toHaveLength(1);
  });
  it.each([
    { evidenceIds: [] }, { evidenceIds: ["missing"] }, { evidenceIds: ["b"], text: " " }, { evidenceIds: ["b"], kind: "invented" },
  ])("rejects an invalid generated item atomically: %j", (change) => {
    const item = { kind: "action", text: "Send it", owner: "", due: "", evidenceIds: ["b"] };
    expect(() => acceptMinutesResponse({ items: [item, { ...item, ...change }] }, fixture().captions)).toThrow();
  });
  it("rejects remote markers and unbounded response lists, but accepts no useful content", () => {
    expect(() => acceptMinutesResponse({ localOnly: false, items: [] }, [])).toThrow(/locally/);
    expect(() => acceptMinutesResponse({ items: new Array(65).fill({}) }, [])).toThrow(/response/);
    expect(acceptMinutesResponse({ localOnly: true, items: [] }, [])).toEqual([]);
  });
});

describe("document Markdown exports", () => {
  it("exports question/answer roles with source times and speaker names", () => {
    const project = fixture(); const result = exportDocument(project, "interview", (key) => key);
    expect(result).toContain("## 인터뷰");
    expect(result).toContain(`[00:00:00] ${project.speakers[0]!.name} · 질문`);
    expect(result).toContain(`[00:00:03] ${project.speakers[1]!.name} · 답변`);
  });
  it("prints stale evidence instead of reviewed status and never invents owner or deadline", () => {
    const project = fixture(); project.documents!.items[0]!.owner = ""; project.documents!.items[0]!.due = "";
    project.captions[1]!.text = "The decision was withdrawn.";
    const result = exportDocument(project, "minutes", (key) => key);
    expect(result).toContain("근거 재확인 필요"); expect(result).not.toContain("확인 완료");
    expect(result).toContain("담당자: 미정 · 기한: 미정");
    expect(result).toContain("> [00:00:03] Yes, Min will send it by Friday\\.");
  });
  it("escapes supplied Markdown and HTML so original content cannot create document structure", () => {
    const project = fixture(); project.name = "title\n# fake heading";
    project.captions[0]!.text = "<script>x</script>\n# fake heading\n[link](https://example.invalid)";
    const result = exportDocument(project, "interview", (key) => key);
    expect(result).not.toContain("<script>"); expect(result).not.toContain("\n# fake heading");
    expect(result).toContain("&lt;script&gt;"); expect(result).toContain("\\[link\\]");
  });
});
