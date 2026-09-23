/**
 * The drill, as the executor actually runs it.
 *
 * `drill.test.ts` in core covers what a drill *means* — what counts as a pass, what an empty
 * roster is worth. What is left here is everything that could be right in that logic and
 * catastrophic in the process, which is where this one was.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EscalationExecutor } from "../src/escalation/executor.js";
import type { EscalationConfig, OnCallEntry } from "../src/escalation/config.js";
import * as drills from "../src/escalation/drills.js";
import type { pageAll } from "../src/escalation/pager.js";
import { sealSignal } from "../src/shared/crypto.js";
import { KIND_SIGNAL } from "../src/shared/kinds.js";

const STANDING = 4_102_444_800;
const entry = (callsign: string): OnCallEntry => ({
  declaration: { author: { kind: "node", callsign }, channel: "sms", expires: STANDING },
  command: ["true"],
});

const dirs: string[] = [];
function tempState(nextAt: number): string {
  const dir = mkdtempSync(join(tmpdir(), "navcom-drill-"));
  dirs.push(dir);
  const path = join(dir, "drill.json");
  drills.writeDrillState(path, { last: null, nextAt });
  return path;
}

function config(statePath: string, ackSeconds: number, oncall: OnCallEntry[]): EscalationConfig {
  return {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls: ["wss://fake.relay"] },
    escalation: {
      pagingWindowSeconds: 300, contactWindowSeconds: 300, drillWindowDays: 7,
      drillAckWindowSeconds: ackSeconds, drillStatePath: statePath,
      maxPagesPerWindow: 20, pageBudgetWindowSeconds: 3_600, ladderRetentionSeconds: 3_600,
      oncall,
    },
    log: { path: join(dirname(statePath), "escalation-log.jsonl"), retentionDays: 90 },
  };
}

const executors: EscalationExecutor[] = [];
function build(statePath: string, ackSeconds: number, page: ReturnType<typeof pager>) {
  const pool = {
    publish: () => [Promise.resolve("ok")],
    subscribeMany: () => ({ close: () => {} }),
    destroy: () => {},
  } as unknown as SimplePool;
  const secretKey = generateSecretKey();
  const ex = new EscalationExecutor({
    config: config(statePath, ackSeconds, [entry("Wren")]),
    secretKey, pubkey: getPublicKey(secretKey), pool, page, drillStatePath: statePath,
  });
  executors.push(ex);
  return ex;
}

const pager = () =>
  vi.fn<typeof pageAll>(async () => [{ callsign: "Wren", channel: "sms", dispatched: true }]);

afterEach(async () => {
  await Promise.all(executors.splice(0).map((e) => e.stop()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("a drill that is due", () => {
  it("pages the roster once, not once a second until the window closes", async () => {
    // A drill waits out its acknowledgement window — ten minutes by default — before it can
    // record anything, and the sweep runs every second. Unguarded, ONE weekly drill paged
    // every on-call person roughly six hundred times. The mechanism built to prove the
    // pager works without wearing it out was the thing most likely to destroy it.
    const page = pager();
    const ex = build(tempState(Math.floor(Date.now() / 1000) - 1), 6, page);
    ex.start();

    await new Promise((r) => setTimeout(r, 3_500));
    expect(page.mock.calls.length).toBe(1);
  }, 15_000);

  it("re-arms before waiting, so a drill that dies does not page forever", async () => {
    // The in-flight flag covers this process. This covers a crash mid-window: without it
    // `nextAt` stays in the past and every sweep from then on considers a drill due.
    const statePath = tempState(Math.floor(Date.now() / 1000) - 1);
    const ex = build(statePath, 60, pager());
    ex.start();

    await vi.waitFor(() => {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as { nextAt: number };
      expect(state.nextAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    }, { timeout: 5_000 });
  }, 15_000);

  it("says what the drill found even when it cannot write the result", async () => {
    // The log line came after the write, so a filesystem that refused threw straight past
    // it and the entire product of a safety check was lost — not in the file, not in the
    // log, nowhere.
    const statePath = tempState(Math.floor(Date.now() / 1000) - 1);
    const said: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => void said.push(String(m)));
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m: unknown) => void errors.push(String(m)));

    const ex = build(statePath, 1, pager());
    // Forces the write itself to fail, rather than the OS permission bits a real read-only
    // filesystem would set: a build container commonly runs as root, where chmod 0o400 is
    // never enforced — root bypasses it — so a deploy running as root would silently skip
    // the very failure this test exists to prove is handled, and pass for the wrong reason.
    // This found real Vercel deploys failing on exactly that gap.
    vi.spyOn(drills, "writeDrillState").mockImplementation(() => {
      throw new Error("EACCES: permission denied, open 'drill.json'");
    });
    await ex.fireDrill();

    expect(said.some((m) => m.startsWith("[drill]"))).toBe(true);
    expect(errors.some((m) => /RESULT NOT RECORDED/.test(m))).toBe(true);
    // And it says what the consequence is, rather than only that a write failed.
    expect(errors.some((m) => /publish the previous drill/.test(m))).toBe(true);
  }, 15_000);

  it("refuses to start a second while one is running", async () => {
    const page = pager();
    const ex = build(tempState(Math.floor(Date.now() / 1000) - 1), 3, page);

    const first = ex.fireDrill();
    await ex.fireDrill();
    expect(page.mock.calls.length).toBe(1);
    await first;
  }, 15_000);
});

describe("a drill fired by hand", () => {
  it("can pass, because the acknowledgement arrives on a subscription that is open", async () => {
    // `--drill` fired without ever subscribing, so the on-call person's answer went nowhere:
    // every manual drill waited out its window, recorded FAIL, and that FAIL was published
    // in 10910 where it demotes the watch. `docs/human-tasks.md` gives this command as the
    // proof that paging works, and it could not pass.
    const statePath = tempState(STANDING);
    const responder = generateSecretKey();
    const secretKey = generateSecretKey();
    const watchtower = getPublicKey(secretKey);
    const DRILL = "d".repeat(32);

    let onevent: ((e: Event) => void) | undefined;
    const pool = {
      publish: () => [Promise.resolve("ok")],
      subscribeMany: (_u: string[], _f: unknown, params: { onevent: (e: Event) => void }) => {
        onevent = params.onevent;
        return { close: () => {} };
      },
      destroy: () => {},
    } as unknown as SimplePool;

    const page = vi.fn<typeof pageAll>(async () => {
      // The on-call person answers a moment after the page lands -- over the relay, the only
      // way an answer can arrive.
      setTimeout(() => {
        onevent?.(
          finalizeEvent(
            {
              kind: KIND_SIGNAL,
              tags: [["p", watchtower], ["t", "distress-ack"]],
              content: sealSignal(responder, [watchtower], { distress_id: DRILL }),
              created_at: Math.floor(Date.now() / 1000),
            },
            responder,
          ),
        );
      }, 20);
      return [{ callsign: "Wren", channel: "sms", dispatched: true }];
    });

    const wren: OnCallEntry = {
      declaration: {
        author: { kind: "human", callsign: "Wren", pubkey: getPublicKey(responder) },
        channel: "sms",
        expires: STANDING,
      },
      command: ["true"],
    };
    const ex = new EscalationExecutor({
      config: config(statePath, 0.3, [wren]),
      secretKey, pubkey: watchtower, pool, page, drillStatePath: statePath,
    });
    executors.push(ex);

    await ex.drillOnce(DRILL);

    expect(page).toHaveBeenCalledTimes(1);
    expect(drills.readDrillState(statePath)?.last?.result).toBe("pass");
  });
});
