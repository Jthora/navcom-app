# NavCom

**The Watchtower** — infrastructure for acting without authority while remaining accountable.

Someone is always on watch while operators are out. Not an app people check: a post
someone holds, and a terminal in the pocket of whoever's on the street.

---

## The model

**Someone is on watch.** A named human at a console, or [Mecha Jono](./docs/watch/agents.md)
holding the board when no human is on station. When you signal, something answers.

**You sign on when you go out.** The watch sees you: area, duration, last contact. You
signal as needed. You stand down when you're home, and someone confirms it.

**You ask the watch instead of searching.** Standing outside a closed shelter at 10pm
with someone who needs a bed, you don't tap through a database one-handed in the cold.
You send `Query`, and someone with a full console and both hands free answers.

That relationship — a support operator with situational awareness backing field operators
with local awareness — is the product. Everything else serves it.

## One application, two modes

You take up the watch, or you go out. The same person does both on different nights, so it
is one app you learn once.

**[Going out](./docs/watch/field-terminal.md)** — one hand, dark, cold, offline. Status,
signal, directory, log, and a playbook screen that is designed but not yet written.

**[Holding the watch](./docs/watch/the-watch.md)** — the board, the directory, answering
`Query`, raising people when somebody needs them. A squad holds it on a phone; a box can hold
it all night alongside a relay and an agent. It is a mode of the same app, not a separate
console — that was the original plan, and [`console.md`](./docs/watch/console.md) records why
it changed.

The two situations are opposite, and each mode's screens are built for its own.

## Watch states

An operator always knows what's actually behind them before going out.

| | |
|---|---|
| **Station** | A named human is at the console |
| **Automated + on-call** | Agent holds the board; a human is reachable |
| **Automated** | Agent holds the board; no human committed |
| **Dark** | No watch. Field terminal runs standalone |

Automated is normal, not a failure. What's never acceptable is an operator believing a
human is watching when none is.

## The rules that don't move

**A `Distress` signal terminates in a human, or tells the operator it couldn't.** The
agent's job in an emergency is to raise someone, not to handle it — and every step of
that escalation is reported back honestly.

**Nothing is ever recorded about the people being served.** No names, no descriptions, no
photographs, no medical detail. This system describes services and operators, never
recipients. There is no field for it and there never will be.

**Duress is always deliberate, never inferred.** Overdue nudges the watch; it never
escalates on its own. Alarm fatigue would destroy the one mechanism where failure means
someone is hurt.

**No feed, no browsing people, no comments, anywhere.** Every social primitive must answer
an operational question or it doesn't exist.

**Watch is a post, not a rank.** No clearance levels, no hierarchy, no operator who sees
more by status. **And nothing tasks anyone** — the watch tells you what is happening, it
never assigns. There is no dispatch verb.

**Pseudonymity is architectural.** No legal names. Keys on device. No persisted position
history, no social graph, no legal identities — and `principles.md` states plainly what
the node *does* hold rather than claiming there's nothing worth seizing. An operator may
waive protections for themselves, never for a third party.

## Documentation

```
CLAUDE.md                          Operating brief — scope, invariants, anti-patterns
docs/attestation.md                The one object everything is built from — read first
docs/positioning.md                What this is and who it's for — hand this to someone
docs/spec/                         Normative specs (MVP surface only) — bootstrap first
docs/build-order.md                What comes after what, and what gates it
docs/delivery.md                   How NavCom reaches a device; navcom.app's surfaces
docs/vision.md                     Where this is going
docs/principles.md                 Design rules, and how conflicts resolve
docs/ecosystem.md                  Starcom, NavCom, and the Earth Intelligence Network
docs/lineage.md                    Where the ideas came from, and what we didn't take
docs/watch/the-watch.md            Roles, states, duty, escalation, qualification
docs/watch/signals.md              The protocol — six signals, defined responses
docs/watch/console.md              The Console, and the box it runs on
docs/watch/field-terminal.md       The Field Terminal
docs/watch/agents.md               Mecha Jono; what an agent may and may not hold
docs/product/identity.md           Persona, standing, endorsements-as-credentials
docs/product/data-tiers.md         Four tiers with opposing retention rules
docs/product/visibility.md         Ghost / Team / Open, and the switches underneath
docs/product/directory-schema.md   Resource schema, intake taxonomy, staleness model
docs/product/funding.md            Pseudonymous support without a donation platform
docs/product/opt-ins.md            Everything the system could hold about you
docs/product/propagation.md        How the network grows, and how it never grows
docs/research/lore.md              Fiction as design source — read this first
docs/research/archetypes.md        Twelve field-operator archetypes
docs/research/ecosystem-roster.md  Watch, analysts, agents, infrastructure, adversaries
docs/research/constraints.md       What those stresses demand
docs/research/prior-art.md         What exists, and what it teaches
```

New here? Start with [`docs/positioning.md`](./docs/positioning.md) — what this is, who
it's for, and what it deliberately isn't.

Before proposing anything, read [`docs/research/lore.md`](./docs/research/lore.md). It
explains why this isn't shaped like the software you're used to, and what happens if
someone "fixes" that.

## Contributing

**The most valuable contribution is local knowledge, not code.** If you know which listing
is wrong, that is the thing this project needs — the engineering is the easy 20%.

Entries live in `data/regions/<region>/resources.csv`. Run `npm run check:data` before
opening a pull request. Full guidance, including the rules that never bend, in
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

The directory is readable by anyone at [navcom.app](https://navcom.app) — no account,
nothing to install.

## Licence

Three, for three different things — [`LICENSING.md`](./LICENSING.md) explains why.

| Code | Data | Docs |
|---|---|---|
| Apache-2.0 | CC0 1.0 | CC BY 4.0 |

The directory data is public domain deliberately: a city, a 211 service or a mutual aid
group should be able to use corrected listings with no friction. The name is not covered —
"NavCom" is a claim about behaviour, so fork the code and call it something else.

**Please read this before relying on the data.** It is maintained by volunteers and shows
how old every perishable fact is, on purpose. When a check is too old to trust it says
*call first* — a real answer, not a missing one. A blank means nobody established
something, never that there is no restriction. Call ahead before sending anyone anywhere.

---

A project of [Archangel Agency](https://archangel.agency).
