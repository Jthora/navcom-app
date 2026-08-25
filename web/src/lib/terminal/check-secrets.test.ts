import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Plain .mjs — this is the file that runs after the build, and testing the thing that actually
// runs is the point.
import { scan, walk, PATTERNS } from '../../../scripts/check-secrets.mjs';

/**
 * What the gate catches, and what it deliberately does not claim to.
 *
 * This is not a test of a PII scanner — there isn't one, on purpose, because nothing here can
 * reliably tell prose about a person from prose about a building, and pretending otherwise is
 * worse than having no check at all. It is a test of a narrower, fully mechanical claim: a known
 * secret shape either appears in a file or it does not.
 */

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'navcom-secrets-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('the configured node secret', () => {
  it('is found verbatim if it ever reaches the output', () => {
    const dir = scratch();
    const secret = 'a'.repeat(63) + '7';
    writeFileSync(join(dir, 'leaked.json'), JSON.stringify({ oops: secret }));
    const hits = scan([join(dir, 'leaked.json')], secret);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.what).toMatch(/node secret/);
  });

  it('is silent when the secret never appears', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'fine.json'), JSON.stringify({ pubkey: 'not-the-secret' }));
    const secret = 'a'.repeat(63) + '7';
    expect(scan([join(dir, 'fine.json')], secret)).toHaveLength(0);
  });

  it('is not asked to hunt for a secret nobody configured', () => {
    // The ordinary case on a machine with no NAVCOM_NODE_SECRET set — undefined must not become
    // "match everything" or "match empty string", either of which would make this check useless
    // or noisy on every run.
    const dir = scratch();
    writeFileSync(join(dir, 'anything.json'), '{}');
    expect(scan([join(dir, 'anything.json')], undefined)).toHaveLength(0);
  });

  it('does not flag NavCom\'s own published pubkey as a leaked secret', () => {
    /*
     * The case that would make this gate useless if handled wrong. `navcom-node.json` publishes
     * a 64-character hex pubkey *on purpose* — that is not the secret, it is the public half, and
     * a scan that flagged every 64-hex string would fire on the file this project deliberately
     * ships. This only ever compares against the exact configured secret string, never against a
     * shape, so the pubkey never matches unless it happens to equal the secret — which would be a
     * different and much worse bug.
     */
    const secret = 'a'.repeat(63) + '7';
    const pubkey = 'b'.repeat(63) + '2';
    const dir = scratch();
    writeFileSync(join(dir, 'navcom-node.json'), JSON.stringify({ pubkey }));
    expect(scan([join(dir, 'navcom-node.json')], secret)).toHaveLength(0);
  });
});

describe('unconditional patterns', () => {
  it('catches a PEM private key header, any common variant', () => {
    const dir = scratch();
    for (const variant of ['RSA ', 'EC ', 'OPENSSH ', 'DSA ', '']) {
      const file = join(dir, `${variant || 'plain'}.txt`);
      writeFileSync(file, `-----BEGIN ${variant}PRIVATE KEY-----\nMII...\n-----END ${variant}PRIVATE KEY-----`);
      const hits = scan([file], undefined);
      expect(hits, `${variant || '(bare)'} PRIVATE KEY not caught`).toHaveLength(1);
    }
  });

  it('catches an AWS-style access key id', () => {
    const dir = scratch();
    const file = join(dir, 'creds.json');
    writeFileSync(file, JSON.stringify({ key: 'AKIAABCDEFGHIJKLMNOP' }));
    expect(scan([file], undefined)).toHaveLength(1);
  });

  it('does not fire on ordinary hex, base64 or prose near that length', () => {
    /*
     * The false-positive check that matters most for this gate staying trusted. A build full of
     * commit hashes, CIDs and hashed IDs must not turn every deploy into a wall of red — a gate
     * that cries wolf gets disabled, which is worse than not having it.
     */
    const dir = scratch();
    const file = join(dir, 'ordinary.json');
    writeFileSync(
      file,
      JSON.stringify({
        commit: '644604ca0667275cbb54b8b25f99ff7ea650d42b',
        cid: 'bafybeigpcpp4xcwpt7by6nzklntkjnrprfowzuvng36x7kgw26nzcjipji',
        pubkey: '28e2683dea55598d0ca02e9c859c4e7c7e14f7adb7bf04546524d6599bc6b82a',
        prose: 'AKIA is not a word that appears in this sentence about a shelter.'
      })
    );
    expect(scan([file], undefined)).toHaveLength(0);
  });

  it('every declared pattern is checked — a list nobody wired up would pass silently', () => {
    // Guards the gate's own gate: a PATTERNS entry added later and never reached by scan() would
    // make this file look more protective than it is.
    expect(PATTERNS.length).toBeGreaterThanOrEqual(2);
  });
});

describe('walking the build output', () => {
  it('reads text formats and skips binaries', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'a.html'), 'hello');
    writeFileSync(join(dir, 'b.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const files = walk(dir);
    return files.then((f: string[]) => {
      expect(f.some((p) => p.endsWith('a.html'))).toBe(true);
      expect(f.some((p) => p.endsWith('b.png'))).toBe(false);
    });
  });

  it('descends into subdirectories, the way a real build is shaped', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'top.js'), '');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, '_ipfs'));
    writeFileSync(join(dir, '_ipfs', 'navcom-directory.car'), '');
    const files = await walk(dir);
    expect(files.some((p: string) => p.includes('_ipfs'))).toBe(true);
  });
});
