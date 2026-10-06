# Mission interchange — NavCom ⇄ Starcom / Mecha Jono

**NavCom's side of the boundary, rev 2 — 2026-10-06.** Starcom's side is
[`starcom.app/spec/starcom-navcom-interchange.spec.md`](https://starcom.app/spec/starcom-navcom-interchange.spec.md)
(rev 10 at the time of writing; rev 11 will carry the answers below). Each spec owns its own
side; neither restates the other's.

**Rev 2** records Starcom's reply of the same day — all eight proposals accepted — and closes a
gap neither side had seen: The Record accepts writes only from an allowlist, so operators' claims
and reports cannot be published there. §5.0 says where they go instead, and §10 asks two new
questions about it.

Written for Mecha Jono's development agent first, and for any human on either team second. It
says what NavCom now is, exactly how to serve it missions, how raw intel moves in both directions,
what may and may not be counted, and what Mecha Jono's part is.

**MUST / MUST NOT / SHOULD / MAY** carry RFC 2119 meaning. Times UTC; durations in seconds.

---

## 0. Read this first

**NavCom changed on 2026-10-05, and the change is in your favour.** Missions are now the point of
the application. The old rule *"nothing tasks anyone"* became *"nothing tasks anyone **without
their asking**"*: a mission is an offer, taking one is the operator's own act, and that is now
what NavCom is for. The landing page is becoming a map of missions with a communications panel
beside it, and Mecha Jono's packages are expected to be most of what is on that map at launch.

So: **do not hold back.** The rules below are few and specific — seven lines that protect people
who never agreed to be in this system, and a handful of wire conventions. **Everything they do
not forbid is permitted**, and most of what you are already doing is exactly right. Where this
document says MUST NOT, it is protecting somebody. Everywhere else, go further.

### Status of everything in this document

Nothing here pretends to exist before it does. NavCom's published contract derives `emitted`
from whether a builder exists, and this document follows the same discipline.

| Mark | Meaning |
|---|---|
| **LIVE** | Running on navcom.app today |
| **BUILT** | In NavCom's code and tested, not yet reachable by an operator |
| **DESIGNED** | Decided and written down in `docs/design/`, not yet built |
| **AGREED** | Proposed here and accepted by Starcom on 2026-10-06; normative in Starcom's rev 11 when published |
| **PROPOSED** | This document's suggestion. Needs an answer — see §10 |

| | Status |
|---|---|
| Reading kind `30079` packages from The Record | LIVE — every device subscribes to The Record directly, verifies each package itself, and keeps the subscription open, so a new or closed mission shows without a reload |
| The grid (the map missions appear on) | LIVE as the landing page at [`navcom.app`](https://navcom.app/), lighting each mission's province |
| Kind `1911` observation (raw intel) | BUILT — builder and contract exist; published at `/.well-known/navcom-intel.json` |
| Kind `1912` report | Reserved, **not emitted** — the contract says `emitted: false` |
| Claims, settlement, challenge (§5) | AGREED — Starcom reads them once built on its side |
| Standing, Writs, bounties (§8) | DESIGNED |

---

## 1. What NavCom is now

One application, two halves: **Nav**, a map NavCom draws itself, and **Com**, profiles, groups,
chat and the detail of anything. An operator may be entirely alone — no crew, no watch — and that
is the default, not a degraded state.

**The loop with Starcom**, in the words that settled it:

```
NavCom (field, boots on the ground)           Starcom (the chair, strategic)
  operators produce RAW INTEL  ──────────►  refined into INTEL REPORTS
                                              → critical / actionable intel
                                              → MISSION PACKAGES (Mecha Jono)
  operators take and report     ◄──────────  packages tagged navcom_mission
  missions in the field
```

**NavCom produces raw intel only. It never produces intel reports, and it never grades.** Field,
not chair. Grading, corroboration and refinement are Starcom's.

Design behind this document, all published:
[missions](https://navcom.app/docs/design/missions/) ·
[economy](https://navcom.app/docs/design/economy/) ·
[map](https://navcom.app/docs/design/map/) ·
[com](https://navcom.app/docs/design/com/) ·
[raw intel](https://navcom.app/docs/product/raw-intel/) ·
[build order, milestone 11](https://navcom.app/docs/build-order/).

---

## 2. The rules

### 2.1 The seven lines that do not move

These protect somebody who never agreed to be here. They bind anything NavCom displays, including
your packages. A package that crosses one is not shown.

1. **Nothing is recorded about the people being served**, and **no mission may be settled by
   evidence about a person.** No descriptors, no names, no photographs of them, no IDs — and not
   their location: no encampments, no sleeping sites, not as `geo`, not as an ask, not as a count
   (§7).
2. **`Distress` terminates in a human or says it couldn't, and nothing in the mission system may
   borrow that channel.** A package MUST NOT use kinds `20910`–`20914`, MUST NOT ask NavCom to
   page anyone, and MUST NOT present a mission as an emergency NavCom answers. Your `limits`
   already say *"follow official responders"* — that is the right instruction.
3. **Duress is always deliberate**, never inferred from silence. An operator who goes quiet on a
   mission has abandoned nothing that anyone may act on.
4. **Agents are always identified as agents**, and never the sole responder to `Distress`. Every
   package from Mecha Jono is shown as *posted by an agent*. More necessary now that agents post
   missions, not less.
5. **Panic wipe** destroys an operator's local mission history. Nothing you publish depends on it
   surviving.
6. **No legal names anywhere.** Operators are callsigns. Standing accrues to a persona.
7. **Volatile data shows its age.** A field mission MUST carry `valid_until`. An expired mission
   reads as expired; it is never quietly shown as current.

### 2.2 The two that changed, and what they now ask of you

8. **Nothing tasks anyone *without their asking*.** A package MUST NOT name a NavCom operator as
   its assignee, and MUST NOT be addressed to a person who did not claim it. `for` names who the
   work benefits (*"the people the mission serves"* is right); it never names an individual.
9. **A state is visible before somebody commits to it.** An operator must be able to see, before
   setting out, whether anybody is actually behind a mission. That is your `mission_state`, and it
   MUST be true (§4.4).

### 2.3 Withdrawn on 2026-10-05

Four of NavCom's old prohibitions no longer apply, and you may have been designing around them:
**a feed** (the landing page now opens populated), **"don't make onboarding engaging"** (replaced
by: recognition by name yes, payment per task advertised up front no), **"no map view"** (the
landing page *is* a map), and **"show no counts"** (replaced by §7: several kinds of standing,
never a total).

---

## 3. What NavCom reads

| | |
|---|---|
| Relay | **The Record**, `wss://record.cosmiccodex.app` — authoritative for packages (AGREED, Q8). The five relays rev 10 lists are best-effort mirrors a reader need not read. The Record honours NIP-40 expiry, which its NIP-11 document confirms |
| Author | `6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692` |
| Filter | `{ "kinds": [30079], "authors": ["6301c4d0…9692"], "#t": ["navcom_mission"] }` |

Measured on 2026-10-06: **90 packages** carry `t=navcom_handoff`; **15** carry `t=navcom_mission`,
of which 9 are `open`. NavCom's grid shows **`navcom_mission` packages only** — boots-on-ground
work. Desk packages (`where:desk`) are Starcom's and are not on the grid in the first release; see
§9.3 for why they may matter later.

NavCom verifies the Nostr signature and the author key. **It does not yet verify the ML-DSA-65
manifest signature** in `metadata.signature`, and will not claim to until it does.

---

## 4. Serving a NavCom mission — the package profile

Everything in this section is what you already publish, plus three additions, all AGREED, marked as
such. A package that meets §4.1 is shown; nothing else in this section is a precondition.

### 4.1 Required for a package to appear on the grid

| Tag | Value | Why |
|---|---|---|
| `t` | `starcom_mission_package`, `navcom_handoff`, `navcom_mission` | The last one is what puts it on the map |
| `mission_state` | `open` (see §4.4 for the others) | Invariant 9 |
| `valid_until` | Unix seconds | Invariant 7. **All 15 current field missions carry it** |
| `jurisdiction` **or** `geo` | e.g. `us-ca`, or §4.2 | Somewhere to draw it |

### 4.2 Placement — where it appears

**`jurisdiction` is enough, and it is what you use today.** `us-ca` lights California on the grid;
the grid draws provinces for every country NavCom has regions in (today the US, the UK and
Australia). That is exactly the right resolution for a state-wide campaign.

**`geo` is optional and coarse.** When present:

- `geo_precision` MUST be `city` or `1km`. Nothing finer. NavCom's importer will round anything
  finer down to ~1 km and treat the extra precision as a defect in the package
- `geo_kind: subject_location` MUST locate an **entity on public record** — an organisation, a
  facility, infrastructure, a parcel. **Never a person, a home, or a place people sleep**
  (invariant 1). Your current use — a charity's registered address, geocoded by the Census — is
  exactly right
- NavCom never decides which country a point is in from a drawn border. At any public basemap's
  resolution, El Paso's own shelters plot inside Mexico. Placement is by region and jurisdiction

### 4.3 Objectives — what an operator sees

| Field | Rendered as |
|---|---|
| `ask` | The objective, verbatim. Write it as you do now: one thing, plainly |
| `limits` | **Verbatim, above the ask, every time.** Yours are excellent — *"never take anyone's personal details… never post faces or the places people sleep"* — keep writing them exactly like that |
| `effortMinutes` | *"about 20 minutes"* |
| `for` | Who the work helps. Never an individual |
| `handsBack` | What the operator returns (§5) |
| `done` | Your view of the ask, as rev 10 says. NavCom never sets it |
| `check` tags | *"Check before you go: local laws on recording consent"* — a topic, never an answer. NavCom does not write legal guidance and neither should a package |

### 4.4 `mission_state` — keep it true

| Value | Means | Status |
|---|---|---|
| `open` | Anyone may take part | LIVE in your packages |
| `closed` | Over. A closed mission is a good outcome; close honestly | LIVE in your packages |
| `claimed` | An **exclusive** mission somebody has taken | AGREED (Q3) |

**Mecha Jono's duty under invariant 9:** if you can no longer settle reports on a mission — the
window passed, the situation changed, nobody is watching it — **close it.** An open mission is a
promise that somebody is behind it.

### 4.5 Campaigns and tasks — AGREED `claims` tag

NavCom designed a mission as a discrete task with one claimant. **Your packages are campaigns**:
one heat-relief package covers all of California with four asks, meant for many people at once.
An exclusive claim on that would let one operator lock a state.

So, AGREED (Q2):

| `["claims", "many"]` | A campaign. Anybody may take part; nobody can lock it. **The default when the tag is absent**, because it is what you publish today |
|---|---|
| `["claims", "one"]` | A task. The first accepted claim takes it; you set `mission_state` to `claimed`, and back to `open` if the claim lapses |

### 4.6 Identify yourself — AGREED `agent` tag

NavCom labels every package from your key as agent-posted regardless (invariant 4). A
self-describing `["agent", "mecha_jono"]` tag would let any other reader do the same without
knowing your key.

---

## 5. The return path — claims, reports, settlement — AGREED

Built on existing NIPs, so neither side allocates a kind for it. Starcom accepted it on
2026-10-06 (Q1); its reading side is still to be built.

**NavCom sends labels, never kind-`1` replies.** Rev 10's kind-`1` reply stays valid on Starcom's
side, but a kind-`1` note is a public social post that every client indexes and displays. A claim
sent that way would publish who took what, which is exactly what the operator's choice in §5.1
exists to control.

### 5.0 Where the return path is published

**Not The Record.** Its own NIP-11 document, read on 2026-10-06, describes it as *"EIN open-read,
allowlist-write archive … everything here is meant to be public and permanent."* Operators are not
on that allowlist, and should not be: NavCom promises an operator that a report can be withdrawn,
honestly described, and a relay built for permanence is the wrong home for one.

| Signed by | Published to | Read by |
|---|---|---|
| **An operator** — public claims, reports, witness and challenge labels | **NavCom's relays**: today `wss://relay.damus.io` and `wss://nos.lol`, both already among rev 10's mirrors; NavCom's own RelayNodes when they ship | Starcom and Mecha Jono, filtering `#a` for their packages (Q9) |
| **An operator** — a private claim (gift wrap) | The inbox relays Mecha Jono names in a NIP-17 kind `10050` list | Mecha Jono only (Q4, Q10) |
| **Mecha Jono** — packages, `settled` and `challenged` labels | **The Record** | NavCom, which already reads it |

### 5.1 Taking part — a claim

A NIP-32 label, kind `1985`, signed by the operator's contact key:

```json
{ "kind": 1985, "tags": [
  ["L", "navcom.mission"], ["l", "claimed", "navcom.mission"],
  ["a", "30079:6301c4d0…9692:starcom_mission_package_field-heat_relief-CA-2026-10-02"],
  ["expiration", "<unix seconds>"] ] }
```

**The operator chooses who sees it, every time, with nothing preselected.** *Everyone*: published
as above. *The poster only*: the same event, NIP-44 encrypted to Mecha Jono and NIP-59
gift-wrapped, so no relay learns who took what. **For a private claim on a `claims: one` task, you
MUST still publish `mission_state: claimed`** — a private claim withholds *who*, never *that*.

A claim expires by itself (NIP-40). Walking away costs the operator nothing: **abandoning a claim
MUST NOT affect anything about them** — not standing, not a score, not a note. That is invariant 8.

### 5.2 Doing it — a report

Kind `1912`, **reserved and not emitted yet**. When it ships it carries:

- `["a", "30079:…"]` — the package — and `["ask", "<objective id>"]` for each objective covered
- **no `g` tag**, deliberately: a region-indexed history of who worked where is the queryable
  record NavCom refuses to build
- counts of **materiel**, never people (§7)

**Reports will arrive late, on purpose** (DESIGNED). The client is to refuse same-day publication
by default and warn before a second report in one region inside a short window. That is a privacy control: a report
must not reveal where somebody is tonight. **So a report can land after `valid_until`.** A report
MUST be accepted if its claim predates `valid_until`; please do not reject late reports.

### 5.3 Settlement, challenge, witness

All NIP-32 labels on the **report**, namespace `navcom.mission`:

| Label | Signed by | Effect |
|---|---|---|
| `settled` | The poster — Mecha Jono, autonomously | Standing mints (§8). Reads *settled by poster* |
| `witnessed` | Anyone who was there | Settles immediately. Reads *settled by witness* |
| `challenged` | **Anyone, under their own name** | Reverses nothing. Reads *settled, challenged by <name>* |

**If you say nothing for seven days, the report settles itself** and reads *settled
unchallenged*. Silence is acceptance. **To dispute a report, label it `challenged` within seven
days.** Nothing adjudicates: there is no tribunal, no vote and no appeal, and both statements
stand for the reader to weigh.

**Mecha Jono settles and challenges; it does not score people.** There is no input anywhere for an
agent to rate an operator. Standing is derived by NavCom from these events alone.

---

## 6. Raw intel

### 6.1 What NavCom sends — kind `1911`, BUILT

Signed by the operator's **contact** key, regular kind, immutable, superseded never edited.
Contract: [`/.well-known/navcom-intel.json`](https://navcom.app/.well-known/navcom-intel.json).

| Field | |
|---|---|
| `anchor` | A thing **already on public record** — an organisation, infrastructure, a parcel. Never people, never an encampment |
| `observed_at` | When seen |
| `tags` | From the closed vocabulary only. **No free text, anywhere — that is the whole enforcement** |
| `method` | `saw` · `told` · `inferred` — how the observer knows. A fact, not a grade |
| `callsign` | A callsign or `anonymous` |
| `precision` | `area` or `exact` |
| `supersedes` | The author's own earlier observation this replaces |

Find them with `{ "kinds": [1911], "#g": ["<region slug>"] }` or `"#d": ["<anchor id>"]`.

Things your models must hold:

- **`anonymous` is pseudonymous, not unlinkable.** Same contact key, same source. Two
  `anonymous` observations from one key **cannot corroborate each other**, and your weighting
  already relies on that
- **"refines" means two different things, and they must never be merged.** In NavCom's spec,
  `["refines", <id>]` is *the same observation re-published at a precision withheld for 48 hours*
  — the pair is one observation and **never corroborates itself**. In the loop, refinement is your
  analysis into intel reports. Different words would be better; until then, keep them apart
- **Grading is yours.** Admiralty A–F / 1–6. `F6` is a valid grade, not a rejection — there is no
  quality bar on submission, ever. Grades stay inside your analysis; they are not published as
  per-operator scores
- **The vocabulary is a stub, written by humans with local knowledge.** Do not extend it. Failure
  is safe: what it cannot express stays on the operator's device

### 6.2 What you send back — a citation — AGREED

When an intel report or a package uses an observation, cite it:
`["e", "<1911 event id>", "<relay>", "cites"]`.

One tag, two effects. **Citation pins retention**: an uncited, uncorroborated observation is
dropped from NavCom's stores after 90 days, and a cited one is kept, so the evidence behind your
work never disappears. **And citation is how the operator who found it is credited** (§8). Cite
generously.

### 6.3 Asking for raw intel

You MAY publish missions whose ask is an observation: *"check whether the cooling centre on 4th
is open, and say what you saw."* Anchor them on public record, keep them in the vocabulary, and
the observation that comes back cites itself to the mission.

---

## 7. Counts

### 7.1 In what operators report: count things, not people

| | |
|---|---|
| ✓ | *"48 bottles of water and 30 cooling-centre cards handed out"* — materiel. This is **Supply** standing |
| ✓ | *"3 cooling centres confirmed open"* — public-record facilities |
| ✗ | *"47 people reached at the underpass"* — the size and location of the population served |
| ✗ | Any count tied to a site and a time where people gather |

A count of people at a place is the location of people being served, which NavCom's published
contract lists under `never`, and which raw intel's anchor rule refuses for the same reason: an
encampment is constituted by the people in it.

**One concrete change, please:** the heat-relief package's `metadata.mechaJono.format.effect` reads
*"People reached with water and the cooling-centre list: a count."* Its `report:counts` ask
already says the right thing — *"what you handed out, counts only."* Making `effect` match —
*"Water and cards handed out: a count"* — is the whole fix.

### 7.2 In standing: kinds, never a total

| | Answers | Fed by your missions? |
|---|---|---|
| **Honor** | How far you've come with one body | Yes — settling missions posted for a body. Spent on rungs that raise a Writ ceiling |
| **Karma** | Will they work with you again — per counterparty, −100 to +100, decays toward neutral | Only mechanically: a released bounty raises it, a bounty withheld to its locktime lowers it. Never by an agent's judgement |
| **Hours** | How much you've done | Yes — from settled reports. A record, never a score |
| **Supply** | What you moved | Yes — from the materiel counts in §7.1 |
| **Intel** | What you knew that the grid didn't | **Yes — when you cite an observation (§6.2)** |
| **Writs** | May you ask others to do things | No — they govern missions posted *on NavCom*, not yours |
| **Sats** | Did somebody pay | Only through §8.2 |

**Never added together, never ranked.** Two rules for anything Starcom publishes:

- **No ranking of individual operators.** A public list of who did the most street work in a city
  is a target list sorted by commitment. Rank missions and campaigns instead, if you rank anything
- **Two counts, never a ratio.** For intel: *"4 submitted, 1 refined"*, and the reader does the
  division. A derived precision score would be the single number that sums somebody up

---

## 8. Standing and money

### 8.1 What settling your missions gives an operator

The maintainer's own words: **points are acquired for free for performing missions from Mecha Jono.**
A settled report on your mission mints Hours and Supply for the operator, Honor with the body
the package is posted for, and Intel for every observation you cite. Settling promptly is the
most valuable thing Mecha Jono does for operators.

### 8.2 Bounties — optional, DESIGNED

If Mecha Jono ever funds a mission: **NIP-61 nutzaps**, because the payment is the receipt, and a
**Cashu NUT-14 HTLC locked to the claimant at claim time**, with a refund locktime to you. NavCom
shows `funded`, `released` or `withheld`. **NavCom holds no money, takes no fee, sets no default
mint and arbitrates nothing.** Writs cannot be bought; money is a separate lane.

---

## 9. Mecha Jono — role, duties, and permission

### 9.1 What Mecha Jono contributes

Mecha Jono is the agent at Starcom's end of the loop: it turns refined intelligence into Mission
Packages, publishes them on The Record, and — as decided by the maintainer — **approves its own
missions autonomously**. On NavCom it is the largest single source of things to do, and the reason
the map opens populated. It is identified as an agent everywhere it appears.

### 9.2 Duties

- Keep `mission_state` true; close what you can no longer settle (§4.4)
- Carry `valid_until` on every field mission (§4.1)
- Settle or challenge reports within seven days (§5.3)
- Locate subjects only when they are on public record, at `city` or `1km` (§4.2)
- Count things, not people (§7.1)
- Cite the observations you use (§6.2)
- Never touch the `Distress` channel, never assign a named person, never score an operator

### 9.3 Permission — go further

- **Publish more field missions.** Quick wins especially: short, daylight, in pairs
- **Keep writing `limits` the way you do.** They are exactly the safety writing this needs
- **Ask for raw intel** on public-record places — open, closed, moved, hours changed
- **Settle autonomously and fast.** It is how operators are credited
- **Cite generously.** It keeps the evidence and pays the finder
- **Propose new tags.** NavCom ignores tags it doesn't know; nothing breaks
- **Desk packages stay yours.** NavCom shows field work only (decided 2026-10-06): it is the
  boots-on-the-ground half, and desk work belongs in Starcom's own app. Nothing about desk
  packages needs to change for NavCom
- **Fund bounties** if you can (§8.2)

---

## 10. Questions, and Starcom's answers

Answered by Starcom on 2026-10-06; all eight accepted. Three are Mecha Jono's to act on.

| | Question | Answer | Who acts |
|---|---|---|---|
| Q1 | NIP-32 namespace `navcom.mission` with `claimed`, `settled`, `witnessed`, `challenged`? | **Yes**, beside rev 10's kind-`1` reply | Starcom builds the reader |
| Q2 | `["claims", "one" \| "many"]`? | **Yes, as written.** Absent means `many` | — |
| Q3 | `mission_state: claimed` for `claims: one`? | **Yes.** A private claim still publishes the state | — |
| Q4 | Can Mecha Jono read NIP-59 gift-wrapped private claims? | Starcom supports private claims; **Mecha Jono to answer** | Mecha Jono |
| Q5 | Cite observations with `["e", id, relay, "cites"]`? | **Yes.** Starcom's `navcom-intel/0.1.0` reader is built and counts one contact key as one source; wiring it in comes first | Starcom builds |
| Q6 | Count materiel, never people? | **Yes, for every package** in rev 11 | Mecha Jono changes `format.effect` |
| Q7 | `["agent", "mecha_jono"]`? | **Yes.** Rev 11 defines `["agent", <name>]` for any agent | Mecha Jono adds the tag |
| Q8 | Which relays are authoritative? | **The Record.** The five are best-effort mirrors | — |

### New in rev 2

| | Question | NavCom's default if unanswered |
|---|---|---|
| Q9 | Will Starcom and Mecha Jono read operators' labels and reports from NavCom's relays (§5.0), filtering `#a` for their packages? | NavCom publishes there regardless; until Starcom reads them, nothing from NavCom's side reaches it |
| Q10 | Will Mecha Jono publish a NIP-17 kind `10050` list naming the relays where it accepts gift-wrapped claims? | Private claims stay unavailable on Mecha Jono's missions — the answer to Q4 needs somewhere to deliver |

### Your open questions from rev 10, answered

- **Encryption.** Packages broadcast in plaintext is right: a mission is a public offer.
  What needs sealing is who took it, and §5.1 does that per claim
- **Addressed vs broadcast.** Packages broadcast; claims are either, chosen by the operator each
  time; reports are public and region-blind
- **Keeping the two descriptions in step.** This document is NavCom's side and yours is Starcom's.
  Each links the other, each is versioned, and neither restates the other

---

## Appendix — a field mission, as NavCom would like to receive it

Your live heat-relief package, with the three AGREED additions and the §7.1 fix:

```json
{ "kind": 30079, "pubkey": "6301c4d0…9692", "tags": [
  ["d", "starcom_mission_package_field-heat_relief-CA-2026-10-02"],
  ["t", "starcom_mission_package"], ["t", "navcom_handoff"], ["t", "navcom_mission"],
  ["t", "field_mission"], ["t", "where:field"], ["t", "variant:long"],
  ["mission_state", "open"], ["mission_family", "heat_relief"],
  ["jurisdiction", "us-ca"], ["valid_until", "1791608400"],
  ["claims", "many"],
  ["agent", "mecha_jono"],
  ["ask", "field:heat_relief:CA:2026-10-02#find:centres"],
  ["ask", "field:heat_relief:CA:2026-10-02#handout:water"],
  ["ask", "field:heat_relief:CA:2026-10-02#check:neighbour"],
  ["ask", "field:heat_relief:CA:2026-10-02#report:counts"],
  ["t", "audience:rlsh"] ],
  "content": "{ … \"metadata\": { \"mechaJono\": { \"format\": { \"effect\": [\"Water and cards handed out: a count\"] } } } }" }
```

And the settlement of one operator's report on it:

```json
{ "kind": 1985, "pubkey": "6301c4d0…9692", "tags": [
  ["L", "navcom.mission"], ["l", "settled", "navcom.mission"],
  ["e", "<the operator's 1912 report id>"],
  ["a", "30079:6301c4d0…9692:starcom_mission_package_field-heat_relief-CA-2026-10-02"] ] }
```
