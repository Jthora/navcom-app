/**
 * Being on station.
 *
 * Signing on is a deliberate act and never automatic — an operator who did not sign on is
 * not watched, and the terminal must never decide otherwise on their behalf.
 */

import {
  capabilitySentence,
  checkReview,
  sendDistressUntilAcknowledged,
  sendSignal,
  waitForResponse,
  type DistressPhase,
  type OnStationPayload,
  type ResponsePayload,
  type SignalType,
  type ReviewCheck,
  type WatchStatePayload
} from '@navcom/core';

import { loadConfig } from './config';
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
import { pool } from './pool';

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
    throw new Error(
      'This goes to a watch, and you have not added one. Nothing to send it to.'
    );
  }
  return { config, identity };
}

async function send(type: SignalType, payload: object, timeoutMs = 10_000) {
  const { config, identity } = ctx();
  const sent = await sendSignal(
    pool(), config.relays, identity.secretKey, watchAddress(config), type, payload as never
  );
  return waitForResponse(
    pool(), config.relays, identity.secretKey, identity.pubkey, config.pubkey, sent, timeoutMs
  );
}

/** Attaches the declared area, which is coarse by construction — it came from a sign-on. */
function area(text?: string) {
  return {
    ...(text === undefined ? {} : { text }),
    ...(session?.area ? { area: session.area } : {})
  };
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

function watchAddress(config: { pubkey: string; holders: string[] }): WatchtowerAddress {
  return watchtowerAt(config.pubkey, config.holders, kemKeys());
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
      toldAtSignOn: capabilitySentence(state, Math.floor(Date.now() / 1000)),
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

  async routine() {
    const r = await run(() => send('routine', {}));
    if (r) lastResponse = r;
  },

  async query(text: string) {
    // Area rides along so the watch can answer "nearest bed" without asking where you are.
    const r = await run(() => send('query', area(text), 15_000));
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
    const r = await run(() => send('resupply', area(text), 15_000));
    if (r) lastResponse = r;
  },

  async assist(urgency: 'soon' | 'now', text: string) {
    const r = await run(() => send('assist', { urgency, ...area(text ? text : undefined) }, 15_000));
    if (r) lastResponse = r;
  },

  /**
   * Asks the watch what it has written about this operator, and checks the answer.
   *
   * The check is the point. A response carries entries, proofs and the root they are
   * against — all three from the watch — so verifying them against each other proves
   * nothing. `checkReview` accepts only a root this device saw published itself.
   */
  async reviewLog(): Promise<ReviewCheck | null> {
    const response = await run(() => send('log-review', {}, 20_000));
    if (!response) return null;
    lastResponse = response;
    if (!response.review) return null;
    const identity = loadIdentity();
    if (!identity) return null;
    return checkReview(response.review, seenRoots(), identity.pubkey);
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
      const r = await run(() => send('stood-down', {}));
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

    session = null;
    clearField('wipeable', 'signon');
    return closedBy;
  },

  /**
   * Sends Distress and keeps sending until a human acknowledges.
   *
   * Never stops on its own. Every attempt is reported, including the ones that never left
   * the device — an operator who knows nothing is getting through can act on that.
   */
  async raiseDistress(text: string) {
    distressPhases = [];
    error = null;
    distressRunning = true;
    distressRaisedAt = Date.now();
    distressController = new AbortController();
    try {
      // ctx() moved inside the try: found in robustness audit. It used to run before this
      // block even started, so its throw (no identity yet, or the ordinary Alone case of
      // no watch configured) propagated straight out of this async function as an unhandled
      // rejection -- the caller (distress/+page.svelte) fires this with no await and no
      // catch, so nothing here ever ran: `error` stayed null, `distressRunning` stayed
      // false. An operator who felt the hold complete got no signal that nothing was sent,
      // which is invariant 2 failing in exactly the way it forbids.
      const { config, identity } = ctx();
      await sendDistressUntilAcknowledged(
        pool(), config.relays, identity.secretKey, identity.pubkey, watchAddress(config),
        // A Distress carries the last known fix where one exists, and the declared area
        // where it does not. Somewhere to start beats nothing to go on.
        {
          position: position.current,
          area: session?.area ?? null,
          ...(text ? { text } : {})
        },
        {
          signal: distressController.signal,
          onPhase: (p) => { distressPhases = [...distressPhases, p]; }
        }
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      distressRunning = false;
      distressController = null;
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
   * Drops everything this module is holding in memory, and sends nothing.
   *
   * A wipe clears storage; without this the screen would go on showing "On station —
   * Downtown" from a variable, which is the wipe appearing to have failed at the moment an
   * operator most needs to believe it worked.
   *
   * It deliberately does **not** stand down. Standing down is a signal, and a signal is
   * visible — the operator wiping under duress is the last person who should be made to
   * transmit. The board entry is the watch's, it is Live, and it expires on its own.
   */
  forget() {
    session = null;
    lastResponse = null;
    error = null;
    distressPhases = [];
  }
};
