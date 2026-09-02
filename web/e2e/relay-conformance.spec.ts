import { expect, test } from '@playwright/test';
import { startRelay, type LocalRelay } from './relay-server';
import { CLAIMS, checkRelay, needsAttention, render } from '../../packages/watchtower/src/relay/conformance';

/**
 * The conformance checker, checked.
 *
 * `packages/watchtower/src/relay/conformance.ts` answers whether a relay can carry this app's
 * traffic — and a checker that reports failure is indistinguishable from a broken checker
 * until it has been run against something known-good.
 *
 * This is that control. The local relay in `relay-server.ts` is one we wrote, whose matching
 * logic is visible in the same repository, and which honours tag filters. **Every claim must
 * pass against it.** If one does not, the finding is about the checker, not about any relay.
 *
 * It is the same discipline as a positive control in `payload.test.ts` — there, a region page
 * *must* still carry records, so a typo in the matcher cannot make the negative assertions pass
 * for the wrong reason. Here, a checker that always said `fail` would look identical to a
 * genuine discovery about `relay.damus.io`, which is the worst possible thing for this
 * particular tool to get wrong: it would either raise a false alarm about the safety-critical
 * path, or teach somebody to ignore it.
 *
 * Not in the default run — it starts a server. `npm run test:relay`.
 */

let relay: LocalRelay;

test.beforeAll(async () => {
  relay = await startRelay();
});

test.afterAll(async () => {
  await relay?.close();
});

test.describe('the conformance checker, against a relay we know behaves', () => {
  test('passes every claim', async () => {
    const result = await checkRelay(relay.url);

    expect(result.reached, 'the local relay should be reachable').toBe(true);

    const failed = result.claims.filter((c) => c.verdict !== 'pass');
    expect(
      failed,
      'against a known-good relay every claim must pass; a failure here is a bug in the ' +
        'checker:\n' + failed.map((c) => `  ${c.verdict} ${c.claim} — ${c.detail}`).join('\n')
    ).toEqual([]);

    // All five, by name, so a claim silently disappearing is caught too.
    expect(result.claims.map((c) => c.claim)).toEqual([...CLAIMS]);
    expect(needsAttention([result])).toBe(false);
  });

  test('says nothing needs a look, and says which relay when something does', async () => {
    const good = await checkRelay(relay.url);
    expect(render([good]).join('\n')).toContain('NOTHING NEEDS A LOOK');

    /*
     * An unreachable relay is `unknown`, never `fail`.
     *
     * The daemon's `--check` already refuses to blame the daemon when no relay answered, on
     * the grounds that telling somebody to rebuild a working box while their network is down
     * is worse than telling them nothing. Two answers to one question would be worse still.
     */
    const dead = await checkRelay('ws://127.0.0.1:9');
    expect(dead.reached).toBe(false);
    expect(dead.claims.every((c) => c.verdict === 'unknown')).toBe(true);
    expect(needsAttention([dead])).toBe(false);
    expect(render([dead]).join('\n')).toContain('unreachable');
  });

  test('never publishes a real event kind', async () => {
    /*
     * The load-bearing safety property, asserted against what actually crossed the wire.
     *
     * A test `20911` on a shared relay is a Distress somebody can receive; a test `30915` is a
     * fake shelter in somebody's directory. The behaviour under test is a property of the kind
     * *range*, so unallocated kinds prove the same thing while impersonating nothing — and
     * that is only true for as long as nobody 'tidies' the constants back to the real ones.
     */
    const before = relay.received.length;
    await checkRelay(relay.url);
    const seen = new Set(relay.received.slice(before).map((e) => e.kind));

    expect(seen.size, 'the check should have published something').toBeGreaterThan(0);
    for (const kind of [20910, 20911, 20912, 10910, 10912, 30911, 30915, 1910]) {
      expect([...seen], `published a real NavCom kind: ${kind}`).not.toContain(kind);
    }
  });
});
