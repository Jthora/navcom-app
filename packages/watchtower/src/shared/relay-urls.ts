import { normalizeURL } from "nostr-tools/utils";

/**
 * A config's relay list: each address checked, and each relay kept once however it was written.
 *
 * Two spellings of one relay -- `wss://x` and `wss://x/`, or a line pasted twice -- were two
 * entries here and one connection in the pool, which refuses the second publish with "duplicate
 * url". The heartbeat then logged a refusal and an acceptance on every beat, the flood its
 * once-per-change rule exists to stop, and the startup line's k/N disagreed with the warning's
 * [review: relay paths]. An address the pool cannot parse throws there for the whole list, so it
 * is refused here, by name, at startup.
 */
export function relayList(urls: unknown, where: string): string[] {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error(`Config missing required [relays] urls (${where})`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    let same: string | null = null;
    if (typeof u === "string" && /^wss?:\/\/./i.test(u)) {
      try {
        same = normalizeURL(u);
      } catch {
        same = null;
      }
    }
    if (same === null) {
      throw new Error(
        `Config [relays] urls contains an invalid entry (must be a ws:// or wss:// address): ${JSON.stringify(u)} (${where})`,
      );
    }
    // Compared as the pool keys them, kept as the operator wrote them, so the logs name it that way.
    if (seen.has(same)) continue;
    seen.add(same);
    out.push(u as string);
  }
  return out;
}
