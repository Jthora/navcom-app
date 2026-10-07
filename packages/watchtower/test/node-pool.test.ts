/**
 * Every node-side pool is built one way, and that way works where the tools actually run.
 *
 * `engines` says Node >= 20, and Node 20 has no global WebSocket. Four tools built a
 * `SimplePool` without installing one [F07], and they worked on the Node 22 they were written on
 * -- the pager printed that it was watching while it could not open a socket. The guard is
 * structural: one factory, and a test that nothing in `src/` builds a pool any other way.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer, type Server, type Socket } from "node:net";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import type { SimplePool } from "nostr-tools/pool";
import { nodePool } from "../src/shared/nostr-node.js";
import { startRelay, eventually, type LocalRelay } from "./helpers/local-relay.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(PACKAGE, "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

/** Runs a snippet as an ES module in a fresh Node, optionally with no global WebSocket. */
async function run(code: string, opts: { node20?: boolean } = {}) {
  const args = [
    ...(opts.node20 ? ["--no-experimental-websocket"] : []),
    "--import", "tsx", "--input-type=module", "-e", code,
  ];
  const child = spawn(process.execPath, args, { cwd: PACKAGE, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr.on("data", (d: Buffer) => (out += d.toString()));
  const killer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  const code_ = await new Promise<number | null>((resolve) => child.on("exit", (c) => resolve(c)));
  clearTimeout(killer);
  return { code: code_, out };
}

const relays: LocalRelay[] = [];
const servers: { close(): unknown }[] = [];
const pools: SimplePool[] = [];
afterEach(async () => {
  for (const p of pools.splice(0)) p.destroy();
  await Promise.all(relays.splice(0).map((r) => r.close()));
  for (const s of servers.splice(0)) s.close();
});

describe("building a pool on Node [F07]", () => {
  it("happens in one place, so nothing can build one before the socket is installed", () => {
    const offenders = sources(SRC)
      .filter((path) => !path.endsWith(join("shared", "nostr-node.ts")))
      .filter((path) => /new\s+SimplePool\s*\(/.test(readFileSync(path, "utf8")))
      .map((path) => relative(PACKAGE, path));
    expect(offenders, "build pools with nodePool() from shared/nostr-node.ts").toEqual([]);
  });

  it("does not reconnect by itself unless asked to [F04]", () => {
    // One of the two defences against a future-dated event making a listener deaf, and the only
    // one the CLI has: its response subscription is core's, not the shared listener.
    const pool = nodePool();
    pools.push(pool);
    expect((pool as unknown as { enableReconnect: boolean }).enableReconnect).toBe(false);
  });

  it("is never asked to reconnect by anything in src/ [F04]", () => {
    const offenders = sources(SRC)
      .filter((path) => /enableReconnect\s*:\s*true/.test(readFileSync(path, "utf8")))
      .map((path) => relative(PACKAGE, path));
    expect(offenders).toEqual([]);
  });

  it("lets `watchtower-daemon --check` reach a relay on a runtime with no global WebSocket", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const result = await run(
      `const { checkWatch } = await import(${JSON.stringify(join(SRC, "daemon/check.ts"))});
       const r = await checkWatch({ pubkey: "${"a".repeat(64)}", relays: [${JSON.stringify(relay.url)}], timeoutMs: 2000 });
       console.log("REACHED=" + r.relays[0].reached);
       process.exit(0);`,
      { node20: true },
    );
    expect(result.out).toContain("REACHED=true");
  }, 40_000);
});

describe("a relay that takes the connection and never finishes the handshake", () => {
  it("does not take the process down when it finally hangs up", async () => {
    // Found in the F05 probes: nostr-tools gives up after its connection timeout and detaches
    // its error handler from a socket that is still open. When the relay later resets it, `ws`
    // emits an error nobody is listening for, Node makes it uncaught, and the daemon's handler
    // exits. An overloaded relay or a NAT timeout is all it takes.
    const sockets: Socket[] = [];
    const server: Server = createServer((socket) => sockets.push(socket));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const pending = run(
      `const { installNodeWebSocket } = await import(${JSON.stringify(join(SRC, "shared/nostr-node.ts"))});
       const { SimplePool } = await import("nostr-tools/pool");
       installNodeWebSocket();
       const pool = new SimplePool();
       pool.subscribeMany(["ws://127.0.0.1:${port}"], { kinds: [1] }, { onevent() {} });
       setTimeout(() => { console.log("SURVIVED"); process.exit(0); }, 6000);`,
    );
    // Past nostr-tools' three-second connection timeout, then reset what it abandoned.
    await new Promise((r) => setTimeout(r, 4_000));
    for (const s of sockets) s.resetAndDestroy();

    const result = await pending;
    expect(result.out, result.out).toContain("SURVIVED");
    expect(result.code).toBe(0);
  }, 40_000);
});

describe("a relay whose handshake finishes after nostr-tools has given up on it", () => {
  it("leaves no socket open behind it", async () => {
    // nostr-tools abandons a socket at its connection timeout by detaching its handlers, and never
    // closes it. When the handshake finished later the socket stayed open, kept alive by ws
    // answering pings, until the relay or the process restarted -- one per attempt, and a
    // listener retries every fifteen seconds for as long as the relay is slow. It is now closed
    // when it is abandoned [#12], so the late handshake has nothing left to finish on.
    const wss = new WebSocketServer({ noServer: true });
    const open = new Set<ServerSocket>();
    const connections = new Set<Socket>();
    let upgrades = 0;
    const http = createHttpServer();
    http.on("connection", (socket: Socket) => {
      connections.add(socket);
      socket.on("close", () => connections.delete(socket));
    });
    http.on("upgrade", (req, socket, head) => {
      setTimeout(() => {
        if (socket.destroyed) return;
        wss.handleUpgrade(req, socket, head, (ws) => {
          upgrades++;
          open.add(ws);
          ws.on("close", () => open.delete(ws));
        });
      }, 1_500);
    });
    servers.push({ close: () => { for (const ws of wss.clients) ws.terminate(); wss.close(); http.close(); } });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
    const address = http.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const pool = nodePool();
    pools.push(pool);
    await expect(pool.ensureRelay(`ws://127.0.0.1:${port}`, { connectionTimeout: 500 })).rejects.toBeDefined();

    await eventually(() => expect(connections.size, "the abandoned socket is still open").toBe(0), 3_000);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(open.size, "a late handshake left an open connection behind").toBe(0);
    expect(upgrades, "the socket outlived the give-up long enough for the handshake to finish").toBe(0);
  }, 15_000);
});

describe("a relay that takes the connection and never answers the upgrade [#12]", () => {
  it("leaves no socket open once nostr-tools has given up on it", async () => {
    // nostr-tools abandons a socket at its connection timeout by nulling its handlers, and never
    // closes it; `ws` sets no handshake timeout of its own. Against a relay that takes the TCP
    // connection and never answers, every retry left one socket open for as long as the relay held
    // it -- about two hundred an hour from a listener -- and pool.destroy() could not reach them.
    const open = new Set<Socket>();
    const server: Server = createServer((socket) => {
      open.add(socket);
      // Read what arrives, so the client hanging up is seen here; the upgrade is never answered.
      socket.resume();
      socket.on("close", () => open.delete(socket));
      socket.on("error", () => {});
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const pool = nodePool();
    pools.push(pool);
    for (let i = 0; i < 3; i++) {
      await expect(pool.ensureRelay(`ws://127.0.0.1:${port}`, { connectionTimeout: 200 })).rejects.toBeDefined();
    }
    await eventually(() => expect(open.size, "sockets nobody holds are still open").toBe(0), 3_000);
  }, 15_000);

  it("still connects to a relay that answers within the caller's own timeout", async () => {
    // The socket is closed when the caller gives up, not on a clock of its own: a relay that takes
    // six seconds to finish the upgrade is still reached by a caller that waits nine -- as the
    // conformance check (twelve) and promote (nineteen) wait. Six, so that the five-second
    // handshake timeout considered for #12 instead of closing on give-up would fail this.
    const wss = new WebSocketServer({ noServer: true });
    const http = createHttpServer();
    http.on("upgrade", (req, socket, head) => {
      setTimeout(() => wss.handleUpgrade(req, socket, head, () => {}), 6_000);
    });
    servers.push({ close: () => { for (const ws of wss.clients) ws.terminate(); wss.close(); http.close(); } });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
    const address = http.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const pool = nodePool();
    pools.push(pool);
    const relay = await pool.ensureRelay(`ws://127.0.0.1:${port}`, { connectionTimeout: 9_000 });
    expect(relay.connected).toBe(true);
  }, 15_000);
});
