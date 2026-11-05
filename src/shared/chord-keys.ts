// The keys a chord may be made of, by the name the settings file uses, the scan code the global hook reports (libuiohook), the words shown to a
// person, and the name the page gives the key when it is pressed in the settings window (KeyboardEvent.code, which tells the left and the right
// key of a pair apart, as the hook does). Pure: the settings window, the settings checks and the key hook all use it.
//
// Not offered: Escape (it cancels a question), the Windows keys (they open the Start menu), and the keys the hook reports under more than one code.

export type KeyDef = {
  /** The scan code as the global hook reports it. */
  code: number;
  /** In words. */
  label: string;
  /** The name of the key in KeyboardEvent.code. */
  dom: string;
  /** Ctrl, Shift or Alt: holding one types nothing, so it may be the key held alone to get the microphone ready early. */
  modifier: boolean;
};

const table: Record<string, KeyDef> = {
  'right-ctrl': { code: 3613, label: 'Right Ctrl', dom: 'ControlRight', modifier: true },
  'right-shift': { code: 54, label: 'Right Shift', dom: 'ShiftRight', modifier: true },
  'right-alt': { code: 3640, label: 'Right Alt', dom: 'AltRight', modifier: true },
  'left-ctrl': { code: 29, label: 'Left Ctrl', dom: 'ControlLeft', modifier: true },
  'left-shift': { code: 42, label: 'Left Shift', dom: 'ShiftLeft', modifier: true },
  'left-alt': { code: 56, label: 'Left Alt', dom: 'AltLeft', modifier: true },
};
const add = (name: string, code: number, label: string, dom: string): void => void (table[name] = { code, label, dom, modifier: false });

const LETTERS: Record<string, number> = { a: 30, b: 48, c: 46, d: 32, e: 18, f: 33, g: 34, h: 35, i: 23, j: 36, k: 37, l: 38, m: 50, n: 49, o: 24, p: 25, q: 16, r: 19, s: 31, t: 20, u: 22, v: 47, w: 17, x: 45, y: 21, z: 44 };
for (const [letter, code] of Object.entries(LETTERS)) add(letter, code, letter.toUpperCase(), `Key${letter.toUpperCase()}`);
const DIGITS = [11, 2, 3, 4, 5, 6, 7, 8, 9, 10];
DIGITS.forEach((code, n) => add(`digit-${n}`, code, String(n), `Digit${n}`));
const F_KEYS = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88, 91, 92, 93, 99, 100, 101, 102, 103, 104, 105, 106, 107];
F_KEYS.forEach((code, n) => add(`f${n + 1}`, code, `F${n + 1}`, `F${n + 1}`));
add('space', 57, 'Space', 'Space');
add('tab', 15, 'Tab', 'Tab');
add('enter', 28, 'Enter', 'Enter');
add('backspace', 14, 'Backspace', 'Backspace');
add('caps-lock', 58, 'Caps Lock', 'CapsLock');
add('insert', 3666, 'Insert', 'Insert');
add('delete', 3667, 'Delete', 'Delete');
add('home', 3655, 'Home', 'Home');
add('end', 3663, 'End', 'End');
add('page-up', 3657, 'Page Up', 'PageUp');
add('page-down', 3665, 'Page Down', 'PageDown');
add('arrow-left', 57419, 'Left arrow', 'ArrowLeft');
add('arrow-up', 57416, 'Up arrow', 'ArrowUp');
add('arrow-right', 57421, 'Right arrow', 'ArrowRight');
add('arrow-down', 57424, 'Down arrow', 'ArrowDown');
add('semicolon', 39, ';', 'Semicolon');
add('equal', 13, '=', 'Equal');
add('comma', 51, ',', 'Comma');
add('minus', 12, '-', 'Minus');
add('period', 52, '.', 'Period');
add('slash', 53, '/', 'Slash');
add('backquote', 41, '`', 'Backquote');
add('bracket-left', 26, '[', 'BracketLeft');
add('backslash', 43, '\\', 'Backslash');
add('bracket-right', 27, ']', 'BracketRight');
add('quote', 40, "'", 'Quote');
add('print-screen', 3639, 'Print Screen', 'PrintScreen');
add('scroll-lock', 70, 'Scroll Lock', 'ScrollLock');
add('num-lock', 69, 'Num Lock', 'NumLock');
const NUMPAD = [82, 79, 80, 81, 75, 76, 77, 71, 72, 73];
NUMPAD.forEach((code, n) => add(`numpad-${n}`, code, `Numpad ${n}`, `Numpad${n}`));
add('numpad-multiply', 55, 'Numpad *', 'NumpadMultiply');
add('numpad-add', 78, 'Numpad +', 'NumpadAdd');
add('numpad-subtract', 74, 'Numpad -', 'NumpadSubtract');
add('numpad-decimal', 83, 'Numpad .', 'NumpadDecimal');
add('numpad-divide', 3637, 'Numpad /', 'NumpadDivide');
add('numpad-enter', 3612, 'Numpad Enter', 'NumpadEnter');

export const CHORD_KEYS: Readonly<Record<string, KeyDef>> = table;
export const DEFAULT_HOTKEY = 'right-ctrl+right-shift';

const byDom = new Map(Object.entries(table).map(([name, def]) => [def.dom, name]));

/** The name the settings file uses for the key the page reports as this KeyboardEvent.code; undefined for a key that is not offered. */
export function keyNameOfDom(code: string): string | undefined {
  return byDom.get(code);
}

/** The most keys one hotkey may be made of. */
export const MAX_HOTKEY_KEYS = 4;

/** F13 to F24 and the like: keys no program uses, so a single one of them is safe to hold alone. */
const RARE = new Set(['f13', 'f14', 'f15', 'f16', 'f17', 'f18', 'f19', 'f20', 'f21', 'f22', 'f23', 'f24']);

/** "right-ctrl+right-shift" -> the keys' names and the words for them; null for an unknown key, the same key twice, or none or too many keys. One key is allowed: it is held alone. */
export function splitHotkey(text: unknown): { names: string[]; label: string } | null {
  if (typeof text !== 'string') return null;
  const names = text.split('+').map((p) => p.trim().toLowerCase());
  if (names.length < 1 || names.length > MAX_HOTKEY_KEYS) return null;
  const seen = new Set<number>();
  for (const name of names) {
    const def = table[name];
    // The same key twice (or two names for one scan code) is one key held: the hook could not tell them apart.
    if (!def || seen.has(def.code)) return null;
    seen.add(def.code);
  }
  return { names, label: names.map((n) => table[n]!.label).join(' + ') };
}

/**
 * What to tell a person who chose this hotkey, or null when there is nothing to say. A single key fires whenever it is pressed, so one that is used
 * for typing or for shortcuts would ask a question in the middle of work; a chord of keys that all type can fire while someone types fast.
 */
export function hotkeyWarning(names: readonly string[]): string | null {
  if (names.length === 1) {
    const only = names[0]!;
    if (RARE.has(only)) return null;
    return table[only]?.modifier
      ? `${table[only]!.label} on its own is held for many shortcuts too, so Talkthrough would listen each time you use one. A key you never use, such as F13 to F24, is safer.`
      : `${table[only]?.label ?? only} is a key you use for typing or in programs, so Talkthrough would listen and look at your screen every time you press and hold it. A key you never use, such as F13 to F24, is safer.`;
  }
  if (names.every((n) => !table[n]?.modifier)) return 'None of these keys is Ctrl, Shift or Alt, so holding them together can happen while you type fast. You can still use them.';
  return null;
}
