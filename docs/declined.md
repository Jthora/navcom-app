# What NavCom Declines

A gap needs a third fate.

| Fate | Lives in |
|---|---|
| **Fixed** | the code |
| **Deferred** — designed, sequenced, not yet built | [`build-order.md`](build-order.md) |
| **Declined** — a real problem we are not taking on | here |

Without this page, every honest observation becomes an obligation and the obligation list
only grows. Nobody here has an institution behind them; capacity is what it is. **Declining
out loud is cheaper than a promise nobody can keep, and more honest than silence.**

This is not the [anti-patterns table](../CLAUDE.md), which lists conventional solutions that
are *wrong* here. These are problems that are **real, correctly identified, and someone
else's — or nobody's.**

## How to use it

- When you find a gap, ask whether it belongs here **before** it goes to `build-order.md`
- **Outside research lands here more often than it lands in the build order.** Eighty-five
  proposals were checked against the code once; most were already built or already refused,
  and the entries below are what was genuinely new *and* genuinely not ours. The whole
  reconciliation is in
  [`research/rlsh-brief-reconciliation.md`](research/rlsh-brief-reconciliation.md)
- Every entry names the actual problem, never a strawman version of it
- Every entry names **what declining costs**, because that cost is the honest part
- Declining is not denying. A real problem stays written here even though we are not solving
  it, so the next person finds a decision instead of an oversight
- An entry can be reversed — by deciding to build it, not by forgetting this page

---

## Things the system will never know

### Whether anyone is safe

The board holds **declarations**: someone said they were going out, for roughly this long,
in roughly this area. An operator can set routine check-ins to `Never` and be correctly
shown as active for eight hours with no contact at all. Nothing is wrong; `routine_interval:
null` is deliberate and stays.

We decline to infer safety from any of it. There is no arrangement of missed windows,
inactivity or silence that this system will read as *"they are in trouble"* — that is
invariant 3, and it is not negotiable at any capacity.

**Cost:** the Team Lead wants to *"see who's out and know they got home"* and gets only the
first half. Someone will read "active" as "fine."

**Instead:** every surface showing the board must be built so a declaration cannot be
mistaken for a monitor. That is a wording and layout problem, not a mechanism one, and it is
the Console's hardest design problem.

#### The best argument against this rule, and why it still loses

External RLSH research proposed a server-side check-in timer that escalates on a missed
window — the standard lone-worker pattern, and its authors' highest-value feature. It is
worth writing down why NavCom refuses the one thing every comparable product does.

The strongest form of the argument is not *"it would be useful."* It is
[C37's neighbour, C38](research/constraints.md): **an operator may waive protections for
themselves, never for a third party.** Somebody who arms *"treat my missed window as my
deliberate Distress"*, in advance, knowing exactly what it does, is not having duress
inferred about them — they are consenting to a rule in advance, which is the same shape as
every other opt-in here.

**It loses on the rationale, not the consent.** Invariant 3 is not primarily about autonomy;
it is about alarm fatigue, and the pager is *shared*. A false page spends a finite, common
resource: the willingness of the person on call to believe the next one. So the waiver does
reach a third party after all — the operator two nights later whose real Distress arrives at
a roster that has been woken four hundred times for flat batteries and long dinners. C38
does not authorise that, and `escalation.spec.md`'s paging budget exists because of it.

Three further things would have to be untrue for this to be reversible, and none of them is:

- `escalation.ts` **cannot start a ladder from anything but a received `20911`**. This is
  structural, not conventional — the refusal is in the type, so no client can express the
  invalid case by accident
- the field terminal is silent, and `/terminal/on-call/` states in-product that a Distress
  page is *"the only notification NavCom ever sends."* Shipping this makes that sentence
  false — and *"A pulse when a signal is acknowledged"*, below, declines a far weaker
  interrupt precisely to hold that line
- the mechanism the proposal actually wants **already exists without the alarm**: a buddy is
  told, per recipient, that somebody is watching, and sees them go past the time they gave.
  What it adds over that is the page, which is the banned part

**Cost, stated plainly:** an operator who is unconscious, restrained, or has had their phone
taken cannot summon help, and NavCom will not notice. That is the same cost already recorded
under *"Storing your emergency contact on the node"*, and it is the real one. Somebody will
be hurt in a way a timer would have caught, and the answer is still that a system which cries
wolf is not there on the night it matters.

**Reversing this is a decision about an invariant**, taken by a person, recorded in the
commit that takes it — not an implementation detail, and not something to arrive at by
building toward it one plausible step at a time.

### Whether the accountability log is complete

Tampering is closed by chaining. Selective disclosure is closed by inclusion proofs against
a published root. Backdating is closed by anchoring that root to Bitcoin. **Omission is not
closed, and will not be.** A watch that never writes an
entry publishes a commitment to a log that never contained it, and every proof still
verifies. Counter-signing narrows this to entries the subject saw; it cannot cover an entry
shown to nobody.

**Cost:** an operator can never prove the record is *whole*, only that what is in it was not
edited afterwards.

**Instead:** say so on the screen, above the entries, before they are fetched.

## Things we will not decide

### Disputes between operators

If two people disagree about what happened, NavCom holds **records, not verdicts**. There is
no appeal, no arbitration, no moderation queue, and no role with authority to rule. Nothing
tasks anyone; nothing judges anyone.

**Cost:** real conflicts will happen and the software will be no help.

**Instead:** the log, reviewable by the people it concerns, so an argument at least has
shared facts.

### How old anybody is

Some people in this community started young. An operator five years in can be seventeen, and
the move most likely to matter to them — from a safe neighbourhood and litter to a patrol
with some chance of trouble in it — happens at exactly the age where it matters most.

**NavCom cannot know, and never will.** [`identity.md`](product/identity.md) enumerates what
does not exist anywhere in the system, and date of birth is on that list beside legal name and
home location. There is no account, no verification step, and nothing to attach an age to. So
every safety affordance here is **age-blind by construction** — not by omission.

That forecloses the whole class of things a conventional design would reach for: an age gate,
a different Distress ladder for a minor, a parental view, a warning that fires below some
number. None of them is buildable without collecting the one field invariant 8 exists to
refuse, and collecting it would put a minor's date of birth on a device that can be taken —
which is worse than not knowing.

**Cost, stated plainly:** a seventeen-year-old and a forty-year-old get the same screens, the
same ladder, and the same silence. If age should change what this app does, it cannot.

**Instead:** the things that happen to help are already there for other reasons, and it is
worth knowing they are load-bearing for this case too. The contact rung is device-initiated,
so the parent's number a young operator is most likely to enter **stays on their phone** and
reaches no node — that is `declined.md`'s own refusal of node-held contacts, arriving at the
right answer for a case nobody modelled. And the capability receipt states what is behind you
*before* every sign-on rather than once at setup, which is the closest this design comes to
saying "you are stepping up" without presuming to judge that anyone is.

Whether somebody that age should be doing this is a question for the people around them.
Software that pretended to answer it would be claiming an authority this project spends
`positioning.md` disclaiming.

### A beginner track for children

Older operators tell younger ones — six, ten, thirteen — to train and get ready rather than
go out. **That instinct is right**, and the obvious way to support it is a starter path in
this app: entry-level content, and difficulty tiers to work up through.

It is declined, and the strongest reason is not a rule.

**A difficulty ladder aimed at a twelve-year-old does not redirect them away from
patrolling. Its top rung is the street.** "Beginner" implies an advanced, and the thing at
the end of the progression is the activity everybody in the scenario was trying to delay.
Built well it would be the most compelling on-ramp this community has ever had, in an app
that is free, needs no account, and by design cannot tell how old anybody is — *"How old anybody is"*, above. The better
it worked as a curriculum, the worse it would work as a deterrent.

Three of this project's existing refusals land on it independently, which is usually a sign
the shape is wrong rather than the details:

- **The content.** `CONTRIBUTING.md` names de-escalation, first aid, overdose response and
  rights as the class where *"confident wrong guidance gets someone hurt, and reviewing it
  needs real expertise rather than good intentions."* Writing it for children raises those
  stakes rather than lowering them
- **The ladder.** Tiers a person climbs are refused network-wide — `refusals.ts`'s
  `no-credential-gate`, *"claims describe, they never gate"* — and a visible progression is a
  ranking whatever it is called
- **The mechanics.** *"No streaks, badges, prompts or nudges. Ever."* Those work on children
  better than on adults, which is an argument against, not for

**Cost, stated plainly:** a thirteen-year-old who wants to be useful and is being told to
wait gets nothing from us but a list of other people's courses. That is thin, and the
community's instinct to give them something real is a good one going unserved.

**Instead:** the app's honesty is the intervention. A kid who opens NavCom is told, before
every sign-on, that `Distress` pages nobody — which is more sobering than any curriculum, and
it is already there. Nothing here gamifies going out: no streak, no count, no rank. And
[`community.ts`](https://github.com/Jthora/navcom-app/blob/main/web/src/lib/community.ts)
carries `YOUTH` — real organisations that already train young people, with instructors
qualified to do it, inheriting the same staleness rule as everything else on that page.
A name and a link, which is the whole of what this project should be doing here.

### Summarising a night into a category

External RLSH research proposes an after-action record with an `outcome` field — what
happened, chosen from a list. The pain point behind it is real and well-evidenced: volunteers
stay when work comes in **finite, completable units with a record afterward.**

**NavCom already has that**, which is the reason this is declined rather than deferred. Sign-on
→ stand-down is a completable act with an explicit end, the patrol record is written under the
operator's own callsign whether or not anybody was watching, and the coming-home panel shows
it to them at the moment they finish. The completion signal is not missing.

What an `outcome` enum adds is a prompt to **compress a night into a word**, and three things
are wrong with that here. There is no obviously correct vocabulary, and inventing one shapes
what operators notice — which is why `CLAUDE.md` reserves the directory's `type` taxonomy for
people with local knowledge, and this is the same act aimed at nights instead of places. A
category invites comparison in a system that refuses counts and ranks everywhere else. And
every field added to that record is a field somebody can put a served person into
[invariant 1], which is why `log.ts` made its own outcomes a closed union rather than free
text.

**Cost:** an operator cannot file *what came of it* in any structured way, so nothing can ever
be counted, filtered or compared across nights — including by them. The free-text note carries
it instead, and a note is not searchable.

**Instead:** the note, and the fact that standing down already writes the record. If a
vocabulary is ever wanted, it comes from operators who have run a lot of nights, not from
here.

### Whether an agent is trustworthy

Unverifiability is answered by **limits, not better tests**. A sufficiently good performance
is indistinguishable from the real thing on any test it anticipates, so passing a drill means
*"no evidence found yet"* and never *"verified."*

**Cost:** we cannot tell you the agent is safe. We can only tell you what it is unable to do.

### What goes in a playbook

**Do not generate playbook content.** Confident wrong guidance is the Medic's kill trigger,
and plausible-sounding safety content is worse than none. Field playbooks, directory seed
data and the `type` taxonomy need humans with local knowledge.

**Cost:** the knowledge layer stays thin until people write it.

### Interoperating with an allied agency

The Liaison wants their people visible to ours for one night, then gone — federation without
membership, time-boxed and scoped to an operation. It is a real requirement and it is
genuinely hard.

**There is no allied agency.** Building federation before anyone asks for it is designing
against an imagined counterparty, and the shape they need will be decided by who they turn
out to be.

**Cost:** a joint operation with another group has no tooling and will be run over the phone.

**Instead:** the design stays written down in the roster. Reverse this the day someone asks.

## Things we will not provide

### A 24/7 monitoring centre

Named here because external research files it as *deferred*, and the difference is the whole
point of this page. Commercial lone-worker systems work because somebody is awake in a room
somewhere; a peer watching a timer is materially weaker, and saying so is required rather
than optional.

It is **declined, not deferred**: there is no capacity for it and there is no plan to acquire
any, so putting it on an obligation list would be a promise nobody can keep. See *Uptime*
directly below, which is the same refusal at the level of the box.

**Cost:** stated in full under *Whether anyone is safe* — this system improves the
medium-risk case and does not solve the high-risk one, and nothing here should imply
otherwise.

### Uptime

One box, run by one person, for people they know. There is no SLA, no redundancy for the
watch itself, and no promise that anyone is holding it tonight.

**Dark is a supported state precisely because availability is declined.** That is the trade,
and it is why the watch state is visible before sign-on rather than after.

**Cost:** an operator may go out with nothing behind them. They will know that before they
go, which is the entire point.

### Anonymity that also accrues standing

You can contribute without a persistent identity, or you can build standing that travels
with you. **Not both.** Standing is a history attached to a key; a contribution with no
durable identifier cannot accrue one, and a key that accrues one is pseudonymous rather than
anonymous — linkable across everything it signs.

**Cost:** the Convert has the best directory knowledge in the network and the most reason to
be unlinkable. She has to choose, and the choice is not reversible for anything already
signed.

**Instead:** state the trade at the moment of contribution, in those words. Never write
"anonymous" where "pseudonymous" is what is true.

### Publishing battery level to peers or the watch

Useful-sounding and one small edit away: put a level on the heartbeat, and a peer can tell
*"their phone died"* from *"something happened"*.

**It makes silence interpretable, and the inference runs both ways.** Somebody who goes quiet
at 6% reads as a flat battery. Somebody who goes quiet at 90% reads as *something is wrong* —
and that is a conclusion drawn from an absence, by a worried person, at 2am. Invariant 3 says
duress is never inferred from silence; a field that makes silence look alarming is that
inference wearing a different hat, and it pushes people toward escalating on nothing.
`signals.spec.md` already requires the public case to work this way: a phone whose battery
died must be indistinguishable from one whose owner went home.

**Cost:** a peer genuinely cannot tell the two apart, which is the whole point and is still a
cost. Somebody will worry about a dead battery.

**Instead:** the operator's own phone tells *them*, while they are out, and publishes
nothing. They are the only person who can act on it without guessing about somebody else.
Built — see `battery.svelte.ts`. It is Chromium-only and therefore absent on iOS, which is
stated rather than estimated around.

### Storing your emergency contact on the node

The escalation ladder's contact rung is **device-initiated**: your own phone reaches your own
person, so no number is stored anywhere. The node-initiated version — the box holding phone
numbers for operators and dialling them — is declined.

Storing a roster of operators' personal contacts on one machine is the concentration this
whole design exists to avoid, and it is the single most useful thing a subpoena or a seizure
could find.

**Cost is real and should not be softened:** the case node-initiated uniquely covers is *the
operator cannot act* — unconscious, restrained, phone taken. That is the actual emergency,
and declining this means the ladder cannot cover it.

**Instead:** the ladder reaches on-call humans, and where it cannot, it says so. An operator
who wants coverage for being unable to act should tell somebody where they are going, which
is not a thing software does better.

### Protection from someone holding your unlocked phone

Panic wipe destroys the Wipeable tier. Burn destroys both tiers and the offline caches.
Neither is a secure erase — a browser unlinks storage rather than scrubbing the pages
underneath, there is no OS keystore, and browser history survives both.

**Cost:** a phone taken by someone patient and equipped is a phone taken.

**Instead:** say exactly where the boundary is, on the screen that does the wiping.

### A library of protective-gear print files

External RLSH research proposes hosting STL and CAD files for printable armour, with material
specs, printer settings and cost tiers — strong evidence behind the pain point, and a real
one: gear is expensive and people fund it by donation.

**Three separate reasons, any one sufficient.** `service-worker.ts` precaches everything in
`static/` except `.csv`, so a binary dropped there lands on every operator's phone against a
400MB device floor — the exact thing area pages are deliberately *not* precached to avoid.
Hosting somebody else's CAD is mirroring, which
[`community-continuity.md`](product/community-continuity.md) refuses in favour of linking. And
*"$150 gets you this level of protection"* is a safety claim about equipment nobody here
tested, which is the Medic's kill trigger wearing different clothes.

**Cost:** the strongest-evidenced pain point in that research gets nothing from us, and it is
a real one. Somebody will spend money badly for want of a list somebody else could have made.

**Instead:** it is a good project for somebody with a printer, a test rig and no connection to
this app. Nothing about it needs NavCom, which is the tell.

### Telling you what is findable about your own persona

Proposed as client-side-only, own-persona-only, never persisted — and those three constraints
are not enough, which is why this is here rather than in the build order.

Learning what is *publicly linkable* to a persona means asking third parties: search engines,
image search, the platforms themselves. Those queries correlate the operator's IP and timing
with their own persona **at exactly the services most useful to somebody unmasking them**. The
tool would create the trail it exists to find, and it would contradict
[`build-order.md`](build-order.md) 8.6 — *"leave no trace, and say so"* — which is currently
true.

**Cost:** unmasking is a documented, strongly-evidenced harm here, and an operator who wants
to audit their own exposure gets no help from us.

**Instead:** the half NavCom can honestly do is state what *this app* emits and why — now
written, in [`product/what-leaves.md`](product/what-leaves.md). Auditing the open internet is
not, and that page says so rather than leaving the reader to wonder whether it was forgotten.

### An onboarding flow that replaces a person

The first night is not a software problem. A person who says *"stay behind me, we're not
doing anything clever tonight"* beats any flow, and building the flow would produce exactly
the streaks-and-nudges surface the rules forbid.

**Cost:** the Newcomer needs somebody, and if nobody is available the software will not
substitute.

### A pulse when a signal is acknowledged

The design roster proposed it as the haptic pattern most worth building: two pulses in a pocket
telling an operator their signal landed, without taking their eyes off the street. Silence is
never a response in this protocol, and today the only way to learn an ack arrived is to look.

**Declined.** It fires on *arrival*, and the field terminal is silent. A vibration on an
incoming event is an unsolicited interrupt however welcome the news is, and an ack is the
strongest case anybody will ever make for one — which is exactly why it is the one to refuse.
The line is what stops the next twenty cases, each with a slightly worse argument.

**Cost:** an operator waiting on an answer has to look at the screen to learn it came. That is
a real cost and it is smaller than a terminal that has started interrupting people.

**What is built instead:** pulses that confirm a press the operator just made, in the moment
they made it — including when a held threshold fires, which is the one an operator cannot
otherwise learn without looking. Input feedback, not notification.

---

---

## What is **not** declined, so nobody mistakes this page for a licence

Everything in [`build-order.md`](build-order.md) is deferred, not declined — endorsements,
recovery, propagation, the RelayNode, counter-signing, redundant escalation executors. They
are designed and sequenced. Moving something here requires a decision, and that decision
should be recorded in the commit that moves it.

**Allied interop used to be on that list, and it was a contradiction with the entry above.**
This page declined it; this paragraph called it deferred; `constraints.md` C37 states its
shape as though it were coming. An audit found all three, which is one more reader than it
should have taken. It is **declined** — the entry above has the argument, and C37 describes
what would be built *if* it were ever reversed, not a commitment to build it.
