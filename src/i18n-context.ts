import { createContext } from "react";
import type { Locale, TranslationParams } from "./i18n";

// Keep context identity stable when a language catalog is hot-reloaded.
// This module has no runtime dependency on the catalogs or their provider.
export type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
};
export const I18nContext = createContext<I18nValue | null>(null);
