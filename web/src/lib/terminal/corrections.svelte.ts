/**
 * Live corrections for the area this device carries.
 *
 * The device half of Milestone 6. Corrections travel as attestations on relays and are
 * merged over the **cached** directory at read time — so an operator sees their squad's
 * corrections with no build, no deploy, no maintainer, and no signal.
 *
 * ## Cached, because the directory is
 *
 * The whole point of the cached directory is that it works in a car park with no bars. A
 * correction that only existed while a relay was reachable would be exactly the wrong shape:
 * live when you do not need it and gone when you do. So corrections are written to the
 * accruing tier as they arrive and read from there on start.
 *
 * ## Read from everybody, and that is deliberate
 *
 * There is no peer list here and no allowlist. A correction is a **public attestation with
 * an author and an age**, and it wins or loses on those — an in-person check from a stranger
 * last night is better evidence than a website scrape from March, and pretending otherwise
 * would throw away the ninth tribe's whole contribution.
 *
 * What protects the reader is not who is allowed to speak. It is that a correction is
 * additive and cannot delete anything [`@navcom/core`'s `directory/corrections.ts`], so the
 * worst a hostile stranger achieves is a claim beside the record, wearing their name.
 */

import type { Event } from 'nostr-tools/core';
import {
  buildCorrection,
  KIND_CORRECTION,
  readCorrection,
  type Correction,
  type Method
} from '@navcom/core';
import { ensureContactKey } from './card';
import { loadIdentity } from './identity';
import { pool } from './pool';
import { relays } from './relays';
import { get, set } from './storage';

type Stored = Correction & { by: string };

const FIELD = 'corrections';

/**
 * How many corrections this device will hold, and how many for any one record.
 *
 * A correction is the one thing in this system a **stranger** can write into another
 * operator's device: anybody may publish one, every device carrying that area caches it, and
 * it is keyed by author, so fresh keys buy unlimited entries.
 *
 * Measured rather than feared: twenty thousand of them is about 11 MB, past a typical
 * localStorage quota — and 1.E established what a full phone does, which is stop saving.
 * **The end of that chain is an operator's patrol record silently failing to record, caused
 * by somebody with no relationship to them at all.**
 *
 * Both numbers sit far above anything a real area produces. A record with twenty-five
 * separate people correcting it is not a directory problem.
 */
const MAX_HELD = 400;
const MAX_PER_RECORD = 25;

let held = $state<Record<string, Stored>>({});
/** Whether corrections are arriving faster than this device will hold them. */
let partial = $state(false);

/**
 * Writes are coalesced to the end of the tick.
 *
 * Every arrival re-serialised the entire map, so three thousand of them wrote **2.1 GB** to
 * storage for 1.5 MB of data. Relays deliver in bursts, so this is the ordinary case rather
 * than the hostile one — a flood only made it visible.
 */
/**
 * Corrections this operator made that have not reached a relay.
 *
 * The signed events themselves, because republishing needs the signature and the content
 * both. Kept in the accruing tier beside the corrections — this is the operator's own
 * contribution and losing it is the failure, which is the same reason their patrol record
 * lives there.
 */
const PENDING = 'corrections_unsent';
let unsent = $state<Record<string, Event>>({});

let writeQueued = false;
function persist(): void {
  if (writeQueued) return;
  writeQueued = true;
  queueMicrotask(() => {
    writeQueued = false;
    set('accruing', FIELD, held);
  });
}
let closer: { close(): void } | null = null;

/** Keyed by author and record: one operator's latest word about a place replaces their last. */
const keyOf = (c: Stored) => `${c.by}:${c.record}`;

export const corrections = {
  /** Everything this device knows, for merging. */
  get all(): Stored[] {
    return Object.values(held);
  },

  /** What is known about one record. */
  about(recordId: string): Stored[] {
    return Object.values(held).filter((c) => c.record === recordId);
  },

  /**
   * Whether more corrections are being published to this area than the device will hold.
   *
   * Said on the screen rather than kept quiet: a directory holding a fraction of what was
   * published looks exactly like a directory nobody has corrected.
   */
  get partial(): boolean {
    return partial;
  },

  /**
   * Loads what is cached and starts listening for more.
   *
   * `records` scopes the subscription to the area actually carried. Asking a relay for every
   * correction on the network would pull places this operator will never go, on a phone
   * counting bytes.
   */
  start(records: readonly string[]): void {
    held = get<Record<string, Stored>>('accruing', FIELD) ?? {};
    unsent = get<Record<string, Event>>('accruing', PENDING) ?? {};

    const urls = relays();
    if (urls.length > 0) void this.flush();
    if (urls.length === 0 || records.length === 0) return;

    closer?.close();
    closer = pool().subscribeMany(urls, { kinds: [KIND_CORRECTION], '#d': [...records] }, {
      onevent: (event: Event) => {
        const read = readCorrection(event);
        if (!read) return;

        // Out-of-order delivery is normal. An older correction must not overwrite the same
        // author's newer one.
        const key = keyOf(read);
        const existing = held[key];
        if (existing && existing.last_verified > read.last_verified) return;

        /*
         * Full: what is here is kept and updated, and new authors are turned away.
         *
         * Refusing the new one rather than evicting an old one means a flood cannot displace
         * a correction somebody actually relies on — an operator carrying good corrections
         * before the flood still has them afterwards.
         */
        if (!existing) {
          const forRecord = Object.values(held).filter((c) => c.record === read.record).length;
          if (Object.keys(held).length >= MAX_HELD || forRecord >= MAX_PER_RECORD) {
            partial = true;
            return;
          }
        }

        held = { ...held, [key]: read };
        persist();
      }
    });
  },

  /**
   * Publishes what this operator learned.
   *
   * Signed by the contact key, which is generated here if it does not exist — contributing
   * must not be gated behind having published a card, because the operator with the best
   * knowledge is often the one with the most reason not to be findable.
   */
  async submit(
    record: string,
    fields: Correction['fields'],
    method: Method = 'in_person',
    /**
     * Flag every field in this correction as weakly backed, despite the method above.
     *
     * A single switch rather than a per-field one, because a correction here only ever
     * asserts one field at a time in practice — see `fix()` in the region page — and a
     * per-field API for a single-field caller is complexity nobody is using. `flag` is never
     * included even if somehow passed through, since it is a report about the record rather
     * than a value with a confidence to caveat.
     */
    bridged = false
  ): Promise<void> {
    const urls = relays();
    const callsign = loadIdentity()?.callsign;
    const secret = ensureContactKey();

    const bridgedFields = bridged
      ? (Object.keys(fields).filter((k) => k !== 'flag') as Correction['bridged'])
      : undefined;

    const correction: Correction = {
      record,
      // `anonymous` is a real author in this schema, not a fallback for a missing one.
      verified_by: callsign ?? 'anonymous',
      method,
      last_verified: new Date().toISOString().slice(0, 10),
      fields,
      ...(bridgedFields?.length ? { bridged: bridgedFields } : {})
    };

    const event = buildCorrection(secret, correction, Math.floor(Date.now() / 1000));
    const read = readCorrection(event);
    if (read) {
      // Held locally whether or not a relay takes it: an operator who corrects a record with
      // no signal must still see their own correction. Getting it *out* is handled below.
      held = { ...held, [keyOf(read)]: read };
      persist();
    }

    /*
     * Whether it actually reached anybody.
     *
     * The comment above used to promise this would *"publish the next time this runs with a
     * connection"*, and **nothing implemented that**. A correction made at a door with no
     * signal was held locally, failed once, and was never sent again — while appearing in the
     * operator's own directory, so they had positive evidence it had worked. That is worse
     * than a silent failure: it is a disguised one.
     *
     * It matters most for exactly the person this feature is for. The operator with the best
     * knowledge is the one standing at the door, and standing at the door is where the signal
     * is worst.
     */
    const results = urls.length > 0
      ? await Promise.allSettled(pool().publish(urls, event))
      : [];
    if (results.some((r) => r.status === 'fulfilled')) return;

    unsent = { ...unsent, [event.id]: event };
    set('accruing', PENDING, unsent);
  },

  /**
   * Retries everything this operator wrote that never got out.
   *
   * Called on `start`, which is what the promise in `submit` always described. Silent when
   * there is nothing to do, and it never blocks a screen — a correction is not urgent, it
   * just has to eventually arrive.
   */
  async flush(): Promise<void> {
    const urls = relays();
    const queue = Object.values(unsent);
    if (urls.length === 0 || queue.length === 0) return;

    const landed: string[] = [];
    await Promise.all(
      queue.map(async (event) => {
        const results = await Promise.allSettled(pool().publish(urls, event));
        if (results.some((r) => r.status === 'fulfilled')) landed.push(event.id);
      })
    );
    if (landed.length === 0) return;

    unsent = Object.fromEntries(Object.entries(unsent).filter(([id]) => !landed.includes(id)));
    set('accruing', PENDING, unsent);
  },

  /** How many of this operator's own corrections have not reached anybody yet. */
  get unsentCount(): number {
    return Object.keys(unsent).length;
  },

  stop(): void {
    closer?.close();
    closer = null;
  }
};
