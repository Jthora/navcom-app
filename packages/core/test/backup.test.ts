/**
 * Carrying an identity to another phone, and getting it back after a dropped one.
 *
 * The blob is meant to live wherever the operator chooses — a note app, a USB stick, a
 * printout in a drawer. Every one of those is somewhere it can be found by somebody who
 * should not have it, so the passphrase is doing real work rather than ceremonial work.
 */

import { describe, expect, it } from 'vitest';
import { BACKUP_KDF, BackupError, isBackup, openBackup, sealBackup } from '../src/index.js';

const kit = { secret: 'a'.repeat(64), callsign: 'Wren', peers: [{ callsign: 'Raven' }] };

describe('a backup round trip', () => {
  it('comes back exactly as it went in', () => {
    expect(openBackup('correct horse battery', sealBackup('correct horse battery', kit))).toEqual(kit);
  });

  it('differs every time, even for the same data and passphrase', () => {
    // A fresh salt per backup. Two identical blobs would tell somebody holding both that
    // nothing had changed between them.
    expect(sealBackup('same', kit)).not.toBe(sealBackup('same', kit));
  });

  it('and differs because the salt is fresh, not only because the nonce is', () => {
    /*
     * The test above passes with a **hard-coded salt**, because NIP-44 picks a random nonce
     * either way — so it asserts what the AEAD does and says nothing about what this module
     * does. A fixed salt means one precomputation opens every backup ever made under a given
     * passphrase, which is the whole reason the salt is there.
     */
    const salts = [sealBackup('same', kit), sealBackup('same', kit)].map(
      (blob) => (JSON.parse(blob) as { salt: string }).salt
    );
    expect(salts[0]).not.toBe(salts[1]);
    expect(salts[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it('costs what it says it costs', () => {
    // A work factor is the security parameter most likely to be lowered by somebody with good
    // intentions and a slow test suite. Nothing about the code would look wrong afterwards.
    expect(BACKUP_KDF.N).toBe(2 ** 15);
    expect(BACKUP_KDF.dkLen).toBe(32);
  });

  it('reveals nothing in the clear', () => {
    const blob = sealBackup('pw', kit);
    expect(blob).not.toContain('Wren');
    expect(blob).not.toContain('Raven');
    expect(blob).not.toContain('a'.repeat(64));
  });
});

describe('what it refuses', () => {
  it('refuses an empty passphrase rather than encrypting in name only', () => {
    expect(() => sealBackup('', kit)).toThrow(BackupError);
    expect(() => sealBackup('   ', kit)).toThrow(BackupError);
  });

  it('refuses the wrong passphrase', () => {
    expect(() => openBackup('wrong', sealBackup('right', kit))).toThrow(BackupError);
  });

  it('says the same thing for a wrong passphrase as for a damaged blob', () => {
    // Deliberate. Telling them apart would tell somebody holding a stolen backup whether
    // they were getting closer, and an operator who mistyped tries again either way.
    const blob = sealBackup('right', kit);
    const damaged = JSON.stringify({ ...JSON.parse(blob), data: 'AAAA' });
    const wrong = (() => { try { openBackup('wrong', blob); } catch (e) { return (e as Error).message; } })();
    const broken = (() => { try { openBackup('right', damaged); } catch (e) { return (e as Error).message; } })();
    expect(wrong).toBe(broken);

    /*
     * The comparison above cannot fail.
     *
     * Both messages come from the same `throw`, so it asserts that one string equals itself —
     * it stays green if that string is changed to *"Wrong passphrase."*, which is precisely
     * the oracle this test exists to prevent. What has to be checked is the message itself:
     * it must leave both possibilities open, because a stolen backup plus a message that
     * names the passphrase tells the holder they are getting closer.
     */
    expect(wrong).toMatch(/passphrase/i);
    expect(wrong).toMatch(/damaged/i);
  });

  it('refuses anything that is not a backup', () => {
    for (const junk of ['', 'not json', '{}', '[]', '{"v":99,"salt":"aa","data":"bb"}']) {
      expect(() => openBackup('pw', junk), junk).toThrow(BackupError);
    }
  });
});

describe('telling a backup from a recovery code', () => {
  it('recognises a backup', () => {
    expect(isBackup(sealBackup('pw', kit))).toBe(true);
  });

  it('does not mistake a bare secret for one', () => {
    // A recovery code is the identity secret and nothing else -- printable, and restoring
    // who you are without what you hold.
    expect(isBackup('a'.repeat(64))).toBe(false);
  });
});

describe('a passphrase people can actually type', () => {
  it('normalises, so an accented character typed two ways still opens it', () => {
    // The same passphrase composed differently -- e + combining acute vs precomposed é --
    // is the same passphrase to a person, and a restore that fails for that reason is
    // indistinguishable from a lost identity.
    const blob = sealBackup('café north', kit);
    expect(openBackup('café north', blob)).toEqual(kit);
  });
});

describe('a passphrase as the person who typed it would recognise it', () => {
  it('opens when it was pasted with a trailing space', () => {
    // The blob is meant to live in a note app, a USB stick, a printout in a drawer — every
    // one of those is a place a passphrase gets pasted, and a paste carries a trailing
    // newline or space more often than not. Untrimmed, that made a backup permanently
    // unopenable, and because a wrong passphrase and a damaged blob are deliberately
    // indistinguishable the operator could never learn a space was the whole problem.
    const blob = sealBackup('correct horse', { kept: true });
    expect(openBackup('correct horse ', blob)).toEqual({ kept: true });
    expect(openBackup(' correct horse', blob)).toEqual({ kept: true });
    expect(openBackup('\ncorrect horse\n', blob)).toEqual({ kept: true });
  });

  it('opens one that was sealed with the stray space instead', () => {
    // Symmetric, because both sides go through the same place.
    const blob = sealBackup('correct horse ', { kept: true });
    expect(openBackup('correct horse', blob)).toEqual({ kept: true });
  });

  it('opens when the same characters were typed on a different keyboard', () => {
    // `café` is one code point or two depending on the keyboard, and they render the same.
    const precomposed = 'café';
    const decomposed = 'café';
    expect(precomposed).not.toBe(decomposed);
    expect(openBackup(decomposed, sealBackup(precomposed, { kept: true }))).toEqual({ kept: true });
  });

  it('still refuses a passphrase that is only whitespace', () => {
    // Trimming must not turn "no passphrase" into a passphrase.
    expect(() => sealBackup('   ', { kept: true })).toThrow();
    expect(() => sealBackup('\n\t', { kept: true })).toThrow();
  });

  it('still refuses an actually wrong passphrase', () => {
    const blob = sealBackup('correct horse', { kept: true });
    expect(() => openBackup('wrong horse', blob)).toThrow(/wrong passphrase/i);
  });
});
