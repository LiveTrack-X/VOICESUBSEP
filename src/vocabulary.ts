import type { AsrSelection } from "./cloudAsr";

export const MAX_VOCABULARY_TERMS = 50;
export const MAX_VOCABULARY_TERM_LENGTH = 50;
export const MAX_VOCABULARY_LENGTH = 2_000;
export const GROQ_VOCABULARY_BYTES = 224;
const controls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
export const VOCABULARY_INVALID = "용어 사전은 최대 50개, 용어당 50자, 전체 2,000자까지 입력하세요. 빈 용어와 제어 문자는 사용할 수 없습니다.";
export const GROQ_VOCABULARY_LIMIT = "Groq 용어 힌트는 쉼표와 공백을 포함해 UTF-8 224바이트까지 지원합니다. 용어를 줄이거나 다른 엔진을 선택하세요. 용어를 자동으로 자르지 않습니다.";
export const VOCABULARY_UNSUPPORTED = "이 엔진 설정에서는 용어 힌트를 지원하지 않습니다. 사전은 프로젝트에 보관하며 이번 외부 요청에는 전송하지 않습니다.";

/** Project imports and analysis requests share the same bounded plain-term format. */
export function parseVocabulary(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_VOCABULARY_TERMS) throw new Error(VOCABULARY_INVALID);
  const terms: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || controls.test(item)) throw new Error(VOCABULARY_INVALID);
    const term = item.normalize("NFC").trim();
    if (!term || Array.from(term).length > MAX_VOCABULARY_TERM_LENGTH) throw new Error(VOCABULARY_INVALID);
    if (!terms.includes(term)) terms.push(term);
  }
  if (Array.from(terms.join(", ")).length > MAX_VOCABULARY_LENGTH) throw new Error(VOCABULARY_INVALID);
  return terms;
}

/** The editor uses one term per line. Blank lines are only layout, never terms. */
export function parseVocabularyText(text: string): string[] {
  return parseVocabulary(text.split(/\r\n|\n|\r/u).filter(line => line.trim().length > 0));
}

export function vocabularyBlockReason(terms: readonly string[], selection: AsrSelection): string | null {
  return selection.provider === "groq" && new TextEncoder().encode(terms.join(", ")).byteLength > GROQ_VOCABULARY_BYTES
    ? GROQ_VOCABULARY_LIMIT : null;
}

export function vocabularySupportNotice(terms: readonly string[], selection: AsrSelection): string | null {
  return terms.length && (selection.provider === "gemini" || selection.provider === "xai" && selection.model !== "grok-voice-transcribe-2.0")
    ? VOCABULARY_UNSUPPORTED : null;
}
