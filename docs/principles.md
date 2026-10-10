# Principles

Design rules, and how conflicts resolve. When a decision is contested it gets settled
here rather than by whoever argues longest.

---

## 1. The watch is the product

Everything attaches to the duty relationship: a named party responsible for operators who
are out, and operators who signal rather than browse. A feature that doesn't serve that
relationship is probably somebody else's product.

## 2. No feed. No browsing people. No comments.

Anywhere, ever. No scrolling timeline, no discoverable directory of operators, no replies
or threads on anything.

Social products are optimised for the feed; operational tools are optimised for the
moment of need. This rule does more anti-drift work than every other rule combined — if a
feature needs a feed, it's the wrong feature.

Discovery is contextual only: operators active near you tonight, or present at an op
you're in. Answers to questions become directory or playbook entries — knowledge, not
discussion.

**Notes, 2026-10-09** (decided, not built; [`design/groups.md`](./design/groups.md)):

- **Narrowing what the phone already holds is not browsing people.** Search sends nothing,
  and matches names only (groups.md §4).
- **Narrowed: a crew's log is an owner-decided exception to *no scrolling timeline*.** It is one
  flat list fetched when opened, closed at the end of stored events, with no replies, no threads
  and no subscription (groups.md §9). A crew also keeps one Agreed line.
- **A crew card is an owner-decided exception to *no discoverable directory of operators*.** One
  member may hold a public card for their crew. It carries no roster, count or meeting place,
  and a knock reaches only that member (groups.md §10). Nothing about a unit's chain or
  offices is public.

## 3. Every social primitive answers an operational question

Presence isn't "the network is alive" — it's **who can I actually reach tonight**.
Standing isn't reputation — it's **can I work with this stranger**. If a primitive can't
be phrased as an operational question, cut it.

## 4. Automation holds the board; a human holds the responsibility

Agents may run timers, answer lookups, route requests and escalate. They may never be the
end of the line when someone is in trouble, judge whether an operator is safe, or be
presented ambiguously as a person.

**`Distress` terminates in a human, or tells the operator it couldn't.**

**And nothing in this system tasks anyone.** The watch tells you what is happening; it never
assigns. There is no dispatch verb — not for a human holding the board, and least of all for
an agent. A network of volunteers with no hierarchy cannot give orders, and a system that
appeared to would be sending people toward danger on its own initiative.

**Narrowed 2026-10-09** (decided, not built). Units may be hierarchical. Inside a unit whose
charter the member read and accepted before joining, orders exist as that charter allows. Every
order expires within 7 days, never travels by notification or `Distress`, and needs both the CO
and the XO to bring more than one person to a place ([`design/units.md`](./design/units.md)
§10). The default level is word and offers, which leaves this rule as written. The watch still
never assigns, and no agent orders anyone.

## 5. Never the people served

No names, no descriptions, no photographs, no locations of individuals, no medical
detail. This system describes services and operators, never recipients.

Not configurable. No use case overrides it.

## 6. Opt-in, not absent

Operators disagree fundamentally about visibility, and both extremes get a complete
system. The resolution is always a setting, never a deletion — removing a feature serves
only the person who refused it.

Presets set switches and never override them. No preset is visible to another operator.
Defaults lean private; ceilings stay high.

## 7. Two kinds of memory, opposite rules

Identity, standing, contributions and board time **accrue** — losing them is the failure.
Positions, incident logs and tonight's data are **wipeable** — retaining them is the
failure. See [`product/data-tiers.md`](./product/data-tiers.md).

Panic wipe destroys tonight and preserves the decade. Burn destroys everything **on the
device**, and only burn reaches endorsements — because they carry association data. The
node-side accountability log is outside both, deliberately: a log an operator could erase
would not be a check on the watch.

## 8. Duress is deliberate; overdue only nudges

Never inferred from silence, missed windows or inactivity. Overdue makes the watch
contact you; only a human reviewing it can raise it further.

People are late for ordinary reasons far more often than dangerous ones, and alarm
fatigue would destroy the one mechanism where failure means someone is hurt.

## 9. An honest blank beats a confident guess

The worst failure available here is a confident wrong answer that leaves someone outside at
10pm.

This is [the attestation model](./attestation.md) applied to everything the system shows:
weight is derived from how something is known and how long ago, never asserted; absence is
information rather than a gap; and nothing is ever *verified*, only unfalsified so far.

Volatile data shows its age; stale reads "call first"; blank renders as "unknown," never as
absence of restriction; flagging is always easier than fixing.

It binds agents hardest — a wrong answer carries unearned authority coming from one.

## 10. Pseudonymity is architectural

The realistic threat is doxxing, stalking and harassment. Security effort goes into **not
holding identifying data**: no legal names; keys on device; no central social graph; local
inference only.

**What the node actually holds — stated honestly, because the claim "nothing worth
seizing" is no longer true:**

| Held | Exposure if seized |
|---|---|
| Board state (Live, in memory) | Who is out *right now*, coarse area |
| Accountability log (90 days) | Watch actions — never positions or query text |
| Directory | Public data |
| Encrypted emergency contacts | Only where an operator opted in; decryptable only during escalation |
| Agent logs, drill results | Operational, no operator PII |

No persisted position history, no social graph, no legal identities. That is a much
smaller target than most systems — and it is not nothing, so it gets said plainly rather
than implied away.

**This is a strong default, not a wall an operator can't open.** An operator may waive
protections *for themselves* — an emergency contact, a paging channel, a recovery
method — when the capability is worth the exposure to them. Nobody may waive them for a
third party, which is why rule 5 stays absolute and this one doesn't.

Every such choice is off by default, honestly priced at the point of decision, encrypted,
scoped, revocable and auditable. See [`product/opt-ins.md`](./product/opt-ins.md).

## 11. Watch is a post, not a rank

No clearance levels, no hierarchy, no operator who sees more by status. Whoever holds the
board has it; when they stand down they don't outrank anyone.

**Narrowed 2026-10-09** (decided, not built). A chain of command may exist inside units that
choose one, and a unit's leader reads one more net: the one above, where their seat is
([`design/units.md`](./design/units.md) §11). The watch stays a post. Unit office never makes
anyone a watch holder or gives any view of the board.

## 12. Safety independence, not capability independence

Dark is survivable: cached directory, local logging, duress fallback. (Field playbooks are
designed and not yet written, so they are not on this list.) Running
without a watch must never leave an operator worse off than carrying no app at all.

It does leave them substantially less capable — `Query` is the central value of the watch
and it requires one. Say that honestly rather than implying Dark is equivalent.

## 13. Honest retention, honest propagation

The system earns opens by reflecting something real — a signal awaiting response, someone
out tonight. Never manufactured urgency: no streaks, badges, leaderboards, or absence
commentary.

**Engagement notifications are banned; safety paging is not.** The distinction matters —
conflating them once left the escalation ladder with no way to wake anyone. An on-call
operator being paged for a `Distress` has explicitly asked to be reachable. Nothing else
in the system may notify anyone about anything.

Growth follows existing trust paths. No referral rewards, invite quotas, contact upload,
or standing that depends on recruitment.

**Notes, 2026-10-09** (decided, not built). A crew card is an owner-decided exception: growth
outside existing trust paths, reaching one member by knock
([`design/groups.md`](./design/groups.md) §10). In units, a position's echelon grows with the
units under it, but nothing accrues to a person for forming units or admitting members: no
Honor, rung, writ or Karma ([`design/units.md`](./design/units.md) §16).

## 14. The device floor

A prepaid Android 8 with ~400MB free. Some of the most valuable operators have the least
device. If it doesn't run there, it doesn't ship.

---

## Resolving conflicts

1. **Never the people served** (5) — absolute
2. **Operator safety** — escalation, duress, wipe, pseudonymity (4, 8, 10)
3. **Accuracy** (9) — "unknown" beats wrong
4. **The field runs standalone** (12)
5. **Opt-in** (6) — try optional before removing
6. **No feed** (2) — growth never justifies it
7. Everything else
