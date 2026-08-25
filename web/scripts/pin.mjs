/**
 * Handing the directory to somebody who will hold it.
 *
 * The archive and its identifier are computed by `car.mjs` with no network and no account —
 * content addressing is deterministic, so the identifier is real whether or not anybody has a
 * copy. This is the separate act of *somebody having a copy*, which is the half a CID cannot
 * do for itself.
 *
 * ## The default is that NavCom holds nothing
 *
 * The archive is published at `/_ipfs/navcom-directory.car` over ordinary HTTPS, and whoever
 * runs a node fetches it:
 *
 * ```
 * curl -sL https://navcom.app/_ipfs/navcom-directory.car | ipfs dag import
 * ```
 *
 * That is the documented arrangement and the one to prefer, for the reason the keyless distress
 * pager exists: **the thing doing the work holds nothing.** An RPC token is a bearer credential —
 * possession is authorization — and on a store shared with four other projects it can fill a
 * quota, enumerate what everyone holds, and, if the surface includes `pin/rm`, remove it. The
 * worst case is not storage cost; it is somebody pinning something that gets the shared account
 * terminated, which takes the whole network's permanence layer with it.
 *
 * A build environment is a poor home for a credential like that, and NavCom's is poorer than
 * most: its CI was deleted rather than repaired, so nothing verifies it between deploys.
 *
 * ## Pushing is opt-in, and it is the lesser option
 *
 * Set `IPFS_RPC_API_ENDPOINT` and `IPFS_RPC_API_KEY` and this will `dag/import` the archive at
 * deploy time, pinning **the directory root inside it** so the identifier NavCom publishes is the
 * one a gateway serves. That is genuinely useful — it happens without anybody remembering — and
 * it is bought by NavCom holding a key it would otherwise not need.
 *
 * Absent those variables, nothing here is wrong and nothing is missing. The archive is still
 * built, still identified, still published. Only the pulling is somebody else's to schedule.
 *
 * ## Why a pinning service rather than a node
 *
 * A public IPFS node announces its addresses to the global DHT, which is how retrieval works
 * and also means the machine's IP becomes publicly discoverable. Putting that on the box that
 * runs an always-on agent — one operator, one location — is the shape
 * [`bootstrap.spec.md`](../../docs/spec/bootstrap.spec.md) already refuses for Watchtowers: *a
 * list of them is a list of where operators are.* A hosted pin has no such surface, holds only
 * bytes that were already public, and costs nothing.
 *
 * It is **decorrelation, not sovereignty.** A free tier is still an account, and every real
 * outage this network has had was an account rather than a bug. What makes that survivable is
 * the property a URL does not have: if the pin goes, the identifier still resolves the moment
 * anybody else holds the same bytes. Two holders of one CID are interchangeable and need no
 * synchronisation between them.
 *
 * ## What it does when there are no credentials
 *
 * Skips, loudly, and exits zero. That is not politeness — the build runs on a laptop with no
 * credentials and must stay green there, and a pin step that failed the build locally would be
 * removed within a week. What it must never do is skip *quietly*: the receipt records that
 * nobody is holding it, so an absent pin reads as absent rather than as done.
 *
 * ## S3 signing, by hand — and unverified until it runs
 *
 * Sixty lines of well-specified HMAC against ~20 MB of SDK that would only ever run at build
 * time. The trade is deliberate and **the risk is real and currently unmitigated**: this was
 * written on a machine with no credentials, so no request has ever been signed by it. A
 * signing bug fails as an opaque 403 and nothing here can tell that apart from a wrong key.
 *
 * By this project's own rule that is *not built* — an integration that has never met a
 * counterparty is a claim, not a capability. The first real deploy is the test, `verify-pin.mjs`
 * is the independent check on what it produced, and until both have run the receipt says
 * nobody is holding anything.
 *
 * ## A failed pin does not fail the deploy
 *
 * It may fail. It may never fail *silently* — the same shape invariant 2 gives escalation. A
 * third party's outage must not stop NavCom shipping, and a pin that quietly did nothing must
 * not read as one that worked. So a failure is recorded in the receipt, printed in full, and
 * the build continues.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../build/_ipfs/', import.meta.url));

const sha256hex = (/** @type {Uint8Array|string} */ b) => createHash('sha256').update(b).digest('hex');

/**
 * Imports the archive over a Kubo-compatible RPC, pinning the directory root.
 *
 * Deliberately generic rather than written to one provider: `POST {endpoint}/api/v0/dag/import`
 * with a bearer token is what Filebase's RPC, a self-hosted Kubo behind an auth proxy, and
 * Mecha Jono's node all speak. Nothing here should need changing if the endpoint moves.
 *
 * Multipart is assembled by hand — it is a boundary and two headers, and a dependency for that
 * would be larger than the code.
 *
 * @param {{ endpoint: string, token: string, body: Uint8Array }} p
 */
export async function dagImport({ endpoint, token, body }) {
  const boundary = `----navcom${sha256hex(body).slice(0, 24)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="navcom-directory.car"\r\n' +
      'Content-Type: application/vnd.ipld.car\r\n\r\n'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const payload = Buffer.concat([head, Buffer.from(body), tail]);

  const url = `${endpoint.replace(/\/+$/, '')}/api/v0/dag/import?pin-roots=true`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: /** @type {BodyInit} */ (payload)
  });

  const text = await response.text().catch(() => '');

  /**
   * The service's own words, with the credential scrubbed out of them.
   *
   * Error bodies from auth proxies echo the request more often than anybody expects — and this
   * text is written into the sidecar, published in the health receipt, and printed in a build
   * log. A token arriving back in a 403 and recorded in all three would be the finding this
   * network spent three rounds closing on another node, reached by a route nobody was watching.
   *
   * Applied only when building a message, never before parsing. Scrubbing the response first
   * corrupts it — a short token appears inside ordinary JSON and the redaction eats the payload,
   * which a test caught by using a one-character token. The length guard is the other half of
   * that: anything under eight characters is not a credential worth protecting, and redacting it
   * would destroy the message a person needs in order to fix the real problem.
   *
   * @param {string} s
   */
  const scrub = (s) => (token.length >= 8 ? s.replaceAll(token, '<redacted>') : s);

  if (!response.ok) {
    return { root: null, error: `${response.status} ${response.statusText} — ${scrub(text).slice(0, 400)}` };
  }

  /*
   * NDJSON, one object per line. The root arrives as `{"Root":{"Cid":{"/":"bafy…"}}}` and a
   * `PinErrorMsg` beside it is a *failure wearing a 200* — the exact disguised-success shape
   * this project keeps finding, so it is read and reported rather than assumed absent.
   */
  let root = null;
  let pinError = null;
  for (const line of text.split('\n').filter((l) => l.trim())) {
    try {
      const parsed = JSON.parse(line);
      const cid = parsed?.Root?.Cid?.['/'];
      if (cid) root = cid;
      if (parsed?.Root?.PinErrorMsg) pinError = parsed.Root.PinErrorMsg;
    } catch {
      // A line that is not JSON is not a root. Keep looking.
    }
  }

  if (pinError) return { root, error: `imported but not pinned — ${scrub(pinError)}` };
  if (!root) return { root: null, error: `no root in the response — ${scrub(text).slice(0, 300)}` };
  return { root, error: null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sidecarPath = join(OUT, 'navcom-directory.json');
  if (!existsSync(sidecarPath)) {
    console.error('[pin] no archive — run `npm run car` first.');
    process.exit(1);
  }
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  const body = new Uint8Array(readFileSync(join(OUT, 'navcom-directory.car')));

  const endpoint = process.env.IPFS_RPC_API_ENDPOINT;
  const token = process.env.IPFS_RPC_API_KEY;

  if (!endpoint || !token) {
    /*
     * The default, not a deficiency — and the wording matters. An earlier version said
     * "skipped", which reads as something that failed to happen, and a build log that reports
     * the preferred arrangement as a shortfall is one somebody eventually "fixes" by adding a
     * credential nobody needed.
     *
     * What stays honest is the other half: the sidecar keeps saying nobody is holding it yet,
     * because that is true until a node pulls, and an unheld archive must never read as a held
     * one anywhere it is read.
     */
    console.log('[pin] no push credentials — the pull path is the default, and NavCom holds no key.');
    console.log('[pin]   curl -sL https://navcom.app/_ipfs/navcom-directory.car | ipfs dag import');
    console.log(`[pin] ${sidecar.held_by}`);
    process.exit(0);
  }

  console.log('[pin] pushing — note this is the opt-in path; the default is for a node to pull.');

  const { root, error } = await dagImport({ endpoint, token, body });

  if (error || !root) {
    sidecar.pin = { at: new Date().toISOString(), failed: error ?? 'no root returned' };
    sidecar.held_by = 'nobody — the import failed, see pin';
    writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
    console.error(`[pin] FAILED — ${sidecar.pin.failed}`);
    console.error('[pin] the deploy continues; nothing about the directory changed.');
    process.exit(0);
  }

  if (root !== sidecar.cid) {
    /*
     * The node imported the archive and arrived at a different root than the packer did, which
     * means one of the two computes identifiers the other would not recognise. Publishing either
     * would publish a number describing nothing. Reported, never reconciled — there is no version
     * of this worth guessing about.
     */
    sidecar.pin = {
      at: new Date().toISOString(),
      failed: `root mismatch — the node read this archive as ${root}, the packer wrote ${sidecar.cid}`
    };
    sidecar.held_by = 'nobody — the node and the packer disagree about what this archive is';
    writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
    console.error(`[pin] MISMATCH — ${sidecar.pin.failed}`);
    process.exit(0);
  }

  sidecar.pin = { at: new Date().toISOString(), endpoint: endpoint.replace(/\/+$/, ''), root, pinned: true };
  sidecar.held_by = `an ipfs node, as ${root}`;
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');

  console.log(`[pin] ${root} imported and pinned — the published identifier now resolves`);
  console.log('[pin] verify: npm run test:pin');
  process.exit(0);
}
