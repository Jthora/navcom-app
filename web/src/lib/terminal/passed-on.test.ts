import { beforeEach, describe, expect, it, vi } from 'vitest';

let passedOn: typeof import('./passed-on.svelte').passedOn;
beforeEach(async () => {
  vi.resetModules();
  ({ passedOn } = await import('./passed-on.svelte'));
});

describe('an Assist the watch passed on', () => {
  it('is one current fact: the newest replaces the last, and an older one arriving late does not', () => {
    passedOn.heard('Raven asks for someone.', 'Vale', 100);
    passedOn.heard('Kite asks for someone near Harlem.', 'Vale', 200);
    passedOn.heard('Raven asks for someone.', 'Vale', 150);
    expect(passedOn.text).toBe('Kite asks for someone near Harlem.');
  });

  it('is put down by the operator, and tells nobody', () => {
    passedOn.heard('Raven asks for someone.', 'Vale', 100);
    passedOn.clear();
    expect(passedOn.text).toBeNull();
  });

  it('ignores an empty one', () => {
    passedOn.heard(null, 'Vale', 100);
    expect(passedOn.text).toBeNull();
  });
});
