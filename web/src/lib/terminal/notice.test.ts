import { beforeEach, describe, expect, it, vi } from 'vitest';

let notice: typeof import('./notice.svelte').notice;
beforeEach(async () => {
  vi.resetModules();
  ({ notice } = await import('./notice.svelte'));
});

describe('what the watch told everybody out', () => {
  it('is one current fact: the newest replaces the last, and an older one arriving late does not', () => {
    notice.heard('Crowd thinning on 7th Ave.', 'Vale', 100);
    notice.heard('Police line across 8th Ave at 33rd.', 'Vale', 200);
    notice.heard('Crowd thinning on 7th Ave.', 'Vale', 150);
    expect(notice.text).toBe('Police line across 8th Ave at 33rd.');
  });

  it('is put down by the operator, and tells nobody', () => {
    notice.heard('Crowd thinning on 7th Ave.', 'Vale', 100);
    notice.clear();
    expect(notice.text).toBeNull();
  });

  it('ignores an empty one', () => {
    notice.heard(null, 'Vale', 100);
    expect(notice.text).toBeNull();
  });
});
