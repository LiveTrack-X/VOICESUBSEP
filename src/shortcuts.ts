export const SHORTCUT_STORAGE_KEY = "voicesubsep-shortcuts-v1";
export const SHORTCUT_CHANGE_EVENT = "voicesubsep-shortcuts-changed";
export const MAX_SHORTCUT_BYTES = 8192;

export const SHORTCUT_ACTIONS = [
  { id: "save", label: "프로젝트 저장", group: "프로젝트", defaultKey: "Mod+KeyS" },
  { id: "open", label: "프로젝트 열기", group: "프로젝트", defaultKey: "Mod+KeyO" },
  { id: "new", label: "새 프로젝트", group: "프로젝트", defaultKey: null },
  { id: "undo", label: "실행 취소", group: "편집", defaultKey: "Mod+KeyZ" },
  { id: "redo", label: "다시 실행", group: "편집", defaultKey: "Mod+Shift+KeyZ" },
  { id: "play", label: "재생 / 일시 정지", group: "재생", defaultKey: "Space" },
  { id: "back", label: "5초 뒤로", group: "재생", defaultKey: "ArrowLeft" },
  { id: "forward", label: "5초 앞으로", group: "재생", defaultKey: "ArrowRight" },
  { id: "previousCaption", label: "이전 자막 보기", group: "자막 이동", defaultKey: "Alt+ArrowUp" },
  { id: "nextCaption", label: "다음 자막 보기", group: "자막 이동", defaultKey: "Alt+ArrowDown" },
  { id: "analyze", label: "음성 분석 열기", group: "작업", defaultKey: null },
  { id: "export", label: "내보내기", group: "작업", defaultKey: null },
  { id: "shortcuts", label: "단축키 허브", group: "작업", defaultKey: "F1" },
] as const;
export type ShortcutAction = typeof SHORTCUT_ACTIONS[number]["id"];
export type ShortcutBindings = Record<ShortcutAction, string | null>;
export type ShortcutStorage = Pick<Storage, "getItem" | "setItem">;
export type ShortcutLoad = { bindings: ShortcutBindings; status: "default" | "saved" | "invalid" | "unavailable" };

export function defaultShortcuts(): ShortcutBindings {
  return Object.fromEntries(SHORTCUT_ACTIONS.map(action => [action.id, action.defaultKey])) as ShortcutBindings;
}

const supportedCode = /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Space|Arrow(?:Left|Right|Up|Down)|Home|End|PageUp|PageDown|BracketLeft|BracketRight|Comma|Period|Slash|Backslash|Semicolon|Quote|Backquote|Minus|Equal|Backspace|Delete|Enter)$/u;
export function isMacKeyboard(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);
}

/** Physical key codes keep saved shortcuts stable with Korean/Japanese layouts. */
export function shortcutFromEvent(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing"> & { keyCode?: number; getModifierState?: (key: string) => boolean }, mac = isMacKeyboard()): string | null {
  if (event.isComposing || event.keyCode === 229 || event.getModifierState?.("AltGraph") || (mac ? event.ctrlKey : event.metaKey) || !supportedCode.test(event.code)) return null;
  return [...((mac ? event.metaKey : event.ctrlKey) ? ["Mod"] : []), ...(event.altKey ? ["Alt"] : []), ...(event.shiftKey ? ["Shift"] : []), event.code].join("+");
}

export function shortcutProblem(binding: string): "invalid" | "reserved" | null {
  if (typeof binding !== "string" || binding.length > 48) return "invalid";
  const parts = binding.split("+");
  const code = parts.pop() ?? "";
  const mod = parts.includes("Mod"), alt = parts.includes("Alt"), shift = parts.includes("Shift");
  if (!supportedCode.test(code) || [...(mod ? ["Mod"] : []), ...(alt ? ["Alt"] : []), ...(shift ? ["Shift"] : [])].join("+") !== parts.join("+")) return "invalid";
  // Keep OS/window, browser navigation, clipboard, zoom and developer controls.
  // F1 is deliberately available as the app's visible help/shortcut hub.
  if (["F5", "F10", "F11", "F12"].includes(code) || (alt && ["F4", "Space", "Home"].includes(code)) ||
      (alt && mod) || (mod && ["KeyA", "KeyC", "KeyV", "KeyX", "KeyL", "KeyT", "KeyW", "KeyN", "KeyQ", "KeyR", "KeyP", "KeyF", "KeyH", "KeyJ", "KeyK", "Minus", "Equal", "Digit0"].includes(code)) ||
      (mod && shift && ["KeyI", "KeyB", "Delete"].includes(code)) ||
      (!mod && !alt && ["Backspace", "Delete", "Enter"].includes(code)) ||
      (alt && ["ArrowLeft", "ArrowRight"].includes(code))) return "reserved";
  return null;
}

export function shortcutConflict(bindings: ShortcutBindings, action: ShortcutAction, binding: string | null): ShortcutAction | null {
  return binding === null ? null : SHORTCUT_ACTIONS.find(item => item.id !== action && bindings[item.id] === binding)?.id ?? null;
}

export function checkedShortcuts(value: unknown): ShortcutBindings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid shortcut settings");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== SHORTCUT_ACTIONS.length) throw new Error("Invalid shortcut settings");
  const bindings = {} as ShortcutBindings;
  const used = new Set<string>();
  for (const { id } of SHORTCUT_ACTIONS) {
    const key = record[id];
    if (!Object.hasOwn(record, id) || (key !== null && (typeof key !== "string" || shortcutProblem(key) || used.has(key)))) throw new Error("Invalid shortcut settings");
    bindings[id] = key as string | null;
    if (typeof key === "string") used.add(key);
  }
  return bindings;
}

export function parseShortcuts(raw: string): ShortcutBindings {
  if (raw.length > MAX_SHORTCUT_BYTES || new TextEncoder().encode(raw).length > MAX_SHORTCUT_BYTES) throw new Error("Invalid shortcut settings");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 || !("version" in value) || value.version !== 1 || !("bindings" in value)) throw new Error("Invalid shortcut settings");
  return checkedShortcuts(value.bindings);
}

export function loadShortcuts(storage?: ShortcutStorage): ShortcutLoad {
  try {
    const raw = (storage ?? localStorage).getItem(SHORTCUT_STORAGE_KEY);
    if (raw === null) return { bindings: defaultShortcuts(), status: "default" };
    try { return { bindings: parseShortcuts(raw), status: "saved" }; }
    catch { return { bindings: defaultShortcuts(), status: "invalid" }; }
  } catch { return { bindings: defaultShortcuts(), status: "unavailable" }; }
}

export function notifyShortcutsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SHORTCUT_CHANGE_EVENT));
}

export function saveShortcuts(bindings: ShortcutBindings, storage?: ShortcutStorage): boolean {
  try {
    (storage ?? localStorage).setItem(SHORTCUT_STORAGE_KEY, JSON.stringify({ version: 1, bindings: checkedShortcuts(bindings) }));
    if (!storage) notifyShortcutsChanged();
    return true;
  } catch { return false; }
}

export function formatShortcut(binding: string | null, mac = isMacKeyboard()): string {
  if (!binding) return "—";
  const labels: Record<string, string> = { Mod: mac ? "⌘" : "Ctrl", Alt: mac ? "⌥" : "Alt", Shift: "Shift", Space: "Space", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Semicolon: ";", Quote: "'", Backquote: "`", Minus: "-", Equal: "=" };
  return binding.split("+").map(part => labels[part] ?? part.replace(/^(Key|Digit)/u, "")).join(" + ");
}

type ShortcutTarget = { closest: (selector: string) => unknown };
/** Save is the only editing shortcut allowed while a text draft is focused. */
type ShortcutEvent = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing" | "repeat" | "defaultPrevented" | "target"> & { keyCode?: number; getModifierState?: (key: string) => boolean };
export function shortcutActionForEvent(event: ShortcutEvent, bindings: ShortcutBindings, blocked = false, mac = isMacKeyboard(), allowRepeat = false): ShortcutAction | null {
  if (blocked || event.defaultPrevented || (event.repeat && !allowRepeat) || event.isComposing) return null;
  const key = shortcutFromEvent(event, mac);
  if (!key) return null;
  const action = SHORTCUT_ACTIONS.find(item => bindings[item.id] === key)?.id;
  if (!action) return null;
  const target = event.target as (ShortcutTarget | null);
  const within = (selector: string) => typeof target?.closest === "function" && !!target.closest(selector);
  if (within('[role="dialog"], [aria-modal="true"]')) return null;
  if (within('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"]') && !(action === "save" && key.includes("Mod+"))) return null;
  if (["Space", "Enter"].includes(event.code) && !key.includes("Mod+") && !key.includes("Alt+") && within('button, a[href], [role="button"], summary, video, audio')) return null;
  return action;
}

export function dispatchShortcut(event: ShortcutEvent & { preventDefault: () => void }, bindings: ShortcutBindings, onAction: (action: ShortcutAction) => unknown, blocked = false, mac = isMacKeyboard()): boolean {
  const action = shortcutActionForEvent(event, bindings, blocked, mac, true);
  if (!action) return false;
  // Holding Space must not toggle repeatedly or fall through to page scrolling;
  // likewise, held Ctrl+S must not open the browser's page-save dialog.
  event.preventDefault();
  if (!event.repeat) onAction(action);
  return true;
}

export function adjacentCaptionId(captions: readonly { id: string; start: number; end: number }[], selected: string | null, time: number, direction: -1 | 1): string | null {
  const ordered = [...captions].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const index = ordered.findIndex(caption => caption.id === selected);
  if (index >= 0) return ordered[index + direction]?.id ?? null;
  return (direction > 0 ? ordered.find(caption => caption.start > time) : ordered.reverse().find(caption => caption.start < time))?.id ?? null;
}
