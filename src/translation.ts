import { request } from "./api";
import type { Caption, Project, SubtitleLanguage } from "./domain";

export const TRANSLATION_LANGUAGES: readonly SubtitleLanguage[] = ["ko", "en", "ja", "zh", "es"];
export const TRANSLATION_LANGUAGE_NAMES: Record<SubtitleLanguage, string> = {
  ko: "한국어", en: "English", ja: "日本語", zh: "简体中文", es: "Español",
};
export const MAX_TRANSLATION_BATCH_CAPTIONS = 8;
export const MAX_TRANSLATION_BATCH_CHARACTERS = 12_000;
export const MAX_TRANSLATION_TEXT_CHARACTERS = 8_000;
export type TranslationRow = { id: string; sourceText: string; text: string };
export type TranslationInput = { id: string; text: string };
export type TranslationStatus = {
  ready: boolean;
  models: string[];
  engine: "ollama";
  localOnly: true;
  error?: string;
};
export type TranslationDevice = "auto" | "cpu";

export function isValidTranslationText(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= MAX_TRANSLATION_TEXT_CHARACTERS &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}
function validateTarget(target: SubtitleLanguage): void {
  if (!TRANSLATION_LANGUAGES.includes(target)) throw new Error("지원하지 않는 번역 언어입니다.");
}
export function hasFreshTranslation(caption: Caption, target: SubtitleLanguage): boolean {
  return caption.translation?.sourceText === caption.text && isValidTranslationText(caption.translation.texts[target]);
}

/** The source remains canonical; preview falls back without presenting old translations as fresh. */
export function captionTranslatedText(caption: Caption, target: SubtitleLanguage): string {
  return hasFreshTranslation(caption, target) ? caption.translation!.texts[target]! : caption.text;
}

/** Preserve complete captions; never split text and lose its source-ID correspondence. */
export function buildTranslationBatches(
  captions: readonly Caption[], target: SubtitleLanguage, retranslateAll = false,
): TranslationInput[][] {
  validateTarget(target);
  const batches: TranslationInput[][] = [];
  let current: TranslationInput[] = [];
  let characters = 0;
  for (const caption of captions) {
    if (!caption.text.trim() || (!retranslateAll && hasFreshTranslation(caption, target))) continue;
    if (caption.text.length > MAX_TRANSLATION_BATCH_CHARACTERS) throw new Error("자막 하나가 번역 요청의 글자 수 제한을 초과합니다.");
    if (current.length >= MAX_TRANSLATION_BATCH_CAPTIONS || characters + caption.text.length > MAX_TRANSLATION_BATCH_CHARACTERS) {
      batches.push(current);
      current = [];
      characters = 0;
    }
    current.push({ id: caption.id, text: caption.text });
    characters += caption.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** Apply only results proven to belong to the current source text, in one undoable update. */
export function applyTranslations(project: Project, rows: readonly TranslationRow[], target: SubtitleLanguage): Project {
  validateTarget(target);
  const byId = new Map(rows.filter((row) => isValidTranslationText(row.text)).map((row) => [row.id, row]));
  let changed = false;
  const captions = project.captions.map((caption) => {
    const row = byId.get(caption.id);
    if (!row || row.sourceText !== caption.text) return caption;
    const fresh = caption.translation?.sourceText === caption.text;
    if (fresh && caption.translation!.texts[target] === row.text) return caption;
    changed = true;
    return { ...caption, translation: { sourceText: caption.text, texts: {
      ...(fresh ? caption.translation!.texts : {}), [target]: row.text,
    } } };
  });
  return changed ? { ...project, captions } : project;
}

export class MissingTranslationError extends Error {
  readonly captionIds: string[];
  constructor(captionIds: string[]) {
    super("번역이 없거나 원문이 변경된 자막이 있습니다. 번역을 완료한 뒤 내보내세요.");
    this.name = "MissingTranslationError";
    this.captionIds = captionIds;
  }
}

/** Source word timings cannot be attributed to translated tokens. */
export function translatedProject(project: Project, target: SubtitleLanguage): Project {
  validateTarget(target);
  const missing = project.captions.filter((caption) => !hasFreshTranslation(caption, target)).map((caption) => caption.id);
  if (missing.length) throw new MissingTranslationError(missing);
  const result = structuredClone(project);
  result.captions = result.captions.map((caption) => {
    const { words: _words, translation: _translation, ...rest } = caption;
    return { ...rest, text: caption.translation!.texts[target]! };
  });
  return result;
}

export async function translationStatus(signal?: AbortSignal): Promise<TranslationStatus> {
  const result = await request<TranslationStatus>("/api/translation/status", { signal });
  if (!result || typeof result.ready !== "boolean" || result.engine !== "ollama" || result.localOnly !== true ||
    !Array.isArray(result.models) || result.models.some((model) => typeof model !== "string" || !model.trim())) {
    throw new Error("로컬 번역 서버의 응답 형식이 올바르지 않습니다.");
  }
  return result;
}

export async function translateBatch(
  captions: readonly TranslationInput[], target: SubtitleLanguage, model: string, device: TranslationDevice,
): Promise<TranslationRow[]> {
  validateTarget(target);
  const result = await request<{ target: SubtitleLanguage; model: string; captions: TranslationRow[] }>("/api/translation/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, target, device, captions }),
    signal: AbortSignal.timeout(195_000),
  });
  const sourceById = new Map(captions.map((caption) => [caption.id, caption.text]));
  const seen = new Set<string>();
  if (!result || result.target !== target || result.model !== model || !Array.isArray(result.captions) || result.captions.length !== captions.length) {
    throw new Error("번역 결과가 요청한 자막과 일치하지 않습니다.");
  }
  for (const row of result.captions) {
    if (!row || typeof row.id !== "string" || !sourceById.has(row.id) || seen.has(row.id) ||
      row.sourceText !== sourceById.get(row.id) || !isValidTranslationText(row.text)) {
      throw new Error("번역 결과가 요청한 자막과 일치하지 않습니다.");
    }
    seen.add(row.id);
  }
  // Keep the source order even when the model/server returns reordered IDs.
  const byId = new Map(result.captions.map((row) => [row.id, row]));
  return captions.map((caption) => byId.get(caption.id)!);
}
