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
 * ## Where the holder is announced
 *
 * Station goes only to relays this phone hears on, renewed each beat on those that have kept
 * answering, so a relay it cannot hear on reads Dark within five minutes. **A relay that leaves the
 * watch's list while this phone is on station is told Dark at once**, a single time, signed by the
 * watch key and stamped later than any state this phone has signed — never a relay still on the
 * list (decided 2026-10-07; `watch-state.spec.md`). An operator reading an old relay and a current
 * one may read Dark until the next beat lands on the current one: false in the safe direction, and
 * accepted. A holder who stands down before the board has followed such a change tells it with the
 * stand-down's own Dark, which goes to the relays the board was listening on as well as the list.
 *
 * ## Who can read what
 *
 * Signals are sealed to the **holders** — each member's own operator key — so a member
 * reads the board with their own key and never needs the watch's. The watch key signs
 * answers and watch state, which is a separate job [`watch-key.ts`].
 */

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import {
  KIND_DISTRESS,
  KIND_SIGNAL,
  KIND_WATCH_STATE,
  STALE_AFTER_SECONDS,
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
import { watchRelays } from './relays';
import { usable } from './relay-url';
import { pool } from './pool';
import { subscribeLive, type LiveSubscription } from './subscribe';
import { watchKey, watchPubkey } from './watch-key';

/** How often watch state is republished. A stale state reads Dark, which is the point. */
export const WATCH_BEAT_SECONDS = 120;

/**
 * How long standing down waits to read the watch's state before it decides whether to say Dark.
 * Nothing answering in that time is not a reason to stay quiet: it says Dark, the safe direction.
 */
const HANDOVER_READ_MS = 3_000;

/**
 * How long a relay has to have kept answering the board's subscription before this phone renews
 * its holder's claim there [review: relay paths].
 *
 * Renewing wherever the board was hearing *at that instant* let a relay that answers and drops
 * straight away — a volunteer relay in a crash loop, a proxy that kills sockets, a weak cell —
 * keep a named human announced: each reopen answered for a moment, the claim went out in that
 * moment, and it never went stale, while nothing on the phone heard a `Distress` for more than a
 * fraction of a second at a time. Taking the watch is not held to this; renewing it is.
 */
export const HEARD_FOR_MS = 10_000;

export interface Waiting {
  id: string;
  operator: string;
  callsign: string;
  type: SignalType | 'distress';
  text: string | null;
  at: number;
  /**
   * The relays it arrived on. They are ones the sender published to, so they are where an answer
   * can reach them, whatever this watch's own relays have become since [review: relay paths].
   */
  heardOn: string[];
}

type Advertised = { state: string; holder: string | null };

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
/**
 * This holder's claim reached a relay within the last five minutes, so operators read them as on
 * station. Cleared once that long passes with nothing renewed, which is when operators read Dark.
 */
let announced = $state(false);
let announcedUntil: ReturnType<typeof setTimeout> | null = null;
/** Still advertised as staffed, because standing down never reached a relay. */
let stillAdvertised = $state(false);
let darkRetry: ReturnType<typeof setInterval> | null = null;
/** A renewal waiting for a relay that has just started answering to have kept at it. */
let recheck: ReturnType<typeof setTimeout> | null = null;
/**
 * Moved on by taking the watch, standing down, and forgetting it all.
 *
 * Each of those awaits relays, and a person can act again before they answer: retake the watch
 * while a stand-down's Dark is still out, or wipe the phone while it reads who holds the watch. So
 * whatever comes back belongs to the act that is current, and an older one stops where it is —
 * otherwise a failed Dark armed its retry over a holder back on station, and a wipe was followed
 * by a Dark it had promised would not be sent [review: relay paths].
 */
let generation = 0;
/**
 * The `created_at` of the last watch state this phone signed. Each one is later than the last, so
 * a stand-down straight after a take — or a take straight after a stand-down — is never a tie that
 * relays settle by comparing ids, which would leave the older claim standing half the time.
 */
let lastSignedAt = 0;

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
let advertised = $state<Advertised | null>(null);

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
let closer: LiveSubscription | null = null;
/** Which watch the listener is open for, so returning to the screen does not reopen it. */
let listeningTo: string | null = null;
/**
 * The relays the listener was opened on, or last moved to.
 *
 * Only the watch was compared, so a holder who changed relays while on station went on being heard
 * on the old ones and announced on the new — operators who followed the change read On station
 * and nothing on this phone heard their `Distress` [review: relay paths]. A different list is
 * followed now, on the next `start()` or beat — and a relay that leaves it while this phone holds
 * the watch is told Dark, once, so it stops saying a human is on station where nobody here hears.
 */
let listeningOn: string[] = [];
/** The listener these callbacks belong to; anything from one it replaced is ignored. */
let listenToken: object | null = null;
/** The relays the listener is hearing on now: answered, and not closed since. */
let hearing = $state<string[]>([]);
/** Whether every relay has answered or failed at least once since the listener opened. */
let heardBack = $state(false);
/** Hearing nothing at the last look, so the next answer is announced at once. */
let wasDeaf = false;
/** When the advertised state was published, and which event it was: only a newer one replaces it. */
let advertisedAt = 0;
let advertisedId = '';
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
   * Whether operators read this holder as on station right now: a claim of theirs reached a relay
   * within the last five minutes. False before the first one lands, and again once five minutes
   * pass with nothing renewed — after a take while this phone heard nothing, or after it stopped
   * hearing.
   */
  get announced(): boolean {
    return announced;
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
   * Whether this phone is hearing the watch on no relay at all [review: relay paths].
   *
   * Known only once every relay has answered or failed, and true while none of them is answering
   * its subscription: refused, dropped, or held without a word. A holder in this state would not
   * hear a `Distress`, so nothing more is announced until a relay has kept answering for
   * {@link HEARD_FOR_MS}.
   */
  get deaf(): boolean {
    return heardBack && hearing.length === 0;
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
    const urls = usable(watchRelays());
    if (!identity || !address || urls.length === 0) return;
    if (closer && listeningTo === address) {
      // Already listening for this watch: reopening would leave a gap a Distress could fall into.
      // A change of relays is followed instead, in place — relays on both lists keep their
      // subscription untouched; a new one is asked once its connection is up, and a dropped one
      // is let go at once.
      if (!sameRelays(urls, listeningOn)) {
        const dropped = listeningOn.filter((url) => !urls.includes(url));
        listeningOn = urls;
        closer.follow(urls);
        /*
         * A relay that left the list while this phone holds the watch is told Dark, once
         * (decided 2026-10-07). Nothing here hears a Distress sent there any more, and its copy of
         * this holder's Station otherwise read On station for up to five minutes. Only to the
         * relays that left: one still on the list is renewed by the beat, and Dark there would be
         * false. Stamped later than anything this phone has signed, so it replaces the Station.
         * An operator reading both an old relay and a current one may read Dark until the next
         * Station beat lands on the current one — accepted, and the safe direction.
         */
        if (onStation && dropped.length > 0) void tellDark(dropped);
      }
      return;
    }

    // The previous listener, which was for another watch, is let go once this one is opened.
    const previous = closer;
    const token = {};
    listenToken = token;
    listeningTo = address;
    listeningOn = urls;
    advertised = null;
    advertisedAt = 0;
    advertisedId = '';
    hearing = [];
    heardBack = false;
    wasDeaf = false;
    /*
     * Two filters per relay, not `subscribeMany` with an array.
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
    // Live: a watch held for hours outlasts any one socket [audit: relay paths, F19].
    closer = subscribeLive(
      urls,
      [
        { kinds: [KIND_SIGNAL, KIND_DISTRESS], '#p': [address] },
        // This watch's own published state, so a holder can tell whether they are still the
        // one the world is being told about.
        { kinds: [KIND_WATCH_STATE], authors: [address] }
      ],
      {
        onevent: (event: Event, url: string) => {
          if (listenToken !== token) return;
          if (event.kind === KIND_WATCH_STATE) {
            // Newest wins, whichever relay answers last [audit: relay paths, F11]: the stand-down
            // guard below trusts this, and a lagging relay's old Station made it refuse to say Dark.
            if (!newer(event, advertisedAt, advertisedId)) return;
            try {
              advertised = JSON.parse(event.content) as Advertised;
              advertisedAt = event.created_at;
              advertisedId = event.id;
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
          apply(type, read.from, read.payload, event, url);
        },
        // The same signal from another relay: one more place an answer can reach them.
        onrepeat: (event: Event, url: string) => {
          if (listenToken === token) heardAlsoOn(event.id, url);
        },
        oneose: () => {
          if (listenToken !== token) return;
          heardBack = true;
          listened();
        },
        onlisten: (now: string[]) => {
          if (listenToken !== token) return;
          hearing = now;
          listened();
        }
      }
    );
    previous?.close();
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
    const urls = usable(watchRelays());
    if (!secret || !identity?.callsign || urls.length === 0) return;

    const mine = ++generation;
    // Holding a watch is hearing it: the listener is opened here if no screen opened it. Before this
    // take counts as on station, so a relay that left the list while nobody here held the watch is
    // let go without a Dark this phone never owed it — it was never told this holder was there.
    board.start();
    since = Math.floor(Date.now() / 1000);
    onStation = true;
    // A stand-down still retrying its Dark would land it on top of this claim.
    if (darkRetry) clearInterval(darkRetry);
    darkRetry = null;
    stillAdvertised = false;
    unannounced = false;
    setAnnounced(false);
    if (beat) clearInterval(beat);
    beat = setInterval(() => {
      if (!onStation) return;
      // A change of relays made on another screen is followed before anything is claimed.
      board.start();
      // The beat is also the retry: a watch that could not announce itself heals here as
      // soon as there is signal, and the warning clears with it.
      //
      // **Only where this phone is listening** [audit: relay paths, F09; review: relay paths].
      // The beat used to outlive the board, so a holder who left the Watch screen went on being
      // announced as a human on station while nothing on the phone could hear a Distress. Then it
      // checked only that a listener existed — and one whose every relay refused it, or held it
      // without a word, still existed. A relay this phone cannot hear on — or heard on only for a
      // moment — is not told again, so the claim there goes stale and reads Dark within five
      // minutes, which is then true.
      void announce();
    }, WATCH_BEAT_SECONDS * 1000);

    // Reported, not assumed. Everyone out sees the callsign of whoever took it — so if
    // nothing was published, this operator is covering nobody and needs to know now rather
    // than at the moment somebody needs them.
    //
    // Where this phone hears [review: relay paths]: the relays it hears on now, and if it hears on
    // none yet, the ones it has not heard back from at all — never one that has already refused,
    // dropped or ignored the board. Once every relay has answered or failed and none is hearing,
    // that is nowhere, which the screen says. An unknown relay that then turns out not to answer
    // keeps this one claim until it reads Dark, within five minutes, because nothing renews it.
    const hearingNow = closer?.listening() ?? [];
    const on = hearingNow.length > 0 ? hearingNow : (closer?.pending() ?? []);
    if (on.length === 0) return;
    const ok = await publishState(secret, identity.callsign, since, on);
    // Stood down, or wiped, while that was out: what it says about this take no longer applies.
    if (generation !== mine) return;
    unannounced = !ok;
    if (ok) setAnnounced(true);
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
    const urls = usable(watchRelays());
    const mine = ++generation;
    onStation = false;
    unannounced = false;
    setAnnounced(false);
    if (beat) clearInterval(beat);
    beat = null;
    if (recheck) clearTimeout(recheck);
    recheck = null;
    // An earlier stand-down's retry is this one's to finish: it retries for itself if it must.
    if (darkRetry) clearInterval(darkRetry);
    darkRetry = null;
    if (!secret || urls.length === 0) return;
    // Captured now: the screen's *Give up this watch* removes the key straight after calling this.
    const author = getPublicKey(secret);
    const listenedOn = listeningOn;

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
     *
     * **Read where Dark would go, not only where the listener happened to be** [review: relay
     * paths]. The guard trusted what the board's listener had heard, and after a change of relays
     * the listener had not heard the new ones — so Dark went out over a holder who had taken over
     * there. The relays Dark is about to reach and the ones the board listens on are asked now,
     * briefly; nothing answering is not a reason to stay quiet.
     *
     * **And Dark goes to both** [review: hold decisions]. A relay that left the list while this
     * phone was on station, before the board followed the change — saved on another screen, with
     * the next beat up to two minutes off — still carries this holder's Station. The guard read it
     * and Dark skipped it, so it went on saying a human was on station after they had stood down,
     * and a later take, which follows the list before it counts as on station, never told it either.
     */
    const callsign = loadIdentity()?.callsign;
    const newest = await newestState(author, usable([...urls, ...listenedOn]));
    // Taken up again while that was read, and the new claim stands; or wiped, and nothing is sent.
    if (generation !== mine) return;
    // A Station old enough to read as Dark speaks for nobody, and must not silence this one.
    const fresh = Math.floor(Date.now() / 1000) - newest.at < STALE_AFTER_SECONDS;
    const holder = newest.state?.state === 'station' ? newest.state.holder : null;
    if (fresh && holder && callsign && holder !== callsign) {
      console.info('[watch] handed over to ' + holder + ' — not publishing Dark over them');
      // Whatever this phone once published has been replaced by their claim.
      stillAdvertised = false;
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
     *
     * Unless the holder took the watch back, or wiped the phone, while it was out: then there is
     * nothing to retry — a Dark retried over a holder back on station would land on their claim.
     */
    const landed = await publishDark(secret, listenedOn);
    if (generation !== mine) return;
    stillAdvertised = !landed;
    if (landed) return;

    /*
     * The captured secret, not a fresh read.
     *
     * This re-read `watchKey()` on every tick, and the screen's *Give up this watch* removes
     * that key the moment it calls this — so from the first failed publish the retry returned
     * immediately, forever, while `stillAdvertised` stayed true and the relay went on telling
     * every operator that a named human was watching. Invariant 4, produced by the loop written
     * to prevent it.
     */
    darkRetry = setInterval(() => {
      void publishDark(secret, listenedOn).then((ok) => {
        // One that lands after the watch was taken back, or another stand-down began, speaks for
        // neither: the warning and the retry belong to whatever is current.
        if (!ok || generation !== mine) return;
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
    const urls = watchRelays();
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
     *
     * **Gone to where they will hear it** [review: relay paths]. The answer went only to this
     * watch's relays as they are now, and counted as sent if any took it — so a holder who had
     * changed relays answered a `Distress` heard on the old one where its sender never listens,
     * was told it had gone, and the sender's phone went on to say nobody was coming. It goes to
     * the relays the signal arrived on as well, and counts as sent only if one of those took it:
     * the sender published there, and listens there.
     */
    const heard = usable(item.heardOn ?? []);
    const took = await publishEach(usable([...heard, ...urls]), event);
    const sent = heard.length > 0 ? took.some((url) => heard.includes(url)) : took.length > 0;
    if (!sent) return false;

    // A Distress stays until a human has actually ended it, which is not something this
    // screen can know. Acknowledging is telling them somebody is awake, not that it is over.
    if (item.type !== 'distress') {
      waiting = waiting.filter((w) => w.id !== item.id);
      routineDropped = false;
    }
    return true;
  },

  /**
   * A screen closing. **Not the end of a watch** — while this phone holds one, the listener
   * stays open with the beat, so a holder who steps away to Status still hears a Distress [audit:
   * relay paths, F09]. The beat announces them only on relays the listener is hearing on.
   */
  stop(): void {
    if (onStation) return;
    unlisten();
  },

  /**
   * Everything this phone holds for a watch, gone, and nothing sent [audit: relay paths, F10].
   *
   * For a panic wipe and a burn. A wipe used to leave the beat running, so a phone wiped in a
   * hurry went on announcing its holder's callsign every two minutes; a burn left a Dark retry
   * that could reopen sockets afterwards. Going quiet is decided: the watch reads Dark to
   * everyone within five minutes, which is true — nobody on this phone is watching.
   */
  forget(): void {
    // Anything still on its way back — a stand-down's read, a Dark — now stops where it is.
    generation++;
    unlisten();
    if (beat) clearInterval(beat);
    beat = null;
    if (darkRetry) clearInterval(darkRetry);
    darkRetry = null;
    if (recheck) clearTimeout(recheck);
    recheck = null;
    onStation = false;
    since = 0;
    unannounced = false;
    setAnnounced(false);
    stillAdvertised = false;
    entries = [];
    waiting = [];
    stateAt = {};
    advertised = null;
    advertisedAt = 0;
    advertisedId = '';
    routineDropped = false;
    distressDropped = false;
  }
};

/** Closes the listener and forgets what it was hearing. */
function unlisten(): void {
  listenToken = null;
  closer?.close();
  closer = null;
  listeningTo = null;
  listeningOn = [];
  hearing = [];
  heardBack = false;
  wasDeaf = false;
}

/** The same relays, in any order. Both lists come out of `usable`, so spelling is settled. */
function sameRelays(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((url) => b.includes(url));
}

/** Newest wins, and of two from the same second the lower id, as NIP-01 settles them. */
function newer(event: Event, at: number, id: string): boolean {
  return event.created_at > at || (event.created_at === at && (id === '' || event.id < id));
}

/**
 * After every change in what the listener hears. Hearing again after hearing nothing is announced
 * without waiting for the beat — once the relay has kept answering for {@link HEARD_FOR_MS}, not
 * the moment it answers, so a relay that answers and drops straight away announces nobody.
 */
function listened(): void {
  const deafNow = heardBack && hearing.length === 0;
  if (wasDeaf && !deafNow && onStation) void announce();
  wasDeaf = deafNow;
}

/**
 * This holder's Station, on the relays the board has heard on for at least {@link HEARD_FOR_MS}
 * without a break, and nowhere else. If it is hearing somewhere but not yet for that long, it looks
 * again once that relay would have been.
 */
async function announce(): Promise<void> {
  if (recheck) clearTimeout(recheck);
  recheck = null;
  const secret = watchKey();
  const who = loadIdentity()?.callsign;
  if (!onStation || !secret || !who || !closer) return;
  const on = closer.listening(HEARD_FOR_MS);
  if (on.length === 0) {
    if (closer.listening().length > 0) recheck = setTimeout(() => void announce(), HEARD_FOR_MS);
    return;
  }
  const mine = generation;
  const ok = await publishState(secret, who, since, on);
  // A stand-down, retake or wipe while that was in flight owns the warning now.
  if (generation !== mine) return;
  unannounced = !ok;
  if (ok) setAnnounced(true);
}

/**
 * Whether operators read this holder as here. Set when a claim lands, and cleared once a claim
 * that is not renewed would read Dark to them.
 */
function setAnnounced(on: boolean): void {
  if (announcedUntil) clearTimeout(announcedUntil);
  announcedUntil = null;
  announced = on;
  if (!on) return;
  announcedUntil = setTimeout(() => {
    announcedUntil = null;
    announced = false;
  }, STALE_AFTER_SECONDS * 1000);
}

/** When the next watch state this phone signs is stamped: now, and never at or before the last. */
function stateTime(): number {
  lastSignedAt = Math.max(Math.floor(Date.now() / 1000), lastSignedAt + 1);
  return lastSignedAt;
}

/**
 * The newest watch state on these relays, beside what the listener already holds; newest wins.
 *
 * Asked once and briefly, for the stand-down guard. Whatever has not answered by
 * `HANDOVER_READ_MS` is left out, and what the listener heard stands for it.
 */
function newestState(author: string, urls: string[]): Promise<{ state: Advertised | null; at: number }> {
  let best = { state: advertised as Advertised | null, at: advertisedAt, id: advertisedId };
  return new Promise((resolve) => {
    let done = false;
    let read: LiveSubscription | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      read?.close();
      resolve(best);
    };
    const timer = setTimeout(finish, HANDOVER_READ_MS);
    read = subscribeLive(urls, { kinds: [KIND_WATCH_STATE], authors: [author], limit: 1 }, {
      onevent: (event) => {
        if (!newer(event, best.at, best.id)) return;
        try {
          best = { state: JSON.parse(event.content) as Advertised, at: event.created_at, id: event.id };
        } catch {
          /* unreadable: what was held stands */
        }
      },
      oneose: finish
    });
    // Told before it was returned, when there was nobody to ask.
    if (done) read.close();
  });
}

/**
 * Publishes to each relay on its own, and gives back the ones that took it.
 *
 * One at a time, so a relay the pool cannot open is one refusal among the rest rather than a
 * throw for all of them [audit: relay paths, F01], and so the caller can tell which took it.
 */
async function publishEach(urls: string[], event: Event): Promise<string[]> {
  const results = await Promise.allSettled(
    urls.map((url) => {
      try {
        return pool().publish([url], event)[0] ?? Promise.reject(new Error('nothing to publish to'));
      } catch (e) {
        return Promise.reject(e);
      }
    })
  );
  return urls.filter((_, i) => results[i]?.status === 'fulfilled');
}

/** The watch's Dark state, signed now and stamped later than anything this phone has signed. */
function darkEvent(secret: Uint8Array): Event {
  return finalizeEvent(
    {
      ...buildWatchStateEvent(darkInput(), stateTime()),
      content: JSON.stringify(darkState())
    },
    secret
  );
}

/** Publishes Dark to the watch's relays and to `also`, reporting whether any relay took it. */
async function publishDark(secret: Uint8Array, also: readonly string[] = []): Promise<boolean> {
  const urls = usable([...watchRelays(), ...also]);
  if (urls.length === 0) return false;
  return (await publishEach(urls, darkEvent(secret))).length > 0;
}

/**
 * Dark, once, to relays that have left the list of a watch this phone holds — and to no other.
 *
 * Not retried. A relay that refuses it still lets this holder's last Station there age to Dark
 * within five minutes, and nothing on this phone listens there any more to keep it fresh.
 */
async function tellDark(urls: string[]): Promise<void> {
  const secret = watchKey();
  if (!secret) return;
  await publishEach(urls, darkEvent(secret));
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

/** Publishes Station to these relays, reporting whether any took it. */
async function publishState(secret: Uint8Array, callsign: string, at: number, urls: string[]): Promise<boolean> {
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
      stateTime()
    ),
    secret
  );
  return (await publishEach(urls, event)).length > 0;
}

/** One more relay a signal on the board was heard on. */
function heardAlsoOn(id: string, url: string): void {
  const at = waiting.findIndex((w) => w.id === id);
  if (at === -1 || waiting[at]!.heardOn.includes(url)) return;
  waiting = waiting.map((w, i) => (i === at ? { ...w, heardOn: [...w.heardOn, url] } : w));
}

/** Folds one signal into the board. */
function apply(
  type: Waiting['type'],
  from: string,
  payload: Record<string, unknown>,
  event: Event,
  url: string
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

  // Already waiting, heard again: where it came from is added, and how long we have had it stands.
  if (waiting.some((w) => w.id === event.id)) return heardAlsoOn(event.id, url);

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
      at: Math.floor(Date.now() / 1000),
      heardOn: [url]
    }
  ];
}
