/**
 * Which relay addresses this phone can actually reach — one rule, for every list that holds them.
 *
 * A leaf, so the watch config and the relay list can both use it without importing each other.
 *
 * **A prefix check was not a rule.** `wss://` alone, an out-of-range port or a stray `>` all
 * passed it, and nostr-tools then threw for the whole list: one typo on one line of a watch
 * config made every Distress read "never left the phone", and the watch-state read threw out of
 * the start screen's `onMount`, leaving it frozen without its Distress control [audit: relay
 * paths, F01].
 *
 * **And `ws://` is only reachable from here.** A page served over https cannot open `ws://` to any
 * other host — the browser blocks it as mixed content, and on an iPhone even `ws://localhost` —
 * so such an entry was a relay that never answered [audit: relay paths, F21]. It is accepted for
 * a relay on this device, and on a plain-http page, which is how development and the browser
 * tests run.
 */

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;

/** Why an address was refused, in words an operator can act on; null when it is fine. */
export function whyNotReachable(address: string, pageProtocol = pageScheme()): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return `"${address}" is not a relay address — expected wss://`;
  }
  if (!url.hostname) return `"${address}" names no relay — expected wss://relay.example`;
  if (url.protocol === 'wss:') return null;
  if (url.protocol === 'ws:') {
    if (LOOPBACK.test(url.hostname) || pageProtocol === 'http:') return null;
    return `"${address}" — ws:// only reaches a relay on this device; one anywhere else needs wss://`;
  }
  return `"${address}" is not a relay address — expected wss://`;
}

/** The address as this phone will dial it, or null when it cannot. */
export function reachableRelay(address: string, pageProtocol = pageScheme()): string | null {
  if (whyNotReachable(address, pageProtocol) !== null) return null;
  return new URL(address.trim()).href.replace(/\/$/, '');
}

/** Only addresses this phone can reach, each once, in the order given. */
export function usable(urls: readonly string[], pageProtocol = pageScheme()): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    const r = typeof u === 'string' ? reachableRelay(u, pageProtocol) : null;
    if (r) out.add(r);
  }
  return [...out];
}

function pageScheme(): string {
  return globalThis.location?.protocol ?? 'https:';
}
