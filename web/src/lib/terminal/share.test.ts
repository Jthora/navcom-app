import { describe, expect, it, vi, afterEach } from 'vitest';
import { canShareText, shareText } from './share';

/** Replaces `navigator.share` for one test. `undefined` removes it entirely. */
function withShare(impl: ((data: ShareData) => Promise<void>) | undefined, canShare?: unknown) {
  const nav = navigator as unknown as Record<string, unknown>;
  if (impl === undefined) delete nav['share'];
  else nav['share'] = impl;
  if (canShare === undefined) delete nav['canShare'];
  else nav['canShare'] = canShare;
}

afterEach(() => withShare(undefined));

describe('whether to offer the control', () => {
  it('is not offered when the browser has no share sheet', () => {
    withShare(undefined);
    expect(canShareText()).toBe(false);
  });

  it('is offered when share exists without canShare, because a text share still works', () => {
    withShare(async () => {});
    expect(canShareText()).toBe(true);
  });

  it('believes canShare when the browser has one', () => {
    withShare(async () => {}, () => false);
    expect(canShareText()).toBe(false);
  });
});

describe('what leaves', () => {
  it('sends the text and nothing else', async () => {
    /*
     * The assertion that matters. `propagation.md` §2 refuses a call to action, a download link
     * and a referral code, and a `url` in this payload is all three at once travelling with
     * every recap an operator ever posts.
     */
    const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {});
    withShare(share);
    await shareText('two nights, Downtown');
    expect(share).toHaveBeenCalledTimes(1);
    const sent = share.mock.calls[0]?.[0] ?? {};
    expect(Object.keys(sent)).toEqual(['text']);
    expect(sent.text).toBe('two nights, Downtown');
  });
});

describe('the four outcomes', () => {
  it('shared, when the sheet took it', async () => {
    withShare(async () => {});
    expect(await shareText('x')).toBe('shared');
  });

  it('unsupported, without calling anything', async () => {
    withShare(undefined);
    expect(await shareText('x')).toBe('unsupported');
  });

  it('cancelled rather than failed, when the operator dismissed the sheet', async () => {
    // Reported as a failure, this teaches an operator the feature is broken when it did exactly
    // what they asked of it.
    withShare(async () => {
      const err = new Error('Share canceled');
      err.name = 'AbortError';
      throw err;
    });
    expect(await shareText('x')).toBe('cancelled');
  });

  it('cancelled even from a build that throws a bare error saying so', async () => {
    withShare(async () => {
      throw new Error('The operation was aborted.');
    });
    expect(await shareText('x')).toBe('cancelled');
  });

  it('refused, which is the only one worth printing', async () => {
    withShare(async () => {
      const err = new Error('Permission denied');
      err.name = 'NotAllowedError';
      throw err;
    });
    expect(await shareText('x')).toBe('refused');
  });

  it('never throws, whatever comes back', async () => {
    for (const thrown of [null, undefined, 'a string', 42, {}]) {
      withShare(async () => {
        throw thrown;
      });
      await expect(shareText('x')).resolves.toMatch(/refused|cancelled/);
    }
  });
});
