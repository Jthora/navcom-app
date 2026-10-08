/**
 * A page says what kind it is (decided 2026-10-07; `escalation.spec.md`, *A page says what kind it is*).
 *
 * A re-page reached a phone as the same bytes as a first page -- the same words, the same one-tap
 * acknowledgement link for a ladder that did not exist -- and a drill or `--check` as a real
 * "NavCom — Distress". The kind now travels from the executor through the page command and
 * `navcom-push` to the service worker, and a repeat carries its attempt under its own flag, never as
 * the id a page offers to acknowledge. Anything missing or unknown is a first page: of the wrong
 * readings, a real page shown as a drill is the one somebody sleeps through.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { generateSecretKey } from "nostr-tools/pure";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EscalationExecutor } from "../src/escalation/executor.js";
import { pageAll, pushTemplateGaps, testPage } from "../src/escalation/pager.js";
import { pagePayload } from "../src/push/index.js";
import { build, cleanup, distressFrom, fakeConfig, fakePool, onCallEntry, quiet, workingPager } from "./helpers/executor.js";

afterEach(cleanup);

const ID = "a".repeat(64);
const OTHER = "b".repeat(64);

/** An entry whose command exits 0 only when its three placeholders arrive as `expected`. */
function expecting(expected: [kind: string, distress: string, attempt: string]) {
  const entry = onCallEntry("Wren");
  entry.command = [
    "node",
    "-e",
    `const got = process.argv.slice(1); process.exit(JSON.stringify(got) === ${JSON.stringify(JSON.stringify(expected))} ? 0 : 3)`,
    "{{kind}}",
    "{{distress}}",
    "{{attempt}}",
  ];
  return entry;
}

describe("the page command's placeholders", () => {
  it("gives a first page its kind and its Distress id, and no attempt", async () => {
    const [r] = await pageAll([expecting(["first", ID, ""])], "m", 10_000, ID, "first", OTHER);
    expect(r!.dispatched, "a first page's placeholders were wrong").toBe(true);
  });

  it("gives a repeat its kind and its attempt, and never a Distress id to acknowledge", async () => {
    const [r] = await pageAll([expecting(["repeat", "", OTHER])], "m", 10_000, ID, "repeat", OTHER);
    expect(r!.dispatched, "a repeat carried an id a page offers a one-tap acknowledgement for").toBe(true);
  });

  it("gives --check's test page the drill kind, so a phone shows it as no emergency", async () => {
    const [r] = await testPage([expecting(["drill", "", ""])], "check", 10_000);
    expect(r!.dispatched).toBe(true);
  });

  it("defaults to a first page for a caller that names no kind", async () => {
    const [r] = await pageAll([expecting(["first", ID, ""])], "m", 10_000, ID);
    expect(r!.dispatched).toBe(true);
  });
});

describe("what the executor passes", () => {
  it("pages a ladder as first, with the Distress id", async () => {
    quiet();
    const box = build({ oncall: [onCallEntry("Wren")] });
    const distress = distressFrom(generateSecretKey(), box.pubkey);
    box.deliver(distress);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(1));
    const [, message, , id, kind] = box.page.mock.calls[0]!;
    expect([id, kind]).toEqual([distress.id, "first"]);
    expect(message).toMatch(/^NavCom DISTRESS/);
  });

  it("pages a drill as a drill", async () => {
    quiet();
    const dir = mkdtempSync(join(tmpdir(), "navcom-drill-kind-"));
    try {
      const page = workingPager();
      const secretKey = generateSecretKey();
      const { pool } = fakePool();
      const executor = new EscalationExecutor({
        config: fakeConfig([onCallEntry("Wren")]), secretKey, pubkey: "0".repeat(64), pool, page,
        drillStatePath: join(dir, "drill.json"),
      });
      await executor.fireDrill("drill-kind");
      await executor.stop();
      expect(page.mock.calls[0]![4], "a drill paged as a real Distress").toBe("drill");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("navcom-push: what reaches the service worker", () => {
  it("sends a first page's kind and Distress id, and the drill flag old service workers read", () => {
    expect(pagePayload(["--to", "f.json", "--kind", "first", "--distress", ID, "--attempt", ""]).payload).toEqual({
      kind: "first",
      drill: false,
      distress: ID,
    });
  });

  it("sends a repeat's attempt under its own field, and drops a Distress id a template put beside it", () => {
    expect(pagePayload(["--to", "f.json", "--kind", "repeat", "--distress", ID, "--attempt", OTHER]).payload).toEqual({
      kind: "repeat",
      drill: false,
      attempt: OTHER,
    });
  });

  it("sends a drill as a drill, and takes --drill as the older spelling of it", () => {
    expect(pagePayload(["--to", "f.json", "--kind", "drill", "--distress", ""]).payload).toEqual({ kind: "drill", drill: true });
    expect(pagePayload(["--to", "f.json", "--drill"]).payload).toEqual({ kind: "drill", drill: true });
  });

  it("reads a missing, unknown or unfilled kind as a first page -- never a repeat, never a drill", () => {
    for (const argv of [
      ["--to", "f.json", "--distress", ID],
      ["--to", "f.json", "--kind", "{{kind}}", "--distress", ID],
      ["--to", "f.json", "--kind", "REPEAT", "--distress", ID],
      ["--to", "f.json", "--kind", "", "--distress", ID],
    ]) {
      expect(pagePayload(argv).payload, argv.join(" ")).toEqual({ kind: "first", drill: false, distress: ID });
    }
  });

  it("lets an exact kind win over the older drill flag", () => {
    expect(pagePayload(["--to", "f.json", "--kind", "first", "--drill", "--distress", ID]).payload.kind).toBe("first");
  });

  it("drops anything that is not an event id, so a page never offers to acknowledge garbage", () => {
    expect(pagePayload(["--to", "f.json", "--kind", "first", "--distress", "{{distress}}"]).payload).toEqual({ kind: "first", drill: false });
    expect(pagePayload(["--to", "f.json", "--kind", "repeat", "--attempt", "xyz"]).payload).toEqual({ kind: "repeat", drill: false });
  });

  it("keeps a repeat no longer than the hold it is about, unless told otherwise", () => {
    expect(pagePayload(["--to", "f.json", "--kind", "first"]).ttl).toBe(3600);
    expect(pagePayload(["--to", "f.json", "--kind", "repeat"]).ttl).toBe(1800);
    expect(pagePayload(["--to", "f.json", "--kind", "repeat", "--ttl", "600"]).ttl).toBe(600);
    expect(pagePayload(["--to", "f.json", "--ttl", "nonsense"]).ttl).toBe(3600);
  });
});

describe("an on-call entry whose navcom-push template cannot yet say the kind", () => {
  it("is named, with what each missing placeholder costs", () => {
    const old = onCallEntry("Wren", undefined, "push");
    old.command = ["navcom-push", "--to", "/etc/navcom/oncall/wren.json", "{{message}}"];
    const gaps = pushTemplateGaps(old);
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toMatch(/--kind.*every page reaches this phone looking like a new Distress/);
    expect(gaps[1]).toMatch(/--distress.*one-tap acknowledgement/);
    expect(gaps[2]).toMatch(/--attempt.*wake the others/);
  });

  it("is not named once the template says all three, and no other command is looked at", () => {
    const full = onCallEntry("Wren", undefined, "push");
    full.command = ["/usr/local/bin/navcom-push", "--to", "w.json", "--kind", "{{kind}}", "--distress", "{{distress}}", "--attempt", "{{attempt}}"];
    expect(pushTemplateGaps(full)).toEqual([]);
    const sms = onCallEntry("Raven");
    sms.command = ["signal-cli", "send", "-m", "{{message}}", "+15550100"];
    expect(pushTemplateGaps(sms)).toEqual([]);
  });
});
