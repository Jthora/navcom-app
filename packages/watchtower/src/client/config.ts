import { readFileSync, existsSync } from "node:fs";
import { parse } from "smol-toml";
import { relayList } from "../shared/relay-urls.js";
import { isValidHexPubkey } from "../shared/validate.js";

const MAX_CALLSIGN_LENGTH = 32;

export interface ClientConfig {
  identity: {
    privkeyPath: string;
  };
  watchtower: {
    pubkey: string;
    /**
     * Whose keys signals are sealed to.
     *
     * Absent for a box, which holds the Watchtower key itself and is therefore its own
     * holder. A squad with no box lists one pubkey per phone, handed over in the same
     * conversation that hands over the address — nothing discovers this.
     */
    holders?: string[];
  };
  relays: {
    urls: string[];
  };
  operator: {
    callsign: string | undefined;
  };
}

interface RawToml {
  identity?: { privkey_path?: string };
  watchtower?: { pubkey?: string; holders?: string[] };
  relays?: { urls?: string[] };
  operator?: { callsign?: string };
}

export function loadClientConfig(path: string): ClientConfig {
  if (!existsSync(path)) {
    throw new Error(
      `Client config not found at ${path}. Copy client.example.toml to get started -- ` +
        `you'll need the Watchtower's pubkey, printed by the daemon on first run.`,
    );
  }
  const raw = parse(readFileSync(path, "utf8")) as RawToml;

  const privkeyPath = raw.identity?.privkey_path;
  if (!privkeyPath) throw new Error(`Config missing required [identity] privkey_path (${path})`);

  const watchtowerPubkey = raw.watchtower?.pubkey;
  if (!watchtowerPubkey) throw new Error(`Config missing required [watchtower] pubkey (${path})`);
  // Found in review: this accepted ANY non-empty string, including the
  // client.example.toml template's own literal placeholder text
  // ("REPLACE_WITH_WATCHTOWER_PUBKEY") if a user forgot to fill it in,
  // or an npub (a very common Nostr paste mistake -- npub is bech32, not
  // hex). Either would fail cryptically deep inside nip44's ECDH
  // internals on the first signal sent, instead of a clear message here.
  if (!isValidHexPubkey(watchtowerPubkey)) {
    throw new Error(
      `Config [watchtower] pubkey must be 64 lowercase hex characters, got ${JSON.stringify(watchtowerPubkey)} ` +
        `(${path}) -- if you pasted an npub, decode it to hex first; the daemon prints the hex form on startup.`,
    );
  }

  const holders = raw.watchtower?.holders;
  if (holders !== undefined) {
    if (!Array.isArray(holders) || holders.length === 0) {
      throw new Error(`Config [watchtower] holders must list at least one pubkey if present (${path})`);
    }
    const badHolder = holders.find((h) => typeof h !== "string" || !isValidHexPubkey(h));
    if (badHolder !== undefined) {
      throw new Error(
        `Config [watchtower] holders contains an invalid pubkey: ${JSON.stringify(badHolder)} (${path}) -- ` +
          `each must be 64 lowercase hex characters. A wrong entry here means somebody silently cannot read signals.`,
      );
    }
  }

  const urls = relayList(raw.relays?.urls, path);

  const callsign = raw.operator?.callsign;
  if (callsign !== undefined && (typeof callsign !== "string" || callsign.length === 0 || callsign.length > MAX_CALLSIGN_LENGTH)) {
    throw new Error(`Config [operator] callsign must be 1-${MAX_CALLSIGN_LENGTH} characters if present (${path})`);
  }

  return {
    identity: { privkeyPath },
    watchtower: { pubkey: watchtowerPubkey, ...(holders ? { holders } : {}) },
    relays: { urls },
    operator: { callsign },
  };
}
