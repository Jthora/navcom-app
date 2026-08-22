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
| **1** One operator alone | Display rules, patrol record, contact, wipe, seeder | **✓** | **✓** | **✓** |
| **2** One watch staffed | Executor, pager, drills, web push, on-call | **✓** | **✓** | **✓** |
| **3** Two who met once | Peers, presence, cards, invites, public presence, buddy | **✓** | **✓** | **✓** |
| **4** Squad with no box | Watch mode, group sealing, board, handover, watch key | **✓** | **✓** | **✓** |
| **5** Written-down properties | PQC, declined, battery, RTL, watch-state v4 | **✓** | **✓** | **✓** |
| **6** Knowledge gets in | Corrections, merge, needs-checking, notes, promotion | **✓** | **✓** | **✓** |
| **7** Standing | Credentials, claims, revocation, the watch gate | **✓** | — | — |
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


## 1.I — Milestone 1, interface tests

**A tap before hydration threw away what the operator had just typed — on four forms,
including the callsign.**

Every terminal screen is prerendered, so it is on the glass and tappable before its JavaScript
arrives. The peers screen already learned exactly what a `<form>` does in that window and
wrote it down: *"a native GET submit: the page reloads and the code the operator just typed is
gone. A plain button does nothing at all until it works, and a tap that does nothing is
recoverable in a way that a tap that clears the field is not."*

It was fixed **there and nowhere else.** Reading the built HTML rather than the source: three
submit buttons on `setup` and one on `assist` render with no `disabled` attribute at all. With
JavaScript off, tapping `setup` navigated and came back with the callsign field **empty** —
the first thing every operator does, silently undone.

**The privacy half is better than it looked, and worth stating precisely.** The fields carry no
`name` attribute, so nothing was serialised into the query string: the URL became
`/terminal/assist/?` with nothing after it. Free text about somebody's situation did **not**
reach the URL bar or history. The defect is lost input, not a leak — and I checked rather than
assuming the worse version.

Fixed with `disabled` bound to the required field, matching what `query`, `resupply` and
`sign-on` already render. That choice does a second thing a plain button would not: with the
default button disabled, **implicit submission is blocked too**, so Enter on a phone keyboard
does not submit either.

Now asserted as a property rather than four examples — *nothing that submits a form is enabled
before anything is bound to it* — so a fifth form added later is covered without anybody
remembering this pass.

**One existing test had encoded the old behaviour** and was updated rather than deleted: it
asserted the Generate keypair button was enabled on arrival. `makeIdentity` refuses an empty
callsign with an error anyway, so disabling it removes a tap whose only possible outcome was
that error. Same shape as the phone-number contract corrected in 1.R.


## 1.S — Milestone 1, story

**The Protest Medic's night**, with no watch: sign on, work, come home, and wipe.

**She could not start a patrol from the screen she lands on.** The Alone layer promises her
*"your own patrol record"*, and a record begins by signing on — but Status offered her only
*"Cached directory"*.

Everything else was already built for her, which is what makes this one sharp:

- `signOn` sets and persists the session **outside** the watch branch, deliberately. Its own
  docstring: *"So the session is set either way"*
- `standDown` records the patrol whether or not a watch confirmed it, and says why: *"its
  absence must not mean the patrol never happened"*
- The sign-on screen is **written for her**, and says so on arrival: *"Nothing is watching. You
  can still sign on — the signal will keep trying."*

Every part of the capability existed. Only the way in was missing. That is the same branch of
the same screen 0.S found the Distress gap in — so this pass and the last have now found the
**two most important things an operator alone can do**, both unreachable from her home screen,
both fully implemented behind it.

Once she could get there, the rest of the night worked: the patrol lands in her own record with
the note she wrote, a held wipe destroys it, and her identity survives so she can sign on again
straight afterwards. **Invariant 7, walked rather than asserted.**

### Four things the story got wrong before the product did

Worth recording, because a story pass fails noisily and most of it is the test's fault:

- The stand-down is **two steps on purpose** — the second is *"the only place the operator gets
  to say anything in their own words"* — and my first attempt stopped after the first
- The hold-to-wipe control **relabels itself** to *"Keep holding…"*, so a name-based locator
  stops matching exactly when the release is needed
- It also **completes itself** after 800ms and navigates away, so there is no release to
  dispatch at all — waiting for the navigation *is* waiting for the wipe
- And I mistook a working flow for a broken one twice before reading what the screen does

Each of those is the product being deliberate and the test being naive. The rule that a story
may only use controls a person can reach is what surfaced them — a test that reached past the
UI would have passed while the operator could not get there.


## 2.U — Milestone 2, unit tests

The escalation spec lists nine numbered failure modes and says they are *"not optional — these
are the point of the spec."* Only three are named in a test, so each was mutated instead.

**Eight of the nine are genuinely proven.** Modes 1, 2, 3, 5 and 7 in the ladder; 8 and 9 from
2.R. Mode 4 — the one the spec says is *"the client's job, and the only part of the ladder the
node cannot report on"* — is proven in all three of its halves: the device concludes nobody is
coming, it says so **once**, and saying it **does not stop the retrying**. That last one
matters most and is the easiest to break by accident.

**Mode 6 is the finding, and it is a different shape from the rest.**

*"Agent degraded → escalation MUST still fire; it is the one path that cannot depend on agent
health."* `CLAUDE.md` calls the separation **non-negotiable**. The core state machine's half is
tested — `startLadder` takes one argument and a Ladder has no agent-shaped field — and that is
the right test for pure logic.

But the separation that matters is the **process**, and the executor's claim about itself —
*"Nothing here calls the agent, waits on it, or reads its health. There is no seam"* — was
enforced by nothing at all.

**A dependency that does not exist cannot be caught by a behavioural test**, because there is
no behaviour to observe until somebody adds one. So it is now asserted structurally: nothing
under `src/escalation/` may import from `daemon/`, import anything agent-shaped, or read
`agent_health` by any name. Verified by adding the plausible import somebody would actually
write — `import type { WatchtowerDaemon } from "../daemon/watchtower.js"` — which fails it.

The suite also asserts it **found files to check**, because a structural test that silently
matches an empty set is the worst kind of green.

**Method note.** Two of the mutations in this pass needed core rebuilt between runs, since
watchtower resolves `@navcom/core` to `dist/`. That is the third time that has mattered in this
project, and the mutation harness now rebuilds between attempts rather than trusting the last
build.


## 2.I — Milestone 2, interface tests

**Invariant 2's second half had never been rendered from a real event.**

*"`Distress` terminates in a human, or tells the operator it couldn't."* The first half is
proven exhaustively — nine numbered failure modes, all confirmed in 2.U. The **telling**
happens on one screen, and although several browser tests open it, every one of them stops at
the hold control, the missing-watch message, or the contact link. **Nothing ever put a response
on it.**

So the sentences an operator reads while somebody decides whether they are coming — *"Raven
has it"*, *"an agent answered. Still looking for a human"* — existed only as a `switch` nobody
had executed with real input.

Now driven end to end using 0.I's answering harness: the operator holds the control, the app
publishes a `20911`, the watch replies, and the screen renders it. Three claims asserted, and
the middle one is the reason this pass matters:

- A human acknowledgement is shown **by name**, with what they said
- **An agent answering does not read as help arriving** [invariant 5]. It renders as *still
  looking for a human*, and the acknowledged block stays absent. Verified by making the agent
  case render as *"has it"* — which fails
- **Nothing on the screen closes a Distress.** Only the operator ends one, and no button
  offers to

### The harness fought back, and the fix is worth keeping

The hold control is `button.raise`, it **relabels and is replaced** by the live view once the
hold completes, and dispatching a release afterwards hangs on a locator that no longer exists —
long enough to exhaust the test budget, at which point the page closes and the error reads
*"target page has been closed"*, which looks like a crash and is not one.

Waiting on **the published event** instead of a fixed timeout fixed it. That is the honest
signal: a timeout is a guess that goes stale on a slower machine, and this project's device
floor is a slow machine.

Same shape as 1.S's hold-to-wipe. Two of the three most safety-critical controls in this app
are press-and-hold, and both are awkward to drive for the same reason — they are designed so a
pocket cannot trigger them.


## 2.S — Milestone 2, story

**The Sleeper's 3am.** This project's own name for the on-call person who sleeps through
things — the reason drills are randomised, because *"the Sleeper learns a fixed schedule
faster than anybody."* Her whole job is to be woken and say *"I have this"*, and
`signals.spec.md` budgets that at **10 seconds: one tap, and somebody is waiting on it.**

**The notification told her to do something the app cannot do.** It read *"An operator is
waiting for a human. Open the terminal and acknowledge"* — and **there is no acknowledge
control in the terminal.** She taps, arrives at Status, and there is nothing there. The ladder
keeps paging; the operator is told nobody has it.

Every other link in that chain is built. `distress-ack` is a defined signal type with its own
budget. The executor accepts one and refuses it from outside the roster. 2.X made the config
able to name whose key may send it. Two test files construct one by hand. **No client sends
one.**

The copy now names paths that exist: a squad member holding the watch answers from the board,
where the button says *"Tell them you are awake"* — and a node's on-call operator acknowledges
in the console, which is exactly what the SMS page already tells them. Somebody woken at 3am
has seconds, and the one thing the text must not do is send her looking for a button that is
not there.

**The missing control is deferred rather than half-built**, and recorded as build item 2.5. The
hard part is not the button: an ack must name a `distress_id` the paged person's device
**cannot know** — they do not hold the watch key, so they cannot read the `20911`, and the push
deliberately carries no payload from the wire, for a stated reason (*"a notification that
quoted attacker-controlled text on a locked screen would be a way to put words in front of
somebody at their least critical moment"*). That needs a spec decision before it needs code,
and inventing one inside an audit pass would be exactly the *"turn every gap into work"*
failure the brief warns about.

**What does work is now walked**: holding the watch, she sees Distress in its own section above
everything [4.R], answers in one tap, and is never offered a way to decline it [invariant 2].


## 3.U — Milestone 3, unit tests

**Unlinkability is genuinely proven**, and it is worth saying so plainly because it is the
hardest property in the project and the one with a named adversary. Four attacks, all caught:
signing the wrapper with the operator's real key, reusing one ephemeral key across every peer
in a beat, publishing the inner event unwrapped, and adding a `from` tag carrying the sender's
pubkey. The presence tests earn their opening claim.

**Two of my mutations were invalid again** — one added an unused variable (a no-op), the other
referenced a variable that only existed if the first had been applied, so it failed to compile
and reported as "caught" for the wrong reason. **A false *caught* is as bad as a false
*missed***: it certifies a property nothing actually tested. Redone as one valid edit, the
property held.

That is the third time in this grid. Mutation testing has its own version of the failure it
exists to detect, and the only defence is reading what the mutated file actually does.

### Four privacy gates with no proof

**`announceListed` published whether or not the operator had asked to be listed.** `listed()`
is the switch that makes somebody findable, and it is the entire consent model for this
milestone — an operator who never flipped it would have announced *"somebody is out in St.
Louis"* to a public relay. **The Doxxer is a named adversary here**, and this is precisely the
door he uses.

**`publishCard` published without a callsign**, producing a public address nobody can put a
name to.

**`setBuddy` could mark every peer**, and **`buddies()` could return everyone.** Presence is
explicit about why that matters: *"telling every peer you are watching them when you are
watching one would be a lie told to several people at once, which is a worse failure than the
one it replaced."* The guard against that lie existed; nothing proved it.

**No product bug in any of the four.** As in 0.U, the finding is the absence of proof — and
these are gates where a silent regression is not a wrong pixel but an operator announced to a
relay they never chose. Eleven tests added; all four mutations are caught now, re-run rather
than assumed.

**One detail worth keeping.** `MyCard` has no `callsign` field at all — the name comes from the
identity, *"rather than a second public name that could drift from the one peers already
know."* My first fixtures invented one, and the type refused them. The type was right.


## 3.I — Milestone 3, interface tests

**The peer block on Status had never been rendered from a real event.** Four claims live there
and nowhere else, and each is a rule this project argues for in its own comments:

- **Silence is named, not hidden.** A peer nobody has heard from is listed by name, because
  *"leaving them off would read as 'not out', which is a claim nobody made"* [invariant 3]
- ***"Nothing heard is not the same as home."*** Said out loud, next to the names
- **Overdue is a nudge**, and nothing escalates from it — *"no page, no ladder, no contact.
  People are late for ordinary reasons far more often than dangerous ones"*
- **Who is watching you is only what somebody said**, never inferred from you watching them:
  *"two people can each assume the other is keeping an eye out, and assuming symmetry nobody
  agreed to is exactly how somebody ends up watched by nobody"*

All five now driven from sealed presence events a peer actually sent. The two that matter most
are verified in both directions: hiding quiet peers fails the suite, and inferring *watching*
from a peer merely being out fails it too.

That second mutation is worth naming, because it is the plausible one. *"They are out, so
presumably they are keeping an eye out"* is the exact inference a reasonable developer would
make while tidying this code, and it produces a screen that tells two people they are watched
when nobody is.

**Nothing found in the buddy controls**, which are already driven end to end — *Watch for
them* and *Stop watching*, both clicked in an existing browser test. 3.U proved the logic; the
interface for it was already covered, which is the answer this lens hopes for.


## 3.S — Milestone 3, story

**Two people at a meeting**, which is the only way pairing ever happens.

**No test had ever had one device publish something another received.** Second browser
contexts existed — a fresh phone to restore a backup onto, a credential pasted from one screen
into the same screen's other field — but every one of them was one device, or two devices
exchanging a blob by hand. The Paired layer is *"two phones, no watch, no server, no leader"*,
and the two-phone part had never run.

The harness now carries what one phone published to the other, explicitly rather than in the
background, so a test reads like the story: *she sends it, his phone receives it.* It returns
how many events crossed, so an exchange that moved nothing cannot pass quietly.

The story runs: Raven reads her code aloud, Wren types it in, they pair both ways, Raven signs
on, and Wren's screen shows her out in north riverfront — with nothing between them but a
relay carrying sealed bytes.

### My own test was vacuous, and the discipline caught it

The first version asserted only that *"Raven"* appeared on Wren's screen. **It passed with the
relay severed.**

The cause is 3.I's finding working against me: a paired peer nobody has heard from is listed
by name anyway, with *"nothing heard"*. That is right for the product — silence is named, not
hidden — and it meant my assertion could not fail. Rule 7 of this grid says a test that cannot
fail is worse than no test, because it is a claim of coverage.

Sharpened to assert what **only a decrypted heartbeat can produce**: out, with her area, and no
*"nothing heard"*. It now fails when the relay is cut.

**And the ordering was wrong for a real reason.** Delivery goes into subscriptions that are
open *right now*, so Wren has to be looking at Status when it arrives — a navigation afterwards
tears the subscription down and takes the heartbeat with it. That is not a harness quirk: it is
true of a real phone, where a heartbeat that arrives while the app is closed is simply gone.
**Nothing stores presence, by design**, and the test had to be written the way the product
actually behaves rather than the way it was convenient to drive.


## 4.U — Milestone 4, unit tests

**The mechanism behind the one property a squad needs had no test.** `watch-key.ts` states it
plainly: removing somebody from the holder list *"stops them reading new signals"*. That only
holds if **every message has its own content key** — reuse one, and anybody who ever learned it
reads everything sent afterwards, membership list or not.

The content key could be replaced with the sender's own secret and nothing noticed. Proved now
by **mixing two envelopes**: one message's wrapped keys must not open another message's
content. Comparing ciphertexts would have proved nothing, since NIP-44 uses a fresh nonce
either way — the test had to attack the property rather than observe a side effect of it. The
squad's version of the same property is asserted alongside: somebody dropped from the holders
can still read what was sent before and cannot read what comes after.

**Three other membership attacks are already proven** — labelling wraps with who they are for,
leaving the payload unencrypted, and sealing to nobody.

### Four unproven guards on the watch's identity

- **`createWatch` could overwrite a live watch.** Its own docstring says why that must never
  happen — *"replacing a live watch's identity would silently strand every operator configured
  against the old address"* — and 4.X added the same guard to `joinWatch` **and tested that
  one**, while the original here was never covered. A guard copied without its test
- **Founding could stop recording that it founded**, which is the genesis route for the watch
  gate. Without it a new squad is bricked: nobody has standing, so nobody can take the watch,
  so the watch is unusable
- **Leaving could keep the founded flag**, so an operator who gave up their own watch and
  joined somebody else's would walk through the gate as founder of a watch that is not theirs
- **A damaged key could throw instead of reading as no watch**, refusing to start the terminal

**No product bug in any of them.** The code was right; the proof was missing — and three of the
four are cases where the failure is a squad that cannot operate rather than a screen that looks
wrong.


## 4.I — Milestone 4, interface tests

**Answering had never been driven, and it is the whole job of a board.**

Taking the watch, the qualification gate, giving it up, and the Distress section are all
covered by existing tests — the surface looked well tested. What none of them did was **answer
anybody**: somebody asked, and a human on the other end says something back. That is what a
squad holds a board *for*.

Now driven end to end: a query arrives sealed to the holder, the operator types a reply, and
the test asserts something **actually left the phone** before checking the question came off
the board. Asserting only that it disappeared would have passed against 4.E's original bug,
where an answer that reached no relay cleared the item anyway.

Two rules asserted alongside, because they are what make an answer trustworthy:

- **A `Distress` never leaves the board, even after answering it.** Acknowledging is telling
  somebody you are awake, not that it is over, and this screen cannot know that has happened
  [invariant 2]. Verified by letting an answer clear it, which fails
- ***"Nobody can come"* is offered for an Assist**, where it is a real and honest reply — an
  operator who asked for help, got an acknowledgement and waited is worse off than one told
  plainly. 2.S already proved it is refused for a `Distress`; this is the other half, and a
  rule stated only as a prohibition is half-tested

**Nothing found in the rest of the surface.** The gate, the handover confirmation and the
address are already driven, and that is the honest answer for a milestone whose interface has
had three passes over it in the first grid.


## 4.S — Milestone 4, story

**A handover left the watch reading Dark while somebody was holding it.**

A squad shares one watch key, and watch state is a **replaceable** event — so any holder can
overwrite it. Walk the ordinary handover and the hole appears immediately: Wren takes the
watch, Raven takes it over mid-shift, Wren stands down, **and Wren's Dark replaces Raven's
`station`.**

An operator signing on in that window is told nobody is watching when somebody is. It is
invariant 4's mirror image, and while it errs toward the safer belief, it is still the watch
lying about itself — and it silently breaks the thing the squad is providing. Raven's heartbeat
corrects it **up to two minutes later**.

Each device was behaving correctly on its own. Wren really did stand down; Raven really is on
station. Nothing is wrong with either half, which is why nothing found this until two phones
were driven at once.

### The fix needed something the board did not have

*Only whoever is currently advertised may publish Dark.* Standing down is always honoured
locally — what is conditional is **speaking for the watch**, and somebody who has already
handed over does not.

The first attempt at that guard did nothing, and the reason is its own finding: **a holder's
device never watched its own watch.** `watch.svelte` follows the *configured* Watchtower, and a
squad member holds a key rather than a config — so nothing on that phone knew what the world
was being told about it. The board now reads its own watch state from the relays it is already
connected to, which costs one extra filter rather than a connection.

**The other half is asserted too**, because a fix here could easily go too far: standing down
with nobody taking over still publishes Dark. Going quiet would leave a stale claim that a
human is here, which is the entire reason `standDown` exists.

**And one thing confirmed rather than changed:** the incoming holder starts from an empty
board. That is deliberate and stated — *"nobody hands a board over, because nobody holds
anybody else's picture… the way it fills is that operators say they are out again"* — so the
test pins it rather than treating an empty board as a bug.


## 5.U — Milestone 5, unit tests

**The hybrid was proven to round-trip and not proven to be hybrid.**

Either half could be removed — the ML-KEM shared secret or the classical conversation key —
and every test still passed, because encrypt-then-decrypt works perfectly well with one of
them.

**The dangerous direction is losing the post-quantum half.** The envelope still carries its
`q:` prefix, `coverOf` still reports covered, and the screen still tells the operator they are
covered against somebody storing tonight's traffic for fifteen years. 5.R found that notice
carefully written and honest — and it would have gone on being displayed over classical-only
crypto with nothing to contradict it.

Each half is now asserted to **contribute to the derived key**, which is the only thing that
makes it a hybrid at all:

- The post-quantum half: `encapsulate` is randomised, so two seals to one recipient share every
  classical input and differ only in the ML-KEM secret. Identical keys would mean that secret
  never reaches the derivation
- The classical half: the same KEM ciphertext opened against a different claimed sender must
  give a different key. If the classical exchange were not in the mix, it would be the same key
  for anybody

### The order was untestable because it was unwritten

The third mutation — swapping the two halves — was missed, and it took a moment to see why it
*should* be. Swapped consistently on both sides, it round-trips and is equally secure. There
was nothing to be wrong against, because **the spec did not describe the construction at all.**

Two clients that disagree about the mix derive different keys and cannot read each other,
**while both round-trip perfectly on their own** — the kind of fault that ships. And a second
implementation is not hypothetical: M10's CyberDeck is one.

So `signals.spec.md` now states the derivation, marks the ordering normative *because* it is
arbitrary, and the test pins the code against the spec rather than against itself.

**I got the `info` string wrong writing it up**, and the test caught it — I had written what I
assumed rather than what the code does. The spec was corrected to the code, not the other way
round. A spec written from memory is how two implementations end up disagreeing in the first
place.


## 5.I — Milestone 5, interface tests

Two claims about phones that are only true on **some** phones, and neither had ever been
rendered.

**Right-to-left was enforced by scanning the built CSS**, which is the right check and is not
the same as rendering. Nothing in this app sets `dir` at all — the message catalogue is
deferred [5.9] — so a static scan was the only verification possible. A browser can force the
direction, which turns *"the stylesheet contains no `border-left`"* into *"the app holds
together mirrored"*: three screens now render in RTL and none of them scrolls sideways, which
is a rule this project already holds itself to.

**The battery warning had a rule with no test at all.** It is false while charging, however
low, and the reason is written down: *"a phone on a charger at 4% is a phone that is fine in
ten minutes, and warning about it is the kind of noise that trains people to dismiss
warnings."* No test passed `charging: true`, so **the guard could have been deleted in
silence** — and the thing it protects is whether the warning is worth reading at all. Covered
now, and verified by removing the guard, which fails.

The two negatives were already right and are now pinned: nothing at 82%, and nothing at all on
a phone with no Battery Status API, which is every iPhone. *Absent* is the correct behaviour —
nothing here estimates.

**One thing the tests taught me about the product**, which is the good kind of failure: the
warning is scoped to being **on station**, and my first attempt asserted it on a kitchen table.
A phone at 9% doing nothing is nobody's problem. The warning exists because *"when it dies you
stop sending, and the people watching for you will see nothing rather than something wrong."*

### When a mutation does not fire, suspect the mutation

Two attempts to break the RTL test did nothing — one styled an element that does not render
without peers, the other was overridden by a later `margin: 0 auto`. Rather than guess a third
time I **tested the assertion's own sensitivity**: with the page clean the overflow is 0, and
with a deliberately 900px-wide element it is 515. The check works; my mutations did not.

That is a better technique than another guess, and worth keeping: when a mutation comes back
missed, the first question is whether it changed anything at all.


## 5.S — Milestone 5, story

**Asking for help and being told nobody is coming.**

The Quartermaster needs a second pair of hands. What this milestone insists on is that a watch
with nobody to send **says so in as many words**, because *"an operator who asked for help, got
an acknowledgement and waited is worse off than one who was told plainly."* Both halves — the
board's control and the operator's screen — were covered separately [4.I, 5.E]. **The sentence
travelling from one phone to the other was not.**

Now walked: the operator asks, the relay carries it to whoever is holding the board, Raven has
nobody to send and uses the control built for exactly that, and the answer comes back as
*"Nobody is coming"* — **with no acknowledgement anywhere on the screen**, which is the part
that matters. Verified by rendering a decline as an ordinary acknowledgement, which fails.

The other half is asserted too: the operator is told **before they ask** that this can happen.
Somebody deciding whether to ask should know the honest answer is available.

### The harness could not model a squad

Signals are sealed to the **holders** — one operator key per phone — rather than to the watch
key, which is what lets a member be removed without re-provisioning everybody. `seedDevice`
could configure a Watchtower's pubkey and relays and **not its holders**, so every configured
operator in every test was talking to a *box*.

The assist reached the relay and the board could not read it, which is exactly right and looked
like a bug for a few minutes. The harness models a squad now, and the distinction is written
down where the next person will meet it.

**Method note.** I announced this pass as "5.X" in the previous summary. This grid has no X
lens — it is U, I and S. The pass done here is 5.S, and the grid is unchanged.


## 6.U — Milestone 6, unit tests

**This is the honest empty pass, and it is worth as much as the others.**

Twelve mutations across every rule that decides whether somebody walks across a city, and
**all twelve were caught**:

- A website scrape ranking as high as standing at a door; a phone call ranking as high; an
  unknown method treated as trustworthy
- A flagged record no longer suspect; age no longer making anything stale; an out-of-season
  check counting as current
- **A correction's flag making the base record suspect** — the one with a stated attack behind
  it: *"one hostile operator could make any record unusable for everybody, which is deletion
  wearing a different hat"*
- The ranking table flattened so nothing outranks anything
- Promotion keeping an author's older correction, or collapsing two authors into one
- `needsChecking` no longer asking about blanks, or returning everything rather than a few

The rules that matter most in this project are the best-proven code in it, which is the right
place for the effort to have gone.

### One thing found, and it was mine

Rule 8 says prefer a test against something the product can build, and **where a fixture and
the real builder disagree, the fixture is the bug.** The merge is exercised mostly with
hand-written objects — fine, and fast — and my own fixture from 6.X carried a `reports: []`
key that `readCorrection` never produces, hidden by an `as never` cast.

Harmless today. It is also exactly how a merge ends up proven against a shape no relay can
deliver, which is the failure that let 2.X's ack path pass every test while being unreachable
in production.

Removed, and pinned: a read correction now has to carry **exactly** the keys the merge
consumes and no others, verified by adding a key and watching it fail. A cast in a fixture is
a place where the wire and the test can quietly disagree, and this one now cannot.


## 6.I — Milestone 6, interface tests

In **6.E** I seeded the unsent state directly, because driving the correction form by guessing
selectors kept timing out. That is a confession, not a method: the form had never once been
operated end to end by anything but a person. This pass read the screen and drove it.

Six tests in [`web/e2e/correcting.spec.ts`](../web/e2e/correcting.spec.ts), covering the walk a
volunteer actually takes — open a region, open a group, open a record, report a problem, pick
the field, type the value, send — plus backing out, flagging closed, and a private note.

### The two selectors that failed were the finding

Both failures were mine guessing at the DOM, and both times the DOM was right:

- I looked for a button named `hours`. The field buttons render through `FIELD_LABELS`, so the
  control on screen says **"Open"**. The page never shows a raw field name to anybody — the
  same rule as *"the page never shows a snake_case token"*, held one layer further out than
  I expected it to be
- I asserted the operator's callsign appeared in `[data-corrected]`. It does not, and should
  not: that block says *the record carries corrections at all*. The name lives on the field,
  in `[data-said-by]` — **provenance by name, attached to the specific claim**, which is the
  invariant working rather than failing

Both are the shape from the first grid seen from the other side. There the finding was a rule
argued in prose and enforced by nothing; here the rule was enforced *better* than my test
assumed, and the test was the thing out of date.

### What the tests hold down

`hours` is volatile, so the corrected value has to come back through the display rules rather
than being pasted onto the record. The assertion is that after sending, the field shows the
new value **and** the operator's callsign **and** the method — `Wren, in person` — because a
correction with no name on it is the merge quietly becoming an edit.

Verified by deleting the `[data-said-by]` element and rebuilding: the run fails on exactly one
test, the attribution one, and the other five still pass. A correction that silently merges is
now a build failure.

**Counts:** 416 core, 367 web, 207 watchtower, 203 browser (was 197).


## 6.S — Milestone 6, the story

**The trip nobody had to make twice.** Wren walks somebody to a shelter and it is locked. Ash,
across the city, is deciding where to walk somebody right now. Does what Wren learned at that
door reach Ash's phone before Ash sets out?

[`web/e2e/story-doorway.spec.ts`](../web/e2e/story-doorway.spec.ts) — two real pages, and the
only thing that crosses between them is an event the app itself published. Nothing is written
into Ash's storage, and every step on both devices is a control a person can reach.

Three tests: the report arrives **and names Wren**; the listing underneath survives intact;
and it is still there after the phone has been put away and taken out again somewhere with no
signal.

### Nothing found, and here is why that is a result

All three passed on the first run, which is not evidence of anything on its own. Two mutations,
each aimed at a different half of the claim:

- **Received corrections held in memory but never persisted.** Only the stairwell test failed;
  the other two passed. That is the right shape — the correction still *arrives*, it just does
  not *survive*, and exactly one test is about survival
- **The report anonymised** — `An operator reported this` instead of the callsign. Two tests
  failed, the two that assert a name, and the one about the listing surviving passed

Each mutation sank precisely the tests that claim what it broke, and no others. That is what
separates three passing tests from three tests that pass because they assert nothing.

### Why the stairwell test exists

The trip is the moment the knowledge has to be there, and the trip is where the signal is
worst — a basement, a stairwell, a shelter with block walls. A correction that only exists
while a relay is reachable is absent exactly when somebody is standing in front of the door.
That was the case worth spending a test on, and it was previously covered by nothing: 6.E
tested the *unsent* queue, which is the other direction entirely.

**Counts:** 416 core, 367 web, 207 watchtower, 206 browser.


## 7.U — Milestone 7, unit tests

Standing is the one thing here an operator builds over years, and `can-take-watch` is the gate
on holding a board. Twelve mutations against `endorsement.ts` and the terminal's `standing.ts`.
**Nine caught, three survived — and all three survivors were on the reading side.**

- **An unsigned revocation strips standing.** The severe one. A credential is handed over in
  the open, so its endorser's key and its id are both known to anybody who sees it, and wearing
  a key costs nothing — you write the pubkey you want. The signature is the only thing a
  stranger cannot produce, and nothing tested that it was checked
- **A scope read off an unlisted string.** `SCOPES` is closed because *"an endorser explaining
  why somebody is credible is how an operator's history leaks."* The builder refuses free text;
  the reader accepted it, and a forged credential never goes near a builder
- **An unsigned credential can be claimed.** Bounded — the pair reads as null later anyway —
  but the guard exists so it fails while somebody is being *handed* the thing and can still ask
  about it, rather than silently when they present it

Three tests added under *what arrives from somebody who did not use this code*, and all three
now kill their mutation. The shape is the one the date checks in this same file already
learned: **enforced on the way out, unchecked on the way in.**

### The trap that made two of those tests pass while proving nothing

Both signature tests failed on first run against *correct* code, and the reason is worth more
than the tests.

`finalizeEvent` stamps a `Symbol(verified)` on the object it returns, and **object spread
copies symbol keys.** So `{ ...signed, content: 'tampered' }` is an event with somebody else's
content that `verifyEvent` returns **true** for — it never looks at the signature again.

Not a hole in the product: everything hostile arrives over a relay as text, JSON has no
symbols, and nothing in `src/` spreads a signed event back into a verifier (checked). It is a
hole in *tests*, which is worse in one specific way — **it makes a test of a missing check
pass.** Every forged fixture now goes through `overRelay`, and the reason is written at the
helper rather than left for the next person to rediscover by watching a good test go green.

### And the check that could not report anything

`npm run verify` for core runs `tsc --noEmit`, CI runs verify, and **it has been failing on
main** — duplicate `import` statements across three test files, tolerated by vitest's transform
and rejected by TypeScript. One of them I introduced in **5.U**, in this grid, and did not see
because I ran `npm test` rather than the project's own verify.

A check that is already red cannot report a new failure, and it proved that immediately: a dead
helper field I wrote ten minutes earlier referenced a name not in scope, typechecked never, and
nothing said so. Deduped; `npm run verify` at the repository root is green.

**Counts:** 419 core (was 416), 367 web, 207 watchtower, 206 browser.
