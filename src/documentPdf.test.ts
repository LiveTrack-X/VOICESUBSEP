import { afterEach, describe, expect, it, vi } from "vitest";
import { openDocumentPrintView } from "./documentExports";
import { saveDocumentPdf, supportsDirectPdf } from "./documentPdf";

vi.mock("./documentExports", () => ({ openDocumentPrintView: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const label = (key: string) => key;
describe("native PDF result and honest browser fallback", () => {
  it("uses only native confirmation for a saved file and supplies a safe PDF basename", async () => {
    const native = vi.fn(async () => ({ status: "saved", filePath: "C:\\Reports\\safe.pdf" }));
    vi.stubGlobal("window", { voicesubsepDesktop: { saveDocumentPdf: native } });
    expect(supportsDirectPdf()).toBe(true);
    expect(await saveDocumentPdf("<html>report</html>", "../meeting:notes.pdf", label)).toBe("saved");
    expect(native).toHaveBeenCalledWith({ html: "<html>report</html>", suggestedName: expect.stringMatching(/^[^\\/:*?"<>|]+\.pdf$/) });
    expect(openDocumentPrintView).not.toHaveBeenCalled();
  });
  it("returns cancelled without a success claim or surprise print preview", async () => {
    vi.stubGlobal("window", { voicesubsepDesktop: { saveDocumentPdf: vi.fn(async () => ({status:"cancelled"})) } });
    expect(await saveDocumentPdf("html", "report", label)).toBe("cancelled");
    expect(openDocumentPrintView).not.toHaveBeenCalled();
  });
  it.each(["error", "invalid"])("reports a safe failure for %s, never silently falling back", async kind => {
    vi.stubGlobal("window", { voicesubsepDesktop: { saveDocumentPdf: vi.fn(async () => { if (kind === "error") throw new Error("private filesystem detail"); return { status:"unknown" }; }) } });
    await expect(saveDocumentPdf("html", "report", label)).rejects.toThrow("PDF 파일을 저장하지 못했습니다.");
    expect(openDocumentPrintView).not.toHaveBeenCalled();
  });
  it("opens a print preview without claiming a PDF has been saved when the bridge is absent", async () => {
    vi.stubGlobal("window", {});
    expect(supportsDirectPdf()).toBe(false);
    expect(await saveDocumentPdf("html", "report", label)).toBe("print-preview");
    expect(openDocumentPrintView).toHaveBeenCalledWith("html", label);
  });
});
