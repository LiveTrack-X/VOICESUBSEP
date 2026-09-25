import { describe, expect, it, vi } from "vitest";
import { adjacentCaptionId, checkedShortcuts, defaultShortcuts, dispatchShortcut, formatShortcut, loadShortcuts, MAX_SHORTCUT_BYTES, parseShortcuts, saveShortcuts, SHORTCUT_ACTIONS, SHORTCUT_STORAGE_KEY, shortcutActionForEvent, shortcutConflict, shortcutFromEvent, shortcutProblem } from "./shortcuts";

function keyboard(patch: Partial<KeyboardEvent> = {}) {
  return { code: "Space", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, defaultPrevented: false, target: null, getModifierState: () => false, ...patch };
}
function target(kind: "input" | "textarea" | "select" | "contenteditable" | "textbox" | "combobox" | "slider" | "button" | "a" | "dialog") {
  return { closest(selector: string) {
    const selectors = { contenteditable: '[contenteditable]:not([contenteditable="false"])', textbox: '[role="textbox"]', combobox: '[role="combobox"]', slider: '[role="slider"]', dialog: '[role="dialog"]', a: 'a[href]' };
    return selector.split(", ").includes(kind in selectors ? selectors[kind as keyof typeof selectors] : kind) ? this : null;
  } } as unknown as EventTarget;
}

describe("shortcut matching and typing protection", () => {
  it("dispatches Space once, consumes held repeats, and leaves textarea Space entirely native", () => {
    const onAction = vi.fn(), preventDefault = vi.fn();
    expect(dispatchShortcut({ ...keyboard(), preventDefault }, defaultShortcuts(), onAction, false, false)).toBe(true);
    expect(dispatchShortcut({ ...keyboard({ repeat: true }), preventDefault }, defaultShortcuts(), onAction, false, false)).toBe(true);
    expect(onAction).toHaveBeenCalledExactlyOnceWith("play");
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(dispatchShortcut({ ...keyboard({ target: target("textarea") }), preventDefault }, defaultShortcuts(), onAction, false, false)).toBe(false);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
  it("plays with Space outside editors, respects remapping and ignores held repeats", () => {
    expect(shortcutActionForEvent(keyboard(), defaultShortcuts(), false, false)).toBe("play");
    expect(shortcutActionForEvent(keyboard({ repeat: true }), defaultShortcuts(), false, false)).toBeNull();
    const custom = { ...defaultShortcuts(), play: "KeyP" };
    expect(shortcutActionForEvent(keyboard(), custom, false, false)).toBeNull();
    expect(shortcutActionForEvent(keyboard({ code: "KeyP" }), custom, false, false)).toBe("play");
  });
  it.each(["input", "textarea", "select", "contenteditable", "textbox", "combobox", "slider"] as const)("never consumes Space, letters, arrows or project undo in %s", kind => {
    for (const event of [keyboard(), keyboard({ code: "ArrowLeft" }), keyboard({ code: "KeyZ", ctrlKey: true }), keyboard({ code: "KeyP" })]) {
      expect(shortcutActionForEvent({ ...event, target: target(kind) }, { ...defaultShortcuts(), play: "KeyP" }, false, false)).toBeNull();
      expect(shortcutActionForEvent({ ...event, target: target(kind) }, defaultShortcuts(), false, false)).toBeNull();
    }
  });
  it("keeps the existing modified Save exception while unmodified Save never swallows typing", () => {
    expect(shortcutActionForEvent(keyboard({ code: "KeyS", ctrlKey: true, target: target("textarea") }), defaultShortcuts(), false, false)).toBe("save");
    expect(shortcutActionForEvent(keyboard({ code: "KeyS", target: target("textarea") }), { ...defaultShortcuts(), save: "KeyS" }, false, false)).toBeNull();
  });
  it.each([{ isComposing: true }, { keyCode: 229 }, { getModifierState: (key: string) => key === "AltGraph" }])("ignores IME/composition and AltGr even outside inputs %j", patch => {
    expect(shortcutActionForEvent(keyboard(patch), defaultShortcuts(), false, false)).toBeNull();
    expect(shortcutFromEvent(keyboard(patch), false)).toBeNull();
  });
  it("does not invoke project shortcuts behind a modal or after a component handled the key", () => {
    expect(shortcutActionForEvent(keyboard(), defaultShortcuts(), true, false)).toBeNull();
    expect(shortcutActionForEvent(keyboard({ target: target("dialog") }), defaultShortcuts(), false, false)).toBeNull();
    expect(shortcutActionForEvent(keyboard({ defaultPrevented: true }), defaultShortcuts(), false, false)).toBeNull();
  });
  it.each(["button", "a"] as const)("preserves Space activation on %s but still opens the hub using F1", kind => {
    expect(shortcutActionForEvent(keyboard({ target: target(kind) }), defaultShortcuts(), false, false)).toBeNull();
    expect(shortcutActionForEvent(keyboard({ code: "F1", target: target(kind) }), defaultShortcuts(), false, false)).toBe("shortcuts");
  });
  it("can intentionally record Space in the hub without using the global typing guard", () => {
    expect(shortcutFromEvent(keyboard({ target: target("button") }), false)).toBe("Space");
  });
  it("matches Ctrl on Windows and Command on Mac without capturing the Windows key", () => {
    expect(shortcutFromEvent(keyboard({ code: "KeyS", ctrlKey: true }), false)).toBe("Mod+KeyS");
    expect(shortcutFromEvent(keyboard({ code: "KeyS", metaKey: true }), true)).toBe("Mod+KeyS");
    expect(shortcutFromEvent(keyboard({ code: "KeyS", metaKey: true }), false)).toBeNull();
    expect(shortcutFromEvent(keyboard({ code: "KeyS", ctrlKey: true }), true)).toBeNull();
    expect(formatShortcut("Mod+Shift+KeyS", false)).toBe("Ctrl + Shift + S");
    expect(formatShortcut("Mod+KeyS", true)).toBe("⌘ + S");
  });
});

describe("shortcut validation and persistence", () => {
  it("defaults are independent, conflict-free and all supported", () => {
    expect(checkedShortcuts(defaultShortcuts())).toEqual(defaultShortcuts());
    for (const action of SHORTCUT_ACTIONS) if (action.defaultKey) expect(shortcutProblem(action.defaultKey)).toBeNull();
    const first = defaultShortcuts(); first.play = null;
    expect(defaultShortcuts().play).toBe("Space");
  });
  it.each(["Mod+KeyW", "Mod+KeyT", "Mod+Shift+KeyN", "Alt+F4", "Alt+ArrowLeft", "Mod+KeyV", "F5", "F11", "F12", "Mod+Alt+KeyQ", "Mod+Equal"])("rejects reserved shortcut %s", key => {
    expect(shortcutProblem(key)).toBe("reserved");
  });
  it.each(["", "Control+S", "Shift+Mod+KeyS", "Mod+Mod+KeyS", "Mod+KeyAAAA", "Escape", "Tab", "Super+KeyA", "a".repeat(100)])("rejects malformed shortcut %s", key => {
    expect(shortcutProblem(key)).toBe("invalid");
  });
  it("identifies conflicts without replacing another command and accepts disabled keys", () => {
    const settings = defaultShortcuts();
    expect(shortcutConflict(settings, "open", "Mod+KeyS")).toBe("save");
    expect(shortcutConflict(settings, "save", "Mod+KeyS")).toBeNull();
    expect(shortcutConflict(settings, "open", null)).toBeNull();
    expect(() => checkedShortcuts({ ...settings, open: "Mod+KeyS" })).toThrow();
    expect(checkedShortcuts({ ...settings, open: null }).open).toBeNull();
  });
  it("round-trips strict versioned bindings without reading or writing other preferences", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(loadShortcuts(storage).status).toBe("default");
    const settings = { ...defaultShortcuts(), play: "KeyP", open: null };
    expect(saveShortcuts(settings, storage)).toBe(true);
    expect([...values.keys()]).toEqual([SHORTCUT_STORAGE_KEY]);
    expect(loadShortcuts(storage)).toEqual({ bindings: settings, status: "saved" });
  });
  it("does not overwrite unreadable storage on load and reports save failure", () => {
    const storage = { getItem: () => "broken", setItem: vi.fn(() => { throw new Error("quota"); }) };
    expect(loadShortcuts(storage)).toEqual({ bindings: defaultShortcuts(), status: "invalid" });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(saveShortcuts(defaultShortcuts(), storage)).toBe(false);
    expect(loadShortcuts({ getItem: () => { throw new Error("denied"); }, setItem: storage.setItem }).status).toBe("unavailable");
  });
  it.each([null, [], {}, { ...defaultShortcuts(), unknown: "KeyA" }, { ...defaultShortcuts(), save: 42 }, { ...defaultShortcuts(), open: "Mod+KeyS" }])("rejects malformed entire preferences", value => {
    expect(() => checkedShortcuts(value)).toThrow();
  });
  it("rejects unsupported wrappers and oversize data, preserving original input", () => {
    for (const raw of [" ".repeat(MAX_SHORTCUT_BYTES + 1), JSON.stringify({ version: 2, bindings: defaultShortcuts() }), JSON.stringify({ version: 1, bindings: defaultShortcuts(), apiKey: "never" })]) expect(() => parseShortcuts(raw)).toThrow();
    const original = { ...defaultShortcuts(), play: "KeyP" };
    const parsed = checkedShortcuts(original); parsed.play = null;
    expect(original.play).toBe("KeyP");
  });
});

describe("caption keyboard navigation", () => {
  const captions = [{ id: "c", start: 5, end: 6 }, { id: "b", start: 1, end: 3 }, { id: "a", start: 1, end: 2 }];
  it("visits overlapping captions in stable time order without mutating the source", () => {
    expect(adjacentCaptionId(captions, "a", 1, 1)).toBe("b");
    expect(adjacentCaptionId(captions, "b", 1, -1)).toBe("a");
    expect(adjacentCaptionId(captions, "c", 5, 1)).toBeNull();
    expect(captions[0]!.id).toBe("c");
  });
  it("uses the playhead when no selected caption exists", () => {
    expect(adjacentCaptionId(captions, null, 3, 1)).toBe("c");
    expect(adjacentCaptionId(captions, "missing", 3, -1)).toBe("b");
    expect(adjacentCaptionId([], null, 0, 1)).toBeNull();
  });
});
