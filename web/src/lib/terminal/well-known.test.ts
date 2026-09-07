import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REFUSALS, PERMITTED, BROADCAST } from '@navcom/core';
// Plain .mjs, deliberately: this is the file node runs during a build, long after the
// TypeScript is gone, and testing the thing that actually runs is the point.
import { refusalsDocument, healthDocument, metroFigures, nodeIdentity, intelDocument, vocabularyCid, canonicalVocabulary } from '../../../scripts/well-known.mjs';

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

describe('the intel declaration', () => {
  const doc = () => intelDocument();
  const kindsSrc = () =>
    readFileSync(new URL('../../../../packages/core/src/events/kinds.ts', import.meta.url), 'utf8');

  it('does not claim a kind somebody else already allocated', () => {
    // NavCom is the authority for intel on the grid, which makes an accidental collision
    // *our* fault rather than a negotiation. Every allocated kind is in one file; 1911 must
    // not be among them until it is this one.
    const allocated = [...kindsSrc().matchAll(/KIND_(\w+)\s*=\s*(\d+)/g)]
      .map(([, name, n]) => ({ name, kind: Number(n) }));
    const claimed = doc().defines.map((d) => d.kind);
    for (const k of claimed) {
      const clash = allocated.find((a) => a.kind === k && a.name !== 'OBSERVATION');
      expect(clash, `kind ${k} is already KIND_${clash?.name}`).toBeUndefined();
    }
  });

  it('says it is unimplemented for exactly as long as it is', () => {
    // The failure this exists to prevent: a published contract telling Starcom we emit
    // something we do not, or still calling itself a plan after it ships. The status page
    // already drifted this way once, which is why it is derived rather than written.
    //
    // Keyed on an emitter existing, not on the kind constant. Testing the constant would have
    // flipped this to "implemented" on a one-line commit declaring a number, while nothing
    // could build an observation and none existed — telling Starcom to expect events nothing
    // emits. Declaring a kind is not implementing an object.
    const buildable = existsSync(
      fileURLToPath(new URL('../../../../packages/core/src/directory/observation.ts', import.meta.url))
    );
    expect(doc().status.startsWith(buildable ? 'implemented in core' : 'specified, not implemented')).toBe(true);
  });

  it('publishes a vocabulary read out of the spec, not retyped', () => {
    // Parsed from raw-intel.md. If the fenced block is renamed or reshaped this empties out,
    // and an empty vocabulary would tell a consumer every tag is unknown.
    const tags = Object.values(doc().vocabulary.tags).flat();
    expect(tags.length).toBeGreaterThan(0);
    expect(tags).toContain('nothing_observed');
  });

  it('pins the geohash length to the same number the spec does', () => {
    /*
     * The exact drift this catches happened. The prose said "coarse (~20 km)" — four
     * characters — and gave a five-character example, which is +/-2.4 km. An eight-fold
     * disagreement inside the one field whose only job is preventing an operator from being
     * located, and a consumer builds against the example.
     *
     * So the number is read out of the spec's own table rather than compared to a literal
     * here, which would just be a third place for it to disagree.
     */
    const spec = readFileSync(
      fileURLToPath(new URL('../../../../docs/product/raw-intel.md', import.meta.url)), 'utf8'
    );
    const stated = spec.match(/geohash, exactly (\d+) characters/)?.[1];
    expect(stated, 'the spec no longer states a geohash character count').toBeTruthy();
    expect(doc().parameters.area_geohash_chars).toBe(Number(stated));
  });

  it('states the same vocabulary TTL the spec does, and degrades permissive', () => {
    // Same shape as the geohash guard, for the same reason: two homes for one number is how
    // the last eight-fold disagreement happened.
    const spec = readFileSync(
      fileURLToPath(new URL('../../../../docs/product/raw-intel.md', import.meta.url)), 'utf8'
    );
    const stated = spec.match(/cache \*\*(\d+) seconds\*\*/)?.[1];
    expect(stated, 'the spec no longer states a cache TTL').toBeTruthy();
    const c = doc().vocabulary.cache;
    expect(c.ttl_seconds).toBe(Number(stated));
    expect(c.max_stale_seconds).toBeGreaterThan(c.ttl_seconds);
    // The direction is the rule. Restrictive degradation drops valid observations silently.
    expect(c.on_stale.toLowerCase()).toContain('shape');
    expect(c.note.toLowerCase()).toContain('does not bump');
    // The published ttl must sit inside the bounds the same document declares. A contract
    // that can instruct a consumer to DoS its publisher should not be able to do so by typo.
    expect(c.ttl_seconds).toBeGreaterThanOrEqual(c.ttl_seconds_min);
    expect(c.ttl_seconds).toBeLessThanOrEqual(c.ttl_seconds_max);
    expect(c.ttl_seconds_min).toBeGreaterThan(0);
  });

  it('publishes a vocabulary CID a consumer can actually recompute', () => {
    /*
     * The whole value is reproducibility by somebody else. If the canonical form drifts — a key
     * order, a space — the hash becomes ours alone, which is the same as not having one, except
     * it looks like a check.
     */
    const d = doc();
    expect(d.vocabulary.cid).toMatch(/^b[a-z2-7]{20,}$/);
    expect(vocabularyCid(d.vocabulary.tags)).toBe(d.vocabulary.cid);
    // Order-independent: a consumer serialising in a different order must land on the same bytes.
    const shuffled: Record<string, string[]> = {};
    for (const k of Object.keys(d.vocabulary.tags).reverse()) {
      shuffled[k] = [...d.vocabulary.tags[k]].reverse();
    }
    expect(vocabularyCid(shuffled)).toBe(d.vocabulary.cid);
    expect(canonicalVocabulary(d.vocabulary.tags).toString('utf8')).not.toMatch(/\s/);
    // And it must say where the signed copy lives, or the CID proves nothing about origin.
    expect(d.vocabulary.cid_announced_as).toEqual({ kind: 30078, d: 'navcom:intel-vocabulary' });
  });

  it('states a publication rate, so anomaly detection is not ours to staff', () => {
    const v = doc().volume;
    expect(v.per_operator_per_day_max_plausible).toBeGreaterThan(0);
    // It must not read as a limit NavCom enforces — there is no server that could.
    expect(v.note.toLowerCase()).toContain('enforces no rate');
  });

  it('obliges a consumer to replace on refine, not add', () => {
    // Without this the same observation lands twice, ~20km apart, corroborating itself.
    const req = doc().requires.join(' ').toLowerCase();
    expect(req).toContain('refines');
    expect(req).toMatch(/replac/);
  });

  it('commits to an overlap window, so a version bump cannot starve a consumer', () => {
    const v = doc().versioning;
    expect(v.overlap_days).toBeGreaterThan(0);
    expect(doc().version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('does not claim the chain is free of free text, because it is not', () => {
    /*
     * This file said "never: free text of any kind", and a place name accepts anything —
     * verified: "camp behind Home Depot — white male 30s red jacket" is a valid place name
     * today. A directory cannot exist without names, so that is a limit rather than a hole,
     * and the claim had to narrow rather than the schema tighten.
     *
     * Guarded because the overclaim is the comfortable sentence. It reads better, it was
     * written twice, and it is the one an adversarial reader breaks first.
     */
    const d = doc();
    const freeText = d.never.find((n: string) => n.toLowerCase().includes('free text')) ?? '';
    expect(freeText, 'the contract no longer mentions free text at all').toBeTruthy();
    expect(
      freeText.toLowerCase(),
      'the free-text claim must scope itself to the observation'
    ).toContain('observation');
    expect(d.anchor_names_are_free_text?.claim.toLowerCase()).toContain('anchor');
    expect(d.anchor_names_are_free_text?.consumer_should.toLowerCase()).toContain('unstructured');
  });

  it('never promises a field the schema forbids', () => {
    const d = doc();
    const forbidden = d.never.join(' ').toLowerCase();
    expect(forbidden).toContain('descriptor');
    expect(forbidden).toContain('free text');
    // The required list is the whole payload. A free-text field appearing here would be the
    // single change that undoes both hard prohibitions at once.
    expect(d.defines[0].required).not.toContain('note');
    expect(d.defines[0].required).not.toContain('description');
  });
});
