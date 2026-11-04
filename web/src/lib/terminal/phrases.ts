/**
 * Tonight's phrases, written ahead by whoever holds the watch (the joint night, 2026-11-04): the same
 * few answers come up all night — the drop-in on 30th is open, avoid 8th Avenue — and typing each
 * one again on a laptop at 1am is where the wait for an answer grows. One tap puts a phrase in the
 * answer box; nothing is sent until the holder presses Send.
 *
 * Wipeable: tonight's arrangement, as the teams are, so a panic wipe takes them and no backup holds
 * them. About places and conditions, never a person [invariant 1]: the holder writes them, and the
 * screen asks nothing it would not ask of an answer.
 */
import { TEXT_MAX } from '@navcom/core';
import { clearField, get, set } from './storage';

const FIELD = 'watch_phrases';
/** Enough for a night's common answers, few enough to read in one glance. */
export const PHRASES_MAX = 12;

export function phrases(): string[] {
  const held = get<unknown>('wipeable', FIELD);
  return Array.isArray(held) ? held.filter((p): p is string => typeof p === 'string' && p.trim() !== '').slice(0, PHRASES_MAX) : [];
}

/** One per line, as the holder typed them: blank lines dropped, each cut to what an answer may hold. */
export function setPhrases(lines: string): string[] {
  const list = [...new Set(lines.split('\n').map((l) => l.trim().slice(0, TEXT_MAX)).filter((l) => l !== ''))].slice(0, PHRASES_MAX);
  if (list.length > 0) set('wipeable', FIELD, list);
  else clearField('wipeable', FIELD);
  return list;
}
