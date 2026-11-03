/**
 * What the live map draws: blips, each a person who chose to share where they are, or a place on
 * record somebody is going to (the owner's map decisions, 2026-11-03).
 *
 * **Never anybody else.** The watch sees everybody on its board who shares; an operator sees the
 * peers they paired with who share, and their own destination. Nobody being served is ever a blip,
 * and nothing here takes a coordinate from anywhere but a person's own phone or the directory
 * [invariant 1]. Each blip carries how old its fix is and how precise, because a dot reads as
 * *here, now* and is only ever *there, then* [invariant 7].
 */
import { isValidPosition, type BoardEntry, type Position } from '@navcom/core';

export type BlipKind = 'self' | 'operator' | 'place';
export type BlipState = 'out' | 'overdue' | 'distress';

export interface Blip {
  /** An operator's key, `self`, or a record's id. */
  id: string;
  kind: BlipKind;
  label: string;
  team: string | null;
  lat: number;
  lon: number;
  /** How far it may be from where it is drawn; 0 for exact. */
  precision_m: number;
  /** When its fix was heard, in this device's seconds; null for a place, which does not move. */
  at: number | null;
  state: BlipState | null;
  /** An Assist or a Distress of theirs the watch has not dealt with. */
  asking: 'assist' | 'distress' | null;
}

/** Past this, a blip is drawn hollow: nothing heard for three minutes is not the same as there. */
export const BLIP_STALE_SECONDS = 180;
/** Past this, it starts to fade. */
export const BLIP_AGING_SECONDS = 60;

export function freshness(b: Blip, now: number): 'fresh' | 'aging' | 'stale' {
  if (b.at === null) return 'fresh';
  const age = now - b.at;
  return age >= BLIP_STALE_SECONDS ? 'stale' : age >= BLIP_AGING_SECONDS ? 'aging' : 'fresh';
}

interface Asking {
  operator: string;
  callsign: string;
  type: string;
  position: Position | null;
  team?: string;
}

/** The watch's blips: everybody on its board who shares where they are, with what they are asking. */
export function watchBlips(entries: readonly BoardEntry[], waiting: readonly Asking[]): Blip[] {
  const asks = new Map<string, 'assist' | 'distress'>();
  for (const w of waiting) {
    if (w.type === 'distress') asks.set(w.operator, 'distress');
    else if (w.type === 'assist' && !asks.has(w.operator)) asks.set(w.operator, 'assist');
  }
  const out: Blip[] = [];
  for (const e of entries) {
    if (!e.position || e.position_at === null || !isValidPosition(e.position)) continue;
    out.push({
      id: e.operator,
      kind: 'operator',
      label: e.callsign,
      team: e.team ?? null,
      lat: e.position.lat,
      lon: e.position.lon,
      precision_m: e.position.precision_m,
      at: e.position_at,
      state: e.status === 'active' ? 'out' : e.status,
      asking: asks.get(e.operator) ?? null
    });
  }
  // Somebody asking from a fix, who is not on this board: a Distress before their sign-on was heard.
  for (const w of waiting) {
    if (out.some((b) => b.id === w.operator) || !w.position || !isValidPosition(w.position)) continue;
    if (w.type !== 'distress' && w.type !== 'assist') continue;
    out.push({
      id: w.operator,
      kind: 'operator',
      label: w.callsign,
      team: w.team ?? null,
      lat: w.position.lat,
      lon: w.position.lon,
      precision_m: w.position.precision_m,
      at: null,
      state: w.type === 'distress' ? 'distress' : 'out',
      asking: w.type === 'distress' ? 'distress' : 'assist'
    });
  }
  return out;
}

interface Peer {
  pubkey: string;
  callsign: string;
  heard: number;
  payload: { position?: unknown };
}

/** A place on record somebody is going to: the one an answer came from, or one opened by its id. */
export interface Destination {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** An operator's blips: themselves, the peers they paired with who share, and where they are going. */
export function operatorBlips(
  self: Position | null,
  now: number,
  peers: readonly Peer[],
  stateOf: (p: Peer) => string,
  destination: Destination | null
): Blip[] {
  const out: Blip[] = [];
  if (self && isValidPosition(self)) {
    out.push({ id: 'self', kind: 'self', label: 'You', team: null, lat: self.lat, lon: self.lon, precision_m: self.precision_m, at: now, state: null, asking: null });
  }
  for (const p of peers) {
    const at = p.payload.position;
    if (!isValidPosition(at)) continue;
    out.push({
      id: p.pubkey,
      kind: 'operator',
      label: p.callsign,
      team: null,
      lat: at.lat,
      lon: at.lon,
      precision_m: at.precision_m,
      at: p.heard,
      state: stateOf(p) === 'overdue' ? 'overdue' : 'out',
      asking: null
    });
  }
  if (destination && Number.isFinite(destination.lat) && Number.isFinite(destination.lon)) {
    out.push({ id: destination.id, kind: 'place', label: destination.name, team: null, lat: destination.lat, lon: destination.lon, precision_m: 0, at: null, state: null, asking: null });
  }
  return out;
}
