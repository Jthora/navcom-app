import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// Plain .mjs — this is the file that runs during a deploy.
import { dagImport } from '../../../scripts/pin.mjs';

/**
 * The archive going over the wire, against something that actually parses HTTP.
 *
 * The signer in `pin.test.ts` can only be checked for shape, because no credential exists here
 * to have a real service judge it. This is the half that *can* be exercised: a real Node HTTP
 * server receives the request, so the multipart body, the boundary, the headers and the query
 * are all parsed by something other than the code that wrote them.
 *
 * It is not a substitute for a real endpoint — this server was written here, and a counterparty
 * you built is the defect class this project spent a day cataloguing. What it does rule out is
 * the whole family of hand-assembly bugs that would otherwise first appear as an opaque error
 * from a stranger's server at deploy time, with the wrong thing to look at.
 *
 * The case worth the most is the last one: a **200 carrying a pin failure.** That is disguised
 * success, and it is the exact shape this project keeps finding in other people's integrations.
 */

let server: Server;
let url: string;
/** What the last request actually carried, so the assertions inspect the wire rather than intent. */
let seen: { auth?: string; type?: string; path?: string; body: Buffer } = { body: Buffer.alloc(0) };
/** What the server should answer with, set per test. */
let reply = { status: 200, body: '' };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen = {
        auth: req.headers.authorization,
        type: req.headers['content-type'],
        path: req.url,
        body: Buffer.concat(chunks)
      };
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const ROOT = 'bafybeigpcpp4xcwpt7by6nzklntkjnrprfowzuvng36x7kgw26nzcjipji';
const archive = new TextEncoder().encode('a car file, near enough for the wire');
/** Realistic length. A one-character token is not a credential, and pretending otherwise in a
 *  fixture hid a redaction bug that ate the response body. */
const TOKEN = 'rpc-token-long-enough-to-be-real';

describe('what it puts on the wire', () => {
  beforeAll(() => {
    reply = { status: 200, body: JSON.stringify({ Root: { Cid: { '/': ROOT }, PinErrorMsg: '' } }) };
  });

  it('asks the node to pin the roots, not merely to hold the blocks', async () => {
    // Without `pin-roots` an import can be garbage-collected away, which would be a pin that
    // vanishes quietly — the receipt would say held, and nothing would be.
    await dagImport({ endpoint: url, token: TOKEN, body: archive });
    expect(seen.path).toBe('/api/v0/dag/import?pin-roots=true');
  });

  it('does not double the slash when the endpoint has a trailing one', async () => {
    await dagImport({ endpoint: `${url}/`, token: TOKEN, body: archive });
    expect(seen.path).toBe('/api/v0/dag/import?pin-roots=true');
  });

  it('sends the token as a bearer credential', async () => {
    await dagImport({ endpoint: url, token: TOKEN, body: archive });
    expect(seen.auth).toBe(`Bearer ${TOKEN}`);
  });

  it('sends the archive bytes intact inside the multipart body', async () => {
    /*
     * The assertion that matters for hand-assembled multipart: a boundary that disagrees with
     * the header, a missing CRLF, or an off-by-one in the trailer all produce a body a server
     * rejects for reasons that have nothing to do with the content. Here the bytes go through
     * Node's HTTP stack and come out the other side to be compared.
     */
    await dagImport({ endpoint: url, token: TOKEN, body: archive });

    const boundary = /boundary=(.+)$/.exec(seen.type ?? '')?.[1];
    expect(boundary, 'the content-type must declare a boundary').toBeTruthy();
    expect(seen.body.includes(`--${boundary}`)).toBe(true);
    expect(seen.body.subarray(-`\r\n--${boundary}--\r\n`.length).toString()).toBe(`\r\n--${boundary}--\r\n`);
    expect(seen.body.includes('application/vnd.ipld.car')).toBe(true);
    expect(seen.body.includes(Buffer.from(archive))).toBe(true);
  });

  it('reads the root out of the NDJSON response', async () => {
    const { root, error } = await dagImport({ endpoint: url, token: TOKEN, body: archive });
    expect(error).toBeNull();
    expect(root).toBe(ROOT);
  });

  it('finds the root even when the node narrates first', async () => {
    // Kubo emits progress lines before the result. A parser that read only the first line would
    // return nothing and report a failure that did not happen.
    reply = {
      status: 200,
      body: `{"Stats":{"BlockCount":338}}\n{"Root":{"Cid":{"/":"${ROOT}"},"PinErrorMsg":""}}\n`
    };
    const { root, error } = await dagImport({ endpoint: url, token: TOKEN, body: archive });
    expect(error).toBeNull();
    expect(root).toBe(ROOT);
  });
});

describe('failures that arrive looking like successes', () => {
  it('treats a pin error inside a 200 as a failure', async () => {
    /*
     * The one this file exists for. The node accepted the archive, answered 200, and did not
     * pin it — so a caller reading only the status code records a holder that is not holding
     * anything. That is the disguised-success shape, and it is worth more than any of the
     * happy-path assertions above.
     */
    reply = {
      status: 200,
      body: JSON.stringify({ Root: { Cid: { '/': ROOT }, PinErrorMsg: 'pin: context deadline exceeded' } })
    };
    const { error } = await dagImport({ endpoint: url, token: TOKEN, body: archive });
    expect(error).toMatch(/imported but not pinned/i);
    expect(error).toMatch(/deadline exceeded/i);
  });

  it('reports a 200 that carries no root at all', async () => {
    reply = { status: 200, body: '{"Stats":{"BlockCount":0}}\n' };
    const { root, error } = await dagImport({ endpoint: url, token: TOKEN, body: archive });
    expect(root).toBeNull();
    expect(error).toMatch(/no root/i);
  });

  it('survives a response that is not JSON rather than throwing', async () => {
    // An auth proxy in front of a node answers with HTML far more often than anybody expects.
    reply = { status: 200, body: '<html><body>Gateway Timeout</body></html>' };
    const { root, error } = await dagImport({ endpoint: url, token: TOKEN, body: archive });
    expect(root).toBeNull();
    expect(error).toMatch(/no root/i);
  });

  it('passes the service’s own words through on a refusal', async () => {
    // A build log that says "403" and nothing else sends somebody to read the wrong code.
    reply = { status: 403, body: 'invalid api key' };
    const { root, error } = await dagImport({ endpoint: url, token: 'wrong-but-long-enough', body: archive });
    expect(root).toBeNull();
    expect(error).toMatch(/403/);
    expect(error).toMatch(/invalid api key/);
  });
});

describe('the credential does not come back out', () => {
  /**
   * The error text is written into the sidecar, published in the health receipt and printed in a
   * build log. Auth proxies echo the request in error bodies far more often than anybody expects,
   * so a token arriving back in a 403 would be recorded in all three — which is the finding this
   * network spent three rounds closing on another node, reached by a route nobody was watching.
   *
   * Cheap to prevent, invisible until it has already happened, and worth a test on its own.
   */
  it('scrubs the token out of whatever the service says back', async () => {
    const token = 'sk-live-do-not-log-this';
    reply = { status: 403, body: `rejected credential Bearer ${token} for this bucket` };
    const { error } = await dagImport({ endpoint: url, token, body: archive });

    expect(error).not.toContain(token);
    expect(error).toContain('<redacted>');
    // Still useful afterwards — a redacted message must not become an unreadable one.
    expect(error).toMatch(/403/);
    expect(error).toMatch(/rejected credential/);
  });

  it('leaves a legitimate response intact rather than eating it', async () => {
    /*
     * The bug the one-character fixture exposed: scrubbing the body before parsing meant a short
     * token matched inside ordinary JSON and destroyed the payload, so a perfectly good import
     * reported "no root". Redaction belongs on the message, never on the data.
     */
    reply = { status: 200, body: JSON.stringify({ Root: { Cid: { '/': ROOT }, PinErrorMsg: '' } }) };
    const { root, error } = await dagImport({ endpoint: url, token: 'tt', body: archive });
    expect(error).toBeNull();
    expect(root).toBe(ROOT);
  });

  it('scrubs it from a 200 that echoes it too', async () => {
    const token = 'sk-live-do-not-log-this';
    reply = { status: 200, body: `{"Stats":{"note":"auth ${token}"}}` };
    const { error } = await dagImport({ endpoint: url, token, body: archive });
    expect(error ?? '').not.toContain(token);
  });
});
