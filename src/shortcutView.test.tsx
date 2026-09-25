import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider, LOCALES, translate } from "./i18n";
import { ShortcutDialog } from "./components/ShortcutDialog";
import { defaultShortcuts, SHORTCUT_ACTIONS } from "./shortcuts";
import { shortcutMessages } from "./i18n-shortcuts";

afterEach(() => vi.unstubAllGlobals());
describe("shortcut hub", () => {
  it("renders all commands and current keys with accessible change/clear/default controls", () => {
    vi.stubGlobal("localStorage", { getItem: () => "en" });
    const onSave = vi.fn();
    const html = renderToStaticMarkup(<I18nProvider><ShortcutDialog bindings={{ ...defaultShortcuts(), play: "KeyP" }} status="saved" onSave={onSave} onClose={() => {}}/></I18nProvider>);
    expect(html).toContain('aria-label="Keyboard shortcuts"');
    expect(html).toContain('aria-label="Search shortcuts"');
    expect(html).toContain('aria-label="Change shortcut for Play / pause"');
    expect(html).toContain('aria-label="P">P</kbd>');
    expect(html.match(/class="shortcut-row"/gu)).toHaveLength(SHORTCUT_ACTIONS.length);
    expect(onSave).not.toHaveBeenCalled();
  });
  it("reports damaged stored shortcuts without silently overwriting them", () => {
    vi.stubGlobal("localStorage", { getItem: () => "ko" });
    const onSave = vi.fn();
    const html = renderToStaticMarkup(<I18nProvider><ShortcutDialog bindings={defaultShortcuts()} status="invalid" onSave={onSave} onClose={() => {}}/></I18nProvider>);
    expect(html).toContain("변경 전까지 원래 저장값을 유지합니다.");
    expect(onSave).not.toHaveBeenCalled();
  });
  it("provides every added hub message in five app languages", () => {
    for (const key of Object.keys(shortcutMessages)) for (const locale of LOCALES) {
      expect(translate(locale, key)).toBeTruthy();
      if (locale !== "ko") expect(translate(locale, key)).not.toBe(key);
    }
  });
});
