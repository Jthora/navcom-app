/**
 * NavCom's node key — the one identity this project has that is not a person's.
 *
 * ## What it is for, and what it emphatically is not
 *
 * It signs one thing: the artifact announcement (`30078`) that says *"my directory is now this
 * hash."* That is the whole job.
 *
 * It is **not** an operator key, **not** a Watchtower key, and **not** an authority. Being able
 * to verify it means this build pipeline published something — never that the claim is correct.
 * If it leaks, somebody can announce a hash NavCom never built, and what they still cannot do is
 * make bytes at that hash. A consumer that fetches and verifies is unharmed.
 *
 * That bound is why holding this key is acceptable when holding somebody else's RPC token is not.
 * The blast radius is NavCom's own reputation for a pointer, and it is rotatable by running this
 * again.
 *
 * ## The secret never reaches a terminal
 *
 * It is written to a file and the file is printed. Nothing about it goes to stdout, because this
 * network spent three consensus rounds closing a finding about a private key reaching a log, and
 * a build log is not the only place that happens — a screen recording, a shared terminal and a
 * scrollback all count.
 *
 *   node scripts/node-key.mjs
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const KEY_FILE = fileURLToPath(new URL('../.navcom-node-key', import.meta.url));
const hex = (bytes) => Buffer.from(bytes).toString('hex');

if (existsSync(KEY_FILE)) {
  /*
   * Refused rather than regenerated. Overwriting would silently orphan an identity that peers
   * may already have allowlisted — and the failure would not show up as an error, it would show
   * up weeks later as announcements nobody accepts. Rotation is deliberate: delete the file.
   */
  const secret = readFileSync(KEY_FILE, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    console.error(`[node-key] ${KEY_FILE} exists but is not a 64-character hex key. Refusing to touch it.`);
    process.exit(1);
  }
  const pub = getPublicKey(Uint8Array.from((secret.match(/../g) ?? []).map((b) => parseInt(b, 16))));
  console.log('[node-key] a key already exists — not regenerating.');
  console.log(`[node-key] pubkey  ${pub}`);
  console.log(`[node-key] npub    ${npubEncode(pub)}`);
  console.log('[node-key] to rotate deliberately: delete .navcom-node-key and run this again.');
  process.exit(0);
}

const secret = generateSecretKey();
const pub = getPublicKey(secret);

// Owner-readable only. It is still a secret sitting on a disk, and the next line says so.
writeFileSync(KEY_FILE, hex(secret) + '\n', { mode: 0o600 });

console.log('[node-key] generated.\n');
console.log(`  pubkey  ${pub}`);
console.log(`  npub    ${npubEncode(pub)}\n`);
console.log('  The two lines above are public — publish them, hand them to peers, put them in a ticket.');
console.log(`  The secret is in ${KEY_FILE} and was deliberately not printed.\n`);
console.log('  Next:');
console.log('    1. Copy the file contents into NAVCOM_NODE_SECRET in the build environment.');
console.log('    2. Deploy. The build publishes the pubkey at /.well-known/navcom-node.json,');
console.log('       so a peer can verify the identity independently rather than taking it from a message.');
console.log('    3. Give a peer the pubkey above for their allowlist.\n');
console.log('  This key signs artifact pointers and nothing else. It is not an operator key,');
console.log('  not a Watchtower key, and confers no authority — a valid signature proves this');
console.log('  pipeline said something, never that the something is true.');
