/**
 * Whether this phone was offered "Verify five local listings" and what came of it [propagation.md,
 * Cold start]: offered once, never a gate, never repeated. Kept on this device only: an offer, not
 * part of who anybody is, so it travels in no kit and no backup.
 */
import { get, set } from './storage';

export type FiveOffer = 'open' | 'done' | 'declined';

export function fiveOffer(): FiveOffer {
  const v = get<string>('accruing', 'five_offer');
  return v === 'done' || v === 'declined' ? v : 'open';
}

export function setFiveOffer(v: Exclude<FiveOffer, 'open'>): void {
  set('accruing', 'five_offer', v);
}
