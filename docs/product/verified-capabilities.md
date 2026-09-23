# Verified Capabilities

**Designed, not built, and gated on decisions that are not technical.** The research behind it
is [`credential-verification.md`](../research/credential-verification.md); the standing decision
is [`profiles.md` §6](profiles.md), which says *write it down, do not build it* until a
credentialed professional actually asks. This page is the *how*, so that the day one does, the
shape is already argued rather than improvised.

Nothing here is normative until it is built and the gates in §11 are answered.

## 1. What this is

A way for an operator to show, **at their own choice**, that somebody checked a capability they
hold — *current first aid*, *de-escalation training*, *peer recovery specialist* — with the
check's method and age visible, and with no way for anyone to rank, sort or search by it.

What it is not: access, authority, permission, or a tier. Nothing in NavCom reads a capability
to decide anything. `no-credential-gate` stands exactly as written — **claims describe, they
never gate** — and this adds no exception to it.

## 2. Four rungs, of which three exist

| | Says | Checked by | Status |
|---|---|---|---|
| Activity tag | *carries a kit* | nothing — not a qualification | Built (`events/profile.ts`) |
| Peer credential | *I vouch for the holder as a medic* | a signature, offline, naming nobody | Built (`events/endorsement.ts`) |
| Handle proof | *this persona controls that account* | fetching a public post | Half-built — `i` tags carry a proof field almost nothing fills |
| **Verified capability** | *an issuer says this key holds this, checked this way, until this date* | a signature, plus the method on its face | **This page** |

The third rung is the cheapest and answers the bot question better than the fourth does. Build
it first if the goal is "is this a person".

## 3. Wire format — NIP-58, not a NavCom invention

[NIP-58](https://github.com/nostr-protocol/nips/blob/master/58.md) already carries exactly this
shape, and it solves the defect §6 identified in our own primitive: a NavCom credential is a
bearer token that binds to whoever holds it, and **a licence that transfers is not a licence.**
A NIP-58 award is subject-bound and non-transferable by construction.

| Object | Kind | Author | Carries |
|---|---|---|---|
| Capability definition | `30009` | the verifier | `d = cap:<vocabulary-id>`, name, description |
| Award | `8` | the verifier | `a` → the definition, `p` → the operator's **contact** pubkey, payload in content |
| Display | `10008` | the operator | Which awards to show, and in what order — **the opt-in is the standard's, not ours** |
| Revocation | `30914` | the verifier | The award's event id. NavCom's existing revocation kind; NIP-58 has none |

The award's content is a JSON object with an allowlist enforced **refuse-not-trim**, the same
rule as `CARD_FIELDS` and `OBSERVATION_FIELDS`:

```
capability   the vocabulary id, matching the definition
method       issuer-signed | issuer-lookup | registry | document | vouch
checked_at   unix seconds, when the verifier looked
expires      unix seconds, from the issuer where one exists
issuer       the body that issued the underlying credential, by name
attest       optional — a hash of the credential presented, so a third party can re-check
```

Two rules about what is *not* here. **No licence number, ever** — it is a legal name with extra
steps, and publishing one resolves in a single free hop to a name, a city and a disciplinary
history. And **no remote image**: NIP-58 definitions may carry an image URL, and NavCom ignores
it and draws its own glyph from the vocabulary id, because a badge image fetched from a
third-party host is a tracking pixel on an operator's profile.

**Binding to the contact key, never the operational key**, is not optional. The split is what
makes being findable cost no operational exposure, and a badge on the operational key would
spend exactly that.

## 4. Verification, in order, refusing rather than trimming

A reader performs these in sequence. Any failure refuses the badge; none of them renders it
partially.

1. The award's signature verifies (secp256k1 schnorr — already in the bundle).
2. It is kind `8`, with one `a` tag and a `p` tag matching the persona being rendered.
3. The definition at `a` resolves, **and its author is the award's author** — an issuer may only
   award its own definitions.
4. The capability id is in the closed vocabulary (§5). Unknown reads *unknown*; it is never
   rendered as a generic badge.
5. The content payload parses and carries only allowlisted fields, with `method` in the
   taxonomy and `checked_at`/`expires` finite.
6. No `30914` revocation names this award.
7. `expires` is the **issuer's** fact, carried and shown. It is not a timer NavCom runs.
   Milestone 7 settled this for the endorsement beside it — *nothing lapses on a timer; show the
   age and let the reader weigh it, and a second rule for the same problem would be a rule too
   many* — and an issuer's own stated date is a dated fact like any other, not a second rule. So
   a badge past its date renders as past its date and is never removed, and NavCom refuses none
   of them on its own clock. The device's clock is not evidence either: `declined.md` already
   declined marking a contribution clock-unverified.
8. If an `attest` credential is attached (§7), it verifies too, or the badge renders as
   *issuer-signed* downgraded to *unverifiable on this device* — never as verified.

## 5. The vocabulary — closed, and not agent work

Same rule as the Raw Intel tag vocabulary and the activity tags: **the mechanism can be built
against a placeholder; the words need a person with local knowledge.** A draft skeleton, to be
replaced:

- **medical** — `first-aid`, `cpr`, `bleeding-control`, `naloxone`, `wilderness-first-responder`
- **crisis** — `mental-health-first-aid`, `de-escalation`, `crisis-intervention`
- **operational** — `driver`, `radio-operator`, `search-and-rescue`
- **peer** — `peer-recovery-specialist`

Every term names a **capability**, never an affiliation. The line is from `credential-verification.md`:
a capability changes what somebody does in the next ten minutes; an affiliation says who they
are. Affiliations are refused (§9).

## 6. The verifier

A node with a key, outside the app. Not NavCom, and not one of them — **anyone may run one**,
and every award names its issuer so a reader weighs the verifier rather than a checkmark.

- **Requests arrive over relays**, sealed and addressed to the verifier's key. There is no
  inbound HTTP surface, no endpoint to attack, and no redirect URI to register. The escalation
  executor is the same skeleton — relay subscription, sealed payloads, an accountability log.
- **The verifier keeps nothing.** It sees the evidence, it checks, it signs, it discards. Its
  accountability log records *that a check happened and by what method*, never what was seen.
  The link between a legal name and a persona is the most valuable object in this network and
  it must not come to rest anywhere.
- **It publishes its method declaration** — which capabilities it checks, by which method, and
  what it refuses — generated from its code, the way `navcom-refusals.json` is.
- **Signing happens on hardware somebody holds.** A checker may run in a cloud function where a
  registry demands it; the signing key does not go there. A compromised verifier key mints
  credentials, and neither project has a key-rotation story yet.

### Method taxonomy

`issuer-signed` — a credential signed by the issuing body, verified cryptographically.
`issuer-lookup` — the issuer's own public verification surface confirmed it.
`registry` — a government registry that is not the issuer.
`document` — a person looked at the certificate and judged it genuine.
`vouch` — somebody who trained or worked with them says so.

NavCom prints the method and never a grade. Weight is derived by the reader, the same rule that
governs `saw` / `told` / `inferred` on an observation.

## 7. Holder-presented credentials, where an issuer supports them

The strategic direction, and the only path where verification does **not** cost the operator
their pseudonymity:

- **Accept VC-JWT** (Open Badges 3.0 / W3C VC over JOSE), verified with ES256 or RS256 through
  WebCrypto, which the device floor has had for years.
- **Refuse Linked Data Proofs.** JSON-LD canonicalisation is a dependency measured in hundreds
  of kilobytes against a 220 kB budget with 140.5 kB already spent. The budget decides it.
- **Treat Ed25519 as unavailable.** Chrome shipped it in M137 (May 2026); the floor is older.
  A credential we cannot check renders as *unverifiable here*, never as verified.
- **Selective disclosure** (SD-JWT, RFC 9901) is the point: prove *current first aid from this
  issuer, expiring March 2027* without a name or a certificate number. Where the issuer supports
  it, the verifier requests the minimum disclosure that establishes the capability and no more.
- **Key binding** — a `cnf` claim plus a holder-signed token over a nonce the verifier generates
  offline — is what stops a leaked credential being replayed by whoever found it. Without it, a
  presented credential is a bearer token again, and we are back at §6's objection.
- **Status lists are optional and never blocking.** Fetching a Bitstring Status List is a network
  call; offline it renders *status unknown*, which is what invariant 9 requires anyway.

## 8. Rendering — where most of the harm would enter

Normative if built, and each line is a refusal of something conventional.

- **The issuer's name, always. A checkmark, never.** Cryptography proves provenance, not
  competence, and a certificate mill's signature verifies perfectly. Provenance by name is
  already the project's answer to this class of problem.
- **The method and the age are shown beside the capability**, not behind a tap.
- **Age is always shown; expiry is shown when the issuer stated one.** Neither vanishes and
  neither is a failing grade — an operator who was away for three months is the Heart, not a
  delinquent. This is the directory's rule and the endorsement's rule, not a third one.
- **No count, no sorting, no filtering, no "unverified" label.** Badges are additive only. There
  is no profile-strength meter, no completeness bar, and no way to order a board by them.
- **Shape carries the meaning; colour encodes category, never quality.** Read at night,
  one-handed, on a cheap screen, by people who may not see colour. A bronze-to-gold scale is a
  rank system in paint.
- **Original glyphs only.** The red cross and the Star of Life are protected marks, not design
  inspiration.
- **No remote images**, per §3.
- **Not on the public web surface.** navcom.app renders no operator badges, for the same reason
  it renders no roster.

## 9. What this adds to the refusal list

- **No capability search.** "Find a medic near here" is a query for where capable people are —
  a target list and a tasking primitive at once. A watch sees the capabilities of operators
  already on its board; nobody may ask the network.
- **No affiliation badges.** Police, federal, military, agency. This is infrastructure for
  acting *without* authority; a verified-authority emblem contradicts the premise, tells the
  people being served that the network carries police, and tells a serving agency which
  pseudonym belongs to which professional.
- **No firearms or defensive-training badges.** It signals armed status to everyone including
  the people being served, and changes how an encounter starts.
- **No badge may gate anything**, including a mission, a screen, a region or a watch.

## 10. Tiers, wipe, and what cannot be taken back

The evidence an operator presents to a verifier is **Wipeable** and never leaves the device
except to the verifier. A published award is public and permanent: panic wipe destroys the local
copy and nothing else, and withdrawal means discarding the contact key — exactly as it does for
a card today. **You can stop using a persona. You cannot unpublish a badge.** The explainer must
say that in those words.

## 11. The gates, none of which are engineering

1. **Does invariant 8's opt-in clause widen from contact details to identity documents?** §6
   says this is a real widening, to be decided as one.
2. **Does a badge shelf create a tier a pseudonymous operator can never join?** §6 answers no
   badges, no checkmarks, no sorting; §8 here is written to hold that line while still showing
   something. Whether it succeeds is a judgement, not a test.
3. **Has a credentialed professional asked?** The test `declined.md` set for crew federation,
   which crew federation passed on 2026-09-03 when Archangel asked. Not yet met here.
4. **Who runs the verifier, and who reviews it?** It is a second human dependency in a project
   whose on-call roster is one person deep, and that is already a known risk.
5. **Does the explainer get written by a person?** It describes an irreversible harm — publishing
   a real qualification can carry professional and legal consequences in some states. Understating
   it is the Medic's kill trigger aimed at the operator.

## 12. Build sequence

**v0 — days.** `document` and `vouch` methods only. Local glyphs, the vocabulary placeholder,
display in the peer exchange and to a watch that holds you on its board. **Nothing published.**
This tests whether anybody wants a badge before anything becomes permanent.

**v1.** Publication through NIP-58, the `30914` revocation convention, the verifier's method
declaration, and the explainer.

**v2.** Holder-presented VC-JWT with selective disclosure and key binding, as issuers adopt it.

**Never.** Registry adapters, capability search, sorting or ranking, affiliation badges.
