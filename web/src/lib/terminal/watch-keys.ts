/**
 * Keys for a holder at a laptop (2026-11-04): a watch held remotely is often held at a keyboard,
 * and reaching for a trackpad to find the Answer button under a Distress costs seconds.
 *
 * **Every key has a modifier, or works only inside the box being written in** (WCAG 2.1.4): a
 * single-letter shortcut fires on a stray keypress or a speech-recognition word, and here that
 * would answer somebody or silence an alarm. Alt (⌥ on a Mac) for the three that act anywhere on
 * the screen, read by the key's position (`code`), since ⌥ turns a letter into another character
 * on a Mac. Letters chosen clear of the browsers' own Alt menus (Firefox's F E V S B T H, Chrome's
 * F E D).
 *
 * - **Alt+A** answers the first thing waiting: an unanswered Distress first, then the top of the list
 * - **Alt+Q** quiets the alarm, as the Silence button does
 * - **Alt+M** opens the message to everyone out
 * - In the answer or the message: **Ctrl+Enter** (⌘Enter) sends, **Esc** cancels, and in the answer
 *   **Alt+1** to **Alt+9** put in tonight's phrases, as a tap on them does
 *
 * Nothing here sends on its own: Send is still a deliberate press, as it is by hand.
 */
export type WatchKey =
  | { do: 'answer' }
  | { do: 'silence' }
  | { do: 'tell' }
  | { do: 'send' }
  | { do: 'cancel' }
  | { do: 'phrase'; index: number };

/** Where the keyboard is: the answer box, the message box, or neither. */
export type WatchField = 'answer' | 'tell' | null;

/** The parts of a keydown this reads. */
export interface KeyPress {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
}

export function watchKeyFor(e: KeyPress, field: WatchField): WatchKey | null {
  // A held key repeats, and an IME is still composing a word: neither is a decision.
  if (e.repeat || e.isComposing) return null;
  const altOnly = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  if (altOnly) {
    if (e.code === 'KeyA') return { do: 'answer' };
    if (e.code === 'KeyQ') return { do: 'silence' };
    if (e.code === 'KeyM') return { do: 'tell' };
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && field === 'answer') return { do: 'phrase', index: Number(digit[1]) - 1 };
    return null;
  }
  if (field === null) return null;
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) return { do: 'send' };
  if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) return { do: 'cancel' };
  return null;
}

/** "⌥A" on a Mac, "Alt+A" elsewhere: for a button's tooltip. */
export function keyLabel(letter: string, mac: boolean): string {
  return mac ? `⌥${letter}` : `Alt+${letter}`;
}

/** The same, for `aria-keyshortcuts`, which names Alt as Alt everywhere. */
export const ARIA_KEYS = {
  answer: 'Alt+A',
  silence: 'Alt+Q',
  tell: 'Alt+M',
  send: 'Control+Enter Meta+Enter'
} as const;
