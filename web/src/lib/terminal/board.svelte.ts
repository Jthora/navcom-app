/**
 * Holding the board, on a phone.
 *
 * This is the watch as a **mode of the same app**, replacing the plan where a Console was
 * served from a box. The premise of that plan was that a box exists, and for the squads
 * this project is actually for, it does not.
 *
 * ## Taking watch is a declaration, not a monitor
 *
 * Nothing here watches anybody. A phone in a pocket with the screen off is not observing a
 * board, and no amount of interface can make it so. What this screen does is let a person
 * **say, on the record, that they are watching** — and then show them what they have taken
 * on, so they can actually do it.
 *
 * That distinction is the whole design, and it is why:
 *
 * - **Nothing is inferred from the app being open.** Taking watch is an explicit act, and
 *   so is standing down. Closing the tab does not end a watch, because a watch that ended
 *   when a screen closed would end without anybody being told
 * - **Overdue is shown, never acted on.** The board marks somebody past their time and
 *   stops there. It pages nobody, contacts nobody, and starts no ladder [invariant 3]
 * - **There is no alert, no sound and no badge.** A person who took watch is expected to
 *   look. A phone that promised to interrupt them would be promising something a
 *   backgrounded web page cannot deliver
 *
 * ## Who can read what
 *
 * Signals are sealed to the **holders** — each member's own operator key — so a member
 * reads the board with their own key and never needs the watch's. The watch key signs
 * answers and watch state, which is a separate job [`watch-key.ts`].
 */

import { finalizeEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import {
  KIND_DISTRESS,
  KIND_SIGNAL,
  KIND_WATCH_STATE,
  buildResponse,
  buildWatchStateEvent,
  darkState,
  declineIsValid,
  isOverdue,
  openFromGroup,
  readTag,
  type BoardEntry,
  type SignalType
} from '@navcom/core';
import { loadIdentity } from './identity';
import { loadConfig } from './config';
import { relays } from './relays';
import { pool } from './pool';
import { watchKey, watchPubkey } from './watch-key';

/** How often watch state is republished. A stale state reads Dark, which is the point. */
export const WATCH_BEAT_SECONDS = 120;

export interface Waiting {
  id: string;
  operator: string;
  callsign: string;
  type: SignalType | 'distress';
  text: string | null;
  at: number;
}

/**
 * How many of each the board will hold.
 *
 * The watch's address is handed to every operator, so anybody holding it can put something
 * on this board — the same open door the escalation executor has. Unbounded, the screen a
 * watch reads during an incident is whatever the last flood left behind.
 *
 * Two limits rather than one, because the two lists are not the same kind of thing. See the
 * intake below.
 */
const ROUTINE_MAX = 200;
const DISTRESS_MAX = 500;

let entries = $state<BoardEntry[]>([]);
let waiting = $state<Waiting[]>([]);
let routineDropped = $state(false);
let distressDropped = $state(false);
/** Nobody can see this watch yet, because taking it never reached a relay. */
let unannounced = $state(false);
/** Still advertised as staffed, because standing down never reached a relay. */
let stillAdvertised = $state(false);
let darkRetry: ReturnType<typeof setInterval> | null = null;

/**
 * Who this watch is currently advertising as its holder.
 *
 * A holder's device did not watch its **own** watch: `watch.svelte` follows the *configured*
 * Watchtower, and a squad member holds a key rather than a config, so nothing on this device
 * knew what the world was being told about it.
 *
 * That is what made the handover hole invisible from here. Read from the same relays the
 * board already uses, so it costs one filter rather than a connection.
 */
let advertised = $state<{ state: string; holder: string | null } | null>(null);

/**
 * The timestamp of the last sign-on or stand-down applied for each operator.
 *
 * Kept separately because a stand-down **deletes** the entry, and the board still has to
 * remember that it happened — otherwise a stale sign-on arriving afterwards puts somebody
 * back on the board who has gone home.
 *
 * This is the one thing an operator's own clock is good for: ordering two of their own
 * events. The presence store already guards this and says why — *"out-of-order delivery is
 * normal on relays"* — and the board, which is the watch's picture of who is out, did not.
 */
let stateAt: Record<string, number> = {};
let onStation = $state(false);
let since = $state(0);
let closer: { close(): void } | null = null;
let beat: ReturnType<typeof setInterval> | null = null;

/** Anything sealed to us that we could not open is dropped, never guessed at. */
function readSignal(event: Event): { from: string; payload: Record<string, unknown> } | null {
  const identity = loadIdentity();
  if (!identity) return null;
  try {
    return {
      from: event.pubkey,
      payload: openFromGroup<Record<string, unknown>>(identity.secretKey, event.pubkey, event.content)
    };
  } catch {
    return null;
  }
}

export const board = {
  /** Who is out, as this device has heard it. Never persisted — the board expires [C27]. */
  get entries(): BoardEntry[] {
    const now = Math.floor(Date.now() / 1000);
    return entries
      .map((e) => ({ ...e, status: isOverdue(e, now) ? ('overdue' as const) : e.status }))
      .sort((a, b) => a.callsign.localeCompare(b.callsign));
  },

  /**
   * Signals somebody is waiting on an answer to. Oldest first — they have waited longest.
   *
   * **Resupply is deliberately not here.** It is a request that can wait until somebody is
   * somewhere warm, and putting it in the same list as *"I need someone"* would make it
   * compete for attention with things that matter more. That is the alarm-fatigue problem
   * in a quieter dress: a list where most entries do not matter teaches somebody to skim
   * the list.
   */
  /**
   * A `Distress`, and nothing else, oldest first.
   *
   * **Its own list because the spec says so**: `20911` is a separate kind precisely so
   * clients can prioritise it independently of routine traffic [`signals.spec.md`]. This
   * board flattened it into one queue sorted by arrival, styled red and otherwise equal — so
   * a hundred queries arriving first put a `Distress` a hundred rows down the screen a watch
   * reads when somebody is in trouble. Red is not prioritisation if you have to scroll to
   * find it.
   */
  get distress(): Waiting[] {
    return [...waiting].filter((w) => w.type === 'distress').sort((a, b) => a.at - b.at);
  },

  get waiting(): Waiting[] {
    return [...waiting]
      .filter((w) => w.type !== 'resupply' && w.type !== 'distress')
      .sort((a, b) => a.at - b.at);
  },

  /**
   * Whether taking the watch actually reached anyone.
   *
   * Being on station is a claim made *to other people*. A watch holder whose screen says
   * "On station" while nothing was published is covering nobody and does not know it.
   */
  get unannounced(): boolean {
    return unannounced;
  },

  /**
   * Whether standing down actually reached anyone.
   *
   * The worse direction by far, and the one this module already explains: watch state is
   * replaceable, so a Dark that never lands leaves the previous state on the relay and
   * **every operator goes on believing a human is watching** [invariant 4].
   */
  get stillAdvertised(): boolean {
    return stillAdvertised;
  },

  /** Whether routine traffic is arriving faster than the board will hold. */
  get routineDropped(): boolean {
    return routineDropped;
  },

  /** Whether even the Distress list has been capped, which is an extraordinary state. */
  get distressDropped(): boolean {
    return distressDropped;
  },

  /** What ran out. Its own list, quiet, and nobody is waiting in the street on it. */
  get restock(): Waiting[] {
    return [...waiting].filter((w) => w.type === 'resupply').sort((a, b) => a.at - b.at);
  },

  get onStation(): boolean {
    return onStation;
  },

  get since(): number {
    return since;
  },

  /**
   * Starts listening.
   *
   * Listening is not holding watch. A member off watch still sees the board — that is the
   * squad trade, stated in the spec — and it is also what makes handover possible without
   * anything being transferred.
   */
  start(): void {
    const identity = loadIdentity();
    const address = watchPubkey() ?? loadConfig()?.pubkey;
    const urls = relays();
    if (!identity || !address || urls.length === 0) return;

    closer?.close();
    /*
     * `subscribeMap`, not `subscribeMany` with an array.
     *
     * `subscribeMany(relays, filter, params)` takes **one** filter. This passed two in an
     * array with an `as never` cast, and the cast is the whole story: the array was wrapped
     * again and the REQ went out as `["REQ", id, [f1, f2]]` -- a filter that is itself an
     * array, so it has no `kinds`, no `authors` and no `#`-prefixed keys, and every check a
     * relay makes is skipped. It matched everything.
     *
     * That is why the board's filter could be broken with no effect, and why the first test
     * written for it passed against a deliberately corrupted `#p` and had to be withdrawn.
     * The subscription was not narrow-and-wrong, it was absent: this device was asking a
     * volunteer relay for its entire firehose, on the phone `pool.ts` opens exactly one
     * socket to save.
     *
     * Nothing downstream was fooled -- `readSignal` only keeps what decrypts to this
     * operator -- so the cost was bandwidth, battery and a stranger's relay rather than a
     * wrong board.
     */
    closer = pool().subscribeMap(
      urls.flatMap((url) => [
        { url, filter: { kinds: [KIND_SIGNAL, KIND_DISTRESS], '#p': [address] } },
        // This watch's own published state, so a holder can tell whether they are still the
        // one the world is being told about.
        { url, filter: { kinds: [KIND_WATCH_STATE], authors: [address] } }
      ]),
      {
        onevent: (event: Event) => {
          if (event.kind === KIND_WATCH_STATE) {
            try {
              advertised = JSON.parse(event.content) as { state: string; holder: string | null };
            } catch {
              advertised = null;
            }
            return;
          }
          const read = readSignal(event);
          if (!read) return;
          const type = (event.kind === KIND_DISTRESS
            ? 'distress'
            : readTag(event.tags, 't')) as Waiting['type'] | undefined;
          if (!type) return;
          apply(type, read.from, read.payload, event);
        }
      }
    );
  },

  /**
   * Goes on station.
   *
   * Explicit and ceremonial, because signing on means something. Everyone out sees the
   * callsign of whoever took it — an operator must never be unable to name who is behind
   * them [invariant 4].
   */
  async takeWatch(): Promise<void> {
    const secret = watchKey();
    const identity = loadIdentity();
    const urls = relays();
    if (!secret || !identity?.callsign || urls.length === 0) return;

    since = Math.floor(Date.now() / 1000);
    onStation = true;
    // Reported, not assumed. Everyone out sees the callsign of whoever took it — so if
    // nothing was published, this operator is covering nobody and needs to know now rather
    // than at the moment somebody needs them.
    unannounced = !(await publishState(secret, identity.callsign, since));
    if (beat) clearInterval(beat);
    beat = setInterval(() => {
      const s = watchKey();
      const who = loadIdentity()?.callsign;
      // The beat is also the retry: a watch that could not announce itself heals here as
      // soon as there is signal, and the warning clears with it.
      if (onStation && s && who) {
        void publishState(s, who, since).then((ok) => {
          unannounced = !ok;
        });
      }
    }, WATCH_BEAT_SECONDS * 1000);
  },

  /**
   * Stands down, and says so.
   *
   * **Publishes Dark rather than going quiet.** Simply stopping would leave the last state
   * on the relay until it went stale, and every operator reading it in the meantime would
   * believe a human was watching. Dark is a supported state, honestly reported.
   */
  async standDown(): Promise<void> {
    const secret = watchKey();
    const urls = relays();
    onStation = false;
    unannounced = false;
    if (beat) clearInterval(beat);
    beat = null;
    if (!secret || urls.length === 0) return;

    /*
     * Only whoever is currently advertised may publish Dark.
     *
     * A squad shares one watch key and watch state is **replaceable**, so any holder can
     * overwrite it. In a handover that is a hole: Wren takes the watch, Raven takes it over
     * mid-shift, Wren stands down — and Wren's Dark replaces Raven's `station`. **The watch
     * reads Dark while Raven is holding it**, and an operator signing on is told nobody is
     * watching when somebody is. Raven's heartbeat corrects it up to two minutes later.
     *
     * Standing down is always honoured locally. What is conditional is *speaking for the
     * watch*, and somebody who has already handed over does not.
     */
    const mine = loadIdentity()?.callsign;
    if (advertised?.state === 'station' && advertised.holder && mine && advertised.holder !== mine) {
      console.info('[watch] handed over to ' + advertised.holder + ' — not publishing Dark over them');
      return;
    }

    /*
     * Whether Dark actually landed.
     *
     * This function's whole reason for existing is two lines above it: going quiet would
     * leave the previous state on the relay and every operator reading it would believe a
     * human was watching. **A Dark that fails to publish produces exactly that** — and it is
     * worse than never standing down, because the heartbeat that would have kept refreshing
     * the state has just been cleared, so nothing retries and nothing expires it soon.
     *
     * So it retries until it lands, and says so until it does. This is the one place in the
     * app where going quiet is not a safe default.
     */
    if (await publishDark(secret)) return;

    stillAdvertised = true;
    if (darkRetry) clearInterval(darkRetry);
    darkRetry = setInterval(() => {
      const s = watchKey();
      if (!s) return;
      void publishDark(s).then((ok) => {
        if (!ok) return;
        stillAdvertised = false;
        if (darkRetry) clearInterval(darkRetry);
        darkRetry = null;
      });
    }, WATCH_BEAT_SECONDS * 1000);
  },

  /**
   * Answers somebody.
   *
   * The answer is signed by the watch and sealed to the one operator who asked. Answering
   * takes the signal off the board because it has been dealt with — **except a `Distress`,
   * which only a human ending it can clear** [invariant 2]. There is no button here that
   * closes one.
   *
   * `declining` sends *"nobody is coming"* instead of an answer. It is a real reply and the
   * honest one when a watch has nobody to send: an operator who asked for help, got an
   * acknowledgement and waited is worse off than one who was told plainly. Core refuses it
   * for a `Distress`, and this checks before sending rather than trusting the caller.
   */
  async answer(item: Waiting, text: string, declining = false): Promise<boolean> {
    const secret = watchKey();
    const urls = relays();
    if (!secret || urls.length === 0) return false;

    // Refused in core, not here, so no second surface can forget. A watch able to decline a
    // Distress could end it with a tap [invariant 2].
    if (declining && !declineIsValid(item.type)) return false;

    const identity = loadIdentity();
    const event = finalizeEvent(
      buildResponse(
        secret,
        item.operator,
        item.id,
        {
          type: declining ? 'declined' : item.type === 'distress' ? 'ack' : 'answer',
          // A person, saying so. An operator must never be uncertain whether they are
          // talking to one [invariant 5], and this is the field that decides it.
          responder: { kind: 'human', callsign: identity?.callsign ?? 'watch' },
          text: text.trim() || null,
          // No directory lookup happened here -- a person typed this. Claiming provenance
          // for a hand-written answer would dress it as verified, and a confident wrong
          // answer at 10pm is the worst failure available to this system.
          provenance: null
        },
        Math.floor(Date.now() / 1000)
      ),
      secret
    );
    /*
     * Taken off the board only once it has actually gone.
     *
     * The result was discarded, so an answer that reached no relay still cleared the item —
     * the watch believed they had replied and the operator got nothing. Leaving it in place
     * is what lets somebody notice and try again.
     */
    const results = await Promise.allSettled(pool().publish(urls, event));
    const sent = results.some((r) => r.status === 'fulfilled');
    if (!sent) return false;

    // A Distress stays until a human has actually ended it, which is not something this
    // screen can know. Acknowledging is telling them somebody is awake, not that it is over.
    if (item.type !== 'distress') {
      waiting = waiting.filter((w) => w.id !== item.id);
      routineDropped = false;
    }
    return true;
  },

  stop(): void {
    closer?.close();
    closer = null;
    // The beat deliberately survives: closing a screen does not end a watch.
  }
};

/** Publishes Dark, reporting whether any relay took it. */
async function publishDark(secret: Uint8Array): Promise<boolean> {
  const urls = relays();
  if (urls.length === 0) return false;
  const event = finalizeEvent(
    {
      ...buildWatchStateEvent(darkInput(), Math.floor(Date.now() / 1000)),
      content: JSON.stringify(darkState())
    },
    secret
  );
  const results = await Promise.allSettled(pool().publish(urls, event));
  return results.some((r) => r.status === 'fulfilled');
}

function darkInput() {
  return {
    state: 'dark' as const,
    holder: null,
    holder_kind: null,
    oncall: [],
    since: Math.floor(Date.now() / 1000),
    agent_health: 'down' as const,
    last_drill: null,
    log_root: null,
    now: Math.floor(Date.now() / 1000)
  };
}

async function publishState(secret: Uint8Array, callsign: string, at: number): Promise<boolean> {
  const urls = relays();
  const event = finalizeEvent(
    buildWatchStateEvent(
      {
        state: 'station',
        holder: callsign,
        holder_kind: 'human',
        // Nobody is on-call for a phone-held watch unless somebody said so. The node must
        // never assert reachability on anyone's behalf, and a squad has no node to.
        oncall: [],
        since: at,
        agent_health: 'down',
        last_drill: null,
        log_root: null,
        now: Math.floor(Date.now() / 1000)
      },
      Math.floor(Date.now() / 1000)
    ),
    secret
  );
  const results = await Promise.allSettled(pool().publish(urls, event));
  return results.some((r) => r.status === 'fulfilled');
}

/** Folds one signal into the board. */
function apply(
  type: Waiting['type'],
  from: string,
  payload: Record<string, unknown>,
  event: Event
): void {
  const callsign = typeof payload.callsign === 'string' ? payload.callsign : from.slice(0, 8);
  const now = event.created_at;

  if (type === 'on-station' || type === 'stood-down') {
    // Their clock, ordering their own two events. Anything older than what we have already
    // applied for this operator is a replay, and acting on it would make the board wrong in
    // whichever direction the stale event points.
    const applied = stateAt[from];
    if (applied !== undefined && applied >= now) return;
    stateAt[from] = now;
  }

  if (type === 'on-station') {
    const duration = typeof payload.expected_duration === 'number' ? payload.expected_duration : 7200;
    const entry: BoardEntry = {
      operator: from,
      callsign,
      area: typeof payload.area === 'string' ? payload.area : 'unknown',
      signed_on: now,
      expected_until: now + duration,
      routine_due: typeof payload.routine_interval === 'number' ? now + payload.routine_interval : null,
      last_contact: now,
      position: (payload.position as BoardEntry['position']) ?? null,
      status: 'active'
    };
    entries = [...entries.filter((e) => e.operator !== from), entry];
    return;
  }

  if (type === 'stood-down') {
    entries = entries.filter((e) => e.operator !== from);
    waiting = waiting.filter((w) => w.operator !== from);
    return;
  }

  entries = entries.map((e) =>
    e.operator === from
      ? { ...e, last_contact: now, status: type === 'distress' ? 'distress' : e.status }
      : e
  );

  if (type === 'routine') return;

  // Query, Assist and Distress are all things a person is waiting on.
  const without = waiting.filter((w) => w.id !== event.id);

  /*
   * Bounded, and the two lists are bounded differently on purpose.
   *
   * Routine traffic is dropped once the board is full: two hundred unanswered queries is
   * already more than any watch will work through, and letting them accumulate costs the
   * screen that matters.
   *
   * A `Distress` is **never** dropped to make room for routine traffic, and its own cap is
   * high and separate. Invariant 2 is the reason — the ladder may fail but it may never fail
   * silently — so if even that cap is reached the board says so rather than quietly holding
   * less than arrived. A watch seeing that knows something extraordinary is happening, which
   * is a true and useful thing to know.
   */
  if (type === 'distress') {
    const held = without.filter((w) => w.type === 'distress').length;
    if (held >= DISTRESS_MAX) {
      distressDropped = true;
      return;
    }
  } else {
    const held = without.filter((w) => w.type !== 'distress').length;
    if (held >= ROUTINE_MAX) {
      routineDropped = true;
      return;
    }
  }

  waiting = [
    ...without,
    {
      id: event.id,
      operator: from,
      callsign,
      type,
      text: typeof payload.text === 'string' ? payload.text : null,
      /*
       * How long **we** have had it, not when they say they sent it.
       *
       * The list is sorted oldest first because those people have waited longest, and it was
       * ordered by the sender's own `created_at` — so anything backdated went straight to the
       * top of the watch's queue. Receipt time is both the honest answer to "how long have I
       * had this" and the one nobody else can set.
       */
      at: Math.floor(Date.now() / 1000)
    }
  ];
}
