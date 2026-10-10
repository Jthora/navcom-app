/**
 * What NavCom refuses, machine-readable.
 *
 * The EIN consensus ratified this as a network standard, and it came from here: *publish
 * your refusals where integrators look first.* It earned that by failing twice. Two nodes
 * independently proposed a NavCom feed that invariant 1 forbids, and both found the rule and
 * withdrew — after writing the proposal. Starcom drew the conclusion: *"the outbound rule
 * needs to be stated where integrators look first."*
 *
 * The constraint existed both times. It was written down both times. It lived in a document
 * a peer had to think to open, which is the same thing as arriving one round late.
 *
 * ## Why a module rather than a JSON file
 *
 * A hand-maintained JSON file is the defect the Academy found in itself: a machine-readable
 * descriptor advertising a taxonomy the code had already left behind, in the file an agent
 * parses first. *Machine-readable drift is worse than human drift* — an agent that plans
 * against a stale descriptor plans against a world that no longer exists.
 *
 * So this is the source, `.well-known/navcom-refusals.json` is generated from it, and a test
 * fails the build when the two disagree.
 *
 * ## Not a summary of the invariants
 *
 * Invariants are rules about what NavCom does. These are rules about **what NavCom will not
 * accept from anyone**, which is the half an integrator needs before drafting a proposal.
 * They overlap; they are not the same list, and this one is deliberately shorter.
 */

/** A thing NavCom will not accept, and the reason, because a bare no invites a workaround. */
export interface Refusal {
  /** Stable identifier, so a peer can cite one in an artifact. */
  id: string;
  /** What is refused, as an integrator would phrase it. */
  refuses: string;
  /** Why. Never "policy" — a reason a peer can weigh, or argue with. */
  because: string;
}

export const REFUSALS: readonly Refusal[] = [
  {
    id: 'no-person-data',
    refuses: 'Anything identifying a person being served — a name, a description, a case reference, a count of who was turned away',
    because:
      'Invariant 1. No field, no convention, no exception, and no configuration that relaxes it. Filtering happens on arrival, on NavCom\'s side, regardless of what the sender believes it removed — not from distrust, but because a redactor that documents its own incompleteness cannot be the enforcement point.'
  },
  {
    id: 'no-intake-rules',
    refuses: 'Intake rules for any facility — hours, pets, ID, sobriety, curfew, who they accept',
    because:
      'These are missing precisely because they are not publicly knowable. Supplying them from research would be guessing with an extra hop of laundering, and would poison the one dataset in this network that cannot be reconstructed. They come from a person who asked.'
  },
  {
    id: 'nothing-to-the-terminal',
    refuses: 'Any payload addressed to the Field Terminal — packages, feeds, credentials, drill seeds, corpus references, threat products',
    because:
      'The person holding the terminal is outdoors, on a prepaid phone, deciding where to send somebody at 11pm. Everything from another node lands at the Console and is weighed like any other attestation. The watch is already the human filter; there is no second one to build.'
  },
  {
    id: 'no-feed',
    refuses: 'Anything arriving as a feed, a stream, or a subscription NavCom must keep up with',
    because:
      'Operational tools open into a situation, not a timeline. A feed creates an obligation to have read it, which is the beginning of alarm fatigue in the one system where failure means somebody is hurt.'
  },
  {
    id: 'no-credential-gate',
    refuses: 'A credential, score, standing, title or rank used to gate access to anything. The one narrowing: an office held in a unit gates that unit\'s own acts, and nothing outside the unit that granted it',
    because:
      'UNCLASSIFIED only — no tiers of operator who see more by status. A claim is evidence a human weighs, never an automated permission. Ratified network-wide after the node that proposed it withdrew it: claims describe, they never gate. Units narrow this, decided 2026-10-09 and not built (/docs/design/units). A CO and an XO who can do nothing their members cannot are not offices, so an office may gate its own unit\'s acts (admitting, removing, carrying the unit\'s word, and the other acts /docs/design/units §6 lists) and nothing outside it. An office never gates anything outside the unit that granted it: the directory, the map, `Query`, the watch, `Distress`, open missions, other units and public data read the same for everyone. Titles, grade names and standing gate nothing even inside a unit, and never change its room, which is fixed at founding. Units bend "no tiers" in one place: a leader who sits in the higher unit above reads that unit\'s net as one of its members, once teaming up ships after the relay commons. The cost: inside a unit, an office holder can do what other members cannot.'
  },
  {
    id: 'no-tasking',
    refuses: 'Any message that assigns, dispatches, tasks or directs an operator from outside their own accepted chain — and any such message from the watch, an agent, a node or an integrator, in every case',
    because:
      'There is no dispatch verb. The watch tells you what is happening; it never assigns. This is why NavCom can emit only two of the network\'s six workflow phases — the other four are tasking verbs. The one narrowing is inside a unit, decided 2026-10-09 and not built (/docs/design/units). Inside a unit whose charter the member accepted before joining, orders exist only as that charter allows: the charter is shown before anyone joins, joining is the member\'s own asking, and word and offers is the default. An order expires within 7 days, never arrives by notification or the `Distress` kinds, never reaches a non-member, and ends the moment its member leaves. Anything that would bring more than one person to a place needs both the CO\'s and the XO\'s signatures. No agent holds a unit key or an office, so no agent orders anyone. The cost: under the strictest charter, declining an order may cost membership of that one unit, and never Karma, Hours, Supply, Intel or Honor. Orders also wait on a lawyer\'s review. Until they ship, this refuses every such message.'
  },
  {
    id: 'no-operator-traffic-on-a-private-relay',
    refuses: 'Carrying presence, distress, signals, corrections, places, cards, invites, or crew and unit events on a private or allowlisted relay',
    because:
      'The protection in NavCom\'s relay model is the anonymity set, not the sealing — which holds anywhere. A squad among thousands of strangers reveals nothing; the same traffic in a small allowlisted room tells its operator exactly who is active tonight, which is a list of where operators are in time if not in space. Only the artifact announcement (kind 30078) may cross such a relay: it names nobody and says nothing that is not already public on the site. Crew and unit events are covered, a higher unit\'s net included: decided 2026-10-09 and not built (/docs/design/groups, /docs/design/units). Sealing hides what a crew says, not who reads it, and on a small relay who reads it is the roster.'
  },
  {
    id: 'no-cloud-inference',
    refuses: 'Any integration requiring a hosted model, a remote inference endpoint, or a cloud service in the path',
    because:
      'Local inference only. This is the constraint most likely to collide with an always-on agent\'s convenience, and it does not move.'
  },
  {
    id: 'no-callsigns-outbound',
    refuses: 'Requests for operator records, callsigns, positions, board state, query text or endorsements',
    because:
      'None of it is disclosed on request. What an operator publishes themselves is a separate matter and always their choice: directory corrections and observations are facts about places, signed with a contact key, and carry whatever callsign the author put on them — or `anonymous`, which is the real control and is operator-side, not here. This refusal is that NavCom will not hand over, correlate, or answer questions about who said what. It was never a claim that a name an operator chose to publish stays secret, and an earlier wording said so.'
  }
] as const;

/**
 * What a peer may send, so the refusal list is not the whole answer.
 *
 * A list of noes with no yes beside it reads as a closed door, and the point of publishing
 * refusals early was to make the legal integrations *precise* rather than to have none.
 */
export const PERMITTED: readonly Refusal[] = [
  {
    id: 'publicly-knowable-context',
    refuses: 'Seasonal activation, policy changes that state what to re-verify, enforcement activity, durable situational context',
    because:
      'Console only, as attestations weighed like any other, never as directives. This is the class NavCom is structurally unable to reach: a body on foot cannot know a policy changed last week.'
  },
  {
    id: 'attested-claims',
    refuses: 'Attested claims carrying method, age, author and a declared weakness',
    because:
      'Confidence is derived, never asserted. A claim that says how it was learned can be weighed without trusting the sender\'s self-assessment.'
  }
] as const;

/** Where NavCom's cold start actually needs help, stated so a reach-oriented node can aim. */
export interface BroadcastTarget {
  /** Region slug in `data/regions/`. */
  metro: string;
  /** Where the rules an episode must work to are written. */
  rules: string;
  /** How success is counted, by NavCom, not by the broadcaster. */
  measure: string;
}

export const BROADCAST: BroadcastTarget = {
  metro: 'st-louis',
  rules: '/docs/broadcast-boundary',
  measure: 'directory records in that region carrying a verified_by and a method of phone or better'
};
