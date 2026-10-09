/**
 * Being on station.
 *
 * Signing on is a deliberate act and never automatic — an operator who did not sign on is
 * not watched, and the terminal must never decide otherwise on their behalf.
 */

import { finalizeEvent } from 'nostr-tools/pure';
import {
  RESPONSE_WINDOW,
  buildSignal,
  capabilitySentence,
  checkReview,
  distressClosure,
  PublishError,
  sendDistressUntilAcknowledged,
  sendSignal,
  waitForResponse,
  type DistressClosure,
  type DistressPhase,
  type OnStationPayload,
  type PublishResult,
  type SecretKey,
  type ResponsePayload,
  type SignalPayload,
  type SignalType,
  type ReviewCheck,
  type WatchStatePayload
} from '@navcom/core';

import { loadConfig, storedWatch } from './config';
import { loadIdentity } from './identity';
import { get, set, clearField } from './storage';
import { watch, whenWatchChangesHands } from './watch.svelte';
import { seenRoots } from './roots';
import { recordPatrol } from './patrol';
import { coverOf, watchtowerAt, type Cover, type WatchtowerAddress } from '@navcom/core';
import { presence } from './presence.svelte';
import { kemKeys } from './pq.svelte';
import { announceListed, beatListed, stopListed } from './public.svelte';
import { position } from './position.svelte';
import { overdue } from './overdue.svelte';
import { pool } from './pool';
import { distressRelays, watchTargets } from './watch-targets';
import { heard } from './heard.svelte';
import { heardLine } from './heard-copy';

export interface SignOn {
  at: number;
  area: string;
  expectedUntil: number;
  /**
   * What the watch said it could do at the moment of signing on.
   *
   * The operator's own record, not the node's — it is not signed by the Watchtower, so it
   * proves what this terminal was *shown*, not what was true. The node-signed version is
   * the capability receipt, and it lands when the daemon issues one.
   */
  toldAtSignOn: string;
  /** Seconds between routine check-ins, or null. Kept so a re-announce can restate it. */
  routineInterval: number | null;
}

let session = $state<SignOn | null>(get<SignOn>('wipeable', 'signon'));
let busy = $state(false);
let lastResponse = $state<ResponsePayload | null>(null);
let error = $state<string | null>(null);
let distressPhases = $state<DistressPhase[]>([]);
let distressRunning = $state(false);
/**
 * When this Distress was raised, in wall-clock milliseconds.
 *
 * In memory with the phases, and deliberately **not cleared when the sending stops** — a
 * Distress that ended without a human is still a thing that ran for eleven minutes, and the
 * operator standing there is owed that number.
 */
let distressRaisedAt = $state<number | null>(null);
let distressController: AbortController | null = null;


/**
 * Two different absences, and conflating them was the wall.
 *
 * No identity is genuinely unfinished setup. **No watch is not** — it is the ordinary state
 * of an operator who patrols alone, and the message an operator sees has to tell them which
 * one they are in. "This terminal is not set up yet" told a lone operator their app was
 * broken when it was working exactly as designed.
 */
function ctx() {
  const identity = loadIdentity();
  if (!identity) throw new Error('Create a callsign first — everything else needs one.');
  const config = loadConfig();
  if (!config) {
    // A watch whose every relay is refused here was added, and saying it was not sent its
    // operator looking for a setup step they had already done [audit: relay paths, review].
    throw new Error(
      storedWatch()
        ? 'This goes to your watch, and none of its relays can be reached from this page. Fix them on the setup screen.'
        : 'This goes to a watch, and you have not added one. Nothing to send it to.'
    );
  }
  return { config, identity };
}

/**
 * Where a signal to the watch goes [relay-lists §5]: `watchTargets()`, the one list the receipt
 * counts against, so what *heard on* says and where a signal goes cannot drift. None, when every
 * relay the watch names is one nothing is sent to.
 */
function targets(): string[] {
  const relays = watchTargets();
  if (relays.length === 0) {
    throw new Error('Every relay this watch names is one nothing is sent to. Setup says why for each.');
  }
  return relays;
}

/**
 * Sends a signal to the watch, and keeps each relay's answer [relay-lists §7]: a relay that refused
 * this phone's last signal is not counted as one the watch is heard on, because a `Distress` from
 * this phone would be refused there too. Kept when no relay took it as well, before it is thrown.
 */
async function signal(
  relays: string[],
  secret: SecretKey,
  address: WatchtowerAddress,
  type: SignalType,
  payload: SignalPayload
) {
  try {
    return await sendSignal(pool(), relays, secret, address, type, payload, (result: PublishResult) => heard.answered(result));
  } catch (e) {
    if (e instanceof PublishError && e.result) heard.answered(e.result);
    throw e;
  }
}

/*
 * `SignalPayload`, not `object` with a cast.
 *
 * The cast was here because `object` is not assignable to `SignalPayload`, which is exactly
 * the check worth having: it is the union of every shape a watch knows how to read. A cast
 * on a call into the transport layer is what let the board subscribe to nothing for weeks,
 * so this one is spent rather than kept.
 */
async function send(type: SignalType, payload: SignalPayload, timeoutMs = 10_000) {
  const { config, identity } = ctx();
  const relays = targets();
  const address = watchAddress(config);
  const sent = await signal(relays, identity.secretKey, address, type, payload);
  // The whole address, not its pubkey: where the watch names its executor, that key answers too,
  // and a wait for the watch key alone hears the executor only through a copy, if at all.
  return waitForResponse(pool(), relays, identity.secretKey, identity.pubkey, address, sent, timeoutMs);
}

/** Attaches the declared area, which is coarse by construction — it came from a sign-on. */
/*
 * Overloaded so the two callers that always have text are typed as having it.
 *
 * `Query` and `Resupply` require `text`; an `Assist` deliberately does not, because "I need
 * someone" with no words still means that and requiring a reason would delay a send at the
 * moment sending matters. One optional parameter collapsed all three into "maybe text",
 * which is what made a cast necessary at the call into the transport -- and a cast there is
 * what let the board subscribe to nothing for weeks.
 */
function area(text: string): { text: string; area?: string };
function area(text?: undefined): { area?: string };
// And the Assist case, where the operator may or may not have typed anything.
function area(text: string | undefined): { text?: string; area?: string };
function area(text?: string) {
  return {
    ...(text === undefined ? {} : { text }),
    ...(session?.area ? { area: session.area } : {})
  };
}

/**
 * Asks the watch something, and forgets what it last said.
 *
 * `lastResponse` is module state that outlives the screen that produced it, and three screens
 * read its mere presence as proof their own send landed. So an operator who signed on an hour
 * ago, walked out of signal and asked a question was shown the sign-on acknowledgement as the
 * answer — responder callsign, provenance line and all — and Resupply went further: it printed
 * "Sent. Whoever keeps the stash will see it." and **wiped what they had typed**, for a message
 * that never left the phone.
 *
 * Cleared before the send rather than after the failure, because the window between them is
 * exactly when the screen renders.
 */
async function ask<T>(fn: () => Promise<T>): Promise<T | null> {
  lastResponse = null;
  return run(fn);
}

async function run<T>(fn: () => Promise<T>): Promise<T | null> {
  busy = true;
  error = null;
  try {
    return await fn();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    return null;
  } finally {
    busy = false;
  }
}

/**
 * Where a signal goes, and who can read it.
 *
 * One place, so nothing can seal to the address when it meant the holders. A box has no
 * holders listed and is its own holder; a squad lists one pubkey per phone.
 */
/**
 * What to tell a watch that has just taken over, about a patrol already in progress.
 *
 * `expected_duration` is what is **left**, not what was originally asked for. The incoming
 * watch needs to know when this operator is due back, and restating the original duration
 * would push that time forward by however long they have already been out.
 */
function onStationPayload(): OnStationPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    callsign: loadIdentity()?.callsign ?? undefined,
    area: session?.area ?? 'unknown',
    expected_duration: Math.max(0, (session?.expectedUntil ?? now) - now),
    routine_interval: session?.routineInterval ?? null,
    share_position: position.current !== null,
    position: position.current
  };
}

/**
 * The executor's key goes with it, where the watch named one [G3]: the signals the executor acts on
 * are sealed to it as well, its answers are heard beside the watch key's, and only its answer — or
 * a holder's own signature — ends a `Distress` (`distressClosure` in core). Left out, every one of
 * those fell back to the watch key, which the daemon beside the agent holds.
 */
function watchAddress(config: { pubkey: string; holders: string[]; executor?: string }): WatchtowerAddress {
  return watchtowerAt(config.pubkey, config.holders, kemKeys(), config.executor);
}

/**
 * Who may end a `Distress` sent to this phone's watch, or null with no watch.
 *
 * `attributed` false is a box handed over before it named its escalation key: a person's answer
 * from it cannot be told apart from one the agent beside it sent, and Status says so.
 */
export function watchClosure(): DistressClosure | null {
  const config = loadConfig();
  return config ? distressClosure(watchAddress(config)) : null;
}

/** What became of asking the watch to wake the others. */
export interface WakeOutcome {
  /**
   * How many relays took it. None means no relay said so — and with no answer either, that it never
   * left this phone. With an answer, the watch heard it whatever the relays said back.
   */
  took: number;
  /** The watch's answer — accepted, with who is being paged, or refused and why — or null. */
  answer: ResponsePayload | null;
  /**
   * Whose key signed that answer. `executor`: the escalation executor's own, which only it holds.
   * `watch-key`: the watch key, which the daemon beside the agent also holds — on a watch that names
   * its executor, only ever shown as unconfirmed, because a compromised agent can send it.
   */
  from: 'executor' | 'watch-key' | null;
  /** Why it did not go, where it did not. */
  error: string | null;
}

/**
 * What cover this terminal's signals to the watch are actually getting, right now.
 *
 * Derived rather than remembered, so it can never say something that was true an hour ago.
 * `classical` is a supported outcome, not an error — it means somebody we send to has not
 * published a key, and the operator is told in one calm sentence rather than warned.
 */
export function watchCover(): Cover | null {
  const config = loadConfig();
  if (!config) return null;
  const address = watchAddress(config);
  return coverOf(address.holders, address.kem ?? {});
}

export const operator = {
  get session(): SignOn | null { return session; },
  /** Whether this device has an identity. The only genuinely required setup step. */
  get hasIdentity(): boolean { return loadIdentity() !== null; },
  get callsign(): string | null { return loadIdentity()?.callsign ?? null; },
  /**
   * Whether a Watchtower has been added.
   *
   * False is a **normal, complete** state — not an error and not half-finished setup. Most
   * of the app works without one, and nothing may imply otherwise.
   */
  get hasWatch(): boolean { return loadConfig() !== null; },
  /** A watch was added, and none of its relays can be reached from this page: it sends nowhere. */
  get watchStranded(): boolean { return loadConfig() === null && storedWatch() !== null; },
  get busy(): boolean { return busy; },
  get error(): string | null { return error; },
  get lastResponse(): ResponsePayload | null { return lastResponse; },
  get distress(): DistressPhase[] { return distressPhases; },
  /** True while the retry loop is alive. It ends on a human, or on the operator. */
  get distressRunning(): boolean { return distressRunning; },
  get distressRaisedAt(): number | null { return distressRaisedAt; },

  /**
   * Going out.
   *
   * **A local fact first, and a message to a watch second.** An operator with no watch is
   * still going out, and an app that refused to record that until somebody was listening
   * would be telling the commonest user their night does not count.
   *
   * So the session is set either way. If there is a watch, it is told, and what it said it
   * could do is kept with the entry.
   */
  async signOn(area: string, hours: number, routineMinutes: number | null) {
    const now = Math.floor(Date.now() / 1000);
    const state: WatchStatePayload = watch.state;
    // Where the watch was heard, as the receipt showed it before they committed [relay-lists §7].
    const where = heard.now();

    // Only while signed on, so nobody broadcasts from their kitchen.
    position.start();

    if (operator.hasWatch) {
      const payload: OnStationPayload = {
        callsign: loadIdentity()?.callsign ?? undefined,
        area,
        expected_duration: Math.round(hours * 3600),
        routine_interval: routineMinutes === null ? null : routineMinutes * 60,
        share_position: position.current !== null,
        position: position.current
      };
      const response = await run(() => send('on-station', payload));
      // A watch that did not answer does not stop the patrol. It is reported, and the
      // operator decides what that means -- the alternative is an app that refuses to let
      // somebody go out because a relay was slow.
      if (response) lastResponse = response;
    }

    session = {
      at: now,
      area,
      expectedUntil: now + Math.round(hours * 3600),
      toldAtSignOn:
        capabilitySentence(state, Math.floor(Date.now() / 1000)) +
        (where.asked && where.of > 0 ? ` ${heardLine(where.known ? where.on.length : null, where.of)}.` : ''),
      routineInterval: routineMinutes === null ? null : routineMinutes * 60
    };
    // Wipeable: tonight's data. Panic wipe removes it; identity survives.
    set('wipeable', 'signon', session);

    // Peers hear about it too, and they hear about it from nobody else -- there is no
    // watch in this path and no server holding a list. Republished on a heartbeat because
    // relays store none of it.
    void presence.announce(operator.presencePayload());
    presence.beat(() => (session ? operator.presencePayload() : null));

    // Being listed publicly rides on being signed on, and does nothing unless the operator
    // asked for it and has a card. That coupling is what bounds the mistake: somebody who
    // forgets this is on broadcasts a callsign and a metro while out, and nothing at all
    // the rest of the time.
    void announceListed();
    beatListed();

    // A watch that changes hands inherits nothing: the incoming holder's board is empty
    // until the operators on it say so themselves. This is that -- one signal, sent when
    // this device notices somebody else is answering now.
    //
    // It matters most for the operator who is already out. Without it they are invisible
    // to the new watch until their next routine check-in, which by default is an hour of
    // somebody believing they are being watched by a person who cannot see them.
    whenWatchChangesHands(() => {
      if (!session) return;
      void run(() => send('on-station', onStationPayload()));
    });
  },

  /** What peers are told. Coarse by construction, and nothing they did not agree to receive. */
  presencePayload() {
    const fix = position.current;
    return {
      callsign: loadIdentity()?.callsign ?? 'unnamed',
      status: (session ? 'out' : 'stood-down') as 'out' | 'stood-down',
      area: session?.area ?? null,
      until: session?.expectedUntil ?? Math.floor(Date.now() / 1000),
      // Present only where the operator chose it. Each heartbeat replaces the last, so a
      // peer holds where you are and never where you were.
      ...(fix ? { position: fix } : {})
    };
  },

  /**
   * *"I have this."* The only thing that stops the escalation ladder.
   *
   * The last missing piece of the paging path [2.5]. `distress-ack` has been a defined signal
   * with a 10-second budget — *"one tap, and somebody is waiting on it as they are waiting on
   * nothing else"* — the executor has accepted it, the roster can identify who sent it, and
   * **no client sent one.** The push notification told people to "acknowledge in the console",
   * because the control this replaces did not exist.
   *
   * The id comes from the page that woke them and cannot come from anywhere else: `20911` is
   * ephemeral, so a relay forwards it to whoever is subscribed at that instant and stores
   * nothing. A phone that was asleep finds the event gone.
   *
   * Deliberately not waiting for a response. The budget is ten seconds and the person is
   * standing there; `sendSignal` throws when no relay accepted, which is the only distinction
   * that matters to them — it went, or it did not and they must reach somebody another way.
   *
   * **Never called except by a person tapping.** A delivery receipt, a read receipt or an
   * app-open MUST NOT be routed here [signals.spec]: somebody whose phone buzzed is not
   * somebody who woke up, and an agent may never acknowledge at all [invariant 5].
   */
  async acknowledge(distressId: string) {
    const { config, identity } = ctx();
    await signal(targets(), identity.secretKey, watchAddress(config), 'distress-ack', { distress_id: distressId });
  },

  /**
   * *"Page everyone about this one."* Asks the watch to wake the rest of the roster about an
   * operator's attempt, for a person paged again about an operator they already acknowledged.
   *
   * From this phone's own key, the one on the roster, and sealed to the executor's key as well where
   * the watch names one (`readersOf` in core). **It never closes anything**: the executor answers it
   * by opening a ladder for that attempt, and nothing about it tells the operator a person has it
   * [`escalation.spec.md`, *Wake the others*].
   *
   * Waits for the watch's answer, because it is the only way the person who tapped learns whether
   * anybody else is being woken. The wait opens before the signal goes: a response is ephemeral,
   * and one that came back while a slow relay was still confirming would otherwise be missed.
   *
   * **Never called except by a person tapping**, as an acknowledgement is not.
   */
  async wakeOthers(attempt: string): Promise<WakeOutcome> {
    const none = (error: string): WakeOutcome => ({ took: 0, answer: null, from: null, error });
    if (!/^[0-9a-f]{64}$/.test(attempt)) {
      return none('The page did not say which Distress it was about, so there is nothing to send.');
    }
    let context: ReturnType<typeof ctx>;
    try {
      context = ctx();
    } catch (e) {
      return none(e instanceof Error ? e.message : String(e));
    }
    const { config, identity } = context;
    const address = watchAddress(config);
    /*
     * Core's gate, as every other signal goes through it: never to a mission relay, which keeps what
     * it is sent for good, whatever a config, a list or a backup says [review: live hole, phone].
     * `watchTargets()`, the one list for everything sent to the watch [relay-lists §5]. What each
     * relay said is not kept against this phone's last signal: a person on call sends this.
     */
    const relays = watchTargets();
    if (relays.length === 0) return none('every relay this watch names is one nothing is sent to.');
    const event = finalizeEvent(
      buildSignal(identity.secretKey, address, 'wake-others', { distress_id: attempt }, Math.floor(Date.now() / 1000)),
      identity.secretKey
    );
    /*
     * Two waits, opened before the signal goes, and told apart [review: live hole, phone].
     *
     * Where the watch names its executor, only the executor's own key answers for it. The watch key
     * is also held by the daemon the agent runs beside, and the signal is public — its author, the
     * watch and the `wake-others` tag — so a compromised agent could answer in milliseconds with
     * "Done, paging Raven" while nobody was paged, ahead of the executor's real refusal. So the
     * executor's answer is waited for the whole window, and the watch key's is shown only when the
     * executor's never came, and only as unconfirmed.
     */
    const executor = distressClosure(address).executor;
    const stop = new AbortController();
    const windowMs = (RESPONSE_WINDOW['wake-others'] ?? 10) * 1000;
    // Asserted rather than annotated, so the checks after the awaits are not narrowed to null.
    let own = null as ResponsePayload | null;
    let keyed = null as ResponsePayload | null;
    const hear = (key: string) =>
      waitForResponse(pool(), relays, identity.secretKey, identity.pubkey, key, event, windowMs, stop.signal).catch(
        () => null
      );
    const executorAnswer = executor ? hear(executor).then((p) => (own = p)) : Promise.resolve(null);
    const watchAnswer = hear(config.pubkey).then((p) => (keyed = p));
    const settled = () => Promise.all([executorAnswer, watchAnswer]);

    // Each relay on its own, as core's publish does: one address the pool cannot read refuses one
    // relay, not the whole list.
    const results = await Promise.allSettled(relays.map(async (url) => pool().publish([url], event)[0]));
    const took = results.filter((r) => r.status === 'fulfilled').length;
    const best = (): WakeOutcome | null =>
      own ? { took, answer: own, from: 'executor', error: null } : keyed ? { took, answer: keyed, from: 'watch-key', error: null } : null;

    if (took === 0) {
      /*
       * No relay said OK — a slow one runs out the pool's wait while it still forwards the signal —
       * but an answer already here means the watch heard it. Saying it never left would have told
       * the person nobody was being woken while the roster was being paged, and offered the button
       * again for a second tap the watch then refuses.
       */
      const heard = best();
      stop.abort();
      await settled();
      return heard ?? none('no relay took it.');
    }
    await (executor ? executorAnswer : watchAnswer);
    if (own) {
      stop.abort();
      await settled();
      return best()!;
    }
    // The executor's never came in the window; the watch key's, if any, has settled by now.
    await settled();
    return best() ?? { took, answer: null, from: null, error: null };
  },

  async routine() {
    const r = await ask(() => send('routine', {}));
    if (r) {
      lastResponse = r;
      // This is one of the two things that answer the watch's *"you are past the time you
      // gave"* -- and it clears the overdue on the board too, so the screen and the board
      // stop disagreeing. Only cleared on a send that actually landed.
      overdue.clear();
    }
  },

  async query(text: string) {
    // Area rides along so the watch can answer "nearest bed" without asking where you are.
    const r = await ask(() => send('query', area(text), 15_000));
    if (r) lastResponse = r;
  },

  /**
   * *"I ran out of socks."*
   *
   * Goes to the watch rather than to a named peer, which is a change from how this was
   * first sketched. Routing it peer-to-peer would have meant a new stored kind for
   * peer-directed notes — which is a general messaging surface, and a general messaging
   * surface is a chat app with one feature so far. The watch is already whoever is holding
   * things together tonight, and in a squad every holder reads the same board.
   *
   * An operator with no watch cannot send this, and does not need to: somebody patrolling
   * alone has no quartermaster either. They buy their own socks.
   */
  async resupply(text: string) {
    const r = await ask(() => send('resupply', area(text), 15_000));
    if (r) lastResponse = r;
  },

  async assist(urgency: 'soon' | 'now', text: string) {
    const r = await ask(() => send('assist', { urgency, ...area(text ? text : undefined) }, 15_000));
    if (r) lastResponse = r;
  },

  /**
   * Asks the watch what it has written about this operator, and checks the answer.
   *
   * The check is the point. A response carries entries, proofs and the root they are
   * against — all three from the watch — so verifying them against each other proves
   * nothing. `checkReview` accepts only a root this device saw published itself.
   *
   * `escalation` is a second, independent account — the executor's own log, not the
   * watch's — present only when the watch was configured to know where to find it. It is
   * checked the same way and just as honestly: this device has never seen that log's
   * commitment published anywhere, so `checkReview` will correctly say so rather than
   * quietly treating it as trusted. `null` means nothing to show, not "checked and clean."
   */
  async reviewLog(): Promise<{ own: ReviewCheck; escalation: ReviewCheck | null } | null> {
    const response = await ask(() => send('log-review', {}, 20_000));
    if (!response) return null;
    lastResponse = response;
    if (!response.review) return null;
    const identity = loadIdentity();
    if (!identity) return null;
    return {
      own: checkReview(response.review, seenRoots(), identity.pubkey),
      escalation: response.review.escalation
        ? checkReview(response.review.escalation, [], identity.pubkey)
        : null
    };
  },

  /**
   * Coming home.
   *
   * The close of the night, and it is written down whether or not anybody was watching. A
   * watch that confirms it by name is the better version -- *"Wren, 02:14, home"* -- and its
   * absence must not mean the patrol never happened.
   */
  async standDown(note?: string) {
    const current = session;
    let closedBy: string | undefined;

    if (operator.hasWatch) {
      const r = await ask(() => send('stood-down', {}));
      if (r) {
        lastResponse = r;
        if (r.responder?.kind === 'human') closedBy = r.responder.callsign;
      }
    }

    if (current) {
      recordPatrol({
        started: current.at,
        ended: Math.floor(Date.now() / 1000),
        area: current.area,
        ...(note?.trim() ? { note: note.trim() } : {}),
        ...(closedBy ? { closedBy } : {})
      });
    }

    // Told explicitly rather than by going quiet: silence is what a flat battery looks
    // like, and a peer should not have to guess which one it was.
    void presence.announce({
      callsign: loadIdentity()?.callsign ?? 'unnamed',
      status: 'stood-down',
      area: current?.area ?? null,
      until: Math.floor(Date.now() / 1000)
    });

    // Stops following and forgets the last fix. Standing down leaves nothing behind.
    position.stop();

    // No "no longer out" message, and none is needed: the public entry ages off the board
    // by itself. A phone that dies removes you the same way, which is the honest behaviour
    // for a board whose only claim is that somebody is out right now.
    stopListed();
    presence.stopBeat();

    session = null;
    clearField('wipeable', 'signon');
    // Home. Whatever the watch said about the window is spent, and it must not still be on
    // the screen next time this operator signs on.
    overdue.clear();
    return closedBy;
  },

  /**
   * Sends Distress and keeps sending until a human acknowledges this one.
   *
   * Never stops on its own. Every attempt is reported, including the ones that never left
   * the device — an operator who knows nothing is getting through can act on that. A person's
   * answer to an earlier Distress, which the watch repeats for a while, is reported as that
   * (`acknowledged-earlier`) and does not stop it [#0].
   */
  async raiseDistress(text: string) {
    distressPhases = [];
    error = null;
    distressRunning = true;
    distressRaisedAt = Date.now();
    /*
     * This Distress's own controller, compared on every callback.
     *
     * A wipe sets `distressController` to null. Anything this run reports after that -- a late
     * phase, the cancellation error, its own `finally` -- belongs to a Distress the operator has
     * already wiped, and must not reappear on their screen or re-lock the send button. A
     * stand-down leaves the controller in place, so its message is still shown.
     */
    const controller = new AbortController();
    distressController = controller;
    const current = () => distressController === controller;
    /** The watch's state, read where this `Distress` goes for as long as it runs [relay-lists §7]. */
    let reading: { close(): void } | null = null;
    try {
      // ctx() moved inside the try: found in robustness audit. It used to run before this
      // block even started, so its throw (no identity yet, or the ordinary Alone case of
      // no watch configured) propagated straight out of this async function as an unhandled
      // rejection -- the caller (distress/+page.svelte) fires this with no await and no
      // catch, so nothing here ever ran: `error` stayed null, `distressRunning` stayed
      // false. An operator who felt the hold complete got no signal that nothing was sent,
      // which is invariant 2 failing in exactly the way it forbids.
      const { config, identity } = ctx();
      /*
       * Where the watch is heard, read only now and only where the `Distress` goes: the read tells
       * those relays nothing the `Distress` does not, and the screen showed the count this phone
       * already held until it started [relay-lists §7]. Opened beside the first attempt, which waits
       * on nothing.
       */
      reading = heard.read(watchTargets(), config.pubkey);
      /*
       * `distressRelays`, the function: `watchTargets()` and the relays it leaves out, read again
       * before every attempt, so the relays the receipt counted are the relays this goes to, a relay
       * the watch adds is added [relay-lists §6], and each one nothing goes to is said with why.
       */
      await sendDistressUntilAcknowledged(
        pool(), distressRelays, identity.secretKey, identity.pubkey, watchAddress(config),
        // A Distress carries the last known fix where one exists, and the declared area
        // where it does not. Somewhere to start beats nothing to go on.
        {
          position: position.current,
          area: session?.area ?? null,
          ...(text ? { text } : {})
        },
        {
          signal: controller.signal,
          // Which relays that took an attempt the watch was heard on in the last five minutes.
          watchStateAgeMs: (url) => heard.stateAgeMs(url),
          onPhase: (p) => {
            if (!current()) return;
            if (p.phase === 'accounted') {
              // A relay that refused an attempt is not one the watch is heard on from this phone.
              heard.accounted(p);
              /*
               * "The watch heard on N" only where this phone had a count when the attempt was
               * accounted. Opened cold, the read starts beside the first attempt, and whether its
               * answer or the relays' OK came first decided between "heard on 0" and "heard on 1":
               * a person in distress reading "heard on 0" as nothing hearing them. Unknown is left
               * unsaid [invariant 7].
               */
              if (p.heard && !heard.known) {
                const said = { ...p };
                delete said.heard;
                distressPhases = [...distressPhases, said];
                return;
              }
            }
            distressPhases = [...distressPhases, p];
          }
        }
      );
    } catch (e) {
      if (current()) error = e instanceof Error ? e.message : String(e);
    } finally {
      // Closed whoever owns this state now: a read left open would go on asking for nothing.
      reading?.close();
      // A newer Distress, or a wipe, owns this state now.
      if (current()) {
        distressRunning = false;
        distressController = null;
      }
    }
  },

  /**
   * Stops a running Distress. **Only the operator calls this** — nothing else in the app
   * may, because a client that gives up on its own has failed silently.
   */
  standDownDistress() {
    distressController?.abort();
  },

  /**
   * Drops everything this module is holding, stops everything this phone is still sending,
   * and sends nothing new.
   *
   * A wipe clears storage; without this the screen would go on showing "On station —
   * Downtown" from a variable, which is the wipe appearing to have failed at the moment an
   * operator most needs to believe it worked.
   *
   * **It stops a Distress this phone is still sending, the public "out tonight" listing, and
   * following your position.** Decided 2026-09-13, after an audit found a wiped phone kept
   * transmitting all three while its owner believed it had gone quiet. The cost is real and
   * the wipe screen says it: somebody wiping because they are in trouble also silences their
   * own call for help.
   *
   * It still does **not** stand down. Standing down is a signal, and a signal is visible —
   * the operator wiping under duress is the last person who should be made to transmit. The
   * board entry is the watch's to forget.
   */
  forget() {
    distressController?.abort();
    // Released here rather than when the aborted run notices, which can be a relay round-trip
    // later: until then the send button stayed unavailable on a phone that had just been wiped.
    distressController = null;
    distressRunning = false;
    distressRaisedAt = null;
    stopListed();
    presence.stopBeat();
    position.stop();
    session = null;
    lastResponse = null;
    error = null;
    distressPhases = [];
    // What this phone saw of where its watch is heard: tonight's, and gone with the rest of it.
    heard.forget();
  }
};
