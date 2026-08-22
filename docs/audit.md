# The 27 passes

Nine built milestones, three lenses each. Started 2026-08-21.

**Why the count is specified.** Left to its own judgement an agent does one broad sweep,
finds the cross-cutting class of problem, declares the class fixed and stops — which is
genuinely useful and genuinely not the same thing. The findings that matter most are local to
one milestone's logic and only surface when somebody sits with that milestone specifically.
The ceremony is the point.

## The lenses

| | What this pass is looking for |
|---|---|
| **R — Robustness** | Hostile, huge or malformed input. Resource exhaustion. Two tabs. A wrong clock. A relay serving garbage. A peer that is not a peer. What happens under conditions nobody designed for |
| **E — Error handling and reporting** | Does a failure surface at all? Is the message true? Does it point at something the operator can do? Does anything fail in a way that looks like success? Which catches hide a real problem rather than an expected one? |
| **X — Edge cases** | Empty, one, and too many. Boundary values. Unicode and long strings. Duplicates and ordering. First run and last item. Timezones, DST, and the turn of a year |

## The grid

Each cell is a pass. `—` not started, `✓` done, and a note when it found something.

| Milestone | Surface | R | E | X |
|---|---|---|---|---|
| **0** Prove what is built | Browser harness, service worker, offline, seeding, the verification layer itself | **✓** | **✓** | **✓** |
| **1** One operator alone | Display rules, patrol record, contact, wipe, seeder | **✓** | **✓** | **✓** |
| **2** One watch staffed | Executor, pager, drills, web push, on-call | **✓** | **✓** | **✓** |
| **3** Two who met once | Peers, presence, cards, invites, public presence, buddy | **✓** | **✓** | **✓** |
| **4** Squad with no box | Watch mode, group sealing, board, handover, watch key | **✓** | **✓** | **✓** |
| **5** Written-down properties | PQC, declined, battery, RTL, watch-state v4 | **✓** | **✓** | **✓** |
| **6** Knowledge gets in | Corrections, merge, needs-checking, notes, promotion | **✓** | **✓** | **✓** |
| **7** Standing | Credentials, claims, revocation, the watch gate | **✓** | **✓** | **✓** |
| **9** No single point of failure | Backup and restore, capability sentence, funding | **✓** | **✓** | **✓** |

## Rules for a pass

1. **Read the surface first.** Not the tests — the code, and what it assumes
2. **Probe rather than reason.** Twice today a bug survived because both halves were tested
   and the join was not. A pass that only reads will miss the same thing again
3. **A pass that finds nothing says so.** Manufacturing a finding to look thorough is worse
   than an honest empty pass, and it buries the real ones
4. **Fix what is found, in that pass.** A list of known defects is a worse artifact than a
   smaller list of fixed ones
5. **Test counts move the right way.** A total that drops means something was destroyed —
   which has already happened once, to thirteen tests covering invariant 7

## Banked before the grid existed

A cross-cutting robustness sweep ran first and found three things, all fixed:

- **Every wire boundary was uncapped** except two fields that happened to have `maxlength` on
  a textarea. A crafted correction could carry a megabyte onto every device caching that area
- **A full phone stopped saving silently**, so an operator lost their patrol record and found
  out by looking for it later
- The quota detection I wrote to fix that **matched the error message rather than its name**,
  and misclassified anything else that mentioned quota

Those are cross-cutting and are not credited to any cell below. The grid starts from zero.


---

## 0.R — Milestone 0, robustness

**Found: `cache.addAll(SHELL)` was all-or-nothing.** It rejects if any single request fails
and adds nothing at all, so one 404 after a partial deploy failed the whole install,
`skipWaiting` never ran, and **the terminal had no offline capability whatsoever** — while
looking entirely fine, because it fails on a screen that is online. The operator finds out in
a car park.

This is Milestone 0's own foundation: every offline guarantee elsewhere rests on that install
succeeding. Fixed by caching each entry independently and recording what failed.

**A test was written for it and then deleted.** It aborted an asset and asserted the shell
still worked — and passed identically against the broken version, because Playwright's
request interception does not reach a service worker's own fetches. A test that passes either
way is not evidence, and keeping it would have made the next person confident about something
unverified. `Cache.addAll` atomicity is specified behaviour rather than something this
harness can observe, and the spec file says so.

## 0.E — Milestone 0, error handling and reporting

**Found: three screens promised *"works with no signal at all"* and nothing ever checked.**
The mechanism to check had been there the whole time — the Cache API is readable from the
page — and was simply never consulted. The same shape as a claim with nothing behind it,
except the thing behind it existed.

Most operationally: the directory picker says *"opening it is what saves it"*, which is true
and says nothing about whether it worked. An operator who believes they are carrying
St. Louis and is not finds out with no signal.

Now checked rather than promised. The picker marks areas actually on the phone; Status
reports a shell that did not finish saving. **Absence of an answer is not an answer** — a
browser with no Cache API reports `unknown` rather than `no`, because saying "you are not
carrying this" when we cannot tell would invent a fact.

**Not a product bug, worth recording anyway:** a whole spec file failed at once mid-pass
because the preview server was serving a half-written build while `npm run build` was still
running. Re-running serially passed. Chaining a build into a test run races the harness.

## 0.X — Milestone 0, edge cases

Two findings, both about a boundary nobody crosses on purpose.

**A deploy threw away every area an operator was carrying.** The cache name carries the build
version, so activating a new one deleted the old cache whole — and directory areas live there
too, added on visit rather than shipped in the shell. Carry St. Louis, open the app once on
wifi after a deploy, go out with no signal, find nothing. *"Opening it is what saves it"*,
quietly revoked by an unrelated event.

Areas are now carried forward before the old cache is deleted. **This one has real evidence**:
the test fails without the migration and passes with it, which was checked in both directions
after the `addAll` test turned out to prove nothing.

**Corrupt storage was indistinguishable from a first run.** Reading it as empty is right — a
terminal that will not start because of a bad key is worse than one that asks to be set up
again — but presenting it as a *fresh phone* is a different and worse lie, and the next write
destroyed the only copy. A damaged blob is JSON in localStorage and can often be read by
hand, so it is now kept under a salvage key and Status says not to clear the site's data.

## 1.R — Milestone 1, robustness

Four findings, and two leads that honestly went nowhere.

**A future date was the freshest thing possible.** `ageInDays` subtracted and returned a
negative, so `last_verified: 2099-01-01` rendered *fresh, high confidence* — and stayed that
way forever. On its own that is a display bug. Against Milestone 6 it is an attack: corrections
tie-break on `last_verified`, so anybody could date one 2099 and own a field permanently. One
day of tolerance is kept for timezones; beyond that a date in the future is unparseable and
reads *call first*, which is what invariant 9 asks for.

**`area` was uncapped on every signal.** The earlier cross-cutting sweep capped `text` and
walked straight past the field beside it — a `Distress` carries both, and only one was
checked. It lands on whoever is holding the board.

**A `#` in a phone number destroyed the distress message.** `smsLink` interpolated the number
into a URI, so an extension or a DTMF digit — `555-1234#22`, an ordinary address-book entry —
made everything after the `#` a *fragment*: the number truncated and the entire help text was
dropped. The operator taps the one-tap safety net and gets a blank message to a wrong number.
For an operator with no on-call this is the whole safety net, and it failed silently.

**The salvage copy survived panic wipe [invariant 7].** This one was created by 0.X. Keeping a
corrupt blob under `.damaged` so it can be recovered by hand is right; leaving that copy
outside the destroy path is not. A phone whose wipeable storage had ever been corrupted kept a
readable copy of it through a wipe — the operator holds the button down, watches it clear, and
it is still there. Both destroy paths now take their keys from one list, so a new key cannot be
added and missed. Checked in both directions: the tests fail against the old wipe.

**Two leads that went nowhere, recorded because rule 3 says so:**

- *Unbounded patrol growth.* `recordPatrol` appends forever with no cap, which looks like the
  classic exhaustion bug. Measured instead of assumed: one patrol is 125 bytes, so a thousand
  is 122 kB and five thousand is 610 kB against a 5–10 MB quota. A decade of daily patrols
  fits. No cap is warranted, and adding one would have thrown away the operator's record to
  fix a problem that does not exist
- *The CSV seeder.* Probed with a BOM, CRLF, quoted commas, embedded newlines, ragged rows and
  a duplicate header column. It handled all of them. Worth noting that a contributor dropping a
  middle column now degrades *correctly* because of the first finding — the shifted
  `last_verified` is unparseable, so the record reads *call first* rather than inventing a date

## 1.E — Milestone 1, error handling and reporting

**The failure that was reported to nobody.** The cross-cutting sweep made `write` return
whether it had saved, and left a comment saying *"the screens that write ask."* **Not one of
the thirty-odd call sites checked the boolean.** The only reader anywhere was Status, which
read the message once, at mount. So an operator whose phone was full closed a patrol, saw it
accepted, and was told nothing — unless they later opened a different screen, which then
reported a failure from some earlier moment with no indication of what had not been saved.

This is the shape the lens is looking for: a fix that made the *layer* honest and stopped
there. Storage now notifies, and the banner lives in the terminal layout, so it appears on
whatever screen the operator is on at the moment the write fails. It is one place rather than
thirty because a report that each call site has to remember is a report that will be missed
again — that is precisely how this went unreported for two milestones.

**And the one that lost the record rather than merely failing to save it.** `setKeepHistory`
moves the patrol log between tiers when the operator changes their mind about surviving a
panic wipe. Three unchecked writes: copy the log to the new tier, clear the old one. On a full
phone the copy failed and **the clear ran anyway** — so the one operation whose entire purpose
is not losing the history was the thing that destroyed it, on the device least able to afford
it. The source is now cleared only once the copy has landed, and the setting is put back if it
did not, so the record is always where the operator's setting says it is.

Both are checked in both directions, and the browser tests prove an operator actually sees it
rather than that the mechanism exists — the layout banner is the kind of thing that would
otherwise sit there unreachable.

**Nothing found in three places:** the seeder's build-time errors are the best in the codebase
(they name the file and explain *why* ids are global, so the contributor can act); the contact
errors say what to do; and the display rules already answer invariant 9 correctly for a missing
date.

**Two notes on the harness, not the product:**

- The build/preview race from 0.E **recurred** — chaining `npm run build` into a Playwright run
  served a half-written build and failed both new specs. Re-running serially passed. It is
  worth a script rather than a note next time it happens
- The RTL suite caught the banner using `border-left`. Working as intended, and a reminder that
  a fix written in one pass can break a property established in another milestone

## 1.X — Milestone 1, edge cases

**A night patrol read as ending before it started.** The export rendered
`Dec 31, 2025 · 10:00 PM–02:00 AM`, which says a patrol ended four hours before it began.
Crossing midnight is not an edge case for this product — **it is the ordinary case**, because
patrols happen at night, and the export is the one artifact deliberately designed to leave the
app and be pasted into a post or a grant application, where a reader who cannot tell whether
the log is wrong has no way to ask. Now `(next day)`, or `(+N days)` for a sign-off somebody
forgot. Checked across the turn of a year and across spring-forward, where 01:30–03:30 local
correctly reads as one hour.

**An operator could be refused their own callsign while trying to destroy their phone.**
`José` is one code point or two depending on which keyboard produced it, and the two render
identically. The burn gate compared the raw strings, so somebody who set up on one device and
confirmed on another was told their callsign did not match — while looking at a name identical
to what they had typed, under whatever circumstances make a person burn a device. Compared as
NFC now, deliberately not NFKC: canonical equivalence is the same character written two ways,
and this gate ends in destroying everything.

**A patrol record that was not a list threw out of sign-off.** Reachable through a restored
backup or a hand-edited blob, and it surfaced as a sign-off button that did nothing and said
nothing. Read as empty now, which is the same call the corrupt-storage path already makes.

**Nothing found in the seeder.** The obvious lead was that `loadAll` throws for a CSV with no
manifest but not the reverse, and thirty-odd seeded regions do have zero records — so the
picker looked like it would offer an area whose page was never prerendered. It already filters
on record count, and the comment there says why. Checked rather than assumed, and it was
already right.

## 2.R — Milestone 2, robustness

**A stranger can page your on-call human as many times as they like.** Measured, not argued:
three hundred `20911` from three hundred fresh keys produced **three hundred pages** to a real
person's phone, and three hundred ladders that were never released. Nothing here is
privileged — the watch's address is meant to be handed out, and a signed Distress costs a key
made a second ago.

This is not a denial of service against a server. It is an attack on the one mechanism in
this system where failure means somebody is hurt, and `CLAUDE.md` already names the kill
trigger: *alarm fatigue destroys the one mechanism where failure means someone is hurt.* A
pager that has cried wolf four hundred times is not answered on the night it is real, and no
amount of correct ladder logic survives that.

Bounded now, at twenty pages an hour by default — generous enough that a real night never
reaches it, and passed by a flood in under a second. **The bound does not weaken invariant 2**,
which is the whole question: past the budget the ladder still opens, the operator is still
told, and what they are told is that nobody could be paged. The ladder is allowed to fail. It
is never allowed to fail silently.

**And one found on the way: a failed page was reported as a successful one.** Every channel
could exit non-zero — a dead gateway, a missing binary — and the operator was still told
`"Paging Wren."` The dispatch result went to the log and nowhere else. That is invariant 2
failing in exactly the silent way it forbids, and it needed no attacker at all. The node now
adds what only the node knows; the ladder's own sentence describes a state machine that cannot
see a command's exit status.

**Ladders accumulated forever.** Every ladder ever opened stayed resident and was walked once
a second, on a box meant to run for months. Terminal ladders are dropped after a retention
window; **live ladders are never dropped at any age**, because a `paging` ladder that vanished
would stop escalating with nobody told.

**What was deliberately not changed.** The executor answers a `Distress` from anybody, not
just from known operators. Restricting that would need an enrollment step this build does not
have, and it changes *who a watch will answer* — a much larger decision than a rate limit, and
not one to make inside an audit pass. The budget was chosen precisely because it bounds the
harm without deciding that question.

Spec, example config and failure-mode list all updated; two new numbered failure modes.
Checked in both directions — the three flood tests fail against the unbounded version.

**Method note, and this one is mine rather than the code's.** I had been running the watchtower
suite as `npx vitest run --root packages/watchtower`, which bypasses npm scripts and therefore
the `pretest` that builds core. Watchtower resolves `@navcom/core` to `dist/`, so those runs
were testing **whatever core last built**, not core as written. It surfaced here only because
a brand-new core method was missing at runtime. Use `npm test --prefix packages/watchtower`.

## 2.E — Milestone 2, error handling and reporting

**One weekly drill paged everybody roughly six hundred times.** A drill waits out its
acknowledgement window — ten minutes by default — before it can record a result, and the sweep
that decides whether one is due runs every second. Nothing marked a drill in flight, so the
sweep started a new one every second for the entire window, each paging the whole roster.
Measured at four pages in five seconds with a six-second window; the shipped default is a
hundred times longer.

**No attacker is required.** This is the ordinary weekly drill, and the mechanism built to
prove the pager works *without wearing it out* was the thing most likely to destroy it. It is
also worth noting that 2.R's page budget would not have caught this — drills page directly,
and deliberately still do, because a real `Distress` must never be refused because a drill
spent the budget.

Fixed with an in-flight flag, and by re-arming the schedule *before* the window is waited out
rather than after — otherwise a drill that throws leaves `nextAt` in the past and every
subsequent sweep considers a drill due, which is the same storm arrived at by a different
route.

**A watch whose drills stopped ran three months on a dead pass.** Nothing anywhere considered
a drill's *age*. The demotion rule already handled an absent or failed drill, and a stale one
walked straight past it: an executor that died in June leaves a passing June drill in the file,
and the daemon goes on advertising `automated-oncall` on the strength of it. An operator signs
on and reads a clean sentence. **A dead safety check read exactly like a healthy one** — and
this is the case that arrives on its own, without anything going wrong on the night.

Invariant 9 says volatile data shows its age. A drill result is the most volatile thing this
system publishes and it was the one piece that did not. Two weeks — two drill cycles — now
demotes the claim and puts the age in the sentence. `station` is deliberately unaffected: a
human at the console is present regardless of what a drill says.

**And the sentence was not true.** `"No drill has ever passed."` was printed for three
different situations, and only one of them supported it — `last_drill` is the *last* drill, so
a failure today says nothing about last month. Now: never run, last one failed, or passed *N*
days ago, each said plainly.

**Two smaller ones on the same path:** a drill result was logged *after* it was written, so a
filesystem that refused the write threw past the log line and the entire product of a safety
check vanished — not in the file, not in the log, nowhere. And that write failure was silent;
it now says what the consequence is, that the watch will keep publishing the previous drill.

**Nothing found in the keyless pager**, and it is worth saying why: `pager/decide.ts` already
had per-operator rate limiting, multi-relay dedup and an age check, with the reasoning written
out. **The defence existed in this codebase already — in the component that is not
safety-critical.** The executor, which is, had none of it.

**Method note.** `npx vitest` does not typecheck. Two test fixtures written in 1.E used `null`
for fields typed as optional strings and passed anyway; `tsc --noEmit` caught them here. Run
the typecheck, not only the tests.

## 2.X — Milestone 2, edge cases

**Nobody declared on-call in a config file could acknowledge anything.** The executor matches
an acknowledgement by comparing `author.pubkey` to the signing key. **The config parser had no
`pubkey` field**, so every entry a config file could produce carried none, and `undefined`
matched nobody. In any real deployment every ack was refused, every ladder ran to `EXHAUSTED`
while somebody was on their way, and **every drill failed forever** — which then demoted the
watch permanently under 2.E's own rule.

Every existing test passed because the test helper takes a pubkey and builds the entry by
hand. **The ack path was covered only in a shape production cannot create.** That is the same
class as *a mechanism nobody can reach is not built*, one level down: the mechanism was
reachable in the tests and unreachable in the product.

`pubkey` is now a config field, validated as 64 hex at load rather than at 3am. It stays
optional, because somebody on-call by phone who does not run NavCom is a real arrangement —
but a roster where **nobody** can acknowledge is announced at startup in the same block the
empty-roster warning uses, since it has the same consequence and none of the visibility.

**A backwards clock stalled the ladder for the length of the jump.** Window arithmetic is
wall-clock, on a box that may have no battery-backed clock and syncs NTP after boot — an
hour's correction is ordinary there. Elapsed time went negative and the ladder simply stopped:
the operator waits out the entire jump before being told nobody is coming. Re-anchored now,
which bounds the damage to one window, and deliberately **not** reported — a clock correction
is not a transition and the operator has no use for hearing about it.

**`Wren, Wren, Wren answered.`** A client retries its acknowledgement and several relays
deliver each attempt, so a drill recorded the same human repeatedly — and that list is
published in `10910`, where three entries read as three people having woken up. A roster's
depth is the one thing a reader is trying to judge from it. Deduplicated by key, falling back
to callsign.

**And a push registration that could never be encrypted passed both ends.** `getKey` can
return null; the browser encoded that as an empty string and returned a `Registration` that
looked complete, and the node checked the keys were *strings* without checking they were
anything. Both halves were reasonable and the join was a hole — the same shape that has now
appeared three times in this project. The browser refuses and unsubscribes; the node requires
non-empty.

## 3.R — Milestone 3, robustness

**The pairing inbox is the one place a stranger's traffic reaches an operator's screen
without their consent** — the contact key is published, because that is what a card is for —
and it was unbounded. Worse, each arrival copied the whole map, so it was quadratic: five
thousand invites cost **twelve and a half million property copies and four seconds on a
laptop**. On the device floor that screen is gone, and the peers list goes with it.

Capped at fifty, which is far more pairing requests than a real person receives. **The cap is
only defensible because of the two things beside it**: the operator is told plainly that
requests are being turned away, and there is one control that clears them all. A capped list
that empties fifty taps at a time is one nobody can recover from, which would make the cap the
attack rather than the defence. The trade is stated rather than solved — a flood that arrives
first does block a later real invite, and the answer to that is the operator's, not a cleverer
eviction rule.

**A peer list that was not a list broke pairing and presence**, the same class 1.X found in
the patrol record and reachable the same way — a restored backup, a hand-edited blob. It threw
out of `pair` and `peerPubkeys`: a pairing button that does nothing, and a presence
subscription that never starts, neither saying why.

**Nothing found in two places.** A hostile invite cannot carry a huge callsign — `readInvite`
caps it, and the cap holds at the point of read rather than the point of display. And presence
is only accepted from keys already paired with, checked inside `readPresence` rather than by
the caller.

### The harness gained the thing it was missing

No browser test in this suite could check what happens when something **arrives**. The e2e
socket is deliberately dead — right for almost everything here, since most of these tests are
about a phone with no signal — but it meant every behaviour driven by relay traffic was
reachable only in unit tests with the pool mocked out. That is a large blind spot with six
passes left that are mostly about traffic: presence, the board, handover, corrections.

`seedDevice` now takes `relayEvents` and swaps in a socket that speaks enough of the protocol
to replay them against a `REQ` filter. The flood banner and its clear control are proven in a
real browser rather than asserted from a unit test, which is what this project's own rule
asks for.

## 3.E — Milestone 3, error handling and reporting

**Pairing is two halves and only one of them is local.** Accepting an invite pairs the peer on
this device and publishes a reply carrying your key back. `await Promise.allSettled(publish)`
**discarded its result**, so an operator accepting with no signal — the ordinary state of a
field terminal — added the peer to their own list, sent nothing, and was told nothing. They see
the peer; the peer never hears.

For a **buddy** that is the sharpest form: buddy pairing means somebody watches your patrols,
so a reply that never left means **nobody is watching while the operator believes somebody
is.** That is invariant 4's mistake made one person at a time.

`accept` now reports whether the reply actually reached a relay, and the screen says so in
those terms — *"You have Raven, but they do not have you."* There is deliberately **no retry
queue**: invites are held in memory precisely so there is nothing to expire, migrate or leak
into a wipe, and adding an outbox to fix this would trade a stated design decision for a
convenience. The retry is the operator tapping Accept again, so the request stays on screen
when the reply fails and `accept` was made idempotent — the second tap must not be refused for
a pairing the first one made.

**The same discard, one screen over.** `Find` marked an invite `Sent.` unconditionally, so an
operator with no signal watched it succeed and then waited for a reply to something that never
left the phone. Now it says it did not reach a relay, and offers *Try again*.

**Nothing found in the branch that looked worst.** `accept` and `invite` both bail early on
`urls.length === 0`, silently — but `relays()` falls through to a shipped default list and can
never return empty, so that branch is unreachable. Left alone rather than dressed up as a fix.

### Two harness faults, both of which manufacture false results

**Playwright was reusing another project's server.** `reuseExistingServer` on port **4173** —
Vite's default, and therefore every Vite project on the machine — meant a run navigated to a
completely different application and failed waiting for a hydration flag it would never set.
It reads exactly like a bug in the screen under test, and I spent a probe cycle on it. NavCom
now has a port of its own. Worth stating plainly: this can produce a false *pass* as easily as
a false failure, and nothing about the output says which application answered.

**And the harness needed to be able to refuse.** A relay that accepts subscriptions but
rejects publishes is a phone on bad signal, which is where half of this app's *"it worked"*
messages were being printed. `seedDevice` takes `refusePublish` now, which is what made the
half-pairing warning provable in a browser rather than asserted from a mock.

## 3.X — Milestone 3, edge cases

**How fresh a peer looks on your screen was decided by their phone's clock.** Presence
recorded `heard: read.at` — the timestamp the *sender* stamped — and measured staleness
against it. A peer ten minutes slow **read as unknown while actively out**; one an hour fast
**read as out for half an hour after they had stopped**. The second is the dangerous
direction: it tells a buddy somebody is fine when nothing has been heard, which is exactly
what this module's own opening rule forbids.

One field was doing two jobs. Their timestamp is the only thing that can order two of their
own heartbeats, so it is kept as `at` and used for nothing else; `heard` is now when *this*
device received it. **The only honest answer to "how long since I heard from them" is one this
phone can observe** — somebody else's clock is not evidence about our own silence.

**And the same fault in the overdue signal, which fixing the first one made incoherent.**
`until` is a claim in the sender's frame — *"back by nine"* means nine on the phone that said
it — and it was compared straight against our clock. A peer whose clock ran slow read as
**overdue the moment they set out**. `overdue` is a nudge to a buddy, and the anti-pattern
table names overdue nudges as the thing that produces alarm fatigue: a signal that fires
because somebody's clock is wrong is precisely the noise that teaches people to ignore the
real one. The skew is observable from the same message, so the deadline is now translated into
our frame with no extra round trip and nothing to configure.

**The public board had the pairing inbox's flaw, through a wider door.** Same unbounded
quadratic intake, but the region tag is *public* — that is what a board is for — so anybody
may publish a card into somebody else's area. Bounded at two hundred, and the screen says the
board is partial, because a list that silently stops looks like a complete list and somebody
searching for one particular operator would conclude they are not there. Entries already shown
still update, so a flood cannot freeze the board.

**Nothing found in two places, both already right:** out-of-order delivery is handled
explicitly for presence, cards and public presence, each with the reasoning written down; and
a peer's `area` and `callsign` are bounded at the point of read.

### Clocks, three passes running

2.X found the ladder stalling on a backwards NTP correction. This pass found freshness and
overdue both measured against a stranger's clock. **Every one of them was a place where one
machine's time was used as though it were everyone's** — and the fix each time was to be
explicit about whose clock a number belongs to. Worth carrying into the remaining passes: any
timestamp that crossed a device boundary deserves the question *whose clock is this?*

**Method note, third occurrence.** `npx tsc` and `npx vitest --root` bypass the npm scripts
that rebuild core, so both were type-checking and testing against a stale `dist/`. Use the
package scripts — `npm run check`, `npm test --prefix` — not the tools directly.

## 5.E — Milestone 5, error handling and reporting

**The parser distinguished four reasons for Dark and the screen explained two.** `absent` and
`corrupt` fell off the end of the chain — and those are precisely the two cases where an
operator **has** a watch configured and is being shown Dark. The one the screen did explain
well, a wrong clock, proves the point: it is fixable in thirty seconds by somebody who is
told, and unguessable by somebody who is not.

The two that were missing need different actions from each other and from everything else:

- **Nothing at all from a configured watch** is usually one of two things — a relay list that
  is not the one the watch publishes to, or a watch that is not running. Both come from the
  person who handed over the address, and neither is inferable from the word *Dark*
- **Something arriving that cannot be read** is almost always a version gap. That is fixable
  by the operator; a watch that is down is not

Same shape as 0.E: the mechanism to tell them apart had been there the whole time and nothing
consulted it. Dark was always the safe answer and stays the safe answer — what changed is that
the operator now learns which situation they are in.

**And the cover notice counted people where this project's rule is to name them.** It read
*"2 people you send to"*, against a rule written down in this codebase: *"an operator being
told '2 on-call' learns less than one told 'Wren and Raven'"*. Here the count is worse than
merely uninformative — the sentence **asks the operator to get somebody to open the app**, and
a number does not say who to ask. Now *"Raven needs to open the app once"*. `pq` still returns
pubkeys and knows nothing about naming, which is the right split; the peer list is where names
live, so the resolution happens on the screen.

## 9.X — Milestone 9, edge cases

**A decade of standing could be lost to a trailing space.** The blob is meant to live *"a note
app, a USB stick, a printout in a drawer"* — every one of those is a place a passphrase gets
**pasted**, and a paste carries a trailing newline or space more often than not. Untrimmed,
that made a backup permanently unopenable. And because a wrong passphrase and a damaged blob
are *deliberately* indistinguishable — which is right, and protects somebody holding a stolen
backup from learning they are close — **the operator could never find out that a space was the
whole problem.**

Trimmed now, in `keyFrom`, which is the single place both sealing and opening go through, so
the two cannot come to disagree about what a passphrase is. It is the same decision NFKC
already made for the same reason, and the entropy given up is nil: nobody's passphrase is
strong because it ends in a space.

**And a backup of damaged storage looked exactly like a real one.** 0.X established that
corrupt storage reads as empty everywhere else, which is the right call — a terminal that will
not start is worse than one asking to be set up again. It is the wrong call *here*: an operator
whose storage was damaged made a backup, was told it worked, and kept a blob holding
**nothing**. The one artifact meant to survive a lost phone, silently empty. Refused now at
both ends — sealing says the storage is damaged and points at Status, and restoring a kit with
nothing in it no longer reports *"Restored 0 things"* as a success.

That pair is the audit closing on itself: **the first pass established that corrupt storage
reads as empty, and the last one found the place where that rule is a trap.**

**A negative I nearly recorded without testing it.** My first probe of passphrase
normalisation compared a precomposed string to a "decomposed" one — and the source file had
normalised both, so they were identical and the check proved nothing. Built from escapes
instead, it passes for real. Third time in this audit that a probe measured something other
than what it claimed, and the only defence that has ever worked is checking that the test fails
when the behaviour is removed.

## The grid, closed

Twenty-seven passes. What the ceremony bought, in one line: **the findings were not evenly
distributed, and no single sweep would have reached them.** They clustered in failure paths
nobody had a reason to visit — a flood, a dead executor, a phone with no signal, a clock that
moved backwards, a blob pasted with a space on the end.

Six recurring shapes, each found in more than one milestone:

| | Shape | Where |
|---|---|---|
| 1 | **An unbounded intake behind a door the design leaves open** | 2.R, 2.E, 3.R, 3.X, 4.R, 6.R |
| 2 | **Both halves correct, the join untested** | forgery memoisation, PQ envelope, push keys, 6.X, 9.R |
| 3 | **A discarded publish result** | 3.E, 4.E, 6.E |
| 4 | **One machine's clock used as everyone's** | 2.X, 3.X, 4.X |
| 5 | **A second implementation of a rule that already existed** | 1.R vs 7.X, 9.E |
| 6 | **A documented behaviour connected to nothing** | 7.R revocation, 6.E retry, 5.E reasons |

And the three worst findings share one property: **a failure that leaves visible evidence of
success.** A correction in your own directory that reached nobody. A credential taken up that
does not count. A watch that says *On station* to a relay that never heard it. Every other
silent failure left the operator with nothing to look at; those left them looking at the thing
they were wrong about.

Test counts moved from 364 core / 244 web / 189 watchtower / 129 browser to **404 / 332 / 202 /
147** — 447 added, none removed.

**What is still not covered.** Milestone 8 has no row: it is gated on Milestone 6 and unbuilt
apart from 8.1, the printable sheet — which was audited afterwards as a twenty-eighth pass,
below.

## 8.1 — the printed sheet, as a twenty-eighth pass

Added after the grid closed, because 8.1 is built and had no cell.

**The sheet carried the record's age and not its own.** `print.spec.ts` opens by naming the
failure exactly — *"a printed page looks equally authoritative the day it was printed and
eighteen months later"* — and then tests everything except that. A reader holding paper had
the record's `last_verified` date and **no fixed point to compare it against**. The site ships
no JavaScript and never will, so the print date cannot be the moment of printing; it is the
build's, baked in at prerender, which still bounds the answer: *"published 2026-08-22. If that
is long ago, treat everything here as out of date."*

**And the screen's verdict did not reach paper.** A stale record printed identically to a
fresh one apart from a raw date the reader had to interpret. It now carries the same
`call-first` judgement the screen makes, decided by `displayField` rather than by a threshold
invented for paper — the two surfaces must not disagree about the same record.

**One half of that is currently unverifiable, and is recorded rather than faked.** No seeded
record is more than sixty days old, so the stale branch has no data that reaches it. A fixture
would prove the component renders a string, not that the two surfaces agree, so the browser
test asserts the case that does occur and this notes the gap. It closes on its own when 6.9
lands real directory data with real ages.

**Nothing found in the rest of the print surface**, which was better covered than I expected:
navigation dropped as dead ink, the provenance block hidden on screen where ages already show,
`break-inside: avoid` so a record cannot split across a page, and forced black-on-white against
a reader in dark mode — each with a test.

## 9.E — Milestone 9, error handling and reporting

**The screen stated the rule and could not say whether it applied.** *"A backup you never made
does not exist"* is on the backup screen, exactly as `identity.md` requires — and **nothing
recorded whether this operator had made one.** The app could recite the principle and had no
idea which of those two people was reading it.

The sharper half is the one that arrives on its own: **a backup goes stale.** Standing is built
over years and peers accumulate, so a backup made before any of that does not hold it. The
operator has a safety net for a version of themselves that no longer exists, and nothing said
so. That is invariant 9 — *volatile data shows its age* — applied to the safety net rather than
to the data.

Both now answered on the screen an operator opens to think about backups, and deliberately
**not** on Status: this is a fact somebody went looking for, not a nudge to be shown a fact
they did not ask about.

**A bug in that fix, found by the test I wrote for it.** The date was recorded *after* sealing
— correct, so a backup that threw is not recorded as one that exists — which meant it never
travelled inside the blob, and an operator who had **just restored** was told they had never
made a backup. The kit already carries the date it was sealed, so a restored phone adopts it
and learns the more useful thing: **how old the safety net they are now standing on actually
is.**

**Nothing found in the restore errors**, which distinguish an identity already present, a
version this build does not know, an oversized kit, and a wrong passphrase — each a different
sentence pointing at a different action.

**Harness note, recurring:** a `toContainText` regex does not normalise whitespace, and the
phrase spanned a line break in the markup. That is the third time in this project; the fix is
always `\s+` rather than a shorter phrase.

## 9.R — Milestone 9, robustness

**A backup is the one blob in this system somebody can hand you**, and restoring it wrote
whatever keys it contained into the tier that holds the identity, the standing and the patrol
record. It is decrypted with a passphrase the operator types, so this is not something a
stranger runs at a distance — but *"here is your backup from the old phone, the passphrase is
X"* is an ordinary sentence.

Three things were missing, and the middle one is the sharpest:

- **`v` was declared and never checked.** A kit written to a shape this build has never seen
  restored anyway
- **`DEVICE_ONLY` was enforced on the way out and not on the way in.** The same list, twelve
  lines above the restore, calls these *"this device's business rather than this operator's"* —
  and `relays_own` is the list of relays this phone talks to. A crafted backup could set it,
  **routing everything this operator sends through relays somebody else chose**. Excluded from
  a backup we write; accepted from one we read
- **Nothing bounded the key count**, so a "backup" could be a storage bomb — and 1.E
  established that a full phone stops saving

That middle one is the **fifth** appearance of the same shape in this audit, and the closest
together yet: the two halves are in the same file, twelve lines apart. *Both sides tested* is
not the same as *the boundary tested*, even when the boundary is that short.

**Three honest negatives, all on things worth checking rather than assuming.** The KDF
parameters are not in the envelope, so the classic *"attacker picks the cost"* attack is closed
by construction — injecting `N`, `r` and `p` changes the open time not at all, measured rather
than reasoned. A wrong passphrase and a damaged payload give an identical error, which is the
property that matters and which my first probe got wrong by corrupting the envelope instead of
the ciphertext. And the Lightning address validator refuses empty, malformed, `localhost`, a
bare IP, an oversized string, a script tag and a newline injection while accepting the ordinary
forms.

## 7.X — Milestone 7, edge cases

**A credential dated 2099 read as the freshest possible thing, and never aged.** The screen
had its own age arithmetic with a `Math.max(0, …)` clamp, so any future date rendered *"0 days
ago"* — for ever. This module's stated design is *age rather than expiry*: **nothing expires
on a timer, so the age is the entire mechanism**, and a credential that never ages defeats it
completely.

This is 1.R's finding again, in the module where showing an age is not a display detail but
the design. It happened for a plain reason: `ageInDays` already answers this question
correctly, and the screen had a second implementation. A second implementation of a rule is
how the two drift apart, and here one of them had already been fixed.

**And a date that was not a date rendered as `NaN days ago`.** The pattern checked the
*shape* — four digits, two, two — so `2026-13-45` passed it, and a hand-rolled client could
put a month thirteen on a credential. Refused now on the way in and on the way out, with a
leap-day test in both directions so the check is a real calendar check rather than a stricter
regex.

**Nothing found in three places that matter.** The bearer property behaves exactly as
documented: two people holding the same bytes both produce valid claims, which is the cost
`endorsement.ts` states plainly rather than a defect. Duplicate claims of one credential are
refused. And the watch gate's founding route survives leaving and rejoining — `leaveWatch`
clears the founded flag, so an operator who gives up a watch and joins somebody else's is
gated, which is right.

## 7.E — Milestone 7, error handling and reporting

Both findings are about the mechanism 7.R had just built, which is the right place to look:
a new mechanism has no history of anybody noticing what it fails to say.

**An operator was not told that standing had been taken away from them.** Filtering a
withdrawn endorsement out of `held` is correct, and on its own it is **silent** — somebody who
could take the watch yesterday and cannot today would have discovered it at the moment they
tried, which for this particular credential is a bad night. It is now named on a screen they
open, with **who** took it back, because that is the person they can ask. The browser test
proves the other half of the consequence: the watch gate actually closes.

**And claiming an already-withdrawn credential appeared to succeed.** It was stored, the
screen reported it taken up, and `held` filtered it straight back out — so an operator was
shown a success for standing they do not have. It is refused now, with the endorser's name in
the sentence, at the moment they can still ask why.

That second one is the same shape as 6.E, and worth naming as a pattern: **a failure that
leaves visible evidence of success is worse than one that leaves nothing.** Both times it
happened because a value was stored locally for a good reason and the thing that would later
reject it lived somewhere else.

**Nothing found in the claim errors**, and they are a good example of the lens being satisfied:
no identity, malformed JSON, an unsigned credential, one this version cannot read, and one
already held are five distinct sentences, each true and each pointing at a different action.

## 7.R — Milestone 7, robustness

**An endorsement could not be taken back.** `revoke` and `isRevokedBy` were both written,
tested and exported from core. `identity.md` says plainly: *"Revocation is possible —
endorsers publish a revocation, checked when online."* The client **never published one and
never looked for one**. `revoke` was imported by the standing screen and never called;
`isRevokedBy` was never called anywhere in the app.

So an endorser who vouched for somebody and later learned they were unsafe had no way to
withdraw it. And `can-take-watch` is the gate on who may hold a board — the one credential in
this system that decides whether an operator goes out believing a named human is reading what
they send. **A withdrawn endorsement went on opening that gate forever.**

`declined.md` has no entry for it, so this was not a gap somebody weighed and let go. It was
assumed built.

Implemented rather than deferred, because both hard halves already existed and the missing
piece was the wiring: the endorser keeps a record of what they wrote — **of credentials
written, never of people vouched for**, since a credential names nobody and that must stay
true — and withdrawing publishes the revocation core already knew how to make. Holders
subscribe, filtered to the endorsers whose credentials they actually hold, and only
revocations that withdraw something this device holds are cached, so a flood of them cannot
fill the tier that carries an operator's standing.

Two properties kept deliberately:

- **The check is against cached revocations, not the network.** Standing is checked offline at
  least as often as online — in person, two phones, no signal
- **Withdrawal is honoured on the endorser's own device immediately**, whether or not it
  reaches a relay. They have decided; that decision must not wait for signal. What does wait
  is everybody else, and the screen says so

**A bug in my own fix, caught by the reachability test.** I put the *"this has not reached a
relay"* notice inside the row it referred to — and withdrawing removes that row, so the one
case worth reporting rendered nowhere. It passed every unit test. This is the second time in
this audit that a fix introduced a defect only a browser test could see, and both times the
defect was in the reporting rather than the mechanism.

## 6.X — Milestone 6, edge cases

**Two devices could draw different directories from identical evidence.** Ranking settles
almost everything — an in-person check beats a website scrape, a newer date beats an older one
— but on an exact tie the first candidate encountered won, and that is relay delivery order.
Two operators carrying the same area, given the same two corrections in a different order, saw
**different opening hours for the same shelter**. Each device drawing its own picture is the
design; drawing a different one from the same evidence is not.

Fixed with a deterministic sort and nothing else — the ranking rules were right and are
untouched. The tie-break is the author's key, which is arbitrary **and deliberately so**:
between two people who both stood at that door on the same day there is no ground truth to
prefer, and inventing one would be worse than admitting there is none. It is not worth gaming,
because winning a tie means matching the other correction's date and method exactly and anybody
willing to do that can publish tomorrow's date and win outright. The real answer for the reader
is unchanged and was already right — **the field carries its provenance**, so they see who said
it and when.

**And a merge documented as *"additive, never deletes"* could delete.** `buildCorrection`
refuses a correction that asserts nothing; `readCorrection` did not. A hand-rolled client could
publish `{"hours": ""}` — an empty string is still a string, so it became a merge candidate,
and with an in-person method and a recent date it **outranked the published record and won**,
blanking the field on every device carrying that area. Erasing knowledge, quietly, from
anybody.

An empty correction also bought a free slot in the store 6.R had just bounded, which is a
cheaper way to fill somebody else's phone than a real one.

**This is the fourth time the same shape has appeared**: two halves each individually
reasonable, and the join untested. The forgery memoisation, the PQ envelope, the push
registration keys — and now a rule enforced by the builder and not by the reader. The lesson
that keeps holding is that *both sides tested* is not the same as *the boundary tested*.

**Nothing found across the rest of the field rules**, and they are worth naming because they
are the strongest defended surface in the codebase: an unknown field, a field about a person
[invariant 1], an over-long value, a bad date and an unknown method are all refused **on read**,
by a hand-rolled event that never touched the builder.

## 6.E — Milestone 6, error handling and reporting

**A comment promised a behaviour that did not exist.** `submit` held a correction locally and
published it once, above a comment saying it *"will publish the next time this runs with a
connection"*. **Nothing implemented that.** A correction made with no signal failed once and
was never sent again.

What makes this the worst reporting failure in the audit is not the loss — it is that the
operator had **positive evidence it had worked**. The correction is held locally so they can
see their own contribution, which is right; it therefore appeared in their directory exactly as
a successful one would. Every other silent failure found here left the operator with nothing
to look at. This one showed them the thing they were wrong about.

And it lands on precisely the person the feature exists for. The module's own docstring says
contributing must not be gated, *"because the operator with the best knowledge is often the
one with the most reason not to be findable"* — and the operator with the best knowledge is
the one standing at the door, which is where the signal is worst.

Implemented rather than deleted, because the comment described the right behaviour. Unsent
corrections are kept as signed events in the accruing tier — beside the corrections
themselves, and for the same reason the patrol record lives there: **this is the operator's own
contribution and losing it is the failure**. They go out on the next start with signal, and
until they do the directory says so plainly, including what happens next.

This is deliberately the opposite call from invites in 3.E, where I declined to add a queue.
An invite is re-sendable in person to somebody you just met; a correction is something learned
at a door the operator has already walked away from, and it is already persisted, so retrying
adds no tier and no new class of stored data.

**Harness note:** `seedDevice` takes arbitrary accruing fields now. The first version of this
test drove the correction form by guessing at selectors and timed out; starting in the state
under test rather than driving a screen to reach it means the test depends on the behaviour
rather than on markup it does not care about.

## 6.R — Milestone 6, robustness

**A stranger could stop an operator's patrol record from saving.** That is the whole finding,
and it takes three steps that were each individually reasonable.

A correction is the one thing in this system **anybody** may write into somebody else's
device: publish one, and every phone carrying that area caches it. It is keyed by
`author:record`, which bounds one author — and fresh keys are free. Measured: twenty thousand
corrections is about **11 MB**, past a typical localStorage quota. And 1.E already established
what a full phone does, which is stop saving. So the chain ends at an operator's own patrol
record silently failing to record, caused by somebody with no relationship to them at all.

Bounded now, at four hundred overall and twenty-five for any one record — both far above
anything a real area produces. **New authors are refused rather than old ones evicted**, so a
flood cannot displace a correction somebody was already relying on, and an author already held
can still update: a genuine correction from a known author is never turned away because
strangers filled the space. The directory says when it is holding a partial set, because a
directory holding a fraction of what was published looks exactly like a directory nobody has
corrected.

**And a second cost, which was not an attack at all.** Every arrival re-serialised the whole
map to storage, so three thousand corrections wrote **2.1 GB** for 1.5 MB of data. Relays
deliver in bursts, so that is the ordinary case rather than the hostile one — the flood only
made it visible. Writes are coalesced to the end of the tick now.

**The pattern this milestone completes.** Every one of the six flood findings has been the
same shape — an unbounded intake behind a door the design deliberately leaves open — and each
has had a different consequence: the on-call human's phone (2.R), the drill storm (2.E), the
pairing inbox (3.R), the public board (3.X), the watch's board (4.R), and now the operator's
storage. **The doors are meant to be open. It is the absence of a bound behind them that was
uniform**, and worth checking first in anything built after this.

## 5.X — Milestone 5, edge cases

**This pass overturned a second negative of mine, and this one was load-bearing.** In 5.R I
recorded that malformed watch state degrades to Dark on ten hostile inputs. I had passed an
`Event` object to `readWatchState`, which takes a **string** — so every probe failed
`JSON.parse` and returned Dark for a reason that had nothing to do with the input. Probing the
actual signature found the opposite of what I had written: the parser validated almost nothing.

That is twice now (4.R was the first) that a wrong *negative* has been the expensive mistake
rather than a missed positive. Both times the shape was identical — I read a name and believed
it instead of reading what the code does with it.

Four findings behind it, all reachable from any relay:

**An unknown state word rendered *"An agent holds the board."*** `capabilitySentence` falls
through to the agent branch for anything it does not recognise, so a watch publishing a word
this build has never seen told the operator an agent was watching. **A false claim about who
is on the other end**, on the one screen invariant 4 governs. It reads as Dark now.

**`holder` was neither type-checked nor bounded.** An object rendered as `[object Object]`, and
a sixty-thousand-character name filled the screen. This is the field an operator reads to know
*who* is watching, and it is the exact layout attack `CALLSIGN_MAX` exists to prevent —
enforced everywhere except the one place a stranger's string reaches the Status screen.

**Junk inside `oncall` threw out of `capabilitySentence`**, taking the Status screen with it.
`Array.isArray` was checked; the elements were not.

**The version was not checked at all.** Older is fine and deliberately so — *"a v2 node
publishes no root"* — but a payload written to a spec this build has never seen may mean
something different by the same words. Newer now reads as Dark, and reports itself as
`corrupt` rather than `absent` or `stale`, which makes 5.E's new explanation land exactly
right: *"most often the watch is newer than this app."*

**Nothing found in the RTL suite or the battery boundaries**, both of which already had tests
and held up under the obvious probes.

## 5.R — Milestone 5, robustness

**The device kept a shadow copy of every relationship it had ever had.** A peer's ML-KEM key
is cached in the accruing tier, and nothing ever removed one. `unpair` takes somebody out of
the peer list — *"unilateral, immediate, and nobody is told"* — and left their key behind, so
`kem_keys` accumulated the pubkey of everyone the operator had ever paired with, **in the tier
that survives a panic wipe**. An operator who unpaired somebody had done so everywhere except
the one place a seized phone would still show it.

Pruned on start against the set of people this device would actually send to, rather than in
`unpair` — because the same is true of leaving a watch and of withdrawing a card, and a rule
every caller has to remember is one that gets missed. That is how this happened, and it is the
same shape as the wipe-key list in 1.R.

### Four honest negatives, and one near-miss of my own

**The post-quantum fallback notice is exactly right.** I went looking for a silent downgrade
and found the opposite: a note rather than a warning, in the same muted colour as every other
cost on the screen, saying what is actually missing — *"not covered against being stored today
and opened by a future quantum computer"* — and what would change it. The comment above it
explains why an orange "insecure" bar would be both alarming and **wrong**, since the message
is unreadable by anyone today.

**I nearly filed it as missing.** Two searches came back empty and I was ready to report that
nothing surfaced the cover state at all; both had run from the wrong working directory. A
finding that a required behaviour is absent is exactly the kind that must be checked twice
before it is written down, because it accuses the code of something.

**~~Malformed watch state degrades to Dark, every time.~~ This was wrong — see 5.X.** I passed
an `Event` object to a function that takes a **string**, so every probe failed `JSON.parse` and
returned Dark for the wrong reason. The parser did not validate its fields at all. The
correction, and what it cost, are in 5.X.

**Key bundles refuse everything they should.** Signed by an attacker while claiming the
owner, junk content, empty content, a truncated key, a two-hundred-kilobyte key — all refused.
The subscription is filtered by author, so the map cannot be filled by strangers either.

**Battery is absent rather than guessed** on the platforms without the API, which is stated in
the module and is the correct behaviour for a system whose rule is that nothing estimates.

**One thing noted for 5.E rather than fixed here:** the cover notice counts people
(*"2 people you send to"*) where this project's own rule is provenance by name — and a name
would tell the operator *whom* to nudge.

## 4.X — Milestone 4, edge cases

**It began by overturning a negative I recorded in 4.R.** I wrote that the board timestamps
signals with local receipt time and therefore could not be reordered by a backdated flood.
It used `event.created_at` — **the sender's clock** — and I had read the variable name rather
than its assignment. Two real findings were sitting behind that mistake.

**Nothing stopped a replayed state change from making the board wrong.** A stale `stood-down`
removed an operator who was actually out, so the watch simply stopped seeing them; a stale
`on-station` put somebody back who had gone home. The presence store already guards exactly
this and says why — *"out-of-order delivery is normal on relays"* — and the board, which is the
watch's own picture of who is out, did not. The timestamp is now remembered per operator, and
kept after a stand-down deletes the entry, because otherwise a later replay resurrects them.

**And the queue could be jumped by backdating.** *"Waiting on you"* is sorted oldest first,
because those people have waited longest — ordered by the sender's own `created_at`, so
anything stamped far enough in the past went straight to the top of the watch's list. Receipt
time is both the honest answer to *"how long have I had this"* and the one nobody else can set.

**A guard that existed on one door and not the other.** `createWatch` refuses to replace a live
watch's identity and explains why; `joinWatch` — the one that takes a key from somebody else —
overwrote it without a word. On a device holding the only copy of a watch key, that is the
watch ending and everybody configured against it stranded. The screen happens to hide the join
form while a watch is held, and that is not where the rule belongs: *a `maxlength` on a
textarea stops the operator who typed it and nobody else*.

**Nothing found in group sealing, and it is worth saying what was checked.** Zero holders
throws with a real sentence rather than producing a message nobody can read. One holder works
and a stranger is refused. **Duplicate holders produce an envelope byte-identical in size to
three distinct ones**, so the unlabelled-wrap design holds up under the obvious probe. A
hundred holders is 18 kB and 225 ms — linear, and nowhere near a problem at squad scale.

**Also nothing found in a place I expected something:** `expected_until` and `routine_due` are
computed in the sender's frame and would be wrong for the same reason as everything above —
but nothing renders them. Dead fields, so no operator has ever been misled by them. Recorded
rather than fixed, because fixing an unused field is how a codebase grows work that protects
nobody.

## 4.E — Milestone 4, error handling and reporting

Three publishes on the watch side, all discarding their result — the same defect 3.E found on
the peer side, except here the consequences land on **other people**.

**A stand-down that failed left the watch advertised as staffed.** This is the one the module
already explains, two lines above the function: going quiet would leave the previous state on
the relay and *"every operator reading it in the meantime would believe a human was
watching."* A Dark that fails to publish produces precisely that — and it is **worse than
never standing down**, because the heartbeat that had been refreshing the state is cleared
first, so nothing retries and nothing expires it soon. The watch holder goes to bed; every
operator reads *"Wren is at the console."* That is invariant 4, failing in the exact way the
code was written to prevent.

It now retries until it lands and says so until it does. **This is the one place in the app
where going quiet is not the safe default**, so the automatic retry is warranted rather than
hidden behaviour.

**A watch that never announced itself looked identical to one that had.** `takeWatch` set
`onStation = true` and published without checking. A holder whose screen says *On station*
while nothing reached a relay is covering nobody. The heartbeat already retries, so this
self-heals — but the operator had no way to know they were unstaffed *right now*, which is
exactly when it matters.

**An answer that reached no relay was taken off the board anyway.** The watch believed they
had replied; the operator got nothing; the item was gone so nobody could notice. It stays
until it has actually gone.

### And a regression from 4.R, caught here

Moving `Distress` into its own list made `send()` unable to find one: it looked only in
`board.waiting`, so **the one signal that matters became unanswerable.** Fixed to search both.
Worth recording plainly — the previous pass's fix introduced it, the tests all still passed,
and it took reading the handler in a later pass to see it. The same compounding that makes the
grid worth doing also makes each fix a place to look again.

## 4.R — Milestone 4, robustness

**A `Distress` could be buried under routine traffic on the screen a watch reads when
somebody is hurt.** The board put every signal in one list sorted by arrival — `Distress`
coloured red and otherwise equal — so forty queries arriving first put it forty rows down,
and the list was unbounded. The watch address is handed to every operator, so the door is as
open as the escalation executor's.

**This one is a spec violation, not a design opinion.** `signals.spec.md` says `20911` is a
*"separate kind so clients and relays can prioritise it independently of routine traffic"*, and
`buildDistress` says it again in its own docstring: *"Distress gets its own kind so it is never
queued behind routine traffic."* Both halves of the protocol knew. The client flattened them
back together. **Red is not prioritisation if you have to scroll to find it.**

`Distress` now has its own section above everything, and the two lists are bounded separately
and deliberately differently:

- **Routine traffic is dropped when full.** Two hundred unanswered queries is already more
  than any watch will work through, and letting them accumulate costs the screen that matters
- **A `Distress` is never dropped to make room for routine traffic**, and has its own much
  higher cap. If even that is reached the board says so, because invariant 2 forbids failing
  silently — and a watch told that knows something extraordinary is happening, which is a true
  and useful thing to know

**One claimed negative here was wrong, and 4.X corrected it.** This pass recorded that the
board timestamps signals with local receipt time. It does not — it used `event.created_at`,
the sender's clock. See 4.X for what that cost. The finding above stands; the negative beside
it did not, and it is left here rather than quietly edited because a wrong "nothing found" is
the most expensive thing this document can contain.

### The harness, again

Two more gaps closed, both of which had made a whole milestone unreachable from a browser:
`seedDevice` can now seed a **watch key**, because the watch screen shows no board at all on a
device that does not hold one — so nothing about Milestone 4's main screen was testable end to
end. Between this and `relayEvents`, the board findings are proven where an operator would see
them rather than asserted through a mock.

## Milestone 2, after three passes

Every finding was in a path that only runs when something has already gone wrong, or when
nobody is watching: a flood, a failed dispatch, a dead executor, a drill nobody sees fire, an
ack at 3am, a clock correction at boot. **Milestone 2 is the milestone whose entire purpose is
to work on the worst night of somebody's year**, and three of the seven findings meant it
would not have.

The one that should carry forward: two of them — the unreachable ack path and the push
registration — passed every test because the tests exercised objects the product cannot build.
Coverage said yes and production said no.

## Milestone 1, after three passes

Every finding was in the same place — the moment an operator is alone and something has gone
wrong. A future date the display trusted, a `#` that ate the help message, a wipe that kept a
copy, a full phone that said nothing, a move that lost the record, a burn gate that would not
open, an overnight patrol that read as impossible. **Milestone 1 is the layer that has to work
when nothing else does**, and it was the failure paths, not the features, that had the holes.

## Method note, after three passes

Three passes on one milestone produced findings that compound: 0.R made the worker know what
it failed to cache, 0.E found nothing read it, 0.X found that a deploy silently discarded
what it had. Any one of these done as a single sweep would have stopped after the first.
