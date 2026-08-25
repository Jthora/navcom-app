/**
 * Event kinds.
 *
 * Chosen so that live traffic is unstored and current watch state is retrievable by a
 * client that has just connected.
 *
 * Normative source: docs/spec/signals.spec.md
 */

/** Replaceable. Watch state — a cold client MUST be able to read this before signing on. */
export const KIND_WATCH_STATE = 10910;

/** Ephemeral. Peer-to-peer presence, wrapped so no relay can see who talks to whom. */
export const KIND_PEER_PRESENCE = 20913;

/**
 * Replaceable. An operator's public card — the one artifact they choose to be findable by.
 *
 * Signed by a **contact key**, never the operational one. See `events/public.ts` for why
 * that separation is load-bearing rather than tidy.
 */
export const KIND_CARD = 10911;

/**
 * Replaceable. An operator's ML-KEM-768 public key.
 *
 * Published rather than exchanged in person because it is 1184 bytes and a pairing code is
 * 32 — see `events/key-bundle.ts` for why that difference decides it.
 */
export const KIND_KEY_BUNDLE = 10912;

/**
 * Addressable. A correction to a directory record — *"St Pat's shut intake at 20:30"*.
 *
 * Keyed on the record, so an operator's latest word about a place replaces their earlier
 * word rather than accumulating. Signed by the contact key, so contributing publicly costs
 * no operational exposure.
 */
export const KIND_CORRECTION = 30911;

/**
 * Addressable. A place the published directory does not have — *"there is a shelter here."*
 *
 * Separate from `KIND_CORRECTION` because the failure modes differ: a wrong field sends
 * somebody to the wrong hours, a wrong place sends them to an address that is not there. It
 * carries its own validation, and only a method that means somebody went or phoned.
 *
 * Keyed on an id derived from the name and address, so two operators adding the same
 * building produce one row rather than two. Tagged `g` with the region, because a device in
 * an empty region has no record ids to subscribe by — which is the whole reason it exists.
 */
export const KIND_PLACE = 30915;

/**
 * Ephemeral. *"Raven is out tonight."* A name and a region, and nothing else ever.
 *
 * Also signed by the contact key, so it is verifiably the same Raven whose card is up
 * without exposing the key their peers address.
 */
export const KIND_PUBLIC_PRESENCE = 20914;

/**
 * Regular, and therefore **stored** — the one thing here a relay is meant to keep.
 *
 * An invite has to wait for somebody who is asleep. Everything else in this system is
 * ephemeral because a queryable history is the failure mode [C27]; an invite is the
 * exception because a request that expires in sixty seconds is not a request.
 */
export const KIND_INVITE = 1910;

/**
 * A credential — *"I vouch for the holder of this."*
 *
 * **Never published.** Handed over the way everything else here is, because indexing it
 * anywhere would build the social graph this design exists to avoid. Addressable so that a
 * revocation can name it.
 */
export const KIND_CREDENTIAL = 30912;

/** Taking one up, binding it to a persona. Also never published. */
export const KIND_CLAIM = 30913;

/**
 * Withdrawing a credential. **Published**, unlike the credential itself, because a reader
 * has to be able to find it — and it names only the credential, so it reveals nobody.
 */
export const KIND_REVOCATION = 30914;

/**
 * Addressable. *"My directory is now this hash."* — the pointer, never the payload.
 *
 * `30078` rather than a number of NavCom's own: NIP-78 is the existing convention for
 * application-specific replaceable data, so nothing has to be allocated or defended, and any
 * node can read one with an off-the-shelf library.
 *
 * **The only kind here that may cross a private relay.** Everything else NavCom publishes is
 * about an operator, and a small allowlisted relay is worse for those than a public one — the
 * protection is the anonymity set, not the sealing. This names no operator and says nothing that
 * is not already public on the site.
 */
export const KIND_ANNOUNCE = 30078;

/** Ephemeral. Signals: on-station, routine, query, assist, stood-down. */
export const KIND_SIGNAL = 20910;

/** Ephemeral. Distress — its own kind so it is prioritised independently of routine traffic. */
export const KIND_DISTRESS = 20911;

/** Ephemeral. Responses: acknowledgements and answers. */
export const KIND_RESPONSE = 20912;

/**
 * Ephemeral kinds (20000–29999) are not expected to be stored by relays. That is
 * load-bearing rather than incidental: the board must never become a queryable history
 * [C27].
 */
export const isEphemeral = (kind: number): boolean => kind >= 20000 && kind <= 29999;

export const SIGNAL_TYPES = [
  'on-station',
  'routine',
  'query',
  'assist',
  'stood-down',
  /**
   * "Show me what you have written about me" [C33].
   *
   * A signal rather than a new kind, because it is an ordinary request to the watch with an
   * ordinary answer — and the kind table stays at four. Note there is no subject field to
   * ask with: the node answers about whoever signed the request, so asking for somebody
   * else's record is not a permission the payload can express.
   */
  'log-review',
  /**
   * "I have this" — an on-call human accepting a `Distress`, and the only thing that stops
   * the ladder.
   *
   * A signal rather than a new kind: it is a message to the watch like any other. It MUST
   * be an explicit act by a person. A delivery receipt, a read receipt or an app-open event
   * MUST NOT be routed into it — someone whose phone buzzed is not someone who woke up.
   */
  'distress-ack',
  /**
   * *"I ran out of socks."*
   *
   * A **request, not a tally.** The Quartermaster's question is "what should I buy next",
   * and the obvious answer — everyone reports what they handed out — is the wrong shape
   * twice over: it is a feed and it is a count, and a per-operator total published to a
   * squad is a leaderboard whatever it is called.
   *
   * A need has none of that. It carries no number, it is sparse because you only say it
   * when it is true, and it travels because somebody chose to send it rather than because
   * the system collected it. There is also nothing to merge, so the "several people editing
   * offline" problem does not arise rather than being solved.
   *
   * The operator's patrol record stays purely local. Nothing about what anybody carried or
   * gave away is transmitted, now or ever.
   */
  'resupply'
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

/** The signal type travels as an UNENCRYPTED `t` tag so a client can filter without decrypting. */
export const tagSignalType = (t: SignalType): [string, string] => ['t', t];
export const tagRecipient = (pubkey: string): [string, string] => ['p', pubkey];
export const tagInReplyTo = (eventId: string): [string, string] => ['e', eventId];

export function readTag(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}
