import { describe, expect, it } from 'vitest';
import { keyLabel, watchKeyFor, type KeyPress } from './watch-keys';

const press = (over: Partial<KeyPress>): KeyPress => ({
  key: '',
  code: '',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  ...over
});

describe('keys for a holder at a laptop', () => {
  it('Alt+A answers, Alt+Q quiets, Alt+M tells, from anywhere on the screen', () => {
    expect(watchKeyFor(press({ code: 'KeyA', key: 'a', altKey: true }), null)).toEqual({ do: 'answer' });
    expect(watchKeyFor(press({ code: 'KeyQ', key: 'q', altKey: true }), null)).toEqual({ do: 'silence' });
    expect(watchKeyFor(press({ code: 'KeyM', key: 'm', altKey: true }), 'tell')).toEqual({ do: 'tell' });
  });

  it('reads the key’s place, so ⌥A on a Mac, which types å, is still A', () => {
    expect(watchKeyFor(press({ code: 'KeyA', key: 'å', altKey: true }), 'answer')).toEqual({ do: 'answer' });
  });

  it('never a single letter: A, Q and M alone do nothing anywhere (WCAG 2.1.4)', () => {
    for (const code of ['KeyA', 'KeyQ', 'KeyM']) {
      for (const field of [null, 'answer', 'tell'] as const) {
        expect(watchKeyFor(press({ code, key: code.slice(3).toLowerCase() }), field)).toBeNull();
      }
    }
  });

  it('not with another modifier beside Alt, and not on a held or composing key', () => {
    expect(watchKeyFor(press({ code: 'KeyA', altKey: true, ctrlKey: true }), null)).toBeNull();
    expect(watchKeyFor(press({ code: 'KeyA', altKey: true, shiftKey: true }), null)).toBeNull();
    expect(watchKeyFor(press({ code: 'KeyA', altKey: true, repeat: true }), null)).toBeNull();
    expect(watchKeyFor(press({ code: 'KeyA', altKey: true, isComposing: true }), null)).toBeNull();
  });

  it('Ctrl+Enter or ⌘Enter sends, and Esc cancels, only inside the box being written in', () => {
    expect(watchKeyFor(press({ key: 'Enter', ctrlKey: true }), 'answer')).toEqual({ do: 'send' });
    expect(watchKeyFor(press({ key: 'Enter', metaKey: true }), 'tell')).toEqual({ do: 'send' });
    expect(watchKeyFor(press({ key: 'Escape' }), 'answer')).toEqual({ do: 'cancel' });
    expect(watchKeyFor(press({ key: 'Enter', ctrlKey: true }), null)).toBeNull();
    expect(watchKeyFor(press({ key: 'Escape' }), null)).toBeNull();
  });

  it('a plain Enter is a new line, never a send', () => {
    expect(watchKeyFor(press({ key: 'Enter' }), 'answer')).toBeNull();
    expect(watchKeyFor(press({ key: 'Enter', shiftKey: true }), 'answer')).toBeNull();
  });

  it('Alt+1 to Alt+9 put in a phrase, in the answer only', () => {
    expect(watchKeyFor(press({ code: 'Digit1', altKey: true }), 'answer')).toEqual({ do: 'phrase', index: 0 });
    expect(watchKeyFor(press({ code: 'Digit9', altKey: true }), 'answer')).toEqual({ do: 'phrase', index: 8 });
    expect(watchKeyFor(press({ code: 'Digit0', altKey: true }), 'answer')).toBeNull();
    expect(watchKeyFor(press({ code: 'Digit1', altKey: true }), 'tell')).toBeNull();
    expect(watchKeyFor(press({ code: 'Digit1', altKey: true }), null)).toBeNull();
  });

  it('labels the key the way the keyboard does', () => {
    expect(keyLabel('A', true)).toBe('⌥A');
    expect(keyLabel('A', false)).toBe('Alt+A');
  });
});
