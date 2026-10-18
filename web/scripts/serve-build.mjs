#!/usr/bin/env node
/**
 * Serves `build/` to the browser suite: the directory Vercel deploys, with the host's rules
 * from `vercel.json` applied.
 *
 * ## Why not `vite preview`
 *
 * `vite preview` does not serve `build/`. It serves `.svelte-kit/output` with SvelteKit's
 * server behind it. So everything that happens to `build/` after `vite build` (`prune-data`,
 * `slim-html`, the `.well-known` files) never reached a browser test, and a path the static
 * host answers with a 404 could still render through the SSR fallback. It also caches its file
 * list when it starts (sirv). A server that outlived a rebuild then 404s the new chunks and
 * nothing hydrates, which looks exactly like a hydration bug in the screen under test.
 *
 * ## What this does
 *
 * - Reads the disk on every request. It keeps no file list and no cache.
 * - Takes `headers`, `redirects`, `trailingSlash` and `outputDirectory` from `vercel.json`
 *   when it starts. It refuses to start on any other key that changes what is served, so a rule
 *   added there cannot quietly be missing here.
 * - Answers a missing path with `404.html` and a 404, as Vercel does for static output.
 * - Says which server it is on every response (`IDENTITY_HEADER`), so a run can tell it from
 *   `vite preview` or from a copy of itself started before an edit.
 * - Listens on loopback only.
 *
 * Not modelled: compression, ETags and 304s, range requests, query strings on redirects, and
 * Vercel's own response headers. Tests here assert none of them. Add one before a test relies
 * on it.
 *
 * ## One port per checkout
 *
 * The port comes from `NAVCOM_E2E_PORT`, or else from a hash of this checkout's path. A fixed
 * port with "reuse whatever is listening" meant a run in one worktree could test another
 * worktree's build. Anything already on the port is refused, with the reason, unless it is
 * this server, started from this checkout as it stands, over this directory (`probe` below).
 *
 * ## Which directory
 *
 * Always `vercel.json`'s `outputDirectory`, for the browser suite. There is no environment
 * override: specs such as `board-reload.spec.ts` and `landing.spec.ts` read `web/build`
 * directly, so a suite served some other directory would load one build in the browser and
 * assert against another. `--root` serves another directory by hand.
 *
 *   node scripts/serve-build.mjs [--port N] [--root DIR]
 *   node scripts/serve-build.mjs --probe [--port N] [--root DIR]
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
/** `web/`, the checkout this script belongs to. */
export const WEB = fileURLToPath(new URL('../', import.meta.url));
/** The repository root, which `vercel.json` and its `outputDirectory` are relative to. */
export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const VERCEL_JSON = join(REPO, 'vercel.json');

/** The range a hashed port falls in: below Linux's ephemeral range, clear of the usual dev ports. */
const PORT_BASE = 24100;
const PORT_SPAN = 700;

/** Keys of `vercel.json` that change nothing about what a request gets back. */
const INERT = new Set([
  '$schema',
  'buildCommand',
  'installCommand',
  'devCommand',
  'ignoreCommand',
  'framework',
  'outputDirectory'
]);
/** Keys this server implements. Anything else is refused, not ignored. */
const IMPLEMENTED = new Set(['headers', 'redirects', 'trailingSlash']);

/** Vercel's default for a static file that no `headers` rule covers. */
const DEFAULT_CACHE = 'public, max-age=0, must-revalidate';

/**
 * Sent on every response: which server code, which `vercel.json` and which directory this
 * process started with, as `script=… vercel=… root=…`, each a truncated SHA-256.
 *
 * `/version.json` alone names the build, not the server. `vite preview` of the same build
 * answers it with the same bytes from `.svelte-kit/output`, and a server started before an edit
 * to `vercel.json` or to this file still serves the current `build/` (it reads the disk live)
 * with the old headers, redirects or code. All of those passed as "same".
 */
export const IDENTITY_HEADER = 'x-navcom-serve-build';
const IDENTITY_PARTS = /** @type {const} */ (['script', 'vercel', 'root']);

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.car': 'application/vnd.ipld.car'
};

/**
 * @typedef {{ match: RegExp, destination: string, status: number }} Redirect
 * @typedef {{ match: RegExp, headers: { key: string, value: string }[] }} HeaderRule
 * @typedef {{
 *   headers: HeaderRule[],
 *   redirects: Redirect[],
 *   trailingSlash: boolean | undefined,
 *   outputDirectory: string,
 *   digest: string
 * }} HostRules
 * `digest` is of the `vercel.json` bytes the rules were read from, for `IDENTITY_HEADER`.
 */

/** @param {string | Buffer} bytes */
const digestOf = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/**
 * What `IDENTITY_HEADER` says for a server running this file's current code, with rules read
 * from a `vercel.json` whose bytes digest to `vercelDigest`, over `root`.
 *
 * @param {string} root
 * @param {string} vercelDigest
 */
export function identityOf(root, vercelDigest) {
  return `script=${digestOf(readFileSync(HERE))} vercel=${vercelDigest} root=${digestOf(realpathSync(root))}`;
}

/**
 * A `vercel.json` `source` as a regular expression, strict and case-sensitive as Vercel's
 * routing matches it.
 *
 * Only the syntax `vercel.json` uses today: literal text and `( … )` groups. A named parameter,
 * a modifier or a nested group throws, because a pattern read wrongly here would match a
 * different set of paths from production's without anything saying so.
 *
 * @param {string} source
 * @returns {RegExp}
 */
export function compileSource(source) {
  if (typeof source !== 'string' || !source.startsWith('/')) {
    throw new Error(`vercel.json source ${JSON.stringify(source)} does not start with "/"`);
  }
  let re = '^';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '(') {
      const end = source.indexOf(')', i);
      const inner = source.slice(i + 1, end);
      if (end === -1 || inner.includes('(')) {
        throw new Error(`vercel.json source ${source}: nested or unclosed groups are not implemented here`);
      }
      re += `(${inner})`;
      i = end;
    } else if (':*+?{}'.includes(c)) {
      throw new Error(
        `vercel.json source ${source}: "${c}" outside a group is not implemented here. Add it to serve-build.mjs before relying on it`
      );
    } else {
      re += c.replace(/[.\\^$|[\]]/g, '\\$&');
    }
  }
  return new RegExp(re + '$');
}

/**
 * The host's rules, read from `vercel.json` rather than copied.
 *
 * @param {string} [file]
 * @returns {HostRules}
 */
export function hostRules(file = VERCEL_JSON) {
  const bytes = readFileSync(file);
  /** @type {Record<string, any>} */
  const config = JSON.parse(bytes.toString('utf8'));
  const unknown = Object.keys(config).filter((k) => !INERT.has(k) && !IMPLEMENTED.has(k));
  if (unknown.length) {
    throw new Error(
      `vercel.json sets ${unknown.join(', ')}, which serve-build.mjs does not implement. ` +
        'The browser suite would test a site the host does not serve. Implement it there first.'
    );
  }
  const conditional = [...(config.headers ?? []), ...(config.redirects ?? [])].filter(
    (r) => r.has !== undefined || r.missing !== undefined
  );
  if (conditional.length) {
    throw new Error(`vercel.json uses has/missing on ${conditional.map((r) => r.source).join(', ')}, which serve-build.mjs does not implement`);
  }
  if (config.trailingSlash !== undefined && typeof config.trailingSlash !== 'boolean') {
    throw new Error(`vercel.json trailingSlash must be true, false or absent, not ${JSON.stringify(config.trailingSlash)}`);
  }
  return {
    headers: (config.headers ?? []).map((/** @type {any} */ r) => ({
      match: compileSource(r.source),
      headers: r.headers
    })),
    redirects: (config.redirects ?? []).map((/** @type {any} */ r) => ({
      match: compileSource(r.source),
      destination: r.destination,
      status: r.statusCode ?? (r.permanent === false ? 307 : 308)
    })),
    trailingSlash: config.trailingSlash,
    outputDirectory: config.outputDirectory ?? 'web/build',
    digest: digestOf(bytes)
  };
}

/**
 * The directory the browser suite is served: `vercel.json`'s `outputDirectory`, and nothing an
 * environment variable can change (see "Which directory" above).
 *
 * @param {HostRules} [rules]
 */
export function rootFor(rules = hostRules()) {
  return resolve(join(REPO, rules.outputDirectory));
}

/**
 * This checkout's port: `NAVCOM_E2E_PORT` if set, else a hash of the checkout's real path, so
 * two worktrees running the suite at once never meet on one port.
 *
 * @param {string} [checkout]
 * @param {NodeJS.ProcessEnv} [env]
 */
export function portFor(checkout = WEB, env = process.env) {
  const fixed = env['NAVCOM_E2E_PORT'];
  if (fixed) {
    const n = Number(fixed);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) {
      throw new Error(`NAVCOM_E2E_PORT must be a port from 1024 to 65535, not ${JSON.stringify(fixed)}`);
    }
    return n;
  }
  // FNV-1a: stable across runs and machines, and nothing here needs it to be more than that.
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(realpathSync(checkout))) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return PORT_BASE + (h % PORT_SPAN);
}

/** @param {string} path */
function statOf(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * The file a path names under `root`, or null. A directory answers with its `index.html`,
 * with or without the trailing slash: with `trailingSlash` absent, Vercel redirects neither
 * form and serves the directory's index for both.
 *
 * @param {string} root real path of the served directory
 * @param {string} pathname as requested, still percent-encoded
 */
function locate(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = resolve(root, '.' + decoded);
  if (full !== root && !full.startsWith(root + sep)) return null;
  const st = statOf(full);
  if (st?.isFile()) return pathname.endsWith('/') ? null : full;
  if (st?.isDirectory()) {
    const index = join(full, 'index.html');
    if (statOf(index)?.isFile()) return index;
  }
  return null;
}

/**
 * Where Vercel's `trailingSlash` rule sends a path, or null if it leaves it alone.
 *
 * @param {string} pathname
 * @param {boolean | undefined} mode
 */
function slashRedirect(pathname, mode) {
  if (mode === true && !pathname.endsWith('/')) {
    const last = pathname.slice(pathname.lastIndexOf('/') + 1);
    // "Paths with a file extension will not redirect to a trailing slash."
    return last.includes('.') ? null : pathname + '/';
  }
  if (mode === false && pathname !== '/' && pathname.endsWith('/')) return pathname.replace(/\/+$/, '') || '/';
  return null;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} file
 * @param {number} status
 * @param {Record<string, string>} extra
 */
function send(req, res, file, status, extra) {
  const st = statOf(file);
  if (!st?.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(status, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': st.size,
    'cache-control': DEFAULT_CACHE,
    ...extra
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

/**
 * The request handler: the host's rules in Vercel's order (trailing slash, redirects, headers),
 * then the filesystem, then `404.html`.
 *
 * @param {{ root: string, rules: HostRules }} options
 * @returns {import('node:http').RequestListener}
 */
export function handler({ root, rules }) {
  const base = realpathSync(root);
  const identity = identityOf(base, rules.digest);
  return (req, res) => {
    // On every answer, refusals and 404s included, so `probe` can tell this server from any other.
    res.setHeader(IDENTITY_HEADER, identity);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const path = url.pathname;

    const slashed = slashRedirect(path, rules.trailingSlash);
    if (slashed) {
      res.writeHead(308, { location: slashed + url.search });
      res.end();
      return;
    }
    for (const r of rules.redirects) {
      const m = r.match.exec(path);
      if (m) {
        res.writeHead(r.status, { location: r.destination.replace(/\$(\d+)/g, (_, n) => m[Number(n)] ?? '') });
        res.end();
        return;
      }
    }

    /** @type {Record<string, string>} */
    const extra = {};
    for (const rule of rules.headers) {
      if (rule.match.test(path)) for (const { key, value } of rule.headers) extra[key.toLowerCase()] = value;
    }

    const file = locate(base, path);
    if (file) send(req, res, file, 200, extra);
    else send(req, res, join(base, '404.html'), 404, extra);
  };
}

/**
 * @param {import('node:http').Server} server
 * @param {number} port
 * @param {string} host
 * @returns {Promise<void>}
 */
function listen(server, port, host) {
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      server.off('error', fail);
      done();
    });
  });
}

/**
 * Starts serving. Binds IPv4 loopback, and IPv6 loopback where the machine has it, because
 * `localhost` resolves to either and a second process on `::1` would otherwise answer half of
 * the suite's requests.
 *
 * @param {{ root: string, port: number, rules?: HostRules, hosts?: string[] }} options
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export async function serve({ root, port, rules = hostRules(), hosts = ['127.0.0.1', '::1'] }) {
  const handle = handler({ root, rules });
  /** @type {import('node:http').Server[]} */
  const servers = [];
  let bound = port;
  // Drops kept-alive sockets too: `fetch` holds one open, and `close` alone then waits on it for seconds.
  const close = () =>
    Promise.all(
      servers.map(
        (s) =>
          new Promise((done) => {
            s.close(() => done(undefined));
            s.closeAllConnections();
          })
      )
    ).then(() => undefined);
  for (const host of hosts) {
    const server = createServer(handle);
    try {
      await listen(server, bound, host);
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      if (host === '::1' && (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT')) continue;
      await close();
      throw err;
    }
    servers.push(server);
    const address = server.address();
    if (bound === 0 && address && typeof address === 'object') bound = address.port;
  }
  return { port: bound, close };
}

/**
 * `GET /version.json` on a fresh connection, never a pooled one.
 *
 * `fetch` keeps a connection alive and reuses it, so a probe after the server had gone sent its
 * request down the dead socket and read ECONNRESET, a port held, where a new connection would
 * have been refused, a port free.
 *
 * @param {number} port
 * @returns {Promise<{ status: number, identity: string | null, body: Buffer }>}
 */
function versionOn(port) {
  return new Promise((done, fail) => {
    const req = request({ host: 'localhost', port, path: '/version.json', agent: false, timeout: 5_000 }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', fail);
      res.on('end', () => {
        const identity = res.headers[IDENTITY_HEADER];
        done({
          status: res.statusCode ?? 0,
          identity: typeof identity === 'string' ? identity : null,
          body: Buffer.concat(chunks)
        });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('no answer in 5 s'), { code: 'ETIMEDOUT' })));
    req.on('error', fail);
    req.end();
  });
}

/**
 * What is on a port: nothing, this server serving this build, or something else.
 *
 * "Same" needs both:
 *
 * - `IDENTITY_HEADER` as this checkout would send it now: this file's code, `vercel` read as it
 *   stands, `root`. That refuses `vite preview`, another project, and a serve-build started
 *   before an edit to either file or over another directory.
 * - `/version.json` byte for byte, which names the commit and the moment it was built.
 *
 * Anything else is "other", with every part that failed named in `detail`.
 *
 * @param {number} port
 * @param {string} root
 * @param {string} [vercel] the `vercel.json` this run reads
 * @returns {Promise<{ state: 'free' | 'same' | 'other', detail?: string }>}
 */
export async function probe(port, root, vercel = VERCEL_JSON) {
  const ours = readFileSync(join(root, 'version.json'));
  const expected = identityOf(root, digestOf(readFileSync(vercel)));
  let res;
  try {
    res = await versionOn(port);
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === 'ECONNREFUSED') return { state: 'free' };
    return { state: 'other', detail: `it did not answer /version.json (${code ?? String(err)})` };
  }
  const { body } = res;
  const said = res.identity;
  /** @type {string[]} */
  const wrong = [];
  if (said === null) {
    wrong.push(`it sent no ${IDENTITY_HEADER} header, so it is not serve-build.mjs (a vite preview, or another project)`);
  } else if (said !== expected) {
    /** @param {string} s */
    const parts = (s) => Object.fromEntries(s.split(' ').map((p) => p.split('=')));
    const a = parts(said);
    const b = parts(expected);
    /** @type {Record<string, string>} */
    const meaning = {
      script: 'it runs a different serve-build.mjs from this checkout\'s, so it started before an edit to that file or from another checkout',
      vercel: 'it read a different vercel.json when it started, so its headers and redirects are not the ones this run would test',
      root: 'it serves a different directory'
    };
    for (const k of IDENTITY_PARTS) if (a[k] !== b[k]) wrong.push(meaning[k]);
    if (!wrong.length) wrong.push(`its ${IDENTITY_HEADER} header reads ${JSON.stringify(said)}, which this probe cannot read`);
  }
  if (res.status !== 200 || !body.equals(ours)) {
    const text = body.toString('utf8', 0, 160).replace(/\s+/g, ' ');
    wrong.push(`it answered /version.json with ${res.status}: ${text || '(empty)'}`);
  }
  return wrong.length ? { state: 'other', detail: wrong.join('; ') } : { state: 'same' };
}

/**
 * `probe`, synchronously, for a Playwright config, which cannot wait on a promise.
 *
 * @param {number} port
 * @param {string} root
 * @returns {{ state: 'free' | 'same' | 'other', detail?: string }}
 */
export function probeSync(port, root) {
  const out = spawnSync(process.execPath, [HERE, '--probe', '--port', String(port), '--root', root], {
    encoding: 'utf8',
    timeout: 15_000
  });
  if (out.status !== 0) {
    throw new Error(`serve-build.mjs could not check port ${port}: ${out.stderr || out.error?.message || out.status}`);
  }
  return JSON.parse(out.stdout);
}

/**
 * The `baseURL` and `webServer` a Playwright config needs, decided when the config loads.
 *
 * `env` supplies `NAVCOM_E2E_PORT` only. The directory is always `rootFor()`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ baseURL: string, webServer: { command: string, url: string, reuseExistingServer: boolean, timeout: number } }}
 */
export function playwrightServer(env = process.env) {
  const port = portFor(WEB, env);
  const root = rootFor();
  if (!statOf(join(root, 'version.json'))?.isFile()) {
    throw new Error(`Nothing to serve: ${join(root, 'version.json')} does not exist. Build first, from web/: npm run build`);
  }
  const found = probeSync(port, root);
  if (found.state === 'other') {
    throw new Error(
      `Port ${port} is held by a server that is not this checkout's serve-build over ${root}: ${found.detail}. ` +
        'Testing it would test some other build, or this one with other rules. Stop that server, or set NAVCOM_E2E_PORT to a free port.'
    );
  }
  const quote = (/** @type {string} */ s) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
  return {
    baseURL: `http://localhost:${port}`,
    webServer: {
      command: `${quote(process.execPath)} ${quote(HERE)} --port ${port} --root ${quote(root)}`,
      url: `http://localhost:${port}/version.json`,
      reuseExistingServer: found.state === 'same',
      timeout: 30_000
    }
  };
}

/** @param {string[]} argv */
async function main(argv) {
  /** @param {string} name */
  const arg = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const port = arg('--port') ? Number(arg('--port')) : portFor(WEB, process.env);
  const root = resolve(arg('--root') ?? rootFor());

  if (argv.includes('--probe')) {
    process.stdout.write(JSON.stringify(await probe(port, root)));
    return;
  }
  const served = await serve({ root, port });
  console.log(`[serve-build] ${root} on http://localhost:${served.port}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[serve-build] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
