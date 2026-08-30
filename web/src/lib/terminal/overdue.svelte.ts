/**
 * The watch saying *"you are past the time you gave"* — the only thing it ever sends unasked.
 *
 * `watch-state.spec.md` requires the node to mark an overdue entry, make it visible to
 * whoever holds watch, **and attempt contact with the operator**. The daemon does all three
 * now; this is the half that makes the third one reach a person. Shipping the sending
 * without this would be a mechanism nobody can reach, which is the defect class this project
 * has hit five times.
 *
 * ## Why this is a value and not a list
 *
 * **An accumulating list of things the watch said is a feed**, and a feed is the first
 * anti-pattern in `CLAUDE.md` — it creates an obligation to have read it. So this holds one
 * current fact, the way watch state does: either the watch has told you that you are past
 * your window, or it has not. A second nudge replaces the first rather than stacking.
 *
 * ## It must never make a sound
 *
 * The field terminal is silent, and `/terminal/on-call/` states in-product that a `Distress`
 * page is the only notification NavCom ever sends. This arrives and waits to be looked at.
 * Nothing here may vibrate, badge, or raise anything.
 *
 * ## And it is not an alarm about the operator
 *
 * Being past your window means you are late, which people usually are for ordinary reasons.
 * Nothing infers anything further from it [invariant 3], and nothing else is told — the
 * nudge is addressed to the operator and to nobody else.
 */

import { KIND_RESPONSE, open, type ResponsePayload } from '@navcom/core';
import { loadConfig } from './config';
import { loadIdentity } from './identity';
import { pool } from './pool';

/** When the watch last said we were past our window, or null. Unix seconds. */
let saidAt = $state<number | null>(null);
let text = $state<string | null>(null);
let closer: { close(): void } | null = null;

export const overdue = {
  /** True when the watch has said we are past the window and we have not answered it. */
  get flagged(): boolean {
    return saidAt !== null;
  },
  /** The watch's own words, so the screen does not paraphrase them. */
  get text(): string | null {
    return text;
  },
  get at(): number | null {
    return saidAt;
  },

  /**
   * Listens for the watch's contact.
   *
   * Filtered to responses from this operator's own Watchtower, addressed to them. A
   * `#e` filter is deliberately absent: this is the one response that answers no signal the
   * device is currently waiting on — it references the sign-on, which was acked and finished
   * with long before.
   */
  start(): void {
    const config = loadConfig();
    const identity = loadIdentity();
    if (!config || !identity) return;
    closer?.close();
    closer = pool().subscribeMany(
      config.relays,
      { kinds: [KIND_RESPONSE], authors: [config.pubkey], '#p': [identity.pubkey] },
      {
        onevent: (event) => {
          let payload: ResponsePayload;
          try {
            payload = open<ResponsePayload>(identity.secretKey, config.pubkey, event.content);
          } catch {
            // Not for us, or not readable. Every other response type flows through
            // `waitForResponse`; this subscription only exists for the unsolicited one.
            return;
          }
          if (payload.type !== 'contact') return;
          // Newest wins, and nothing accumulates.
          if (saidAt !== null && event.created_at < saidAt) return;
          saidAt = event.created_at;
          text = payload.text;
        }
      }
    );
  },

  /**
   * Puts it down.
   *
   * Called when the operator answers it in the only ways that mean anything — a routine
   * check-in or a stand-down, both of which clear the overdue on the board too. Clearing it
   * on a tap the operator did not make would be the screen deciding they had answered.
   */
  clear(): void {
    saidAt = null;
    text = null;
  },

  stop(): void {
    closer?.close();
    closer = null;
  }
};
