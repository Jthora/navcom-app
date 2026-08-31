# Lore as Design Source

The watch model did not come from studying comparable software. It came from fiction —
deliberately, and this page exists so that stays legible to whoever works on this next.

## Why fiction

Every attempt to derive this product from existing categories produced a reskin. "Like
ATAK but simpler." "Like a mutual aid tool but for RLSH." "Like a social network but
themed." Each was coherent, each was somebody else's product with different paint.

The reason is structural: **commercial software is shaped by what can be monetised,
automated, and scaled.** A volunteer taking a console shift on a Friday night is none of
those things, so no market product contains that idea. It only exists in stories, where
organisations are shaped by what makes them *work* rather than what makes them
profitable.

So the method is: **take mechanics, not aesthetics.** Not the holographic displays — the
duty roster underneath them.

## What we took

**The Watchtower (JLU).** Monitor duty. A named person on station for a defined shift,
responsible for the network while they hold it. Not notifications — a post. This is the
spine of the entire product.

**Oracle (Batman).** The operator who can't be in the field running comms, intel and
overwatch for those who are — and being the most important node in the network rather
than support staff. This produced two things: the asymmetric Console/Field split, and
`Query`, where the person with a laptop does the lookup for the person in the cold.

**Assemble (Avengers).** A call that gathers whoever is available for a specific thing,
right now, from people who are not employees and owe no attendance. Became `Assist`.

**Comms discipline (everywhere).** Terse, structured, acknowledged. "Watchtower, this is
Green Arrow, on station." Became the [signal protocol](../watch/signals.md) — six
signals, defined responders, defined windows, no chat.

**Ceremony.** Going on duty and standing down are explicit acts that mean something. This
is culturally native to a community that puts on a costume, and it's why sign-on isn't a
toggle buried in settings.

## What we deliberately left

**Clearance levels and need-to-know (S.H.I.E.L.D.).** Compartmentalised information is
how institutions control people. Watch is a post, not a rank, and there's no tier of
operator who sees more by status.

**Command hierarchy.** The fiction is full of chains of command. This network has none —
whoever holds watch has the board, and when they stand down they don't outrank anyone.

**Secret identity as a plot device.** Pseudonymity here is a safety property with real
consequences, not a source of drama. Nothing in the product should treat an operator's
privacy as a mystery to be resolved.

**Surveillance as care.** Fictional organisations routinely watch their people without
consent and it's framed as protective. Every visibility feature here is opt-in, and an
operator running Ghost is a full participant.

## Verification doctrine

The agent design comes from the project's own doctrine rather than from AI safety
practice, and it happens to be more rigorous than most of what's shipped commercially.

**The Angelic Verification Problem** states that a sufficiently capable deceptive system
performs exactly as an aligned one would on every test it anticipates — so no external
battery proves alignment, only failure to yet find evidence against it. That isn't a
detector nobody has built. It may be a limit on what's findable from outside at all.

**Continuity Forensics** supplies the mechanism that still works within that limit: a
genuine reading is self-consistent for free, while a forged one must be *held* consistent,
and the holding leaves seams that widen under scrutiny because maintenance costs more at
each layer. Hence many cheap unpredictable cross-checks rather than one audit.

**The Angel AI Initiative** supplies the operational rule: any protocol granting reduced
scrutiny on the basis of a self-reported category, without independent verification, is
exploitable by exactly the class of entity most needing to be screened out.

**And the reflexive clause** — an entity that discovers a verification limit and then
exempts itself from it has not understood the limit. Which is why Mecha Jono submits to
the same screening as any other agent, permanently, despite being ours and local and
named in the doctrine.

The design consequence is the important part: **the answer to unverifiability is bounded
authority, not better tests.** Everything an agent may not do exists so that misbehaviour
is survivable rather than because we expect it. See
[`../watch/agents.md`](../watch/agents.md).

## Why the structure is written down, and not merely absent

The rules above make this project unusually explicit about its own power: who may hold the
watch, what an agent may not do, what a wipe does not reach, what the log cannot prove. That
reads as bureaucratic until you have the argument for it, which came from outside and is
worth keeping.

**Jo Freeman, *The Tyranny of Structurelessness* (1970).** There is no such thing as a
structureless group. Refusing formal structure does not prevent informal structure; it only
prevents it being *seen*. Power still concentrates — it just becomes unaccountable, because
its existence is denied. Occupy is the standard demonstration.

The implication is the one a decentralisation enthusiast least wants to hear: **being
distributed does not make a movement harder to corrupt. It removes the mechanism by which
corruption could be noticed.** So any structure this system creates has to be explicit and
visible *precisely so it can be argued with* — which is why `refusals.ts` is a typed module
published at `/.well-known/navcom-refusals.json` rather than a paragraph somebody has to
think to open, and why the capability receipt names who is on call before an operator signs
on rather than after.

**Gary Marx, on infiltration and agents provocateurs.** Movements built on prior relationships
and cell-like structure resist infiltration; open mass movements with easy joining do not. The
uncomfortable corollary for anyone building software: *smooth onboarding, discoverability and
network effects move a movement toward the penetrable shape.* Friction at the boundary — a QR
scanned in person, a watch key handed over by hand — is not a UX defect to be optimised away.

Two caveats, because neither idea imports cleanly:

- Marx's argument is about **trust**, not transport. NavCom's own published refusal
  `no-operator-traffic-on-a-private-relay` argues the opposite at the network layer: the
  protection there is the **anonymity set**, and the same traffic in a small private room
  tells its operator exactly who is active tonight. Cells for trust; crowds for cover.
- Small-scale infiltration — one or two patient people — is **not defensible by software**
  at all, and [`identity.md`](../product/identity.md) already says so. The design goal is
  blast radius, not immunity: assume it succeeds, and make sure a compromised participant
  learns little, reaches few, and has no ladder to climb.

Neither name appeared here until an outside brief cited them, though the practice long
predated the citation. That is worth noticing on its own: this project had the behaviour and
not the argument, and the argument is what survives an author.

## The method, for whoever comes next

When a design question comes up, the useful move is usually **not** "how does the market
solve this." It's "how would an organisation solve this if it were built to work rather
than to sell."

That question produced a volunteer duty roster, an asymmetric two-app architecture, a
signal protocol, and directory-lookup-by-proxy. None of those are in a product you could
buy, and all of them are obvious once you're looking at the problem through the right
lens.

The failure mode to watch for is the reverse: someone "fixing" the watch into a
notification system, or the board into a feed, because that's what comparable software
does. That would be the market reasserting itself, and it should be resisted on sight.
