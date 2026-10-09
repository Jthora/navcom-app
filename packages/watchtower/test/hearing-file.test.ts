/**
 * The hearing file: where the escalation executor hears, written for the daemon (`shared/hearing.ts`).
 *
 * The daemon publishes the watch state only where both processes hear, so this file is what stands
 * between a relay that refuses the executor and a watch that looks live there while a `Distress` sent
 * only there pages nobody. Every way it can be unbelievable is a way the watch must read Dark, and each
 * has its own sentence, because each has its own fix.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  HEARING_MAX_AGE_SECONDS,
  readHearing,
  relayKey,
  writeHearing,
  type HearingFile,
} from "../src/shared/hearing.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navcom-hearing-"));
  dirs.push(dir);
  return dir;
}

const WATCH = getPublicKey(generateSecretKey());
const NOW = 1_800_000_000;

const file = (over: Partial<HearingFile> = {}): HearingFile => ({
  v: 1,
  at: NOW,
  watch: WATCH,
  relays: [
    { url: "wss://a.relay/", hears: true },
    { url: "wss://b.relay", hears: false, why: "refused the subscription: auth-required: members only" },
  ],
  ...over,
});

describe("writing it", () => {
  it("writes it 0640, all at once, and puts an older 0600 file right", () => {
    const dir = tempDir();
    const path = join(dir, "drill", "hearing.json");
    writeHearing(path, file());
    expect(statSync(path).mode & 0o777).toBe(0o640);
    // Through a file beside it and a rename: nothing half-written is ever at the path, and nothing is left over.
    expect(readdirSync(join(dir, "drill"))).toEqual(["hearing.json"]);

    chmodSync(path, 0o600);
    writeHearing(path, file({ at: NOW + 30 }));
    expect(statSync(path).mode & 0o777, "a file the daemon's user could not read stayed that way").toBe(0o640);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("throws where it cannot be written, for the executor to say", () => {
    const dir = tempDir();
    const blocker = join(dir, "not-a-directory");
    writeFileSync(blocker, "");
    expect(() => writeHearing(join(blocker, "hearing.json"), file())).toThrow();
  });

  it("replaces the file rather than writing into it: a reader holds the old one or the new one, never half", () => {
    const path = join(tempDir(), "hearing.json");
    writeHearing(path, file());
    const before = statSync(path).ino;
    writeHearing(path, file({ at: NOW + 30 }));
    // A rename gives the path a new file; a write in place keeps the old one and is half-written while it runs.
    expect(statSync(path).ino, "written in place, where a reader can find it half-written").not.toBe(before);
  });

  it("leaves nothing beside it when the last step fails", () => {
    const path = join(tempDir(), "hearing.json");
    // A directory at the path: everything up to the rename succeeds, and the rename cannot.
    mkdirSync(path);
    expect(() => writeHearing(path, file())).toThrow();
    expect(existsSync(`${path}.tmp`), "a half-done write left its temporary file behind").toBe(false);
  });
});

/**
 * The executor may run as a user of its own while the file's directory is one the daemon's user can
 * write: by default, and in the examples. Whatever that user leaves at the path or beside it must
 * never be written through, with the executor's privileges, to a file of the executor's.
 */
describe("whatever is left where it writes", () => {
  /** The executor's own file -- its key, say -- in a directory of its own, and the directory it writes the hearing file in. */
  function layout() {
    const base = tempDir();
    const own = join(base, "navcom-escalation");
    const shared = join(base, "navcom");
    mkdirSync(own, { mode: 0o700 });
    mkdirSync(shared, { mode: 0o755 });
    const key = join(own, "watchtower.key");
    writeFileSync(key, "SECRET-EXECUTOR-KEY-HEX\n", { mode: 0o600 });
    chmodSync(key, 0o600);
    return { key, path: join(shared, "hearing.json") };
  }
  const untouched = (key: string) => {
    expect(readFileSync(key, "utf8"), "the executor's own file was overwritten").toBe("SECRET-EXECUTOR-KEY-HEX\n");
    expect(statSync(key).mode & 0o777, "the executor's own file changed mode").toBe(0o600);
  };

  it("never follows a link planted at the temporary name, nor one at the path itself", () => {
    const { key, path } = layout();
    symlinkSync(key, `${path}.tmp`);
    writeHearing(path, file());
    untouched(key);
    expect(lstatSync(path).isSymbolicLink()).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8")).watch).toBe(WATCH);
    expect(existsSync(`${path}.tmp`)).toBe(false);

    // At the path: the rename replaces the link, and nothing is written through it.
    rmSync(path);
    symlinkSync(key, path);
    writeHearing(path, file());
    untouched(key);
    expect(lstatSync(path).isSymbolicLink()).toBe(false);
  });

  it("never writes through a hard link planted at the temporary name", () => {
    const { key, path } = layout();
    linkSync(key, `${path}.tmp`);
    writeHearing(path, file());
    untouched(key);
  });

  it("writes nothing in a directory others can write, and says why", () => {
    const { path } = layout();
    const dir = join(path, "..");
    chmodSync(dir, 0o775);
    expect(() => writeHearing(path, file())).toThrow(/can be written by its group or by anybody \(mode 775\)/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it.skipIf(typeof process.getuid !== "function" || process.getuid() === 0)(
    "writes nothing in a directory another user owns, and says why",
    () => {
      // The file system root stands in for a directory the daemon's user owns: not this user's, here.
      const path = join("/", `navcom-hearing-${process.pid}.json`);
      expect(() => writeHearing(path, file())).toThrow(/belongs to uid 0, not to this user/);
      expect(existsSync(path)).toBe(false);
    },
  );
});

describe("reading it the way the daemon must believe it", () => {
  it("believes a fresh file about this watch, keyed as the pool keys relays", () => {
    const dir = tempDir();
    const path = join(dir, "hearing.json");
    writeHearing(path, file());
    const read = readHearing(path, { watch: WATCH, now: NOW + 5 });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.ageSeconds).toBe(5);
    // `wss://a.relay/` in the executor's config is `wss://a.relay` in the daemon's: one relay.
    expect(read.hears.has(relayKey("wss://a.relay"))).toBe(true);
    expect(read.hears.has(relayKey("wss://b.relay/"))).toBe(false);
    expect(read.deaf.get(relayKey("wss://b.relay/"))).toBe("refused the subscription: auth-required: members only");
    expect(read.listed.size).toBe(2);
  });

  it("says there is none, and where it looked, when it is missing", () => {
    const path = join(tempDir(), "hearing.json");
    const read = readHearing(path, { watch: WATCH, now: NOW });
    expect(read).toEqual({
      ok: false,
      kind: "missing",
      why: `there is no hearing file at ${path}. Is navcom-escalation running, with [escalation] hearing_state_path set to this path?`,
    });
  });

  it("says one that is there and cannot be read is that, and the usual cause", () => {
    const path = join(tempDir(), "hearing.json");
    // A directory stands in for a file another user owns at 0600.
    mkdirSync(path);
    const read = readHearing(path, { watch: WATCH, now: NOW });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.kind).toBe("unreadable");
    expect(read.why).toBe(
      `the hearing file at ${path} exists and cannot be read (EISDIR). Usually its group, after the executor moved ` +
        "to its own user (ops/systemd/README.md, 4b)",
    );
  });

  it("does not read a file that is not JSON, or another version's, as anything but hearing nowhere", () => {
    const path = join(tempDir(), "hearing.json");
    writeFileSync(path, "{ half a file");
    const garbled = readHearing(path, { watch: WATCH, now: NOW });
    expect(garbled.ok).toBe(false);
    if (garbled.ok) return;
    expect(garbled.kind).toBe("malformed");
    expect(garbled.why).toBe(`the hearing file at ${path} is not one this version reads (it is not JSON)`);

    writeFileSync(path, JSON.stringify({ ...file(), v: 2 }));
    const later = readHearing(path, { watch: WATCH, now: NOW });
    expect(later.ok).toBe(false);
    if (later.ok) return;
    expect(later.kind).toBe("malformed");
    expect(later.why).toMatch(new RegExp(`^the hearing file at ${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not one this version reads \\(version 2`));

    writeFileSync(path, JSON.stringify({ ...file(), relays: [{ url: "wss://a.relay", hears: "yes" }] }));
    expect(readHearing(path, { watch: WATCH, now: NOW })).toMatchObject({ ok: false, kind: "malformed" });
  });

  it("does not believe a file about another watch: the executor's privkey_path is not this daemon's key", () => {
    const path = join(tempDir(), "hearing.json");
    const other = getPublicKey(generateSecretKey());
    writeHearing(path, file({ watch: other }));
    const read = readHearing(path, { watch: WATCH, now: NOW });
    expect(read).toEqual({
      ok: false,
      kind: "other-watch",
      why:
        `the hearing file at ${path} is for watch ${other.slice(0, 8)}, not this one (${WATCH.slice(0, 8)}): ` +
        "the executor's privkey_path is not this daemon's key",
    });
  });

  it("does not believe one more than ninety seconds old, and keeps the edge", () => {
    const path = join(tempDir(), "hearing.json");
    writeHearing(path, file());
    expect(readHearing(path, { watch: WATCH, now: NOW + HEARING_MAX_AGE_SECONDS }).ok).toBe(true);
    const read = readHearing(path, { watch: WATCH, now: NOW + 91 });
    expect(read).toEqual({
      ok: false,
      kind: "old",
      why:
        `the hearing file at ${path} is 91s old, and one older than 90s is not believed. The executor writes it ` +
        "every 30s: it has stopped, or cannot write there, and its own log says which",
    });
  });

  it("does not believe one dated more than ninety seconds ahead of this clock", () => {
    const path = join(tempDir(), "hearing.json");
    writeHearing(path, file({ at: NOW + 91 }));
    expect(readHearing(path, { watch: WATCH, now: NOW })).toEqual({
      ok: false,
      kind: "ahead",
      why: `the hearing file at ${path} is dated 91s ahead of this machine's clock`,
    });
    writeHearing(path, file({ at: NOW + 90 }));
    expect(readHearing(path, { watch: WATCH, now: NOW }).ok).toBe(true);
  });

  it("strips control characters from what another process wrote before anybody logs it", () => {
    const path = join(tempDir(), "hearing.json");
    writeFileSync(
      path,
      JSON.stringify({ ...file(), relays: [{ url: "wss://b.relay", hears: false, why: "refused\n[relays] forged line" }] }),
    );
    const read = readHearing(path, { watch: WATCH, now: NOW });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.deaf.get(relayKey("wss://b.relay"))).not.toContain("\n");
  });
});
