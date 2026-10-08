import { KIND_WATCH_CODE_SIGNATURE } from './kinds.js';

/**
 * The bytes a watch code's signature is over — here so the box that makes codes and the phone that
 * reads them build exactly the same ones.
 *
 * Normative [`escalation.spec.md`, *The watch code*]: a nostr event (NIP-01) that is never published,
 * of kind {@link KIND_WATCH_CODE_SIGNATURE}, `pubkey` the watch's address, `created_at` the code's
 * `t`, no tags, and `content` the JSON array, as `JSON.stringify` writes it:
 * `"navcom-watch-code-v1"`, the watch's address, the relays (each once, trimmed, sorted), the holders
 * (each once, lower-case, sorted; none for a box), and the executor's key or `null`. The code's `s`
 * is that event's signature by the watch key, so any nostr library checks it.
 *
 * The link around it, and reading one back, are the Field Terminal's
 * (`web/src/lib/terminal/watch-code.ts`).
 */

/** What a code names. */
export interface WatchCodeFields {
  pubkey: string;
  relays: readonly string[];
  holders: readonly string[];
  /** The escalation executor's own key, where the watch names one. */
  executor?: string;
}

/** Pins the construction, so these words signed for anything else are not this. */
const WATCH_CODE_SIGNATURE_V1 = 'navcom-watch-code-v1';

/** The never-published event a code's signature is over. */
export function watchCodeSignatureEvent(fields: WatchCodeFields, issuedAt: number) {
  const pubkey = fields.pubkey.toLowerCase();
  return {
    kind: KIND_WATCH_CODE_SIGNATURE,
    pubkey,
    created_at: issuedAt,
    tags: [] as string[][],
    content: JSON.stringify([
      WATCH_CODE_SIGNATURE_V1,
      pubkey,
      [...new Set(fields.relays.map((r) => r.trim()).filter(Boolean))].sort(),
      [...new Set(fields.holders.map((h) => h.trim().toLowerCase()).filter(Boolean))].sort(),
      fields.executor ? fields.executor.toLowerCase() : null,
    ]),
  };
}
