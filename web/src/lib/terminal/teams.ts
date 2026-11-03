/**
 * Tonight's teams of the watch this phone is under, or holds (2026-11-02).
 *
 * Carried in a version-2 watch code the watch signed, so sign-on can offer them and one typo does
 * not split a team in two on the board. Wipeable: which teams are out together is tonight's
 * arrangement, so a panic wipe takes it, a backup never holds it, and the next code brings it back.
 */
import { codeTeams } from '@navcom/core';
import { clearField, get, set } from './storage';

export function watchTeams(): string[] {
  const held = get<unknown>('wipeable', 'watch_teams');
  return Array.isArray(held) ? codeTeams(held) : [];
}

export function setWatchTeams(teams: readonly unknown[]): void {
  const named = codeTeams(teams);
  if (named.length > 0) set('wipeable', 'watch_teams', named);
  else clearField('wipeable', 'watch_teams');
}
