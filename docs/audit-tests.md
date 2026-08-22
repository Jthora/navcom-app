# The second 27 — is it proven, is it reachable, does it serve anyone

Nine built milestones, three lenses each. Started 2026-08-22, after
[`audit.md`](audit.md) closed.

**Why a second grid rather than more of the first.** The first asked *what breaks* — hostile
input, silent failures, boundaries. It found sixty-odd defects and its most expensive mistakes
were **two wrong negatives**: places I recorded "nothing found" after measuring the wrong
thing. That is the shape this grid exists to attack. A test suite is exactly where a wrong
negative lives: 404 core tests passed while nobody in a config file could acknowledge a
`Distress`, because the tests exercised an object the config parser cannot build.

So this grid asks a different question at each level: **is the rule proven, is the mechanism
reachable, and does the whole thing serve a person with a goal.**

## The lenses

| | What this pass is looking for |
|---|---|
| **U — Unit** | Rules with no test. Tests that assert an implementation rather than a behaviour. Tests that would pass against the wrong code, or against an object the product cannot build. Vacuous assertions, over-mocked seams, and the join between two tested halves |
| **I — Interface** | Is the mechanism reachable and operable in a browser? Does the control exist, is it enabled, does it survive hydration, does it work one-handed? Does the screen do what the unit tests claim on its behalf? |
| **S — Story** | One named person, one goal, start to finish. Not *"the button exists"* but *"the Protest Medic, at 2am, with a flat battery and no signal, can do what this milestone promises"*. The failure this finds is a journey where every step works and the whole does not |

The people are the project's own, from `research/`: the **Protest Medic**, the **Public Face**,
the **Sleeper**, the **Quartermaster**, the **Newcomer**, and the **Doxxer** — who is not a
user but is present in every story, because what he can see decides what the others can do.

## The grid

Each cell is a pass. `—` not started, `✓` done, and a note when it found something.

| Milestone | Surface | U | I | S |
|---|---|---|---|---|
| **0** Prove what is built | Browser harness, service worker, offline, seeding, the verification layer itself | — | — | — |
| **1** One operator alone | Display rules, patrol record, contact, wipe, seeder | — | — | — |
| **2** One watch staffed | Executor, pager, drills, web push, on-call | — | — | — |
| **3** Two who met once | Peers, presence, cards, invites, public presence, buddy | — | — | — |
| **4** Squad with no box | Watch mode, group sealing, board, handover, watch key | — | — | — |
| **5** Written-down properties | PQC, declined, battery, RTL, watch-state v4 | — | — | — |
| **6** Knowledge gets in | Corrections, merge, needs-checking, notes, promotion | — | — | — |
| **7** Standing | Credentials, claims, revocation, the watch gate | — | — | — |
| **9** No single point of failure | Backup and restore, capability sentence, funding | — | — | — |

Milestone 8 has no row for the same reason as last time — it is unbuilt apart from 8.1, which
was audited as a twenty-eighth pass at the end of `audit.md`.

## Rules for a pass

The first five carry over from `audit.md` unchanged, because they are what made it work:

1. **Read the surface first.** Not the tests — the code, and what it assumes
2. **Probe rather than reason.** A pass that only reads will miss what a pass that runs finds
3. **A pass that finds nothing says so.** Manufacturing a finding is worse than an honest
   empty pass, and it buries the real ones
4. **Fix what is found, in that pass**
5. **Test counts move the right way.** A total that drops means something was destroyed

Four more, specific to auditing tests:

6. **Every test added must fail against the unfixed code.** Demonstrated, not assumed. This
   was already the practice; here it is the whole point
7. **A test that cannot fail is worse than no test**, because it is a claim of coverage. The
   `cache.addAll` test in 0.R passed identically against the broken and the fixed version and
   was deleted rather than kept
8. **Prefer a test against something the product can actually build.** 2.X's ack path was
   covered only in a shape the config parser cannot produce. Where a fixture and the real
   builder disagree, the fixture is the bug
9. **A story pass may only use controls a person can reach.** No seeding past a screen, no
   calling a module directly. If the story needs a state the UI cannot produce, that is the
   finding

## What the first grid already established, so this one does not re-find it

Six recurring shapes, listed in `audit.md`'s closing section: unbounded intakes, untested
joins, discarded publish results, one machine's clock used as everyone's, second
implementations of an existing rule, and documented behaviour connected to nothing. Those are
fixed where found. **This grid should expect to find the same shapes in the tests themselves** —
a suite has intakes, joins and duplicated rules exactly as a codebase does.
