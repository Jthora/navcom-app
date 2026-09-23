/**
 * Checking that a handle on a card belongs to the person who published it.
 *
 * A link in `links.ts` is a **claim** — *"I am also this account"* — and it is rendered as one,
 * because nothing has ever checked it. [NIP-39](https://github.com/nostr-protocol/nips/blob/master/39.md)
 * defines the check: the operator posts a sentence naming their own key somewhere only they can
 * post, and the `i` tag carries a pointer to it. The field has been in the tag shape since links
 * shipped and nothing has ever filled it.
 *
 * ## Why this is the cheapest thing in the profile stack, and worth more than a badge
 *
 * The question people actually ask of a profile is *"is this a person, and is it the person I
 * think?"* — not *"what are they qualified in?"*. A proof answers the first. It needs no
 * vocabulary, no verifier, no invariant widened and no new event: the tag already exists, the
 * proof is fetched from a public URL, and a false claim is disproven rather than merely
 * unsupported. Somebody with a following is impersonated long before they are asked for a
 * certificate — see [`verified-capabilities.md`](../../../../docs/product/verified-capabilities.md),
 * which puts this rung ahead of the one below it for exactly that reason.
 *
 * ## Two platforms, because two of them answer without a key
 *
 * Every other platform in the registry either refuses unauthenticated reads or refuses
 * cross-origin ones, and a check that cannot run in a browser cannot run here at all — there is
 * no server. GitHub and Mastodon both serve a public JSON document with permissive CORS, so
 * those are the two. The list grows when a platform's own endpoint does, never by scraping HTML.
 *
 * ## Nothing here fetches anything
 *
 * This module builds the request and judges the answer. It never performs one. That is not
 * tidiness: `who/` is designed so no relay and no platform learns that somebody opened a card,
 * and the screen says so in those words. A proof check contacts a platform, so it happens on a
 * tap, once, for one link — never on load, and never for all of them.
 */

import { npubEncode } from 'nostr-tools/nip19';
import { checkedHandle, type CardLink } from './links.js';

/**
 * The sentence NIP-39 asks for, without the quoting the examples disagree about.
 *
 * The specification's GitHub example carries the key bare and its Mastodon example carries it
 * quoted, so requiring either exactly would refuse half of the proofs that exist. The phrase and
 * the key are what carry meaning, and both are checked; the punctuation between them is not.
 */
export const PROOF_PHRASE = 'Verifying that I control the following Nostr public key';

/** The statement an operator publishes, in the form to show them when they are making one. */
export function proofStatement(pubkey: string): string {
  return `${PROOF_PHRASE}: ${npubEncode(pubkey)}`;
}

/** Where a reader would fetch the proof, and what shape the answer is in. */
export interface ProofRequest {
  /** A public JSON endpoint. GET, no credentials, no key. */
  url: string;
  /** Which platform's answer shape to expect. */
  kind: 'github' | 'mastodon';
  /** The page a person can open to read the proof themselves, rather than trusting this. */
  human: string;
}

/**
 * What a check concluded.
 *
 * `refuted` exists separately from `unproven` because they are different facts about the world:
 * a document that names somebody else's key, or that belongs to a different account, is evidence
 * the claim is false. A document that could not be read is evidence of nothing, and invariant 9
 * governs it — blank reads *unknown*, never *no*.
 */
export type ProofState = 'proven' | 'unproven' | 'refuted' | 'unprovable';

export interface ProofResult {
  state: ProofState;
  /** Five words or fewer, for a readout. `panel.md` rule 2. */
  readout: string;
  /** One sentence, for the `Why` beneath it. */
  reason: string;
}

const GIST = /^[0-9a-f]{6,64}$/i;
const STATUS = /^[0-9A-Za-z]{1,40}$/;

/**
 * Builds the request for a link that carries a proof, or null.
 *
 * Null covers three different situations deliberately conflated here: no proof was published,
 * the platform has no public check, or the pointer is malformed. All three mean *there is
 * nothing to fetch*, and the caller distinguishes them with `checkProof` when it needs to.
 */
export function proofRequest(link: CardLink): ProofRequest | null {
  const proof = link.proof?.trim();
  if (!proof) return null;

  // Checked by the platform table rather than here, so the rule about what may be spliced into
  // an authority has one home. A handle from `readLinks` has already passed this; one built by
  // hand has not, and this runs on both.
  const handle = checkedHandle(link.platform, link.handle);
  if (handle === null) return null;

  if (link.platform === 'github') {
    if (!GIST.test(proof)) return null;
    return {
      url: `https://api.github.com/gists/${proof}`,
      kind: 'github',
      human: `https://gist.github.com/${handle}/${proof}`
    };
  }

  if (link.platform === 'mastodon') {
    if (!STATUS.test(proof)) return null;
    const [instance, user] = handle.split('/') as [string, string];
    return {
      url: `https://${instance}/api/v1/statuses/${proof}`,
      kind: 'mastodon',
      human: `https://${instance}/@${user}/${proof}`
    };
  }

  return null;
}

/** Whether a platform can be proven at all, for deciding what to offer rather than what to show. */
export const canProve = (platform: string): boolean =>
  platform === 'github' || platform === 'mastodon';

/** Tags out, entities in the few forms that matter, whitespace collapsed. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Case-insensitive account comparison. A handle is not case-sensitive on either platform. */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Judges a fetched document. Never throws — a reader passing whatever came back must get a
 * result, not an exception, because this runs on a tap during a patrol.
 *
 * `body` is the parsed JSON, or null when it could not be fetched or parsed.
 */
export function checkProof(
  link: CardLink,
  pubkey: string,
  body: unknown
): ProofResult {
  if (!canProve(link.platform)) {
    return {
      state: 'unprovable',
      readout: 'No check',
      reason: `${link.platform} publishes nothing a reader can check without an account, so this handle stays a claim.`
    };
  }
  if (!link.proof?.trim()) {
    return {
      state: 'unproven',
      readout: 'Claim',
      reason: 'No proof was published with this handle. It says only what its holder says.'
    };
  }
  if (!proofRequest(link)) {
    return {
      state: 'unproven',
      readout: 'Bad pointer',
      reason: 'The proof named here is not the shape this platform uses, so there is nothing to fetch.'
    };
  }
  if (body === null || typeof body !== 'object') {
    return {
      state: 'unproven',
      readout: 'Not checked',
      reason: 'The proof could not be read. That says nothing either way — unknown is not no.'
    };
  }

  const npub = npubEncode(pubkey);
  const doc = body as Record<string, unknown>;

  if (link.platform === 'github') {
    const owner = (doc.owner as Record<string, unknown> | undefined)?.login;
    const files = doc.files as Record<string, { content?: unknown }> | undefined;
    const contents = files
      ? Object.values(files)
          .map((f) => (typeof f?.content === 'string' ? f.content : ''))
          .join('\n')
      : '';
    if (typeof owner !== 'string' || !contents) {
      return {
        state: 'unproven',
        readout: 'Not checked',
        reason: 'The gist came back without an owner or without contents, so nothing was established.'
      };
    }
    // Ownership first: a gist written by somebody else that happens to name this key proves
    // nothing about who holds the handle, and is the obvious way to fake one.
    if (!same(owner, link.handle)) {
      return {
        state: 'refuted',
        readout: 'Someone else',
        reason: `That gist belongs to ${owner}, not to ${link.handle}.`
      };
    }
    return statement(text(contents), npub, link);
  }

  const account = doc.account as Record<string, unknown> | undefined;
  const user = (checkedHandle('mastodon', link.handle) ?? '').split('/')[1] ?? '';
  const named =
    (typeof account?.username === 'string' && same(account.username, user)) ||
    (typeof account?.acct === 'string' && same(String(account.acct).split('@')[0], user));
  const content = typeof doc.content === 'string' ? doc.content : '';
  if (!account || !content) {
    return {
      state: 'unproven',
      readout: 'Not checked',
      reason: 'The post came back without an author or without text, so nothing was established.'
    };
  }
  if (!named) {
    return {
      state: 'refuted',
      readout: 'Someone else',
      reason: `That post was written by ${String(account.acct ?? account.username ?? 'another account')}, not by ${user}.`
    };
  }
  return statement(text(content), npub, link);
}

function statement(body: string, npub: string, link: CardLink): ProofResult {
  const hasPhrase = body.toLowerCase().includes(PROOF_PHRASE.toLowerCase());
  const hasKey = body.includes(npub);
  if (hasPhrase && hasKey) {
    return {
      state: 'proven',
      readout: 'Proven',
      reason: `${link.handle} published this key, so the same person holds both.`
    };
  }
  if (hasPhrase && !hasKey) {
    // The sharpest failure available: a real proof, for a different key. Somebody has copied
    // somebody else's pointer, or the card was published by a different person than the handle.
    return {
      state: 'refuted',
      readout: 'Other key',
      reason: 'That proof names a different key, so it does not belong to this card.'
    };
  }
  return {
    state: 'unproven',
    readout: 'No statement',
    reason: 'What was published there does not say it controls this key.'
  };
}
