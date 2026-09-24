/** Codes supported by the bundled faster-whisper tokenizer (multilingual models). */
export const ASR_LANGUAGES = [
  "ko", "en", "ja", "zh", "es",
  "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs", "ca", "cs", "cy", "da", "de", "el", "et", "eu", "fa", "fi", "fo", "fr", "gl", "gu", "ha", "haw", "he", "hi", "hr", "ht", "hu", "hy", "id", "is", "it", "jw", "ka", "kk", "km", "kn", "la", "lb", "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my", "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps", "pt", "ro", "ru", "sa", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su", "sv", "sw", "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi", "yi", "yo", "yue",
] as const;
export const ASR_LANGUAGE_STORAGE_KEY = "voicesubsep-asr-language";
export function parseAsrLanguage(value: unknown): string {
  return typeof value === "string" && (ASR_LANGUAGES as readonly string[]).includes(value) ? value : "auto";
}
export function languageName(code: string, locale: string): string {
  // Whisper uses the old Javanese code; Intl uses the current ISO code.
  const displayCode = code === "jw" ? "jv" : code;
  try { return new Intl.DisplayNames([locale], { type: "language" }).of(displayCode) ?? code; }
  catch { return code; }
}
