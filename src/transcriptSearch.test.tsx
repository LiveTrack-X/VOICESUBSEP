import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createProject, type Caption } from "./domain";
import { buildTranscriptDocument, exportTranscriptTxt, type TranscriptTurn } from "./transcriptDocument";
import { filterTranscript, transcriptTimeTarget } from "./transcriptSearch";
import { MAX_TRANSCRIPT_ROWS, transcriptOffsets, transcriptWindow } from "./transcriptScroll";
import { I18nProvider, LOCALES, translate } from "./i18n";
import { TranscriptDocumentPanel } from "./components/TranscriptDocumentPanel";
import { DocumentsDialog } from "./components/DocumentsDialog";

const turns: TranscriptTurn[] = [
  { ids: ["a"], speakerId: "a", speaker: "Alice", color: null, start: 1, end: 4, text: "안녕 literal [a-z]", overlap: true },
  { ids: ["b"], speakerId: "b", speaker: "민준", color: null, start: 3, end: 5, text: "Hello WORLD", overlap: true },
  { ids: ["c"], speakerId: "a", speaker: "Alice", color: null, start: 70.125, end: 73, text: "나중 발언", overlap: false },
];
const label = (key: string) => key;

describe("transcript display search without source playback or mutation", () => {
  it("matches literal content or names case-insensitively and keeps source order", () => {
    const before = JSON.stringify(turns);
    expect(filterTranscript(turns, " ")).toBe(turns);
    expect(filterTranscript(turns, " ALICE ").map(turn => turn.ids[0])).toEqual(["a", "c"]);
    expect(filterTranscript(turns, "민준").map(turn => turn.ids[0])).toEqual(["b"]);
    expect(filterTranscript(turns, "world").map(turn => turn.ids[0])).toEqual(["b"]);
    expect(filterTranscript(turns, "[a-z]")).toEqual([turns[0]]);
    expect(filterTranscript(turns, "missing")).toEqual([]);
    expect(JSON.stringify(turns)).toBe(before);
  });

  it.each(["70.125", "1:10.125", "00:01:10.125", "1:10,125"])("finds a containing turn using the shared cut-time format %s", time => {
    expect(transcriptTimeTarget(turns, time)).toBe(turns[2]);
  });

  it("respects overlap order, end-exclusive bounds, gaps and the current filtered results", () => {
    expect(transcriptTimeTarget(turns, "3.5")).toBe(turns[0]);
    expect(transcriptTimeTarget(turns, "4")).toBe(turns[1]);
    expect(transcriptTimeTarget(turns, "5")).toBe(turns[2]);
    expect(transcriptTimeTarget(turns, "0")).toBe(turns[0]);
    expect(transcriptTimeTarget(turns, "73")).toBeNull();
    expect(transcriptTimeTarget(filterTranscript(turns, "민준"), "70")).toBeNull();
    expect(transcriptTimeTarget([], "1")).toBeNull();
    for (const invalid of ["", "-1", "1:60", "1:60:00", "no", "0.0001", "1:2:3:4"]) expect(() => transcriptTimeTarget(turns, invalid)).toThrow();
  });

  it("finds the end of 3,323 captions without truncating exports or exceeding the virtual row bound", () => {
    const project = createProject(2);
    project.duration = 6646;
    project.captions = Array.from({ length: 3323 }, (_, index): Caption => ({ id: `cue-${index}`, start: index * 2, end: index * 2 + 1,
      text: `발언 ${index}`, speakerId: project.speakers[index % 2]!.id, reviewed: true, reasons: [] }));
    const original = JSON.stringify(project), document = buildTranscriptDocument(project, label);
    const found = filterTranscript(document.turns, "발언 3322");
    expect(found).toHaveLength(1);
    expect(transcriptTimeTarget(document.turns, "01:50:44")?.ids).toEqual(["cue-3322"]);
    const offsets = transcriptOffsets(document.turns, new Map(), 420, false);
    const range = transcriptWindow(offsets, offsets[3322]!, 300);
    expect(range.start).toBeLessThanOrEqual(3322); expect(range.end).toBe(3323);
    expect(range.end - range.start).toBeLessThanOrEqual(MAX_TRANSCRIPT_ROWS);
    const exported = exportTranscriptTxt(project, label);
    expect(exported).toContain("발언 0"); expect(exported).toContain("발언 3322");
    expect(JSON.stringify(project)).toBe(original);
  });
});

describe("document playback and search controls", () => {
  function project() {
    const project = createProject(); project.duration = 80;
    project.captions = [{ id: "cue", start: 1, end: 2, text: "source", speakerId: project.speakers[0]!.id, reasons: [], reviewed: true }];
    return project;
  }
  it("renders search/reset/time controls while retaining all original export actions", () => {
    const onSeek = vi.fn();
    const html = renderToStaticMarkup(<I18nProvider><TranscriptDocumentPanel project={project()} onSeek={onSeek}/></I18nProvider>);
    for (const key of ["발언 내용·인물 검색", "찾을 시간", "시간 찾기", "검색 초기화", "이 발언 재생", "Word 문서 (.docx)", "Excel 통합문서 저장", "HTML 보고서"]) expect(html).toContain(key);
    expect(html).toContain("검색 결과 1개 / 전체 1개");
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("shows pause and original time when media is playing, or connection guidance without a source", () => {
    const onClose = vi.fn(), onSource = vi.fn(), onTogglePlayback = vi.fn();
    const render = (mediaAvailable: boolean) => renderToStaticMarkup(<I18nProvider><DocumentsDialog project={project()} update={()=>{}}
      onClose={onClose} onSource={onSource} time={12.125} playing mediaAvailable={mediaAvailable} onTogglePlayback={onTogglePlayback}/></I18nProvider>);
    const html = render(true);
    expect(html).toContain('aria-label="일시 정지"');
    expect(html).toContain("00:00:12.125");
    expect(html).toContain("발언을 재생해도 문서는 열린 상태로 유지됩니다.");
    expect(render(false)).toContain("재생하려면 원본 미디어를 연결하세요.");
    expect(render(false)).not.toContain('class="transcript-seek"');
    expect(onClose).not.toHaveBeenCalled(); expect(onSource).not.toHaveBeenCalled(); expect(onTogglePlayback).not.toHaveBeenCalled();
  });

  it("localizes every new action and count without losing placeholders", () => {
    for (const locale of LOCALES) {
      const text = translate(locale, "검색 결과 {count}개 / 전체 {total}개 · 내보내기는 전체 발언", { count: 7, total: 3323 });
      expect(text).toContain("7"); expect(text).toContain("3323"); expect(text).not.toContain("{");
      if (locale !== "ko") expect(text).not.toMatch(/[가-힣]/);
    }
  });
});
