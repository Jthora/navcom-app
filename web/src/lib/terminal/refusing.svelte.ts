/**
 * Relays refusing this phone for how much it sends, and the routine traffic held off them.
 *
 * A public relay limits each internet address by volume. Past its limit it answers `rate-limited:`,
 * and sending on draws a ban on the whole address that stops reads as well as writes: relay.damus.io
 * did both to this project's own machine on 2026-10-29 [groups.md §7]. So once a relay says either,
 * the routine beats — presence to peers, a watch's Station, *out tonight* — leave it alone for a
 * while instead of sending into the refusal, and go on to every other relay as before.
 *
 * **A `Distress` never comes through here, and neither does Dark or anything a person taps.** They
 * keep their own slow retries on every relay, so a relay that recovers hears them [invariant 2]. What
 * they are told is still noted, so Status can say which relay is refusing this phone, and that a
 * ban is on the address: anybody sharing the Wi-Fi or the carrier's address shares it.
 *
 * In memory: a reload starts clean, which costs at most one beat into a refusal.
 */
import type { Event } from 'nostr-tools/core';
import { pool } from './pool';

/** How long routine traffic stays off a relay after each kind of refusal. Repeated, it starts again. */
export const COOL_MS = { 'rate-limited': 10 * 60_000, banned: 60 * 60_000 } as const;

export type Refusal = keyof typeof COOL_MS;

export interface Refusing {
  url: string;
  why: Refusal;
  /** What the relay said, as it said it. */
  said: string;
  /** Milliseconds: when it was last said, and until when routine traffic stays off. */
  at: number;
  until: number;
}

let refusing = $state<Record<string, Refusing>>({});

/** The refusal a relay's words amount to, if they are about volume: NIP-01's prefix, or a ban. */
export function refusalOf(said: string): Refusal | null {
  const s = said.trim().toLowerCase();
  if (/^banned\b|\bbanned:/.test(s)) return 'banned';
  if (s.startsWith('rate-limited:')) return 'rate-limited';
  return null;
}

/** Notes what a relay answered. Anything but a volume refusal is left to the caller to report. */
export function heardFrom(url: string, said: string, now = Date.now()): void {
  const why = refusalOf(said);
  if (!why) return;
  // A ban outranks a rate limit it follows: it is what the relay is doing now.
  const was = refusing[url];
  const kind: Refusal = was && was.until > now && was.why === 'banned' ? 'banned' : why;
  refusing = { ...refusing, [url]: { url, why: kind, said: said.trim().slice(0, 140), at: now, until: now + COOL_MS[kind] } };
}

/** A relay that took something: whatever it said before is over. */
export function tookFrom(url: string): void {
  if (!(url in refusing)) return;
  const { [url]: _gone, ...rest } = refusing;
  refusing = rest;
}

/** The relays routine traffic may go to now: every one given, less those still cooling down. */
export function routineTo(urls: readonly string[], now = Date.now()): string[] {
  return urls.filter((url) => !(refusing[url] && refusing[url].until > now));
}

/** Relays refusing this phone now, longest-standing first. */
export function refusingNow(now = Date.now()): Refusing[] {
  return Object.values(refusing)
    .filter((r) => r.until > now)
    .sort((a, b) => a.at - b.at);
}

/**
 * Publishes routine traffic to each relay not cooling down, one at a time so each answer is its own,
 * and notes what each said. Resolves with the relays that took it.
 */
export async function sendRoutine(urls: readonly string[], event: Event, now = Date.now()): Promise<string[]> {
  return sendEach(routineTo(urls, now), event);
}

/** Publishes to every relay given, noting what each said: for what may not wait, as well as routine. */
export async function sendEach(urls: readonly string[], event: Event): Promise<string[]> {
  const results = await Promise.allSettled(
    urls.map((url) => {
      try {
        return pool().publish([url], event)[0] ?? Promise.reject(new Error('nothing to publish to'));
      } catch (e) {
        return Promise.reject(e);
      }
    })
  );
  const took: string[] = [];
  results.forEach((r, i) => {
    const url = urls[i]!;
    if (r.status === 'fulfilled') {
      tookFrom(url);
      took.push(url);
    } else {
      heardFrom(url, r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  });
  return took;
}

/**
 * Forgets every refusal, for tests. A wipe leaves them: they are about the network this phone is on,
 * not about anybody, and forgetting them would send the next beat straight into the refusal.
 */
export function forgetRefusals(): void {
  refusing = {};
}
