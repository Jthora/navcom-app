# Visibility

**For the short version of everything below — every kind, what is in the clear, and what a
relay operator can actually learn — see [`what-leaves.md`](what-leaves.md).** This page is the
policy; that one is the wire.

Operators want genuinely opposite things. Some film everything and have a following;
some share nothing and never will. Both get a complete app.

## Presets set toggles — they are never a mode

A preset applies a set of individual switches, once. It is **not** a persistent state the
app enforces afterwards.

- Applied at onboarding, re-runnable any time
- **Never displayed on a persona.** Nobody can see which preset an operator chose, or
  that they chose one
- Every underlying switch stays individually visible and adjustable
- Changing one switch afterwards breaks nothing and creates no inconsistent state

This distinction matters. A global mode bundles independent decisions — flip it for one
reason and you've silently changed four other things. That's how people get exposed: not
by a bad decision, but by a bundled one.

## The three presets

| Preset | Presence | Position in ops | Endorsements | Op recap | Discoverable card |
|---|---|---|---|---|---|
| **Ghost** | off | off | receive only | off | off |
| **Team** | off | opt-in per op | on | off | off |
| **Open** | listed | opt-in per op | on | on | on |

**Team is the default.** Ghost is a complete, fully useful configuration — knowledge
layer, safety kit, personal record, incident log, standing. An operator can run Ghost
forever and never be a lesser user of the app.

## Position never leaves the people watching you

**Whatever presence is set to, position goes only to the watch and to paired peers. There
is no setting that publishes it, and there is no combination of settings that adds up to
one.**

The distinction is **where it goes, not whether it exists**:

| | |
|---|---|
| **Transmitted** | Live position only, never a history, and only to the watch and paired peers |
| **Local** | Whatever the operator chooses to keep. It is their own logbook on their own phone, and it goes nowhere |
| **Exported** | No coordinates at all, at any precision |

An operator keeping their own movements on their own device is a GPS watch, not a
surveillance surface, and it is theirs. What must never happen is that history being
transmitted or published.

This is not caution, it is a failure mode chosen deliberately. Operators forget things.
Somebody will leave position sharing on and broadcast from their kitchen.

- If position can never be public, that mistake shows their home to four people who already
  know where they live
- If position can be public, the same mistake writes their home address into a permanent,
  machine-readable, un-deletable record that anyone can harvest

Same lapse. Wildly different consequence. **A design where the worst mistake stays inside
the trust circle is the one to have.**

Three things bound the window further, and all three are cheap:

- Position rides on being signed on. Stand down and it stops — so nobody broadcasts from
  home unless they are on patrol from home
- Sign-on carries a declared end time, so it expires by itself
- While position is live the app shows it, unmissably and continuously. The same reason a
  phone shows the location arrow

## Two values, not four — and why the other two are not built

The switch specified `off · team · city · network`. What shipped is **off · listed**, and
the difference is deliberate rather than partial:

- **`team` was never a public setting.** Peers seeing each other is peer presence, which
  needs no switch at all — pairing *is* the consent, and it is already built
- **`city` and `network` are indistinguishable at current scale.** Both would publish a name
  to a region board. Shipping two settings that do the same thing teaches an operator a
  distinction the system does not honour, which is worse than one honest setting

Being listed also **requires a published card**, rather than standing as an independent
switch. A name with nothing to resolve it against is not a pulse, it is an unverifiable
string — and two independent opt-ins can drift into a state where somebody broadcasts under
a key they believed they had discarded.

## Public presence is a name, never a pin and never a number

An operator set to `city` or `network` presence is saying *"Raven is out tonight."* That is
all it says.

- **A name, not a count.** *"Three operators out"* invites gaming and tells a reader
  nothing; a name tells them who. Same rule as everywhere else in this system
- **No position, at any precision.** See above
- It exists so the network has a pulse — so somebody opening the app can see it is real and
  in use. That is a genuine need and this is the cheapest honest way to meet it

### A card is signed by a key used for nothing else

Being findable costs **no operational exposure**. A card and its *"out tonight"* are signed
by a **contact key**, generated when the first card is published and used for nothing but
the card and receiving invites. It is never a presence recipient and never known to a watch.

Without that separation, publishing a card would silently undo peer presence: presence is
`p`-tagged to its recipient in plaintext, so a public operational key lets anyone watching a
relay count the events addressed to it and learn when that operator is out, how many peers
they have, and which nights they work.

Withdrawing a card **discards the contact key**. The card survives on whatever relays kept
it — nothing can unpublish it, and the screen says exactly that — but it now names a key
nobody holds and nobody listens on.

**The proof that the network is alive is the directory, not the operators.** A shelter entry
that reads *"checked 3 days ago by Wren"* says the work is being done, by a named person,
recently. A pin only says somebody is standing somewhere. The directory is already public,
already maintained, and exposes nobody.

## The switches underneath

Each is independently settable regardless of preset:

| Switch | Values |
|---|---|
| Presence | **off · listed.** See below — `city` and `network` were specified and are not built, because at current scale they are the same switch |
| Position sharing | off · per-op opt-in (never persistent). **Recipients are the watch and paired peers only** — this switch has no public setting |
| Position precision | coarse · precise |
| Card discoverability | off · team · network |
| Endorsements | receive only · receive and give |
| Op recap generation | off · on request |
| Lightning address | off · on — **outside presets entirely** |

## The watch sees what you sign on with

Signing on for a shift shares area, expected duration and contact times with **whoever
holds the board** — that's the point of being watched, and it's scoped to the watch
rather than broadcast.

- **Ghost operators can still sign on.** Watch sees you're out and roughly where; nobody
  else does. Being watched over and being visible to the network are different things
- Position sharing remains separately opt-in, per session
- Signing on is always a deliberate act. An operator who doesn't sign on isn't watched,
  and the terminal never does it automatically

## Funding sits outside visibility

The operator who most needs donations may be the one who most needs to stay invisible.
Bundling them would force a trade that doesn't actually exist — a Lightning address is a
string shown to whoever the operator chooses, requiring no presence, no position, and no
public artifact.

So it's independently toggleable from every preset, Ghost included. See
[`funding.md`](./funding.md).

## Reducing exposure: say the true thing

Moving toward less visibility is not symmetrical with moving toward more. Anything
already published stays published.

Whenever an operator reduces exposure, the UI states it plainly:

> This changes what you share from now on. It can't unshare what's already out.

A control that implies otherwise is a false promise, and this community will notice.

## Never

- No preset shown on a persona, in a roster, or anywhere another operator can see it
- No "verified" or "public" style badge derived from visibility choices
- No prompt, nudge or suggestion to increase visibility
- No feature degraded to pressure an operator out of Ghost
- **No setting, preset or combination that publishes a position.** Not as an advanced
  option, not behind a warning, not for operators who ask for it
