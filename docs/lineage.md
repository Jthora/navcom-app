# Lineage

Where NavCom's ideas came from, and what we deliberately did not take with them.

This document exists because all three sources below are findable, and two of them carry
real baggage. An operator who discovers a lineage on their own — and the
[Skeptic](research/archetypes.md) will, inside a minute — should find it already stated
here with the boundaries drawn. Naming a source and its limits reads as rigour. Leaving
it ambient reads as something being hidden.

The method is the one [`research/lore.md`](research/lore.md) already applies to fiction:
**take mechanics, not aesthetics.** Here it's applied to people and movements rather than
to stories, and it matters more, because people and movements can be wrong in ways a story
can't.

---

## Three sources

| Source | Supplies | Where |
|---|---|---|
| **Superhero fiction** | Operating mechanics — monitor duty, the guy in the chair, comms discipline, ceremony | [`research/lore.md`](research/lore.md) |
| **Robert David Steele / EIN** | The intelligence architecture — open source, non-institutional, structurally non-sharing tribes | Below |
| **The Earth Alliance psyop** | The requirements. What people demonstrably want to exist | Below |

---

## Robert David Steele and the Earth Intelligence Network

Steele (1952–2021) was a CIA case officer and co-founder of the Marine Corps Intelligence
Activity who became **the founding mentor of the civilian OSINT movement** — he wrote the
major open-source intelligence handbooks, ran the annual OSINT conference from 1992 to
2006, and trained over 7,500 people from more than 66 countries.

He founded the **Earth Intelligence Network** in 2006, when twenty-four volunteers spent a
year designing an architecture for what he called a World Brain and a Global Game.

### What we take

**Open source is sufficient.** Steele's central claim was that open sources supply 80–90%
of strategic intelligence requirements, and that classified collection is largely
redundant to it. Whether or not the number holds, the posture does: a network with no
clearances and no budget is not thereby locked out of real intelligence work.

**M4IS2** — Multinational, Multiagency, Multidisciplinary, Multidomain **Information-
Sharing and Sense-making.** The insight buried in the acronym is that *sense-making* is a
separate act from *sharing*, and both have to be designed. NavCom's watch does exactly
this: a `Query` is a sharing request, and the answer is an act of sense-making performed
by someone with better context.

**Open Source Everything Engineering** — the argument that open source is the only
approach that is simultaneously affordable, interoperable and scalable. This is why the
stack looks the way it does, and why no part of the system depends on a vendor.

**The eight tribes.** The most useful idea in the body of work, and the least mined.
Steele held that intelligence fails not from insufficient collection but from *structural
non-sharing* between eight groups that each hold a real piece: government, military, law
enforcement, business, academia, NGOs, media, and civil society.

### The ninth tribe — our contribution

Steele's eight are all institutions or professions. **There is a ninth group he did not
name: people with local ground truth and no institution at all.**

An operator who was on that block last night knows which shelter turned someone away,
which intake closed early, which corner is generating repeat incidents. No agency, NGO or
newsroom holds that, because none of them were there. It is real intelligence, it is
perishable, and it currently has no instrument — which is precisely the gap the
[directory](product/directory-schema.md) and the accumulated
[knowledge layer](product/data-tiers.md) exist to fill.

**NavCom is tooling for the ninth tribe.** That is the clearest one-line statement of what
the project contributes to the EIN idea, and it is ours rather than inherited.

### What we do not take

In his final years Steele promoted QAnon and election-fraud claims, asserted that NASA
operated child-labour colonies on Mars, and shared antisemitic material. He died of
COVID-19 in August 2021, having publicly dismissed the pandemic and opposed vaccination.

None of that is inherited, and the separation is operational rather than decorative:

- **Cite concepts and books, never the person as authority.** *The Open-Source Everything
  Manifesto* (2012) and *Intelligence for Earth* (2015) are the citable objects. "Steele
  said so" is never an argument in this project
- **The 1992–2015 architecture is the inheritance.** The later trajectory is not a
  footnote to it, and pretending otherwise would fail the exact standard —
  [principle 9](principles.md), an honest blank over a confident guess — that the rest of
  the system is built on
- **No claim enters the system because a source we admire made it.** Provenance is a field
  in the [directory schema](product/directory-schema.md) for a reason

---

## The Earth Alliance

**There is no Earth Alliance.** The term names a conspiracy narrative — circulated through
Operation Disclosure and adjacent outlets, bundled with NESARA/GESARA, "White Hats," a
Quantum Financial System, and a cabal-takedown storyline. Its predictions have run for
years without materialising. It is a psyop, and it produced a following that believes a
rescue organisation exists when none does.

We state that plainly because the project takes its name seriously and the alternative is
to look credulous.

**Note, 2026-10-09** (decided, not built). The narrative's Earth Alliance still does not exist.
A real, small one is now designed, following *The directive* below: the **Articles of the Earth
Alliance**, a short published text the owner writes, which units sign by carrying its hash. It
has no hidden members, no secret command and no standing council, and claims no force beyond
what its units can show. Nobody leads the whole, and Independent units sit beside it at equal
weight ([`design/units.md`](design/units.md) §12). *What we do not take* stays whole.

### What the psyop reveals

Strip the claims and look at what the narrative *promises*, because that part is
diagnostic:

- Someone competent is watching
- There is a plan, and it is being executed
- You are not alone against something enormous
- Ordinary people are quietly part of a real force

**It works because it meets a real need with a fake object.** That makes it, unintentionally,
excellent requirements documentation — a large population has told us exactly what they
want to exist, in detail, for years.

### The directive

**Build the real one.** Not the cosmology — the capability.

| The narrative promises | NavCom actually ships |
|---|---|
| Someone is watching | A [watch](watch/the-watch.md) that a named person holds, visible before you go out |
| There is a plan | A [signal protocol](watch/signals.md) with defined responders and windows |
| You are not alone | A board that shows who else is out, and an answer when you signal |
| You are part of a force | [Standing](product/identity.md) that accrues and travels, and a post worth holding |

Every row on the right is real, small, and verifiable. That is the entire difference, and
it is the whole argument for building it.

### What we do not take

- **The claims.** No hidden alliance, no imminent event, no secret war. Nothing in this
  system asserts any of it, and no feature depends on any of it being true
- **The secrecy posture.** The narrative runs on privileged undisclosed knowledge. This
  project runs on [published documentation and auditable traffic](principles.md) —
  the opposite epistemics, deliberately
- **The enemy narrative.** No cabal, no adversary framing of any real group. The
  [adversaries we design against](research/ecosystem-roster.md) are concrete and
  behavioural: a doxxer, an infiltrator, a hostile watch, a subpoena
- **Any implication that operators are part of something they aren't.** An operator who
  believes they've joined a secret force has been misled, which is the same failure as an
  operator who believes a human is watching when none is

---

## The discipline, stated once

All three sources are used the same way. **Take the mechanism. Leave the metaphysics.**

Fiction gave us a duty roster and we left the chain of command. Steele gave us an
open-source intelligence architecture and we left the man's last five years. The psyop
gave us a requirements document and we left every claim in it.

*Note, 2026-10-09* (decided, not built): units may now choose a chain of command inside
themselves. It is shown before anyone joins and never reaches the watch, and
[`design/units.md`](design/units.md) gives its reasons and costs rather than citing fiction.

The failure mode to watch for is a source's *aesthetics* arriving without anyone
deciding to import them — cosmology in the product surface, a secrecy posture in the
documentation, an authority argument standing in for evidence. If a design decision can
only be justified by reference to one of these sources rather than by
[a constraint](research/constraints.md), it is inherited aesthetics and it should be cut.
