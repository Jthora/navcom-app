import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { REFUSALS, PERMITTED, BROADCAST } from '@navcom/core';
// Plain .mjs, deliberately: this is the file node runs during a build, long after the
// TypeScript is gone, and testing the thing that actually runs is the point.
import { refusalsDocument, healthDocument, metroFigures, nodeIdentity } from '../../../scripts/well-known.mjs';

/**
 * The descriptor cannot drift.
 *
 * The Academy's worst self-finding was a machine-readable file advertising a taxonomy its
 * code had left behind — in the file an agent parses first, and in its `security.txt`. It
 * called machine-readable drift *worse* than human drift, and it is right: a person reading
 * a stale paragraph is confused, an agent planning against a stale descriptor plans against
 * a world that no longer exists.
 *
 * NavCom would have made the same mistake within a month. These tests are the reason it
 * cannot: every claim the published files make is compared against the thing it claims about.
 */

describe('the refusals descriptor', () => {
  it('says exactly what the source says, in the same order', () => {
    const doc = refusalsDocument();
    expect(doc.refuses.map((r: { id: string }) => r.id)).toEqual(REFUSALS.map((r) => r.id));
    expect(doc.accepts.map((r: { id: string }) => r.id)).toEqual(PERMITTED.map((r) => r.id));
  });

  it('gives a reason for every refusal, because a bare no invites a workaround', () => {
    for (const r of refusalsDocument().refuses as { id: string; because: string }[]) {
      expect(r.because.length, `${r.id} has no reason`).toBeGreaterThan(40);
    }
  });

  it('carries the three integrations that were actually proposed and refused', () => {
    /*
     * Not a completeness check — it is the specific history this file exists for. A feed was
     * proposed twice by two nodes, a credential gate twice, and a Field Terminal payload in
     * three separate designs. If any of these ever falls out of the list, the file stops
     * answering the question it was created to answer.
     */
    const ids = refusalsDocument().refuses.map((r: { id: string }) => r.id);
    expect(ids).toContain('no-feed');
    expect(ids).toContain('no-credential-gate');
    expect(ids).toContain('nothing-to-the-terminal');
  });

  it('counts the broadcast metro rather than repeating a remembered number', () => {
    /*
     * Three artifacts said "two of 479 records", which is true across sixty-nine regions and
     * useless to somebody recruiting in one city. The figure a broadcaster needs is the one
     * for the metro, and it must come from the CSV — a hard-coded count is a count that is
     * wrong the first time somebody makes a phone call.
     */
    const doc = refusalsDocument();
    expect(doc.broadcast.metro).toBe(BROADCAST.metro);

    const counted = metroFigures(BROADCAST.metro);
    if (!counted) throw new Error(`no region data for ${BROADCAST.metro}`);
    expect(doc.broadcast.records).toBe(counted.records);
    expect(doc.broadcast.callable).toBe(counted.callable);

    // A callable record has a phone number and something still worth asking about, so the
    // callable set can never exceed the region.
    expect(counted.callable).toBeLessThanOrEqual(counted.records);
  });

  it('names where the boundary is written, because the rules are not in the JSON', () => {
    expect(refusalsDocument().broadcast.rules).toMatch(/^\//);
  });
});

describe('the verified-build receipt', () => {
  it('reports an unproven build as unproven rather than omitting the question', () => {
    /*
     * The whole value of the receipt is the field that embarrasses the node publishing it.
     * With no test run to read, this must say `unknown` — not an empty object, not a missing
     * key, and above all not a default that reads like a pass. This is invariant 9 pointed at
     * NavCom itself: blank reads *unknown*, never "no restriction".
     */
    // Pointed at a path that does not exist, because after a real build the receipt does — and
    // the branch worth testing is the one where nothing proved anything.
    const doc = healthDocument({}, '/nonexistent/.verify-receipt.json');
    expect(doc.suites.ran).toBe('unknown');
    expect(doc.suites.at).toBeNull();
    expect(doc.suites.counts).toBeNull();
  });

  it('distinguishes a build on a laptop from a build on a runner', () => {
    // NavCom has published four submissions verified on one laptop while its CI was dead.
    // A receipt that could not express that would have been worth nothing.
    expect(healthDocument({}).built_on).toBe('local');
    expect(healthDocument({ CI: 'true' }).built_on).toBe('ci');
  });

  it('points at the refusals, and the refusals point back', () => {
    // Either file is reachable from the other, so an integrator that finds one finds both.
    expect(healthDocument({}).refuses).toBe('/.well-known/navcom-refusals.json');
    expect(refusalsDocument().verification).toBe('/.well-known/navcom-health.json');
  });
});

describe('the refusals match the rules they claim to summarise', () => {
  it('every invariant that forbids an inbound thing has a refusal', () => {
    /*
     * The mapping, checked against `CLAUDE.md` itself rather than against memory. Refusals
     * are not a copy of the invariants — they are the subset an integrator needs before
     * drafting — but each of these three exists *because* an invariant does, and an invariant
     * that quietly lost its refusal would leave the door open in the machine-readable file
     * while the prose still said no.
     */
    const claude = readFileSync(new URL('../../../../CLAUDE.md', import.meta.url), 'utf8');
    const ids = REFUSALS.map((r) => r.id);

    expect(claude).toMatch(/Nothing is recorded about the people being served/);
    expect(ids).toContain('no-person-data');

    expect(claude).toMatch(/Nothing tasks anyone/);
    expect(ids).toContain('no-tasking');

    expect(claude).toMatch(/No legal names anywhere/);
    expect(ids).toContain('no-callsigns-outbound');
  });
});

describe('the node identity a peer verifies instead of trusting a message', () => {
  /**
   * Mecha Jono's allowlist asks for a pubkey published somewhere independently confirmable, and
   * re-checks it on a drift schedule. That is the right shape — *"somebody told me in a chat"* is
   * a weak method, and this project weighs claims by method everywhere else.
   *
   * Derived from the secret rather than written down, so the published identity cannot drift from
   * the one that actually signs. These tests are what stop that drifting later.
   */
  const SECRET = 'a'.repeat(63) + '7';

  it('derives the pubkey from the key that signs, rather than repeating a written-down one', () => {
    const identity = nodeIdentity({ NAVCOM_NODE_SECRET: SECRET });
    expect(identity.pubkey).toMatch(/^[0-9a-f]{64}$/);
    // A different secret must produce a different identity, or it is not derived at all.
    expect(nodeIdentity({ NAVCOM_NODE_SECRET: 'b'.repeat(63) + '7' }).pubkey).not.toBe(identity.pubkey);
  });

  it('says it has no key rather than inventing one', () => {
    // The honest state on a machine with no secret, and the one that must not read as an error —
    // publishing no pointers is a configuration, not a fault.
    const identity = nodeIdentity({});
    expect(identity.pubkey).toBeNull();
    expect(identity.signs).toEqual([]);
  });

  it('refuses a malformed secret rather than signing with something unintended', () => {
    expect(nodeIdentity({ NAVCOM_NODE_SECRET: 'nope' }).pubkey).toBeNull();
    expect(nodeIdentity({ NAVCOM_NODE_SECRET: 'A'.repeat(64) }).pubkey).toBeNull();
  });

  it('never publishes the secret it derived from', () => {
    /*
     * The finding this network spent three rounds closing on another node, guarded here before it
     * can happen. The identity file is served publicly at a well-known path — if a secret ever
     * reached it, it would be indexed rather than merely logged.
     */
    const published = JSON.stringify(nodeIdentity({ NAVCOM_NODE_SECRET: SECRET }));
    expect(published).not.toContain(SECRET);
  });

  it('states what the key is not, so nothing else gets keyed on it', () => {
    // A published identity is exactly where an authority quietly accretes. Saying "no" in the
    // artifact is cheaper than arguing about it after somebody has built a gate on it.
    const identity = nodeIdentity({ NAVCOM_NODE_SECRET: SECRET });
    expect(identity.authority).toMatch(/never truth/i);
    expect(identity.not.join(' ')).toMatch(/operator key/i);
    expect(identity.not.join(' ')).toMatch(/watchtower key/i);
    // And exactly one thing it does sign — a key with an open-ended scope is one nobody can audit.
    expect(identity.signs).toHaveLength(1);
    expect(identity.signs[0].kind).toBe(30078);
  });
});
