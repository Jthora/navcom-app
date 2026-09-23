# Verifying a Qualification

**Research, not a decision.** [`profiles.md` §6](../product/profiles.md) holds the decision, and
it is *written down, not built*. This page is what §6 would be argued against if somebody
reopened it, and it exists because the question was reopened — by the mission pipeline, where
boots-on-the-ground work raised "can NavCom show who is qualified?"

Three different asks hide inside that one question, and they have different answers:

| The ask | The honest answer |
|---|---|
| **Is this a person or a bot?** | Handle proofs ([NIP-39](https://github.com/nostr-protocol/nips/blob/master/39.md)). Cheap, in-protocol, deanonymises nobody beyond the handle, and worth more against bots than any certificate |
| **Has this person done the work?** | The peer credential, which already exists. §6 argues it is the better signal here, and it is |
| **Does this person hold an institutional qualification?** | This page |

Only the third needs anything built. The first two are mostly unbuilt work on primitives that
already exist, and both are cheaper.

## 1. The inverse law

**Machine-checkability comes *from* publicity.** This is the finding that shapes everything
else, and no protocol fixes it, because it is a property of the registries rather than of our
implementation.

The credentials with real, open APIs are public directories *of people*. The credentials that
are safe for a pseudonymous operator to hold have no verification surface at all.

| Credential | What exists | What it costs the holder |
|---|---|---|
| Nurse, physician, NP | **NPI registry API** — free, no token, no registration; rate-limited since June 2024 | Maximal. It is a directory of names and practice addresses |
| Amateur radio | **FCC ULS** — completely open, no auth, 5,000 results a query | Extreme. Returns name, FRN, address, phone, email. A callsign badge is a home-address badge |
| EMT, paramedic | NREMT verification portal. Certification is not a licence; the state EMS office holds that | High — name-based lookup |
| Private investigator | No national API. Fifty systems (Florida FDACS, Oregon IRIS, Nevada's board, Washington DOL). Third-party wrappers are scrapers | High — name, city, licence history |
| Mental health first aid, many trainings | Widely issued through **Credly**, whose Open Badges assertions are public and need no authentication; a revoked badge returns `410 Gone` | Medium — the badge page names the earner |
| Red Cross first aid, CPR, AED | Certificate lookup and digital badge pages, holder-centric; no third-party search by name | Low |
| Stop the Bleed, naloxone, street medic, legal observer | **Nothing.** No registry exists | None, and nothing to check |
| Language fluency | Nothing, and none needed | None |

Read the two ends of that table together: the things most worth knowing at 2am are the things
nobody can check, and the things anybody can check are the things that put a name to a persona.

## 2. The twelve, against that table

[The Twelve](archetypes.md), asked what each could actually prove:

| Archetype | Plausible credential | Verifiable? | Note |
|---|---|---|---|
| **Medic** | Red Cross first aid, naloxone, Stop the Bleed | Partly, weakly | The strongest case for a badge holds the least checkable credentials |
| **Protest Medic** | Street medic training, NLG legal observer | **No** | No registry exists — and this is the archetype for whom any identity linkage is most dangerous |
| **Trainer** | Mental Health First Aid, de-escalation | **Yes**, via Credly | The cleanest fit in the whole set |
| **Convert** | Peer recovery specialist — a real state certification | **Yes**, and that is the problem | She has the best directory knowledge in the network and the most reason to be unlinkable. The one credential available to her is registry-backed under a legal name |
| **Public Face** | None | n/a | Their real need is **handle** verification. Impersonation is a live risk for someone with a following; a first-aid badge is not |
| **Team Lead** | Incident command coursework | Limited | Certificate-number lookup at best |
| **Quartermaster** | Food handling | Yes, narrowly | Rarely changes anything at 2am |
| **Skeptic** | — | — | Twelve years in, watched three apps come and go. **Their reaction is the test of whether this feature is coercive** |
| **Ghost** | — | — | Patrols alone, no position ever. The feature must be invisible and optional or it is not for them |
| **Outpost** | — | — | One bar of signal. Any verification that needs the network must degrade to *unknown*, never to *invalid* |
| **Heart** | Any, lapsing | — | Gone for three months at a time. An expiring badge must not read as a failing grade |
| **Connector** | None | n/a | |

Two findings fall out. **The archetypes with the best case for a badge have the least
verifiable credentials.** And **the archetype who could most easily be verified is the one the
design most owes protection to.**

## 3. Three architectures

| | Query a registry | Holder-presented credential | In-protocol award |
|---|---|---|---|
| **Shape** | We look you up | You bring a signed credential; we check the signature | An issuer awards a badge on Nostr; you choose to display it |
| **Standard** | None — fifty of them | Open Badges 3.0 / W3C VC, SD-JWT ([RFC 9901](https://www.rfc-editor.org/rfc/rfc9901.html)) | [NIP-58](https://github.com/nostr-protocol/nips/blob/master/58.md) |
| **Runs in the browser?** | **No.** Credly's JSON endpoint sends no CORS headers, and neither do the registries | Yes — signature check, offline | Yes — already |
| **New crypto?** | n/a | JOSE (ES256/RS256) | **None.** secp256k1 schnorr, already bundled |
| **Adapters** | One per registry, forever | None | None |
| **Deanonymises?** | Always | Only what the holder discloses | Only the pubkey pairing |
| **Blocked on** | Nothing, and it never ends | Issuer adoption | Somebody running a verifier |

**NIP-58 deserves attention because it solves §6's structural objection without inventing
anything.** §6's argument against institutional credentials on the existing primitive is that a
NavCom credential is a *bearer token* — "a licence that transfers to whoever holds it is not a
licence". A NIP-58 award is kind `8`, immutable and non-transferable, carrying a `p` tag naming
the recipient's pubkey: subject-bound by construction. Display is holder-controlled through
kind `10008`, so nothing appears on a profile the operator did not accept — the opt-in is part
of the standard rather than something we bolt on. The cost is that an award is a public
issuer-to-holder edge, which is the social graph the bearer design exists to avoid.

**Holder-presented credentials are where privacy actually improves.** Selective disclosure lets
a holder prove "holds a current first-aid certification from this issuer, expiring March 2027"
without the name or the certificate number, and key binding (a `cnf` claim plus a
holder-signed token over a verifier nonce) stops a leaked credential from being replayed by
whoever picked it up. Unlike an OAuth check, the issuer never learns that a presentation
happened — the verifier talks to nobody.

## 4. Cryptography against the device floor

| Algorithm | On a prepaid Android 8 | Verdict |
|---|---|---|
| secp256k1 schnorr | Already in the bundle for every Nostr event | Free |
| ES256 / RS256 (WebCrypto) | Supported for years | Safe |
| **Ed25519 (WebCrypto)** | Firefox 129, Safari 17, **Chrome only from M137 (May 2026)** | **Too new for the floor.** Must degrade to *cannot check here*, never a silent pass |

Open Badges 3.0 admits two proof formats: VC-JWT, and Linked Data Proofs over JSON-LD. The
second needs RDF canonicalisation, which is a dependency measured in hundreds of kilobytes
against a 220 kB budget that a live page already spends 140.5 kB of. **Accept VC-JWT; refuse
Linked Data Proofs.** The budget decides this, not taste.

## 5. What verification does not prove

Certification mills sell instant online "certification" with no hands-on assessment, and
commonly claim to be nationally accredited or approved; OSHA does not accept online-only
training for first aid and CPR. **A signature over a mill's claim verifies perfectly.**
Cryptography attests provenance, never competence.

The conventional answer is an allowlist of acceptable issuers, which is a gate with better
manners and a governance burden nobody here has time for. This project already has the better
answer written down: **provenance by name.** Show *who issued it*, never a checkmark, and let a
reader who has never heard of the issuer draw the obvious conclusion.

## 6. The legal exposure lands on the operator, not on us

This is the part that was missing from every earlier discussion, and it is the most important
finding here.

- **Title protection and "holding out".** Massachusetts law says no person shall hold themselves
  out as, or use the title of, EMT or paramedic other than on behalf of a licensed service;
  violations draw fines, referral to the Attorney General, and action against the person's own
  credential. Nurse-title statutes are broad in many states — Virginia makes practising or
  *offering to practise* without a licence a misdemeanour. **The badge can be the offence, and
  the exposure is highest for the genuinely qualified person**, because they have a credential
  to lose.
- **Good Samaritan protection narrows.** Professionals are generally held to a higher standard
  of care, and a pre-existing duty defeats immunity entirely. Texas excludes off-duty EMTs from
  its Good Samaritan civil immunity outright.
- **Emblems are regulated.** The red cross and the Star of Life are protected marks, not
  design inspiration. A capability glyph set must be original work.

So the warning attached to publishing a badge is not only about privacy. In some states,
advertising a real qualification while doing street outreach can carry professional
consequences. **That is the Medic's kill trigger — confident wrong guidance — pointed at the
operator instead of at the person being served**, and it is why the explainer for this feature
should be written and reviewed by a person.

## 7. Selective disclosure hides the name, not the rarity

A disclosure that says *paramedic* and nothing else still identifies somebody if the metro has
four of them and one does street outreach. Region plus capability plus an activity tag is
frequently one person.

Two consequences. Disclosure control must include the ability to show a capability **without a
region**. And the app must not compute a rarity score to warn about it — the population is
unknown, and a fabricated number would be exactly the kind of false confidence this project
refuses elsewhere. State the risk in words; never in a meter.

## 8. Revocation, and what "offline" actually covers

Signature verification is genuinely offline. **Revocation is not.** The W3C Bitstring Status
List works by publishing one long bitstring, at least 131,072 entries, which a verifier
downloads whole — that gives herd privacy, since the publisher learns that somebody is checking
but not which credential. It is still a network call to a third-party host.

For the Outpost on one bar of signal, that means a status check will often fail, and the
failure must render as **unknown** rather than as valid or invalid. Invariant 9 already governs
this: stale says call first, blank says unknown.

NIP-58 has no revocation mechanism at all. NavCom already publishes revocations as kind `30914`
for its own credential, so a convention exists to extend rather than a gap to invent.

## 9. What this changes about §6, and what it does not

**Changed.** §6's central argument — *"a licence number is a legal name with extra steps"* — was
true of every option available when it was written. It is no longer categorically true:
selective disclosure can prove a qualification without the number, the name, or the issuer's
record, where the issuer supports it. And §6's structural objection, that the existing
primitive is a bearer token, is answered by NIP-58's subject-bound award.

**Unchanged, and still the whole decision.** Whether invariant 8's opt-in clause widens from
contact details to identity documents. Whether a badge shelf creates a tier a pseudonymous
operator can never join. And the demand test §6 set, which `declined.md` set first for crew
federation and which crew federation passed on 2026-09-03: **no credentialed professional has
asked.** The maintainer asking on behalf of an imagined one is the case that test exists to
catch.

**New, and decided by this research rather than by preference.** If it is built, it is built as
verification of *presented* credentials, never as querying registries — because the browser
cannot query them, because adapters are a treadmill, and because the registry path deanonymises
by construction while the presented path need not.

## Sources

- [Open Badges 3.0 specification — 1EdTech](https://www.imsglobal.org/spec/ob/v3p0)
- [RFC 9901 — Selective Disclosure for JSON Web Tokens](https://www.rfc-editor.org/rfc/rfc9901.html)
- [SD-JWT-based Verifiable Credentials — IETF](https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/)
- [Bitstring Status List v1.0 — W3C](https://www.w3.org/TR/vc-bitstring-status-list/)
- [NIP-58 — Badges](https://github.com/nostr-protocol/nips/blob/master/58.md)
- [NIP-39 — External Identities in Profiles](https://github.com/nostr-protocol/nips/blob/master/39.md)
- [NPPES NPI Registry API — CMS](https://npiregistry.cms.hhs.gov/api-page)
- [FCC ULS — Amateur Radio License Search](https://wireless2.fcc.gov/UlsApp/UlsSearch/searchAmateur.jsp)
- [NREMT — Verify Credentials](https://www.nremt.org/verify-credentials)
- [Credly — Open Badges assertions](https://www.credly.com/docs/getting_started)
- [Red Cross — Find My Certificate](https://www.redcross.org/take-a-class/digital-certificate)
- [Massachusetts General Laws c.111C — EMS](https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXVI/Chapter111C)
- [Nurse title protection by state — ANA](https://www.nursingworld.org/practice-policy/advocacy/state/title-nurse-protection/)
- [Good Samaritan statutes and medical volunteers — AMA Journal of Ethics](https://journalofethics.ama-assn.org/article/good-samaritan-statutes-are-medical-volunteers-protected/2004-04)
- [Ed25519 in WebCrypto — Igalia](https://blogs.igalia.com/jfernandez/2025/08/25/ed25519-support-lands-in-chrome-what-it-means-for-developers-and-the-web/)
- [Certification mills — Occupational Health & Safety](https://ohsonline.com/articles/2013/04/01/unmasking-the-certification-mill-problem.aspx)
