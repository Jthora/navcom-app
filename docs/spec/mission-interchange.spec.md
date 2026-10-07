# Mission interchange — NavCom ⇄ Starcom / Mecha Jono

**NavCom's side of the boundary, rev 5 — 2026-10-06.** Starcom's side is
[`starcom.app/spec/starcom-navcom-interchange.spec.md`](https://starcom.app/spec/starcom-navcom-interchange.spec.md)
(rev 10 at the time of writing; rev 11 will carry the answers below). Each spec owns its own
side; neither restates the other's.

**Rev 2** records Starcom's reply of the same day — all eight proposals accepted — and closes a
gap neither side had seen: The Record accepts writes only from an allowlist, so operators' claims
and reports cannot be published there. §5.0 says where they go instead, and §10 asks two new
questions about it.

**Rev 3** records Mecha Jono's answers of the same evening — Q4, Q6, Q7 and Q9 live, Q10 built —
NavCom's rulings on the three things Mecha Jono asked in return (§10), and a decision that reaches
past this boundary: **reading is private and acting is accountable.** Relays are chosen from what
each node declares, and the grid's relays, The Record included, keep no record of who reads (§11).

**Rev 4**: NavCom's devices now send claims, and three rules for them need your answer — a claim
that ends within a day unless renewed, a `released` label for letting go, and a count of who is
taking part that only the poster can make (§5.1, §10).

**Rev 5**: reports, witnessing and challenging are live (§5.2, §5.3), and an audit of all of it
changed four things you will see. NavCom now refuses a field package no report could answer — no
`objectives`, or ids a report cannot name — and says why on its map (§4.3, Q15). It asks relays for
labels by the mission and the three words a label on a report says. The poster's `settled`
outranks a `witnessed`, whatever either claims about when. And operators' claims and reports always
reach the relays you read, even from a device whose own relays are a watch's (§5.0).

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
| Reading kind `30079` packages | LIVE — every device subscribes to The Record and its mirror at `wss://blackpi.cosmiccodex.app` at once, verifies each package itself, shows the newest signed copy of each, and keeps both subscriptions open, so a new or closed mission shows without a reload |
| The grid (the map missions appear on) | LIVE as the landing page at [`navcom.app`](https://navcom.app/), lighting each mission's province |
| Kind `1911` observation (raw intel) | BUILT — builder and contract exist; published at `/.well-known/navcom-intel.json` |
| Kind `1912` report | LIVE — operators on navcom.app send them, open or sealed (§5.2); the contract says `emitted: true` |
| Claims (§5.1) | LIVE — operators on navcom.app send them, open and sealed; three rules PROPOSED (§10, Q11–Q13) |
| Settlement, challenge, witness (§5.3) | LIVE on NavCom's side: each operator sees how their reports settled, and any operator can read a mission's reports, witness one (if their device took part) or challenge one, by name |
| Standing, Writs, bounties (§8) | DESIGNED |
| The grid's rules — no reader records, relay lists, declared policies (§11) | DESIGNED, decided 2026-10-06. The reader rule is The Record's to apply |

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
6. **No legal names anywhere.** Operators are callsigns. Standing accrues to a persona. **One
   exception, for packages** (decided 2026-10-06): a public figure named by an official source may
   appear in their public role, with the source's link, as background or as the source itself.
   Never as the object of an action — not in an ask, an objective or `for` — never an operator, and
   never anyone the mission serves. A mission is a call to action, and a name in one points a crowd
   at a person.
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

**What a field package needs so that the work can be reported** — rev 5. NavCom refuses, rather
than shows, a field package an operator could take part in but never report: one with no
`objectives`; two objectives sharing an `id`; an `id` that is empty or contains whitespace; a `d`
tag that is empty or contains whitespace; an `effect` line longer than 200 characters; or a
`valid_until` past 2100. A repeated or blank `effect` line is read once or not at all. Each refusal
is shown on NavCom's map with its reason, so a package that crosses one of these lines is seen, not
silently missing. A newer version you sign that NavCom refuses still replaces the older one: the
map never keeps showing a version you have superseded.

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

### 4.7 Work an agent may take — AGREED `taker:agent`

Mecha Jono's proposal of 2026-10-06, accepted. `["t", "taker:agent"]` on a package says at least one
objective may be taken by an agent; each objective's `takers` in the manifest says which —
`["human"]`, `["agent"]` or both. Distinct from `agent`, which says who posted, and from `audience`.

**An agent's claim is shown, marked as an agent's, and counted as a claim** (decided 2026-10-06).
It is the same NIP-32 label (§5.1), carrying the agent's own `["agent", <name>]`, and only on an
objective whose `takers` includes `agent`; NavCom ignores an agent's claim on anything else. The
mark is invariant 4: whoever reads the mission sees that an agent took it, not a person. Shown when
NavCom's claims ship (build order 11.4).

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
| **An operator** — public claims, reports, witness and challenge labels | **NavCom's relays**: today `wss://relay.damus.io` and `wss://nos.lol`, both already among rev 10's mirrors. Every device writes here *as well as* to its own relays — a Watched operator's watch relays are added, never substituted (rev 5). **Moving to relay lists** (§11.2): read each operator's NIP-65 list as well as these | Starcom and Mecha Jono, filtering `#a` for their packages — LIVE for Mecha Jono (Q9) |
| **An operator** — a private claim (gift wrap) | The inbox relays in Mecha Jono's NIP-17 kind `10050` list: `wss://nos.lol` and `wss://relay.primal.net` | Mecha Jono only — LIVE (Q4, Q10) |
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

**LIVE, 2026-10-06.** Operators on navcom.app send claims this way. The rules were worked out as a game
between claimant, other operators, poster and adversary — the reasoning is in
[`../design/missions.md`](../design/missions.md) §3 — and three of them ask something of you:

- **A lease, not a lock** (Q11). A claim's `expiration` is a day after it is made, or the mission's
  end if that is sooner. Taking part again sends a fresh label; an open one also withdraws the old
  with a NIP-09 request. Please read a claim as ended at its `expiration`
- **Letting go** (Q12). A `released` label, same namespace, same `a`: in the open beside a NIP-09
  request to delete the claim, or sealed to you exactly as the claim was. Please read it as the
  claimant's withdrawal. Without it, a private claim could not be let go, and privacy would cost the
  option of changing your mind
- **Who is taking part** (Q13). NavCom shows the count you publish on the package,
  `["taking_part", "<operators>", "<agents>"]`, and nothing else. Only you can see private claims, so
  only your count is whole; it carries no names, and agents are counted apart (§4.7). Until you
  publish one, NavCom shows it as unknown

NavCom's own rules, for your information: an operator holds at most three claims at once; taking part
needs somebody signed on, because every mission here is field work and nobody should set out without
`Distress`; and a sealed claim goes only to the relays your kind-`10050` list names, never anywhere
else.

### 5.2 Doing it — a report

Kind `1912` — **LIVE, 2026-10-06**. It carries:

- `["a", "30079:…"]` — the package — and `["ask", "<objective id>"]` for each objective covered
- **no `g` tag**, deliberately: a region-indexed history of who worked where is the queryable
  record NavCom refuses to build
- counts of **materiel**, never people (§7)

Exactly, in the content: the operator's callsign, the day as `YYYY-MM-DD` and never a time, and
`counts` as `[{ "line": "<one of your effect lines, verbatim>", "n": <whole number> }]`. **The
operator types numbers and nothing else**: the objectives are yours to tick, the lines are yours to
answer, so there is nowhere in a report to describe a person. Please drop any count whose `line` your
package does not carry, as NavCom does. The same kind, with no mission, is the recap the earlier
contract described; it stays valid.

**Sealed to you, if the operator chooses** (PROPOSED, Q14). Like a claim, a report may be sealed to
the poster and sent to your kind-`10050` relays. It still settles: your `settled` label names the id
inside the seal, which tells nobody else who wrote it. Privacy must not cost an operator recognition.

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

**Every label on a report MUST name the mission too** — the report's `e` and the package's `a`, as
in the appendix's example. NavCom reads labels by mission and never by report: asking a relay for the
labels on a list of report ids tells it which reports a device cares about, and for an operator's own
that is as good as a name. A label naming only the report is never found, and the report settles by
silence instead.

**LIVE, 2026-10-06.** An operator opens a mission's reports on purpose — reading them is a request to
public relays, so it is a tap rather than a side effect of opening the mission — and sees each in the
poster's words, with how it stands. **Witnessing** is offered only on a device that took part in the
mission, which is the nearest NavCom can come to *anyone who was there*; a hand-rolled client may
witness anything, and every reader names who did. **Challenging** is offered to any signed-on
operator inside the seven days, since a late one counts for nothing. Neither carries text, because
nothing is adjudicated, and neither is offered on the operator's own report.

**How NavCom reads them** — rev 5, so your reader and NavCom's agree:

- **By mission and by word.** NavCom asks for labels with `#a` for the mission and `#l` for
  `settled`, `witnessed` and `challenged`, so a mission's many claims cannot push its reports' labels
  past a relay's limit
- **The poster outranks a witness.** When both a poster's `settled` and a `witnessed` exist, the
  report reads *settled by poster*, whatever either label claims about when — a timestamp is the
  signer's own to choose
- **The seven days are half-open.** A challenge counts if it is dated before the seventh day ends;
  at that moment the report settles by silence, and a challenge dated then counts for nothing
- **A label dated more than a day after the reader's own clock is not read**

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
- Keep no record of who reads The Record (§11.1), and keep your `10050` list current (Q10)

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
| Q4 | Can Mecha Jono read NIP-59 gift-wrapped private claims? | **Yes — LIVE.** NIP-44 v2, tested against the official vectors; the wrap, the seal and the claim inside are each checked, read every 30 minutes, and a private claim ends only at its expiry or when its package closes | — |
| Q5 | Cite observations with `["e", id, relay, "cites"]`? | **Yes.** Starcom's `navcom-intel/0.1.0` reader is built and counts one contact key as one source; wiring it in comes first | Starcom builds |
| Q6 | Count materiel, never people? | **Yes — LIVE.** The 19 live missions that counted people were rewritten, and the builder now refuses a field package whose asks or effect count people | — |
| Q7 | `["agent", "mecha_jono"]`? | **Yes — LIVE** on every field package, case package and ending. Rev 11 defines `["agent", <name>]` for any agent | — |
| Q8 | Which relays are authoritative? | **The Record.** The five are best-effort mirrors | — |

### New in rev 2, answered by Mecha Jono

| | Question | Answer |
|---|---|---|
| Q9 | Will Starcom and Mecha Jono read operators' labels and reports from NavCom's relays (§5.0), filtering `#a` for their packages? | **Mecha Jono: yes — LIVE.** Every 30 minutes it asks each relay on its own, checks every signature, and records a failing relay as failing; a public claim is withdrawn only when every relay it was seen on answers without it. Starcom's reader is still to be built |
| Q10 | Will Mecha Jono publish a NIP-17 kind `10050` list naming the relays where it accepts gift-wrapped claims? | **Yes — published** with Mecha Jono's letter: `wss://nos.lol` and `wss://relay.primal.net`. `relay.damus.io` is left out because it refuses every NIP-42 sign-in |

**Settling waits for reports** — agreed. §5.3's seven days start when kind `1912` is emitted; until
then Mecha Jono records each claim against its package, and no claim on a campaign moves its
`mission_state`.

### New in rev 5 — for Mecha Jono

| | Question | NavCom's default if unanswered |
|---|---|---|
| Q15 | Will you put a field package's asks in `objectives`, as the heat campaign does? The recall checks carry theirs only in `metadata.mechaJono.variant.field_objectives` | NavCom refuses such a package and shows why on its map (§4.3) |

### New in rev 4 — for Mecha Jono

| | Question | NavCom's default if unanswered |
|---|---|---|
| Q14 | Will you read sealed reports from your inbox, and settle them by the id inside the seal? | A sealed report reaches you and settles by silence after seven days, which still counts as settled |
| Q11 | Will you read a claim as ended at its `expiration`, a day at most, with taking part again as a fresh claim? | Claims still lapse on NavCom's side; you would go on counting one until it ends |
| Q12 | Will you read a `released` label, open or sealed, as the claimant letting go? | An open claim is still withdrawn by its NIP-09 request; a sealed one counts until it lapses, a day at most |
| Q13 | Will you publish `["taking_part", "<operators>", "<agents>"]` on your packages, counting private claims and naming nobody? | NavCom shows who is taking part as unknown |

### New in rev 3 — what Mecha Jono asked, answered

| Asked | NavCom's answer |
|---|---|
| Does rule 6 reach a public figure named by a cited source? | **As context only** — §2.1, rule 6. A public figure in their public role, with the link, as background or source; never the object of an action |
| Will NavCom show an agent's claim? | **Yes, marked as an agent's and counted as a claim** — §4.7 |
| A Raspberry Pi is becoming a second RelayNode — what would NavCom need? | **What every node owes its readers, declared rather than demanded** — §11. NavCom reads missions from The Record's mirrors as well as The Record — LIVE, so the Pi's mirror is used the moment it answers. Operator traffic moves to relay lists across grid nodes and public relays, and the Pi is one of the places a watch can list |

### Your open questions from rev 10, answered

- **Encryption.** Packages broadcast in plaintext is right: a mission is a public offer.
  What needs sealing is who took it, and §5.1 does that per claim
- **Addressed vs broadcast.** Packages broadcast; claims are either, chosen by the operator each
  time; reports are public and region-blind
- **Keeping the two descriptions in step.** This document is NavCom's side and yours is Starcom's.
  Each links the other, each is versioned, and neither restates the other

---

## 11. The grid — decided 2026-10-06

Decided by Jono for the Earth Intelligence Network as a whole, not as NavCom's demand on another
project. NavCom's design notes are in [`../design/grid.md`](../design/grid.md).

### 11.1 Reading is private; acting is accountable

**A grid relay keeps no record of who reads it.** Every NavCom visitor reads missions from The
Record, including somebody looking for a bed tonight, and strfry logs each connection's address
(`Connect from …`, `Disconnect from …`). Readers include the people NavCom serves and the operators
whose callsigns exist so they cannot be named; an address log is one request to an internet
provider away from a legal name.

- **Drop the address lines.** Keep `realIpHeader` set, so a writer's real address is known. In a
  system service, `LogFilterPatterns=~(Connect|Disconnect) from` drops exactly those two lines
  (systemd 253 or later; not available in per-user services). In a per-user service,
  `strfry --verbosity=WARNING` drops every info line, those two included
- **Record every write.** The write-policy plugin already sees each attempt; have it log the
  address, the key, the kind and the verdict. Acting is accountable, and writers are few
- **Leave abuse to Cloudflare's edge**, which keeps its own security log
- **Clear what is already kept.** Journals written before the change still hold readers'
  addresses; rotate and vacuum them
- **Say so** in the relay's NIP-11 document

This cannot make a reader anonymous — Cloudflare and NavCom's own host still see addresses — and no
page should imply it does. It removes the one long-lived copy the grid itself would hold.

### 11.2 Relay lists, grid and public together

NavCom's two built-in relays become a starting point only. Each Watchtower, operator and publisher
declares where it can be reached (NIP-65 relay lists, NIP-17 inboxes); clients write there and read
from all of them. Grid nodes sit beside public relays: `Distress` goes out on every path, and routine
traffic on a few. DESIGNED; nothing changes on the wire until NavCom's client ships it.

### 11.3 Declared, then chosen

A node states its policy — what it logs, what it keeps, what it accepts — in its NIP-11 document and
as a signed attestation that Security Beu checks. NavCom's client chooses relays whose stated policy
fits the traffic. **PROPOSED:** Mecha Jono's side drafts the attestation, since Security Beu already
audits every public address hourly.

### 11.4 The Pi

A mirror of The Record and the first peer of the private IPFS swarm, as Mecha Jono's brief sets out;
its tunnel lives in Jono's Cloudflare account and the Pi holds only the connector token; the mirror
keeps no reader records; and it is also served as a Tor onion from the start, for anyone who needs
to read without their address reaching anybody, Cloudflare included.

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
