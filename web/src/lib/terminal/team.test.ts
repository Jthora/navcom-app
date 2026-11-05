import { describe, expect, it } from 'vitest';
import { newTeamCode, readTeamLink, teamLink, TEAM_CODE_SECONDS } from './team.svelte';

describe('a team code', () => {
  it('is good for ten minutes, and reads back from its own link', () => {
    const code = newTeamCode(1_800_000_000);
    expect(code.expiresAt).toBe(1_800_000_000 + TEAM_CODE_SECONDS);
    expect(code.secret).toMatch(/^[0-9a-f]{64}$/);
    const link = teamLink(code);
    expect(link).toBe(`https://navcom.app/terminal/peers/#team=${code.secret}.${code.expiresAt}`);
    expect(readTeamLink(link)).toEqual(code);
    expect(readTeamLink(`#team=${code.secret}.${code.expiresAt}`)).toEqual(code);
  });

  it('is fresh every time', () => {
    expect(newTeamCode().secret).not.toBe(newTeamCode().secret);
  });

  it('is never read out of a one-person code, or out of anything malformed', () => {
    expect(readTeamLink(`https://navcom.app/terminal/peers/#${'a'.repeat(64)}`)).toBeNull();
    expect(readTeamLink(`#team=${'A'.repeat(64)}.1800000000`)).toBeNull();
    expect(readTeamLink(`#team=${'a'.repeat(63)}.1800000000`)).toBeNull();
    expect(readTeamLink(`#team=${'a'.repeat(64)}`)).toBeNull();
    expect(readTeamLink(`#team=${'a'.repeat(64)}.1800000000&x=1`)).toBeNull();
  });
});
