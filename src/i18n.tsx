import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { messages } from "./i18n-messages";
import { extraMessages } from "./i18n-extra";
import { I18nContext, type I18nValue } from "./i18n-context";

export const LOCALES = ["ko", "en", "ja", "zh", "es"] as const;
export type Locale = typeof LOCALES[number];
export type TranslationParams = Record<string, string | number>;
export const localeNames: Record<Locale, string> = { ko: "한국어", en: "English", ja: "日本語", zh: "简体中文", es: "Español" };
export const LOCALE_STORAGE_KEY = "voicesubsep-ui-locale";
export function parseLocale(value: unknown): Locale {
  return LOCALES.includes(value as Locale) ? value as Locale : "ko";
}
const catalog = { ...messages, ...extraMessages };
export const dictionaries: Record<Locale, Record<string, string>> = Object.fromEntries(
  LOCALES.map((locale, index) => [locale, Object.fromEntries(Object.entries(catalog).map(([key, values]) => [key, index === 0 ? key : values[index - 1]]))]),
) as Record<Locale, Record<string, string>>;
export function translate(locale: Locale, key: string, params: TranslationParams = {}): string {
  return (dictionaries[locale][key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => Object.hasOwn(params, name) ? String(params[name]) : match);
}
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    try { return parseLocale(localStorage.getItem(LOCALE_STORAGE_KEY)); } catch { return "ko"; }
  });
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : locale;
    try { localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Private storage may be unavailable. */ }
  }, [locale]);
  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t: (key, params) => translate(locale, key, params) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
