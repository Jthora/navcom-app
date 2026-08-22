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
| **0** Prove what is built | Browser harness, service worker, offline, seeding, the verification layer itself | **✓** | **✓** | **✓** |
| **1** One operator alone | Display rules, patrol record, contact, wipe, seeder | **✓** | — | — |
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


---

## 0.U — Milestone 0, unit tests

Milestone 0's surface **is** the verification layer, so this pass measured whether the suite
detects breakage rather than reading it.

**The mechanical checks came back empty**, and that is worth stating because they are where
dead tests usually hide: across 67 test files there are **no** unawaited Playwright
assertions (a floating `expect` never fails a test), **no** tests without an assertion, and
**no** skipped, focused or `todo` tests.

### Mutation, in three rounds

**Twenty-one of twenty-one caught.** Nine coarse mutations that violate an invariant outright —
an agent stopping the ladder, an unproven drill no longer demoting, a stale volatile field
showing its old value, presence accepted from a non-peer, anybody revoking anybody's
credential. Then twelve subtler ones: boundaries moved by one, a drill made fresh for ever,
duplicate acknowledgements counted again, the merge made order-dependent again, clock skew
ignored, and six on the client. Every one failed the suite.

**That sample was biased and I said so before drawing a conclusion from it.** All twenty-one
mutations targeted code the *first* audit fixed — code whose tests I had written days earlier.
The honest question was what happens to code no pass has touched.

### What had no proof at all

Eighty-four exported symbols are never named in any test. Most are constants or type unions
covered indirectly, so naming is not the measure — mutation is. Mutating the security-relevant
ones separated the two, and **four survived**:

- **`setRelays` accepted a non-relay URL and nothing noticed.** 9.R established what this list
  decides — everything an operator sends goes through it, which is why a crafted backup
  setting it was a finding. The validation on the operator's *own* path was equally
  load-bearing and equally unverified
- **`withdrawCard` could leave the contact key behind.** That key **is** the public inbox, so
  an operator who withdrew would still have an address anybody could write to, believing they
  had closed it. This is the mechanism for becoming unfindable
- **`withdrawCard` could leave the device listed** — the module's own docstring says why that
  matters: *"a stale switch on is how somebody ends up publishing under a key they thought
  they had thrown away"*
- **`clearNote` could keep the note.** Wipeable-tier data about a doorway, where clearing
  meaning *gone* is the whole point

**No product bug in any of the four** — the code was correct. The finding is the absence of
proof, which is exactly what this lens is for: every one of them would have been a silent
regression the moment somebody edited it.

Nineteen tests added, and all four mutations are caught now. Checked by re-running the same
mutations rather than by assuming.

**Method note.** `entryHashIsHonest`, `hybridSeal`/`hybridOpen` and `isPubkey` are also never
named in a test — mutation showed the first is covered indirectly, and the other two need
hand-written mutations rather than a string swap. They are the first thing to look at in a
later pass rather than something to claim here.


## 0.I — Milestone 0, interface tests

**The harness could replay traffic but could not answer any.** A response references the id of
the event the app just published, and no canned event can know that id in advance — so every
`relayEvents` test covered *receiving* and none covered *ask, then be told*, which is the shape
of most of what this product does. The socket now records what was published and exposes
`__navcomDeliver`, so a test signs the reply **in Node, where the keys are**, and pushes it
into the open subscription. No crypto in the page.

**Two more harness faults found on the way there, both silent:**

- **An ordinary publish was never acknowledged.** Only the *refusal* path sent an `OK`, so
  anything awaiting its own publish sat until the test timed out — and the failure read as the
  screen being broken rather than the harness not answering
- **`relayEvents: []` fell through to the dead socket.** A test meaning *"a relay that answers,
  with nothing stored yet"* silently got *"no signal at all"*

That is now **five** harness faults in this session — the port collision, the test that passed
either way, the dead socket, and these two — every one of which produces a **wrong result
rather than an error**. The harness is the thing that decides whether any other finding is
true, and it has been the least reliable component in the project.

### The screen this project calls the product had never been opened

Eight routes are never opened by a browser test. Most are the public site and the docs. One is
**`/terminal/query/`** — and `CLAUDE.md` says of it: *"Query goes to the watch. Someone with
both hands free does the lookup. **That is the product.**"*

It is also where two invariants are rendered and nowhere else:

- **An agent is never presented as a human** [invariant 5]. The badge that says so had no test
- **An answer with no provenance renders as unverified, not as fact** — *"Call first."* Also
  untested

Both are now driven end to end: the operator types a question, the app publishes it, the watch
answers, and the screen renders it. Removing either claim fails the suite, checked rather than
assumed.

**Still uncovered, named rather than glossed:** `/`, `/directory/`, `/status/`, `/docs/` and
`/terminal/log/`. The first four are the zero-JavaScript public site, which the budget check
already guards structurally; `/terminal/log/` is the accountability log and is the one worth a
later pass.


## 0.S — Milestone 0, story

**The Newcomer, who knows nobody.** Handed a link at a meeting: no callsign, no watch, no
peers. `CLAUDE.md` is emphatic that this is not a lesser state — *"the app must never present
having no watch as incomplete setup"* — so the story is simply whether she gets a working tool.

**She could not reach her own safety net from the home screen.**

Status renders a Distress control in two branches: on station, and a configured watch. The
third branch — **identity but no watch** — rendered only *"Cached directory"*. That branch's
own comment explains itself well: *"This is a COMPLETE state, not an unfinished one — it is
how an operator who patrols alone works, and it is the most common way to use this app. So it
shows what is usable rather than what is missing."*

The reasoning is right and it reached the wrong conclusion about this one control, because
**Distress is usable for her** — with no watch it terminates in her own person, one tap away,
which `contact.ts` calls *"not the third rung of anything. It is the whole safety net."*

So the most common operator, in the most common state, had **no path from the home screen to
the only safety net she has**. She would have had to know the URL.

**This is the finding a story pass exists for.** Every screen involved works and has tests:
`/terminal/distress/` is covered, the contact controls are covered, the Alone branch renders
correctly. Nothing was broken. The *journey* had a hole, and no screen-by-screen pass can see
one.

### The lens's own rule found the harness fault first

Rule 9 says a story may only use controls a person can reach — no seeding past a screen. That
turned out to be impossible: `seedDevice` **stubs the network and writes storage in the same
function**, so a test could not have a device that has never been opened *and* a phone that
does not dial two strangers' relays. Passing no seed still marked the device seeded and wrote
`{}` into both tiers, which is not what a first run looks like.

Split into `blankDevice`. Of 131 browser tests before this pass, **118 seeded a device**, and
most of the thirteen that did not were public-site tests — so the first thing every operator
does had never been walked end to end.

**Nothing found in four of the five steps**, which is worth saying because they are the ones
the project has thought hardest about: she is told what to do first and never called
incomplete, the word *unfinished* appears nowhere, the no-watch state is described as a normal
way to work in those words, and an area can be carried by tapping it.


## 1.U — Milestone 1, unit tests

The display rules decide whether somebody walks across a city at 11pm, and they are numbered
in the code, so each one can be checked on its own. Rules 1, 2, 3, 5, 6 and 7 are all named in
tests — but 0.U established that naming is not proof, so each was mutated.

**Rules 2, 3, 5, 6 and 7 are genuinely proven.** Blank stops meaning unknown, a warming centre
shows hours it should not, a stale volatile field shows its old value, the flag stops coming
first, seeded entries stop being marked — every one fails the suite.

**Two of my own mutations were invalid and I caught it before writing them up.** Renaming
`flagFirst:` and `seeded:` hit the **interface** rather than the implementation — a type-only
edit that changes nothing at runtime. They came back "missed", which would have been two false
findings. A mutation that does not change behaviour proves exactly as much as a test that
cannot fail. Redone against the implementation, both were caught.

### Rule 1 is real, unproven, and could not be tested as written

*"A volatile value is never shown without its age."* Its guard is **unreachable**: every
`last_verified` that produces a null age — absent, blank, `not-a-date`, a month thirteen, a
date in 2099 — also produces `stale` confidence, so **rule 2 returns `call-first` before rule
1 is consulted**. Probed across seven dates and four methods to establish that rather than
assume it.

So the rule is enforced today by rule 2's coincidence rather than by itself, and a test aimed
at the branch could not fail without it. This project deletes tests that pass either way [0.R]
rather than keeping them as decoration, so the rule is asserted **over the output** instead:
across every combination of date and method, if a volatile field renders as a value then its
age is not null.

That test holds the rule up regardless of which line enforces it — verified by deleting *both*
guards, which it catches. A branch test would not have survived somebody reordering the rules,
which is the change most likely to happen here.

**Nothing found across the rest of the milestone**: the overnight patrol marker, the `#`
encoding in a phone number, burn taking the accruing tier, and two regions claiming one record
id are each caught by an existing test.

**Method note.** The build-freshness guard fired during verification — the built artifact had
aged past what it tolerates while this pass ran. That is the verification layer catching
exactly the hazard it exists for, and it is worth recording as working rather than only
recording the things that were not.
