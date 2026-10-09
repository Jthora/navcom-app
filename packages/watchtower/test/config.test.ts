import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDaemonConfig } from "../src/daemon/config.js";
import { loadClientConfig } from "../src/client/config.js";

describe("loadDaemonConfig", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("parses the brief's exact sample block and applies defaults for the rest", () => {
    dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
    const path = join(dir, "watchtower.toml");
    writeFileSync(
      path,
      `[identity]
privkey_path = "/var/lib/navcom/watchtower.key"

[relays]
urls = ["wss://relay.example", "wss://relay2.example"]

[watch]
routine_interval_default = 3600
overdue_grace           = 1800
hard_expiry             = 14400
`,
    );

    const config = loadDaemonConfig(path);
    expect(config.identity.privkeyPath).toBe("/var/lib/navcom/watchtower.key");
    expect(config.relays.urls).toEqual(["wss://relay.example", "wss://relay2.example"]);
    expect(config.watch.routineIntervalDefault).toBe(3600);
    expect(config.watch.overdueGrace).toBe(1800);
    expect(config.watch.hardExpiry).toBe(14400);
    expect(config.watch.heartbeatIntervalSeconds).toBeGreaterThan(0);
    expect(config.watch.sweepIntervalSeconds).toBeGreaterThan(0);
    // No [authorization] section in the brief's sample block -- must
    // default to empty (Session One's "any pubkey" MVP policy), not
    // throw or require operators to add a section they don't need yet.
    expect(config.authorization.allowedPubkeys).toEqual([]);
  });

  it("throws a clear error when the file is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
    expect(() => loadDaemonConfig(join(dir, "nope.toml"))).toThrow(/not found/);
  });

  it("throws when required [relays] urls is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
    const path = join(dir, "watchtower.toml");
    writeFileSync(path, `[identity]\nprivkey_path = "./k"\n`);
    expect(() => loadDaemonConfig(path)).toThrow(/relays/);
  });

  it("throws when required [identity] privkey_path is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
    const path = join(dir, "watchtower.toml");
    writeFileSync(path, `[relays]\nurls = ["wss://relay.example"]\n`);
    expect(() => loadDaemonConfig(path)).toThrow(/identity/);
  });

  describe("[log] hearing_state_path: where the escalation executor writes where it hears", () => {
    const base = `[identity]\nprivkey_path = "./k"\n\n[relays]\nurls = ["wss://relay.example"]\n\n[log]\n`;

    it("is read when set, and left unset -- today's rule, no default -- when absent", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      writeFileSync(path, base + `hearing_state_path = "/var/lib/navcom-drill/hearing.json"\n`);
      expect(loadDaemonConfig(path).log.hearingStatePath).toBe("/var/lib/navcom-drill/hearing.json");
      // A default would turn every box upgraded to this version Dark until its executor wrote the file.
      writeFileSync(path, base);
      expect(loadDaemonConfig(path).log.hearingStatePath).toBeUndefined();
    });

    it("refuses an empty one or a number rather than reading it as none", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      writeFileSync(path, base + `hearing_state_path = ""\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/\[log\] hearing_state_path must be a non-empty string/);
      writeFileSync(path, base + `hearing_state_path = 7\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/\[log\] hearing_state_path must be a non-empty string/);
    });

    it("refuses the drill file or this daemon's own log as the executor's hearing file", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      writeFileSync(path, base + `drill_state_path = "/var/lib/navcom-drill/drill.json"\nhearing_state_path = "/var/lib/navcom-drill/drill.json"\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/\[log\] hearing_state_path is the same file as \[log\] drill_state_path/);
      // The defaults count: the drill file's default is where the hearing file's sits beside.
      writeFileSync(path, base + `hearing_state_path = "/var/lib/navcom/drill.json"\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/same file as \[log\] drill_state_path/);
      writeFileSync(path, base + `path = "/var/lib/navcom/a.jsonl"\nhearing_state_path = "/var/lib/navcom/a.jsonl"\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/same file as \[log\] path/);
    });
  });

  describe("numeric [watch] field validation (found in review)", () => {
    // A TOML quoting typo (`overdue_grace = "1800"`) used to satisfy
    // `?? default` (a non-undefined value) and flow through as a STRING
    // despite DaemonConfig's type declaring `number` -- downstream,
    // `entry.expectedUntil + overdueGraceSeconds` with a string operand
    // is JS string concatenation, not addition, silently corrupting
    // every overdue/hard-expiry comparison instead of failing loudly.
    const base = `[identity]\nprivkey_path = "./k"\n\n[relays]\nurls = ["wss://relay.example"]\n\n[watch]\n`;

    function writeConfig(dir: string, watchLine: string): string {
      const path = join(dir, "watchtower.toml");
      writeFileSync(path, base + watchLine);
      return path;
    }

    it("rejects a quoted (string) numeric value", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = writeConfig(dir, `overdue_grace = "1800"\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/overdue_grace must be a positive number/);
    });

    it("rejects zero", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = writeConfig(dir, `heartbeat_interval_seconds = 0\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/heartbeat_interval_seconds must be a positive number/);
    });

    it("rejects a negative value", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = writeConfig(dir, `hard_expiry = -100\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/hard_expiry must be a positive number/);
    });

    it("accepts a genuinely absent field and falls back to the default", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = writeConfig(dir, `routine_interval_default = 7200\n`); // omit the rest
      const config = loadDaemonConfig(path);
      expect(config.watch.routineIntervalDefault).toBe(7200);
      expect(config.watch.overdueGrace).toBeGreaterThan(0); // default applied, not thrown
    });

    it("refuses an age window a phone could read the watch as up past, and says why [#4]", () => {
      // A phone reads the watch as up until its state is 300s old by the phone's own clock. At 120,
      // a phone 200s off read it as up while sign-on, Query and Distress all got silence.
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = writeConfig(dir, `max_event_age_seconds = 120\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/max_event_age_seconds must be at least 300, got 120/);
      expect(() => loadDaemonConfig(path)).toThrow(/reads this watch as up/);
    });

    it("accepts an age window of the threshold or wider", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      expect(loadDaemonConfig(writeConfig(dir, `max_event_age_seconds = 300\n`)).watch.maxEventAgeSeconds).toBe(300);
      expect(loadDaemonConfig(writeConfig(dir, `max_event_age_seconds = 900\n`)).watch.maxEventAgeSeconds).toBe(900);
    });
  });

  describe("relay URL validation (found in review)", () => {
    it("rejects a URL missing the ws:// or wss:// scheme", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      writeFileSync(path, `[identity]\nprivkey_path = "./k"\n\n[relays]\nurls = ["relay.example.com"]\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/invalid entry/);
    });

    it("accepts a mix of ws:// and wss://", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      writeFileSync(path, `[identity]\nprivkey_path = "./k"\n\n[relays]\nurls = ["ws://local.relay", "wss://remote.relay"]\n`);
      expect(() => loadDaemonConfig(path)).not.toThrow();
    });

    it("keeps one relay once, however it was written [review: relay paths]", () => {
      // Two spellings were two entries here and one connection in the pool, which refused the
      // second publish -- so the heartbeat logged a refusal and an acceptance on every beat.
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      writeFileSync(
        path,
        `[identity]\nprivkey_path = "./k"\n\n[relays]\nurls = ["wss://nos.lol", "wss://nos.lol/", "WSS://NOS.LOL", "wss://relay.damus.io"]\n`,
      );
      expect(loadDaemonConfig(path).relays.urls).toEqual(["wss://nos.lol", "wss://relay.damus.io"]);
    });

    it("refuses an address the pool could not dial, by name, at startup", () => {
      // nostr-tools throws for the whole list on one of these, so it would have failed later, everywhere.
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      writeFileSync(path, `[identity]\nprivkey_path = "./k"\n\n[relays]\nurls = ["wss://exa mple"]\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/invalid entry.*exa mple/);
    });
  });

  describe("[authorization] allowlist (Stage 2)", () => {
    const base = `[identity]\nprivkey_path = "./k"\n\n[relays]\nurls = ["wss://relay.example"]\n\n`;

    it("parses a real allowlist of valid hex pubkeys", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      const pk1 = "a".repeat(64);
      const pk2 = "b".repeat(64);
      writeFileSync(path, `${base}[authorization]\nallowed_pubkeys = ["${pk1}", "${pk2}"]\n`);
      const config = loadDaemonConfig(path);
      expect(config.authorization.allowedPubkeys).toEqual([pk1, pk2]);
    });

    it("defaults to empty when [authorization] is entirely absent", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      writeFileSync(path, base);
      const config = loadDaemonConfig(path);
      expect(config.authorization.allowedPubkeys).toEqual([]);
    });

    it("defaults to empty when allowed_pubkeys is present but empty", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      writeFileSync(path, `${base}[authorization]\nallowed_pubkeys = []\n`);
      const config = loadDaemonConfig(path);
      expect(config.authorization.allowedPubkeys).toEqual([]);
    });

    it("rejects a non-hex or wrong-length pubkey entry", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      writeFileSync(path, `${base}[authorization]\nallowed_pubkeys = ["not-a-real-pubkey"]\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/invalid entry/);
    });

    it("rejects an uppercase-hex pubkey (must be lowercase, matching nostr-tools convention)", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      writeFileSync(path, `${base}[authorization]\nallowed_pubkeys = ["${"A".repeat(64)}"]\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/invalid entry/);
    });

    it("rejects allowed_pubkeys that isn't an array", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-cfg-"));
      const path = join(dir, "watchtower.toml");
      writeFileSync(path, `${base}[authorization]\nallowed_pubkeys = "${"a".repeat(64)}"\n`);
      expect(() => loadDaemonConfig(path)).toThrow(/must be an array/);
    });
  });
});

describe("loadClientConfig", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("parses a valid client config", () => {
    dir = mkdtempSync(join(tmpdir(), "watchtower-client-cfg-"));
    const path = join(dir, "client.toml");
    writeFileSync(
      path,
      `[identity]
privkey_path = "./operator.key"

[watchtower]
pubkey = "${"a".repeat(64)}"

[relays]
urls = ["wss://relay.example"]

[operator]
callsign = "OP-1"
`,
    );
    const config = loadClientConfig(path);
    expect(config.watchtower.pubkey).toBe("a".repeat(64));
    expect(config.operator.callsign).toBe("OP-1");
  });

  it("throws when [watchtower] pubkey is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "watchtower-client-cfg-"));
    const path = join(dir, "client.toml");
    writeFileSync(
      path,
      `[identity]\nprivkey_path = "./operator.key"\n\n[relays]\nurls = ["wss://relay.example"]\n`,
    );
    expect(() => loadClientConfig(path)).toThrow(/watchtower/);
  });

  it("callsign is optional", () => {
    dir = mkdtempSync(join(tmpdir(), "watchtower-client-cfg-"));
    const path = join(dir, "client.toml");
    writeFileSync(
      path,
      `[identity]
privkey_path = "./operator.key"

[watchtower]
pubkey = "${"a".repeat(64)}"

[relays]
urls = ["wss://relay.example"]
`,
    );
    const config = loadClientConfig(path);
    expect(config.operator.callsign).toBeUndefined();
  });

  describe("watchtower pubkey format validation (found in review)", () => {
    function writeConfig(dir: string, pubkey: string): string {
      const path = join(dir, "client.toml");
      writeFileSync(
        path,
        `[identity]\nprivkey_path = "./operator.key"\n\n[watchtower]\npubkey = "${pubkey}"\n\n[relays]\nurls = ["wss://relay.example"]\n`,
      );
      return path;
    }

    it("rejects the example-config's own literal placeholder text", () => {
      // The exact real-world footgun this fix exists for: a user who
      // forgets to replace client.example.toml's placeholder used to
      // get a cryptic failure deep inside nip44's ECDH internals on the
      // very first signal sent, instead of a clear error here.
      dir = mkdtempSync(join(tmpdir(), "watchtower-client-cfg-"));
      const path = writeConfig(dir, "REPLACE_WITH_WATCHTOWER_PUBKEY");
      expect(() => loadClientConfig(path)).toThrow(/64 lowercase hex/);
    });

    it("rejects an npub (bech32, not hex) -- a very common paste mistake", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-client-cfg-"));
      const path = writeConfig(dir, "npub1" + "q".repeat(58));
      expect(() => loadClientConfig(path)).toThrow(/64 lowercase hex/);
    });

    it("rejects the wrong length", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-client-cfg-"));
      const path = writeConfig(dir, "a".repeat(63));
      expect(() => loadClientConfig(path)).toThrow(/64 lowercase hex/);
    });

    it("rejects uppercase hex", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-client-cfg-"));
      const path = writeConfig(dir, "A".repeat(64));
      expect(() => loadClientConfig(path)).toThrow(/64 lowercase hex/);
    });

    it("accepts a valid 64-char lowercase hex pubkey", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-client-cfg-"));
      const path = writeConfig(dir, "b".repeat(64));
      expect(() => loadClientConfig(path)).not.toThrow();
    });
  });

  describe("relay URL and callsign validation (found in review)", () => {
    it("rejects a relay URL missing the ws:// or wss:// scheme", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-client-cfg-"));
      const path = join(dir, "client.toml");
      writeFileSync(
        path,
        `[identity]\nprivkey_path = "./operator.key"\n\n[watchtower]\npubkey = "${"a".repeat(64)}"\n\n[relays]\nurls = ["relay.example.com"]\n`,
      );
      expect(() => loadClientConfig(path)).toThrow(/invalid entry/);
    });

    it("rejects an overlong callsign", () => {
      dir = mkdtempSync(join(tmpdir(), "watchtower-client-cfg-"));
      const path = join(dir, "client.toml");
      writeFileSync(
        path,
        `[identity]\nprivkey_path = "./operator.key"\n\n[watchtower]\npubkey = "${"a".repeat(64)}"\n\n[relays]\nurls = ["wss://relay.example"]\n\n[operator]\ncallsign = "${"x".repeat(40)}"\n`,
      );
      expect(() => loadClientConfig(path)).toThrow(/callsign/);
    });
  });
});
