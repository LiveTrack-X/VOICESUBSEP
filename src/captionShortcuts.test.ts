import { describe, expect, it } from "vitest";
import { CAPTION_EDIT_SHORTCUTS, defaultShortcuts, parseShortcuts, shortcutActionForEvent, type ShortcutAction } from "./shortcuts";

const target = { closest: (selector: string) => selector === 'textarea[data-caption-text="true"]' || selector.split(", ").includes("textarea") } as unknown as EventTarget;
const event = { target, code: "Enter", ctrlKey: true, altKey: false, metaKey: false, shiftKey: false, isComposing: false, repeat: false, defaultPrevented: false };

describe("caption editing shortcuts", () => {
  it("opens a cursor preview from caption text but preserves ordinary typing, IME and repeated keys", () => {
    expect(shortcutActionForEvent(event, defaultShortcuts(), false, false)).toBe("splitCursor");
    expect(shortcutActionForEvent({ ...event, shiftKey: true }, defaultShortcuts(), false, false)).toBe("splitTime");
    for (const patch of [{ ctrlKey: false }, { ctrlKey: false, code: "Space" }, { isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      expect(shortcutActionForEvent({ ...event, ...patch }, defaultShortcuts(), false, false)).toBeNull();
    }
    expect(shortcutActionForEvent({ ...event, code: "KeyQ", ctrlKey: false }, { ...defaultShortcuts(), splitCursor: "KeyQ" }, false, false)).toBeNull();
  });
  it("never runs caption commands in other text inputs or dialogs", () => {
    for (const selector of ["input", "textarea", '[role="dialog"]']) {
      const other = { closest: (query: string) => query.split(", ").includes(selector) } as unknown as EventTarget;
      expect(shortcutActionForEvent({ ...event, target: other }, defaultShortcuts(), false, false)).toBeNull();
    }
    expect(shortcutActionForEvent(event, defaultShortcuts(), true, false)).toBeNull();
  });
  it("upgrades existing preferences, preserves user bindings and avoids newly introduced conflicts", () => {
    const bindings = Object.fromEntries(Object.entries(defaultShortcuts()).filter(([key]) => !CAPTION_EDIT_SHORTCUTS.includes(key as ShortcutAction)));
    bindings.play = "Mod+Enter"; bindings.open = null;
    const raw = JSON.stringify({ version: 1, bindings });
    const restored = parseShortcuts(raw);
    expect(restored.play).toBe("Mod+Enter"); expect(restored.open).toBeNull(); expect(restored.splitCursor).toBeNull();
    expect(restored.mergeSelected).toBe("Mod+KeyM");
    expect(JSON.stringify({ version: 1, bindings })).toBe(raw);
    expect(() => parseShortcuts(JSON.stringify({ version: 1, bindings: { ...bindings, unknown: null } }))).toThrow();
  });
});
