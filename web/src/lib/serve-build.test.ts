/**
 * The server the browser suite runs against, and the rule for reusing one already running.
 *
 * `scripts/serve-build.mjs` says why the suite stopped using `vite preview`. These pin the parts
 * a refactor would break quietly: a file only in `build/` is served, the host's rules come from
 * `vercel.json`, and a server holding the port for some other build, other rules or other code
 * is refused rather than tested. The last is checked against the Playwright config itself,
 * since that is what decides, which needs `npm run build` first.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compileSource,
  hostRules,
  identityOf,
  IDENTITY_HEADER,
  portFor,
  probe,
  rootFor,
  serve,
  VERCEL_JSON
} from '../../scripts/serve-build.mjs';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
/** Resolved rather than spelled, because the workspace hoists it to the repository root. */
const PLAYWRIGHT = createRequire(join(WEB, 'package.json')).resolve('@playwright/test/cli');
const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A small `build/` and a `vercel.json` beside it. */
function fixture(vercel: Record<string, unknown> = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'navcom-serve-')));
  made.push(dir);
  const root = join(dir, 'build');
  mkdirSync(join(root, '.well-known'), { recursive: true });
  mkdirSync(join(root, 'about'));
  writeFileSync(join(root, 'version.json'), '{"commit":"abc1234","builtAt":"2026-10-10T00:00:00.000Z"}');
  writeFileSync(join(root, '.well-known', 'navcom-node.json'), '{"node":"navcom"}');
  writeFileSync(join(root, 'about', 'index.html'), '<p>about</p>');
  writeFileSync(join(root, '404.html'), '<p>not here</p>');
  writeFileSync(join(dir, 'vercel.json'), JSON.stringify(vercel));
  return { dir, root, vercel: join(dir, 'vercel.json') };
}

/** A raw request, so the path reaches the server exactly as written. */
function get(port: number, path: string, method = 'GET') {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

/**
 * A stand-in for some other server holding a port, answering `/version.json` with `body`, and
 * with `headers` such as a forged or stale identity.
 */
function occupant(body: string, headers: Record<string, string> = {}) {
  return new Promise<{ port: number; server: Server; close: () => Promise<void> }>((done) => {
    const server = createServer((req, res) => {
      if (req.url === '/version.json') {
        res.writeHead(200, { 'content-type': 'application/json', ...headers });
        res.end(body);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    /*
     * Closes the sockets as well. `server.close()` alone stops new connections only, and `fetch`
     * keeps the last probe's connection alive and reuses it, so a "closed" stand-in went on
     * answering and the port read as held, not free.
     */
    const close = () =>
      new Promise<void>((closed) => {
        server.close(() => closed());
        server.closeAllConnections();
      });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      done({ port: typeof address === 'object' && address ? address.port : 0, server, close });
    });
  });
}

describe('the host rules come from vercel.json', () => {
  it('reads the real vercel.json, all of it', () => {
    const rules = hostRules();
    expect(rules.headers.length).toBeGreaterThan(0);
    expect(rules.redirects.length).toBeGreaterThan(0);
    expect(rules.outputDirectory).toBe('web/build');
  });

  it('refuses a key it does not implement rather than ignoring it', () => {
    expect(() => hostRules(fixture({ rewrites: [{ source: '/a', destination: '/b' }] }).vercel)).toThrow(/rewrites/);
    expect(() => hostRules(fixture({ cleanUrls: true }).vercel)).toThrow(/cleanUrls/);
    expect(() =>
      hostRules(fixture({ headers: [{ source: '/a', has: [{ type: 'host', value: 'x' }], headers: [] }] }).vercel)
    ).toThrow(/has\/missing/);
  });

  it('matches a source strictly and case-sensitively, as the host does', () => {
    expect(compileSource('/grid').test('/grid')).toBe(true);
    expect(compileSource('/grid').test('/grid/')).toBe(false);
    expect(compileSource('/grid').test('/Grid')).toBe(false);
    const wellKnown = compileSource('/.well-known/(.*)');
    expect(wellKnown.test('/.well-known/navcom-node.json')).toBe(true);
    expect(wellKnown.test('/x-well-known/navcom-node.json')).toBe(false);
  });

  it('refuses syntax it would read differently from the host', () => {
    expect(() => compileSource('/blog/:slug*')).toThrow(/not implemented/);
    expect(() => compileSource('/a/((x))')).toThrow(/nested/);
  });
});

describe('serving build/', () => {
  const site = fixture({
    headers: [
      { source: '/.well-known/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }] },
      { source: '/version.json', headers: [{ key: 'cache-control', value: 'public, max-age=0, must-revalidate' }] }
    ],
    redirects: [{ source: '/grid', destination: '/', permanent: false }]
  });
  let port = 0;
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const served = await serve({ root: site.root, port: 0, rules: hostRules(site.vercel), hosts: ['127.0.0.1'] });
    port = served.port;
    close = served.close;
  });
  afterAll(() => close());

  it('serves a dotfile directory, with the header vercel.json gives it', async () => {
    const res = await get(port, '/.well-known/navcom-node.json');
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"node":"navcom"}');
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('serves a file written after it started, and stops when the file is gone', async () => {
    // The `vite preview` failure: a file list taken at start, so a rebuild's new chunks 404.
    const late = join(site.root, 'late.json');
    writeFileSync(late, '{"late":true}');
    expect((await get(port, '/late.json')).body).toBe('{"late":true}');
    rmSync(late);
    expect((await get(port, '/late.json')).status).toBe(404);
  });

  it('answers a directory with its index, with or without the slash', async () => {
    expect((await get(port, '/about/')).body).toBe('<p>about</p>');
    expect((await get(port, '/about')).body).toBe('<p>about</p>');
  });

  it("answers a missing path with the build's own 404 page and a 404", async () => {
    const res = await get(port, '/terminal/no-such-screen/');
    expect(res.status).toBe(404);
    expect(res.body).toBe('<p>not here</p>');
  });

  it('does not serve anything outside the directory', async () => {
    for (const path of ['/..%2fvercel.json', '/%2e%2e/vercel.json', '/../vercel.json']) {
      const res = await get(port, path);
      expect(res.status, path).toBe(404);
      expect(res.body, path).not.toContain('redirects');
    }
  });

  it('redirects as vercel.json says, before looking at the disk', async () => {
    const res = await get(port, '/grid');
    expect(res.status).toBe(307);
    expect(res.headers['location']).toBe('/');
  });

  it('says which server it is on every answer, a redirect, a 404 and a refusal included', async () => {
    const identity = identityOf(site.root, hostRules(site.vercel).digest);
    for (const [path, method] of [['/version.json', 'GET'], ['/grid', 'GET'], ['/nowhere', 'GET'], ['/', 'POST']] as const) {
      expect((await get(port, path, method)).headers[IDENTITY_HEADER], `${method} ${path}`).toBe(identity);
    }
  });

  it('applies trailingSlash either way when vercel.json sets it', async () => {
    const add = await serve({
      root: site.root,
      port: 0,
      rules: hostRules(fixture({ trailingSlash: true }).vercel),
      hosts: ['127.0.0.1']
    });
    const strip = await serve({
      root: site.root,
      port: 0,
      rules: hostRules(fixture({ trailingSlash: false }).vercel),
      hosts: ['127.0.0.1']
    });
    try {
      expect((await get(add.port, '/about')).headers['location']).toBe('/about/');
      expect((await get(add.port, '/version.json')).status).toBe(200);
      expect((await get(strip.port, '/about/')).headers['location']).toBe('/about');
    } finally {
      await add.close();
      await strip.close();
    }
  });
});

describe('a running server is reused only if it is this server, serving this build', () => {
  const site = fixture();
  const same = '{"commit":"abc1234","builtAt":"2026-10-10T00:00:00.000Z"}';
  /** This server over `root`, with the rules in `vercel` as they read when it started. */
  const ours = (root = site.root, vercel = site.vercel) =>
    serve({ root, port: 0, rules: hostRules(vercel), hosts: ['127.0.0.1'] });

  it('tells an empty port, this build and some other build apart', async () => {
    const other = await occupant('{"commit":"fffffff","builtAt":"2026-10-09T00:00:00.000Z"}');
    const mine = await ours();
    try {
      expect((await probe(other.port, site.root, site.vercel)).state).toBe('other');
      expect(await probe(mine.port, site.root, site.vercel)).toEqual({ state: 'same' });
    } finally {
      await other.close();
      await mine.close();
    }
    expect(await probe(other.port, site.root, site.vercel)).toEqual({ state: 'free' });
  });

  it("refuses a server with this build's version.json and no identity, which is what vite preview is", async () => {
    // `vite preview` answers from `.svelte-kit/output`, whose version.json is the same bytes.
    const preview = await occupant(same);
    try {
      const found = await probe(preview.port, site.root, site.vercel);
      expect(found.state).toBe('other');
      expect(found.detail).toMatch(/no x-navcom-serve-build header, so it is not serve-build\.mjs/);
      expect(found.detail).not.toMatch(/version\.json/);
    } finally {
      await preview.close();
    }
  });

  it('refuses this server once vercel.json has changed under it', async () => {
    // It read the rules when it started and reads build/ live, so a rebuild never showed it stale.
    const own = fixture({ redirects: [{ source: '/grid', destination: '/', permanent: false }] });
    const mine = await ours(own.root, own.vercel);
    try {
      expect((await probe(mine.port, own.root, own.vercel)).state).toBe('same');
      writeFileSync(own.vercel, JSON.stringify({ redirects: [{ source: '/grid', destination: '/elsewhere/', permanent: false }] }));
      const found = await probe(mine.port, own.root, own.vercel);
      expect(found.state).toBe('other');
      expect(found.detail).toMatch(/different vercel\.json/);
    } finally {
      await mine.close();
    }
  });

  it("refuses a serve-build whose code is not this checkout's", async () => {
    const right = identityOf(site.root, hostRules(site.vercel).digest);
    const stale = await occupant(same, { [IDENTITY_HEADER]: right.replace(/script=\w+/, 'script=0000000000000000') });
    try {
      const found = await probe(stale.port, site.root, site.vercel);
      expect(found.state).toBe('other');
      expect(found.detail).toMatch(/different serve-build\.mjs/);
      expect(found.detail).not.toMatch(/vercel\.json|directory/);
    } finally {
      await stale.close();
    }
  });

  it('refuses one serving another directory, even with the same version.json', async () => {
    const twin = fixture();
    expect(readFileSync(join(twin.root, 'version.json'), 'utf8')).toBe(same);
    const theirs = await ours(twin.root, site.vercel);
    try {
      const found = await probe(theirs.port, site.root, site.vercel);
      expect(found.state).toBe('other');
      expect(found.detail).toMatch(/serves a different directory/);
    } finally {
      await theirs.close();
    }
  });

  /**
   * Loads the real Playwright config, as `playwright test` does, against a port of our choosing.
   * It serves the real `build/`, so these need one.
   *
   * Asynchronous on purpose: the stand-in server lives in this process, and a synchronous spawn
   * would stop it answering, so every port would read as held by something that never replies.
   */
  const loadConfig = (port: number, env: Record<string, string> = {}) =>
    new Promise<{ status: number | null; output: string }>((done) => {
      if (!existsSync(join(rootFor(), 'version.json'))) throw new Error('No build output. Run `npm run build` first.');
      // A filter that matches no file, so the config loads and nothing else does.
      const child = spawn(
        process.execPath,
        [PLAYWRIGHT, 'test', '--list', '--pass-with-no-tests', 'no-such-spec-file'],
        { cwd: WEB, env: { ...process.env, ...env, NAVCOM_E2E_PORT: String(port) } }
      );
      let output = '';
      child.stdout.on('data', (c) => (output += c));
      child.stderr.on('data', (c) => (output += c));
      child.on('close', (status) => done({ status, output }));
    });

  it('the Playwright config refuses a port held by another build', async () => {
    const other = await occupant('{"commit":"fffffff","builtAt":"2026-10-09T00:00:00.000Z"}');
    try {
      const run = await loadConfig(other.port);
      expect(run.status, run.output).not.toBe(0);
      expect(run.output).toMatch(
        new RegExp(`Port ${other.port} is held by a server that is not this checkout's serve-build over .*it answered /version.json with 200`)
      );
    } finally {
      await other.close();
    }
  });

  it('and reuses this server serving this build', async () => {
    const mine = await ours(rootFor(), VERCEL_JSON);
    try {
      const run = await loadConfig(mine.port);
      expect(run.status, run.output).toBe(0);
    } finally {
      await mine.close();
    }
  });

  it('and serves build/ whatever NAVCOM_E2E_ROOT says, since specs read build/ directly', async () => {
    // board-reload, landing and story-quartermaster read web/build from disk. A suite served
    // another directory would load one build in the browser and assert against another.
    const elsewhere = await ours();
    try {
      const run = await loadConfig(elsewhere.port, { NAVCOM_E2E_ROOT: site.root });
      expect(run.status, run.output).not.toBe(0);
      const build = rootFor().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(run.output).toMatch(new RegExp(`not this checkout's serve-build over ${build}:`));
      expect(run.output).toMatch(/serves a different directory/);
    } finally {
      await elsewhere.close();
    }
  });
});

describe('one port per checkout', () => {
  it('is stable, in range, and spread across checkouts', () => {
    const dirs = Array.from({ length: 20 }, () => fixture().dir);
    const ports = dirs.map((d) => portFor(d, {}));
    expect(dirs.map((d) => portFor(d, {}))).toEqual(ports);
    for (const p of ports) {
      expect(p).toBeGreaterThanOrEqual(24100);
      expect(p).toBeLessThan(24800);
    }
    expect(new Set(ports).size).toBeGreaterThan(10);
  });

  it('takes NAVCOM_E2E_PORT over the hash, and refuses one that is not a port', () => {
    expect(portFor(WEB, { NAVCOM_E2E_PORT: '4191' })).toBe(4191);
    expect(() => portFor(WEB, { NAVCOM_E2E_PORT: 'eighty' })).toThrow(/NAVCOM_E2E_PORT/);
  });
});
