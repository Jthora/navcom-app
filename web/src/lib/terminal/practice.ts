/**
 * Practice (2026-11-04): the four things an operator sends, pressed against a pretend watch, so the
 * first time somebody holds Distress is not the night they need it.
 *
 * **Nothing here leaves the phone.** The pretend watch is this module: no key, no relay, no signal.
 * It is never the real screens pointed somewhere else, because a practice that rewired where a
 * Distress goes could be left rewired -- a tab closed mid-practice, a phone that crashed -- and the
 * next Distress would go to a watch that does not exist. The real one stays one tap away throughout.
 *
 * What it rehearses is what a person sees, in the order they see it: *Waiting for signal* with no
 * signal, *Waiting for the watch* until somebody answers, an answer that says how old its record is,
 * and *No watch to send it to* when there is none. The pretend watch says it is pretend on every
 * answer, as an agent says it is an agent [invariant 4], and it names no real place: a remembered
 * practice answer must never pass for directions.
 */
export type PracticeKind = 'check-in' | 'query' | 'assist' | 'distress';

export const PRETEND = 'Pretend watch';

/** How long the pretend watch takes, in ms: long enough to read *Waiting for the watch*, short enough to stay. */
export const ANSWER_MS: Record<PracticeKind, number> = {
  'check-in': 1500,
  query: 6000,
  assist: 4000,
  distress: 5000
};

/** How long the pretend signal stays away, in ms, when practising with none. */
export const SIGNAL_BACK_MS = 5000;

export interface PracticeItem {
  id: number;
  kind: PracticeKind;
  /** When it was pressed, in ms. */
  pressedAt: number;
  /** Practising with no signal: it waits, then goes by itself. */
  noSignal: boolean;
  /** Practising with no watch: nothing to send it to, said at once. */
  noWatch: boolean;
  urgency?: 'soon' | 'now';
}

export type PracticePhase = 'waiting-signal' | 'waiting' | 'answered' | 'no-watch';

/** Where a practice item is at `now`, and when it left the phone, if it has. */
export function phaseAt(item: PracticeItem, now: number): { phase: PracticePhase; sentAt: number | null } {
  if (item.noWatch) return { phase: 'no-watch', sentAt: null };
  const sentAt = item.noSignal ? item.pressedAt + SIGNAL_BACK_MS : item.pressedAt;
  if (now < sentAt) return { phase: 'waiting-signal', sentAt: null };
  if (now < sentAt + ANSWER_MS[item.kind]) return { phase: 'waiting', sentAt };
  return { phase: 'answered', sentAt };
}

/** What the pretend watch says back, as a readout: a value and its qualifier, pretend on every one. */
export function pretendAnswer(kind: PracticeKind): { value: string; sub: string } {
  switch (kind) {
    case 'check-in':
      return { value: 'Heard', sub: `${PRETEND} · nothing else happens` };
    case 'query':
      return { value: 'Example Drop-In', sub: `${PRETEND} · a directory record, checked 5 weeks ago · call first` };
    case 'assist':
      return { value: 'Passed on', sub: `${PRETEND} · to the nearest 3 out` };
    case 'distress':
      return { value: 'Answered', sub: `${PRETEND} · on a real night, the person who has it` };
  }
}

/** What each says with no watch to send it to: what the real screens say [distress, query]. */
export function noWatchSays(kind: PracticeKind): { value: string; sub: string } {
  switch (kind) {
    case 'check-in':
      return { value: 'Kept here', sub: 'on your own patrol record' };
    case 'distress':
      return { value: 'No watch to send it to', sub: 'text your person' };
    default:
      return { value: 'No watch', sub: 'text it to your person' };
  }
}
