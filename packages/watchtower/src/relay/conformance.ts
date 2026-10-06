import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";

/**
 * Can these relays carry this app's traffic?
 *
 * ## Why this exists
 *
 * `Distress` is kind `20911`, which is **ephemeral**: `isEphemeral` in core defines the range
 * as 20000-29999, and NIP-01 says relays are not expected to *store* those. Storage is not the
 * worry -- a queryable history of distress calls is a failure mode this project avoids on
 * purpose. **Forwarding** is the worry, and nothing obliges a relay to do it.
 *
 * If a relay the app ships with declines to forward ephemeral events, `Distress` never leaves
 * the phone, invariant 2 fails silently, and **every test still passes** -- because every test
 * runs against a local relay that behaves. That is the failure shape `verification.md` keeps
 * recording: a rule the logic honours and the output does not.
 *
 * Build order 0.2 has said since the beginning that peer presence "has never crossed a real
 * relay". The local-relay suite closed most of that; what it explicitly did not close, in its
 * own words, is whether `relay.damus.io` behaves.
 *
 * ## Why it publishes, when `watchtower-daemon --check` deliberately does not
 *
 * `--check` reads what is already out there, because its question is whether an operator can
 * see a watch that exists. This question is different and cannot be answered by reading: a
 * relay that has forwarded nothing is indistinguishable from a relay that forwards nothing.
 *
 * So it writes -- and the writes are chosen to be harmless. See `KINDS` below.
 */

/**
 * Unallocated kinds, one per range.
 *
 * **Never the real ones.** A test `20911` on a shared relay is a Distress somebody can
 * receive; a test `30915` is a fake shelter in somebody's directory. Our own daemon and pager
 * both filter by `#p` on the watchtower's pubkey so neither would page anybody -- but that is
 * a fact about our client, not about the relay, and anyone subscribed to bare `{kinds:[20911]}`
 * would see it.
 *
 * The behaviour under test is a property of the **range**, not the kind. NIP-01 assigns
 * semantics by range and relays implement it that way, so an unallocated kind in each range
 * proves exactly the same thing while impersonating nothing.
 */
const KINDS = {
  /** 20000-29999: relays may forward, are not expected to store. */
  ephemeral: 29979,
  /** 10000-19999: one event per (kind, pubkey), replaced in place. */
  replaceable: 19979,
  /** 30000-39999: one event per (kind, pubkey, d-tag). */
  addressable: 39979,
  /** 1000-9999: stored, never replaced. The only range a deletion request has anything to act on. */
  regular: 9979,
} as const;

/** How long to wait for a relay to deliver something it accepted. */
const DELIVERY_MS = 8_000;
/** How long to wait for a connection and an initial EOSE. */
const READY_MS = 12_000;
/** Between writes, because a relay is somebody's donated machine and not a load target. */
const POLITE_GAP_MS = 400;

/**
 * Three states, not two.
 *
 * A relay that could not be reached has **not failed a conformance claim**, and saying so
 * would send a Stationkeeper to rebuild a working box while their network is down. The daemon's
 * `--check` already draws this line and declines to blame the daemon when no relay answered;
 * drawing it differently here would be two answers to one question.
 */
export type Verdict = "pass" | "fail" | "unknown";

export interface ClaimResult {
  claim: string;
  verdict: Verdict;
  /** Why, in the form a person can act on. Always present for fail and unknown. */
  detail: string;
}

export interface RelayResult {
  url: string;
  reached: boolean;
  claims: ClaimResult[];
  /** What a deletion request actually did here. Not a claim — see `DeletionResult`. */
  deletion?: DeletionResult;
}

/**
 * What a NIP-09 deletion request did, which the specification leaves to the relay.
 *
 * **Deliberately not a claim.** A relay that keeps an event after a deletion request has broken
 * nothing: NIP-09 says relays *may* honour or ignore one, there is no enforcement, and deleting
 * from every relay and client is impossible. Reporting that as `fail` would exit the conformance
 * run non-zero for permitted behaviour and train a Stationkeeper to ignore a red result — the exact
 * thing the three-state verdict above exists to prevent.
 *
 * It is measured because the **withdrawal copy depends on it.** An operator taking a published
 * report back is owed the truth about what that does, and before this the only honest sentence was
 * a hedge: *relays may ignore this*. Now it can name which ones did.
 */
export interface DeletionResult {
  /** Gone afterwards, kept, or nothing could be told. */
  honoured: boolean | null;
  detail: string;
}

/** The five claims, in descending order of what breaks if they are false. */
export const CLAIMS = [
  "a write is accepted",
  "an ephemeral event is delivered to another subscriber",
  "a tag filter actually filters",
  "a replaceable event is stored and returned",
  "an addressable event is stored and returned by its tag",
] as const;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(() => r(), ms));
const hex = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");

function sign(secret: Uint8Array, kind: number, tags: string[][], content = "navcom relay self-test") {
  return finalizeEvent({ kind, tags, content, created_at: Math.floor(Date.now() / 1000) }, secret);
}

/** Did the relay say OK? Resolves rather than throws: a refusal is a result, not an error. */
async function publish(pool: SimplePool, url: string, event: Event): Promise<string | null> {
  return publishTo(pool, url, event);
}

/** The same question, of anything that can publish — so the deletion probe can be tested. */
async function publishTo(pool: DeletionPool, url: string, event: Event): Promise<string | null> {
  const results = await Promise.allSettled(pool.publish([url], event));
  const bad = results.find((r) => r.status === "rejected");
  if (bad && bad.status === "rejected") return String(bad.reason).slice(0, 120);
  return results.some((r) => r.status === "fulfilled") ? null : "no response";
}

/** What `probeDeletion` needs of a pool, so a test can hand it one. */
export interface DeletionPool {
  publish: (urls: string[], event: Event) => Promise<string>[];
  querySync: (urls: string[], filter: Filter) => Promise<Event[]>;
}

/**
 * Publishes something, asks the relay to delete it, and looks again.
 *
 * Separate and exported because `checkRelay` builds its own pool and cannot be driven from a test,
 * and because the three outcomes here are easy to get subtly wrong: *kept* is permitted, *not
 * stored* proves nothing about deletion, and only *gone* is a relay honouring the request.
 *
 * Writes two events per relay — a throwaway in an unallocated regular kind, then the request to
 * remove it. Both are signed by a key that exists for this run only, which is the same courtesy the
 * rest of this file extends to somebody's donated machine.
 */
export async function probeDeletion(
  pool: DeletionPool,
  url: string,
  secret: Uint8Array,
  settle: (ms: number) => Promise<void> = sleep
): Promise<DeletionResult> {
  const pubkey = getPublicKey(secret);
  const mark = sign(secret, KINDS.regular, [["d", "navcom-deletion-probe-" + hex(8)]]);
  const filter = { kinds: [KINDS.regular], authors: [pubkey] };

  const sent = await Promise.allSettled(pool.publish([url], mark));
  if (!sent.some((r) => r.status === "fulfilled")) {
    return { honoured: null, detail: "the relay would not accept the event, so nothing could be deleted" };
  }
  await settle(POLITE_GAP_MS);

  const before = await pool.querySync([url], filter);
  if (!before.some((e) => e.id === mark.id)) {
    /*
     * Not a failure of anything. A relay that stores nothing in this range cannot serve a withdrawn
     * report either, which is the question an operator actually has.
     */
    return { honoured: null, detail: "the relay did not store the event, so there was nothing to delete" };
  }

  const request = sign(secret, 5, [["e", mark.id]], "");
  const refused = await publishTo(pool, url, request);
  if (refused !== null) {
    return { honoured: null, detail: `the relay refused the deletion request itself: ${refused}` };
  }
  await settle(DELIVERY_MS);

  const after = await pool.querySync([url], filter);
  if (after.some((e) => e.id === mark.id)) {
    return {
      honoured: false,
      detail:
        "the event is still served after a deletion request. NIP-09 permits that — a withdrawal here " +
        "removes nothing, and an operator must be told so rather than reassured"
    };
  }
  return { honoured: true, detail: "the event was gone afterwards" };
}

/**
 * One relay, all five claims.
 *
 * Ordering is not cosmetic. **The subscription is opened and confirmed before anything is
 * published**, because an ephemeral event reaches only currently-connected subscribers and is
 * never stored. A check that published first would see nothing and report that the relay drops
 * ephemeral events -- a false alarm on the most safety-critical claim here, and the obvious way
 * to write this wrong.
 */
export interface CheckOptions {
  /**
   * Whether to measure what a deletion request does. **Off by default, and that is not timidity.**
   *
   * The five claims already write five events per relay. Adding two more got this machine
   * `banned: too many rate-limit violations` from `relay.damus.io` within two consecutive runs — a
   * check nobody can run twice is worse than a measurement nobody has. The withdrawal copy needs
   * this answer occasionally, not on every run, so it is asked for by name:
   *
   *   npm run conformance --prefix packages/watchtower -- --deletion
   */
  deletion?: boolean;
}

export async function checkRelay(
  url: string,
  now = Date.now,
  opts: CheckOptions = {}
): Promise<RelayResult> {
  const pool = new SimplePool();
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const mine = hex(64);
  const theirs = hex(64);
  const dTag = "navcom-selftest-" + hex(8);

  const claims: ClaimResult[] = [];
  const say = (claim: string, verdict: Verdict, detail: string) =>
    claims.push({ claim, verdict, detail });

  const received: Event[] = [];
  let sawEose = false;
  /** Proof this relay answered at all. Not the same as EOSE -- see `ensureRelay` below. */
  let reachedRelay = false;
  let closer: { close: () => void } | null = null;

  try {
    /*
     * Connect explicitly before anything else, because EOSE does not mean what it looks like.
     *
     * `SimplePool` fires `oneose` once every relay in the set has *settled* -- which includes
     * failing to connect. So a refused connection produced an immediate EOSE, and the first
     * version of this reported an unreachable relay as reached, with all five claims sitting
     * under it. `ensureRelay` throws instead, which is the honest signal.
     */
    await pool.ensureRelay(url, { connectionTimeout: READY_MS });
    reachedRelay = true;

    // Open the ephemeral subscription first, filtered by a tag only this run knows.
    /*
     * One filter object, not an array of them.
     *
     * `subscribeMany` takes a single filter. Passing `[filter]` sends
     * `["REQ", id, [f]]` -- a filter that is an array -- and every property check on the relay
     * side reads a named key an array does not have. `board.svelte.ts` shipped exactly this
     * bug and it cost weeks, because a lenient relay matches everything and the test passes.
     * The local relay was hardened to match *nothing* for a malformed filter precisely so the
     * next occurrence would fail loudly. It caught this one on the first run.
     */
    closer = pool.subscribeMany(
      [url],
      { kinds: [KINDS.ephemeral], "#e": [mine] },
      {
        onevent: (e: Event) => received.push(e),
        oneose: () => {
          sawEose = true;
        },
      }
    );

    const readyBy = now() + READY_MS;
    while (!sawEose && now() < readyBy) await sleep(100);
    if (!sawEose) {
      for (const c of CLAIMS) say(c, "unknown", "relay connected but never answered a subscription");
      return { url, reached: true, claims };
    }

    // 1. A write is accepted. Distinguished from delivery: "refused" and "needs auth" have
    //    different fixes, and both differ from "accepted but never forwarded".
    const wanted = sign(secret, KINDS.ephemeral, [["e", mine]]);
    const refusal = await publish(pool, url, wanted);
    if (refusal) {
      const auth = /auth|restricted|not allowed|pow|rate/i.test(refusal);
      say(CLAIMS[0], "fail", auth ? `write refused: ${refusal}` : `write refused: ${refusal}`);
      for (const c of CLAIMS.slice(1)) say(c, "unknown", "nothing could be published");
      return { url, reached: true, claims };
    }
    say(CLAIMS[0], "pass", "relay accepted a signed event");

    await sleep(POLITE_GAP_MS);
    // A second ephemeral event carrying a tag the subscription did NOT ask for.
    const unwanted = sign(secret, KINDS.ephemeral, [["e", theirs]]);
    await publish(pool, url, unwanted);

    const deadline = now() + DELIVERY_MS;
    while (now() < deadline && !received.some((e) => e.id === wanted.id)) await sleep(150);

    // 2. Delivery. The one that decides whether Distress leaves the phone.
    const got = received.some((e) => e.id === wanted.id);
    say(
      CLAIMS[1],
      got ? "pass" : "fail",
      got
        ? "an ephemeral event published here came back on a separate subscription"
        : `no ephemeral event in ${DELIVERY_MS / 1000}s -- a Distress would not leave the phone`
    );

    // 3. The filter filters. A relay that accepts `#e` and ignores it delivers other people's
    //    traffic, which is a correctness failure and a privacy leak, not merely noise.
    const leaked = received.some((e) => e.id === unwanted.id);
    say(
      CLAIMS[2],
      leaked ? "fail" : got ? "pass" : "unknown",
      leaked
        ? "an event the filter excluded was delivered anyway"
        : got
          ? "an event outside the filter was withheld"
          : "nothing was delivered, so filtering could not be observed"
    );

    // 4 and 5 are about storage, so they are asked for rather than waited for.
    await sleep(POLITE_GAP_MS);
    const rep = sign(secret, KINDS.replaceable, []);
    const repRefusal = await publish(pool, url, rep);
    if (repRefusal) {
      say(CLAIMS[3], "unknown", `could not publish: ${repRefusal}`);
    } else {
      await sleep(POLITE_GAP_MS);
      const back = await pool.querySync([url], { kinds: [KINDS.replaceable], authors: [pubkey] });
      const found = back.some((e) => e.id === rep.id);
      say(
        CLAIMS[3],
        found ? "pass" : "fail",
        found ? "stored and returned by author" : "published, then not returned -- watch state would read Dark"
      );
    }

    await sleep(POLITE_GAP_MS);
    const addr = sign(secret, KINDS.addressable, [["d", dTag], ["g", dTag]]);
    const addrRefusal = await publish(pool, url, addr);
    if (addrRefusal) {
      say(CLAIMS[4], "unknown", `could not publish: ${addrRefusal}`);
    } else {
      await sleep(POLITE_GAP_MS);
      const back = await pool.querySync([url], { kinds: [KINDS.addressable], "#g": [dTag] });
      const found = back.some((e) => e.id === addr.id);
      say(
        CLAIMS[4],
        found ? "pass" : "fail",
        found
          ? "stored and returned by its tag"
          : "published, then not returned -- a place added in the field would not reach anybody"
      );
    }

    // Tidy up after ourselves. The two stored events are ~200 bytes each and this is somebody
    // else's disk; a deletion request is the courtesy, and its success is not a claim.
    /*
     * Measured here because the line below has been asking for deletions since this file was
     * written and never once looked at whether they worked. The withdrawal an operator is offered
     * rests on the answer.
     */
    await sleep(POLITE_GAP_MS);
    const deletion = opts.deletion === true ? await probeDeletion(pool, url, secret) : undefined;

    await sleep(POLITE_GAP_MS);
    await publish(pool, url, sign(secret, 5, [["e", rep.id], ["e", addr.id]], "self-test cleanup"));

    return { url, reached: true, claims, ...(deletion ? { deletion } : {}) };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    for (const c of CLAIMS) {
      if (!claims.some((x) => x.claim === c)) say(c, "unknown", `check did not complete: ${why}`);
    }
    /*
     * `sawEose`, not "did we fill in any claims".
     *
     * The first version said `claims.length > 0`, which the block directly above had just
     * made true -- so a relay that refused the connection outright reported itself reached.
     * An EOSE is the only evidence that this relay answered at all, and `reached` means
     * exactly that.
     */
    return { url, reached: reachedRelay, claims };
  } finally {
    try {
      closer?.close();
    } catch {
      /* a subscription that will not close is not a conformance finding */
    }
    try {
      pool.destroy();
    } catch {
      /* likewise */
    }
  }
}

/** Every relay, one at a time -- concurrent connections to strangers is not a good look. */
export async function checkRelays(
  urls: readonly string[],
  opts: CheckOptions = {}
): Promise<RelayResult[]> {
  const out: RelayResult[] = [];
  for (const url of urls) out.push(await checkRelay(url, Date.now, opts));
  return out;
}

/** True when something a person must act on was found. Drives the exit code. */
export const needsAttention = (results: readonly RelayResult[]): boolean =>
  results.some((r) => r.claims.some((c) => c.verdict === "fail"));

export function render(results: readonly RelayResult[]): string[] {
  const out: string[] = [];
  for (const r of results) {
    out.push("", r.url);
    if (!r.reached) {
      out.push("  unreachable -- nothing was proven either way");
      continue;
    }
    for (const c of r.claims) {
      const mark = c.verdict === "pass" ? "ok  " : c.verdict === "fail" ? "FAIL" : "?   ";
      out.push(`  ${mark} ${c.claim}`);
      if (c.verdict !== "pass") out.push(`       ${c.detail}`);
    }
    if (r.deletion) {
      /*
       * `kept`, never `FAIL`. NIP-09 permits a relay to ignore a deletion request, and marking
       * permitted behaviour as a failure is how a red result stops meaning anything.
       */
      const mark =
        r.deletion.honoured === true ? "ok  " : r.deletion.honoured === false ? "kept" : "?   ";
      out.push(`  ${mark} a deletion request is honoured`);
      if (r.deletion.honoured !== true) out.push(`       ${r.deletion.detail}`);
    }
  }
  const bad = results.flatMap((r) => r.claims.filter((c) => c.verdict === "fail").map((c) => [r.url, c] as const));
  out.push("", bad.length === 0 ? "NOTHING NEEDS A LOOK" : "NEEDS A LOOK");
  for (const [url, c] of bad) out.push(`  - ${url}: ${c.claim} -- ${c.detail}`);
  return out;
}
