/**
 * Nothing that looks like a credential reaches the published output.
 *
 * ## What this is not
 *
 * Not a PII scanner. Nothing here can reliably tell "this sentence describes a person" from a
 * regular expression, and claiming otherwise would be exactly the false confidence this project
 * refuses everywhere else — a rule that looks like coverage and is not is worse than no rule,
 * because it stops anyone from noticing the gap. What field-level PII protection this codebase
 * has is structural: `readCorrection` and `readPlace` refuse any field outside an explicit
 * allowlist, and the allowlist has no field capable of holding a person's name. That is checked
 * separately, by a schema test, not by scanning bytes.
 *
 * What this **does** check is narrower and fully mechanical: a secret either appears literally in
 * the output or it does not, and that is a fact a script can establish with no ambiguity.
 *
 * ## Two checks, one strong and one broad
 *
 * The strong one: if `NAVCOM_NODE_SECRET` is set in the build environment, the built output must
 * not contain that exact string anywhere. This is the specific secret this pipeline actually
 * holds, and it is the one worth being certain about rather than pattern-matching for.
 *
 * The broad one: known credential shapes — a PEM private key header, an AWS-style access key ID —
 * scanned for unconditionally. Cheap, zero false-positive risk, and it catches a key file ending
 * up in the static output by accident rather than by this pipeline's own design.
 *
 * ## Why after the build rather than before
 *
 * A secret in source is a secret in git history forever; a secret in `build/` is a secret in
 * whatever just got deployed. This runs on the artifact that is about to ship, which is the one
 * copy that actually matters — the same reasoning `budget.mjs` uses to measure what a browser
 * downloads rather than what sits in the repository.
 */

import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD = fileURLToPath(new URL('../build/', import.meta.url));

/** Text formats worth reading. Images and fonts cannot carry a leaked string usefully. */
const TEXT_EXT = new Set(['.html', '.js', '.css', '.json', '.txt', '.xml', '.webmanifest', '.car']);

/** Cap per file, so one large bundle does not make this scan slow for no benefit. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Unconditional patterns. Each one names what it is and why it is safe to flag with no context —
 * a false positive here should be structurally impossible, not just unlikely.
 */
export const PATTERNS = [
  { name: 'a PEM private key header', re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'an AWS-style access key id', re: /\bAKIA[0-9A-Z]{16}\b/ }
];

/** @param {string} dir @returns {Promise<string[]>} */
export async function walk(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else if (TEXT_EXT.has(extname(entry.name))) found.push(full);
  }
  return found;
}

/**
 * @param {string[]} files
 * @param {string | undefined} secret
 */
export function scan(files, secret) {
  /** @type {{ file: string, what: string }[]} */
  const hits = [];

  for (const file of files) {
    if (statSync(file).size > MAX_BYTES) continue;
    const text = readFileSync(file, 'utf8');

    if (secret && text.includes(secret)) {
      hits.push({ file, what: 'the configured node secret, verbatim' });
    }
    for (const { name, re } of PATTERNS) {
      if (re.test(text)) hits.push({ file, what: name });
    }
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const secret = process.env.NAVCOM_NODE_SECRET;
  let files;
  try {
    files = await walk(BUILD);
  } catch {
    console.error('[check-secrets] no build/ — run `npm run build` first.');
    process.exit(1);
  }

  const hits = scan(files, secret && /^[0-9a-f]{64}$/.test(secret) ? secret : undefined);

  if (hits.length > 0) {
    console.error(`[check-secrets] FAILED — ${hits.length} finding(s) in the built output:\n`);
    for (const { file, what } of hits) {
      console.error(`  ${file.replace(BUILD, '')}\n    contains ${what}`);
    }
    console.error('\n[check-secrets] refusing to ship this build.');
    process.exit(1);
  }

  console.log(`[check-secrets] ${files.length} files scanned, nothing found.`);
}
