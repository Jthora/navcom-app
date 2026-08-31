# Reconciling an external RLSH design brief

An outside brief and companion solution rosters — *Navcom design brief v0.1* and *Navcom
Solution Rosters v0.1*, Archangel Agency — were brought in to shape the next phase of work.
Roughly eighty-five discrete proposals across twelve rosters, seven ADRs, a threat model and
twelve gated open questions.

This is the record of what happened when each one was checked against the code. It exists so
the next person finds a decision rather than an oversight, and so nobody re-derives it — a
failure this project has already had at small scale, when a scoping line written one day was
forgotten the next.

**Confidence markers are preserved** from the source, as its §10.6 asks, and added where this
document makes claims of its own.

---

## Method

Four parallel audits, one per area, each reading the actual files rather than summaries:
safety and escalation; identity, attestation and the operator's record; content and reference
layers; structure, threat model and governance. Every verdict below is anchored to code or to
a normative document, and where an auditor was uncertain it says so.

Each item was sorted into one of: **already built** · **already declined** · **conflicts with
an invariant** · **mis-scoped** (assumes a surface NavCom does not have) · **new and
buildable** · **new but gated**.

## The headline, stated plainly

`[EVIDENCE]` Of roughly eighty-five items, the great majority were **already built or already
refused by name**. About twelve were mis-scoped against surfaces NavCom does not have — it
handles no media, runs no server, and has no accounts. About eight would violate an invariant
if built literally. Six survived as genuinely new.

**The brief's value was not its proposals.** It was that auditing against it found **eight
real defects in NavCom** that the brief never mentions. That is the honest return, and it is a
good argument for reading outside work critically rather than either adopting or dismissing it.

`[INFERRED]` Two independent designs converging this heavily is itself evidence the primitive
is right — the same argument [`attestation.md`](../attestation.md) already makes about
Starcom's `Finding`.

---

## What it found in NavCom — the actual return

| | Status |
|---|---|
| **The patrol export could not leave your notes out.** `includeNotes` was declared in `ExportOptions`, honoured by `exportPatrols`, and bound by no screen — so it silently read as on. The riskiest free text in the system, in the one artifact built to be pasted in public | **Fixed.** Bound, and off by default |
| **Standing disclosed its endorser set.** Watching for withdrawals subscribes with `authors: <your endorsers>`, so the relay learns who vouched for you — while the code said "indexed nowhere" | **Documented, not silently patched.** Closing it trades against revocation correctness; see `standing.ts` |
| **Holding up a credential overclaimed.** *"Signatures verified on this device"* is true and indistinguishable, to a second reader, from a page that only says so | **Fixed.** Reworded, and the signed pair is now gettable so they can check it themselves |
| **Standing survives a new key for free**, and nothing recorded it | **Documented** for whoever builds key rotation |
| **`field-terminal.md` promised photo capture** the code has never had | **Fixed** — narrative was the bug |
| **`identity.md` described an emblem upload path** that does not exist | **Fixed** |
| **`build-order.md` 10.b justified itself with "nothing writes an entry"**, contradicted by its own document | **Fixed** |
| **`declined.md` contradicted itself on allied interop** — declined in one place, listed as deferred in another | **Settled: declined.** C37 describes the shape if reversed, not a commitment |

A ninth, found by the same pass and fixed since: the guard against *a mechanism nobody can
reach* checked a hardcoded five of twenty-four capabilities, and the nine that declared no
control included the two screens where that defect has actually occurred.

---

## Where the brief and NavCom genuinely disagree

Four real conflicts. Three resolve in NavCom's favour on the evidence; one was a decision.

### ADR-001 — ActivityPub as the foundation protocol

`[DECISION]` **Declined as written; Nostr stays the foundation.** The brief's evidence for
ActivityPub's reach is sound, but its conclusion assumes server-hosted accounts on federating
instances. NavCom has **no server** (`svelte.config.js` is static-only with `strict: true`;
`vercel.json` has no functions) and **no account** — the keypair *is* the identity, so there
is no host to be nomadic between and nomadic identity solves a problem NavCom does not have.

The sealed group-envelope transport has no ActivityPub equivalent, and a real AP actor needs
an inbox, which is one step from the feed and notification anti-patterns.

**What survives** is the brief's §5.3 — reach people where they already are, do not ask them
to migrate — which is already `propagation.md`'s position. An outbound-only bridge is **new
but gated**: it needs a named counterparty (`propagation.md` names Herocore, which is not
ActivityPub) and a server that does not become Milestone 9.4's second single point of failure.

### ADR-004 / Roster 4 — escalation on a missed check-in

`[DECISION]` **Refused. Invariant 3 stands.** The brief's flagship feature collides with four
independently written rules, one of which is structural: `escalation.ts` cannot start a ladder
from anything but a received `20911`. The full argument, including the strongest case *for*
the brief's position (C38's self-waiver) and why it loses anyway, is recorded in
[`declined.md`](../declined.md).

**What was built instead** is the part that was actually missing and is invariant-compatible:
`watch-state.spec.md` requires the node to *attempt contact with the operator* on an overdue,
and it never did. It now does — to the operator and to nobody else.

### Roster 10.1 — *"A attests that they worked alongside B"*

`[EVIDENCE]` **Implementing this literally would be a regression.** NavCom's credential names
no subject at all — three fields, no `p` tag, enforced in `endorsement.ts` — because
[`attestation.md`](../attestation.md) refuses records about people who never agreed to exist
in the system. The brief's shape re-creates exactly that.

10.6, a global queryable attestation graph, is **structurally impossible** here rather than
merely unbuilt: no subject to query on, credentials never published, storage device-local,
verification needs no lookup.

### Roster 12.4 — *"not command-and-control"*

`[INFERRED]` **The brief's version is weaker and adopting it would be a downgrade.** It
refuses a product category; invariant 6 refuses a capability — *"There is no dispatch verb"* —
which binds agents hardest, survives scale, and carries a named failure precedent in
`positioning.md`. A rule against a global ops board stops applying once a cell wants a local
one. *No dispatch verb* does not.

---

## Where they converge

`[EVIDENCE]` Ten roster items are refused by name in [`declined.md`](../declined.md) already,
with costs stated: cross-cell coordination, uptime assumptions, reputation defence, inferring
safety, log completeness, disputes between operators, agent trustworthiness, playbook content,
software creating a cell, and re-engagement interrupts.

Convergence is a finding, not a to-do. Per `CLAUDE.md`, the response is to cite the existing
refusal rather than open a work item — *"prefer deleting a rule to adding one."*

Three more converge in NavCom's favour with a stronger mechanism than the brief asks for:
§3.3 (no real names) is invariant 8; §3.4 (no scores) is *provenance, never a count*; §5.2
(export) is the encrypted backup plus the patrol record.

---

## Mis-scoped, and why

`[EVIDENCE]` These assume a product NavCom is not:

- **11.1 metadata scrubbing.** NavCom handles no media at all — no file input, no
  capture-and-store, nothing in `static/` but icons. There is nothing to scrub.
- **Roster 1, the gear print library.** `service-worker.ts` precaches everything in `static/`
  except `.csv`, so any STL would land on every operator's phone against a 400 MB device
  floor. And hosting other people's CAD is mirroring, which
  [`community-continuity.md`](../product/community-continuity.md) refuses.
- **11.2 client-side self-audit.** F3's three constraints are insufficient: learning what is
  *findable* means querying third parties, correlating the operator's IP with their own
  persona at exactly those services. That contradicts build-order 8.6, *"leave no trace."*
- **§3.6's DGUV risk tiers.** The brief's *conclusion* is already NavCom's, stated more
  bluntly. Its *framework* is not, and importing a risk taxonomy buys nothing the existing
  sentences do not already say.

---

## What was built as a result

| | |
|---|---|
| The overdue contact the spec required and never had | Shipped |
| **4.2** — saying that a watcher need not be an operator. The brief's highest-leverage finding, and in NavCom a copy change: the mechanism always allowed it | Shipped |
| **9.2** — pointers to certification somebody else issues | Shipped |
| The four code defects above | Shipped |

## What is declined as a result

Roster 1 entire; 11.2, 11.4, 11.5, 11.6; 9.1 (already refused verbatim by
`CONTRIBUTING.md`); 3.5, 3.6, 9.4, 9.5, 9.6, 10.4, 10.5, 10.7. Roster 4.9 is **declined, not
deferred** — the brief files 24/7 monitoring as DEFER, which would move it onto an obligation
list; `declined.md`'s *Uptime* entry already refuses it with the cost stated.

## What is still open

- **5.2 — an after-action `outcome` field.** `[HYPOTHESIS]` Genuinely useful and genuinely
  blocked on a person: it needs a closed union of outcomes, and inventing that taxonomy is the
  same act as extending the directory's `type` taxonomy, which `CLAUDE.md` reserves for humans
  with local knowledge. The categories shape what operators notice.
- **3.1 — a statute reference.** `[HYPOTHESIS]` Best-fitting large proposal, but its machinery
  fit is mediocre (per-field volatility does not transfer; `call-first` suppression is
  backwards for statute text) and its real blocker is the same human one as 6.9.
  `CONTRIBUTING.md` already names *rights* as expertise-gated. Queue it behind 6.9, not ahead.
- **9.3 — private completion tracking.** `[HYPOTHESIS]` Accruing tier, endorsement-grade
  handling. Small. Rests on the brief's weakest evidence tier.
- **An outbound bridge**, per ADR-001 above.
- **The census** the brief's §9 gates Phases 5–6 on. Not agent work.

---

## What the brief got right that NavCom had not written down

`[EVIDENCE]` Freeman's *Tyranny of Structurelessness* and Gary Marx on infiltration appear
nowhere in this repository. The *practice* is unusually strong — refusals are a typed module
published at `/.well-known/navcom-refusals.json`, every doc is a public page, and the
capability receipt puts who is on call in front of an operator before they sign on — but the
argument for **why** visible structure matters is not recorded. That belongs in
[`lore.md`](lore.md), and it is the cheapest genuinely-new thing the brief offers.

`[INFERRED]` Its second real contribution is F1 — that the watcher need not be an operator.
NavCom always allowed it and never said it, which made the cheapest safety arrangement in the
app invisible to the people who most needed it. An outside reader found in a day what a year
of inside work had not, which is the argument for doing this again.
