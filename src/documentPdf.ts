import "./desktop";
import { openDocumentPrintView } from "./documentExports";
import { safeFilename } from "./domain";

export function supportsDirectPdf(): boolean {
  return typeof window !== "undefined" && typeof window.voicesubsepDesktop?.saveDocumentPdf === "function";
}

/** Only a native bridge result confirms a PDF file was saved. Browser fallback is a preview. */
export async function saveDocumentPdf(html: string, name: string, label: (key: string) => string): Promise<"saved" | "cancelled" | "print-preview"> {
  const bridge = typeof window !== "undefined" ? window.voicesubsepDesktop : undefined;
  if (!bridge?.saveDocumentPdf) { openDocumentPrintView(html, label); return "print-preview"; }
  try {
    const result = await bridge.saveDocumentPdf({ html, suggestedName: `${safeFilename(name.replace(/\.pdf$/i, ""))}.pdf` });
    if (result?.status === "saved" || result?.status === "cancelled") return result.status;
    throw new Error("Invalid native PDF result");
  } catch { throw new Error(label("PDF 파일을 저장하지 못했습니다. 다시 시도하거나 HTML로 저장하세요.")); }
}
