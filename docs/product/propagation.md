# Propagation

How the network grows. This is a correctness concern, not a marketing one.

## Why it's load-bearing

Most of what makes NavCom worth using needs density that a single city can't provide:

- **Endorsements** only matter when you meet operators you don't already know
- **Presence** is compelling with fifty operators and demoralising with three
- **Portable standing** is meaningless in a network of one city
- **Collective knowledge** is only as good as the number of people keeping it current

A design that can't spread doesn't produce a smaller version of
[the vision](../vision.md) — it produces none of it. Density is a precondition, not a
milestone.

There's also a structural constraint: the project's maintainer is a support operator,
not a field operator, and cannot personally seed twenty cities. **The app has to spread
without its author or it stays a one-city tool.**

## The discipline: honest propagation

Same rule as honest retention. Growth mechanics that manufacture pressure are
disqualifying here — reward-driven recruiting would attract exactly the glory-seeking
personality this community is wary of, and it would poison the endorsement layer
immediately.

**Propagation follows the community's existing trust paths rather than bypassing them.**
Trust here is built in person and through known reputation. The mechanics ride those
rails or they don't exist.

---

## The watch changes what growth means

Density isn't only about field operators. **A Watchtower needs people willing to hold the
board**, and that's a different recruitment problem with a better answer: it opens a post
to people who can't patrol at all — distance, disability, circumstance, or simply being
better at a console than on a street.

That widens the addressable community well beyond people who go out at night, and it's
the most honest pitch the project has: *you don't have to patrol to be useful; someone
has to be watching.*

An agent covers the nights nobody signs up, so a thin roster is survivable while it
grows.

**Two different things are being recruited for here, and the pitch above is only the
first.** Holding the board is one axis. Keeping the box that makes an always-on board
possible — patched, backed up, drilled, up at 3am — is a second, distinct form of service:
the **Stationkeeper** ([roster](../research/ecosystem-roster.md)). Someone can do a great
deal of the second while personally doing very little of the first, and reading the pitch
above as the whole recruiting story undersells them.

## Mechanisms

### 1. Endorsement as invitation — primary

Endorsing an operator who isn't on NavCom yet produces a **claimable credential**. They
receive something that says: someone you worked beside vouched for you, and it's waiting.

This makes the standing system its own distribution channel, and it grows the network
strictly along real working relationships. It is earned rather than solicited — nobody
is asked to recruit anyone.

Design requirements:

- **The credential names no one but the endorser** — *"I vouch for the holder"*, plus a
  scope tag and date, binding to whatever persona claims it. Nobody can create a record
  naming a person who hasn't consented to exist in the system
- **Inspectable offline before claiming**, with no network call until consent
- Claiming requires only generating a persona — no account, no verification step
- **Recognition, not recruitment.** Past tense. Never an invitation to join anything
- **One delivery. No reminders, no expiry.** Nothing accumulates anywhere, because the
  system never holds or delivers it — an expiry would only manufacture pressure
- **The endorser cannot see whether it was claimed.** Declining is silent and permanent

### 2. The artifact that leaves — primary

A scrubbed, well-made recap of an operator's own op, designed to be posted publicly.

This is a convergence: the same feature that stops the Public Face from screenshotting
something with a teammate's callsign in it *is* the thing that makes the project visible
outside its own users. Give him something built to travel and he stops improvising.

Design requirements:

- Contains only the sharing operator's own activity — never teammates' callsigns,
  positions, or presence
- **Never discloses team size or that anyone else was there.** "Team of six" leaks op
  scale and pattern even with every name stripped
- Coarse location at best; no route, no timing detail
- Carries a quiet mark of provenance. No call to action, no download link, no referral code
- Generated on request, never automatically

**Understatement is the aesthetic.** Time, place, activity, what was done — and nothing
more. No impact claims, no "we helped X people," no inflated numbers. This isn't a
compromise between shareable and honest: restraint is what reads as credible, so the
operator with professional standards for their feed and the operator who finds
overstatement distasteful want the same artifact.

The quality bar is set by whoever has the most demanding feed. If it isn't good enough
for them to post, propagation doesn't happen at all — which makes visual design the
mechanism here, not decoration.

### 3. Export to Herocore — primary

Op logs export in a form the community's existing hub accepts. Every exported log lands
where the entire community already reads, which is propagation through the incumbent
rather than against it.

**Primary because the audience is already there.**
[Herocore](../research/prior-art.md) is where RLSH post patrol logs today, which makes it
the shortest path between NavCom existing and the people it's built for knowing that it
does. It also sets the relationship correctly: NavCom captures the patrol as it happens
and hands the record to where the community already gathers. Complement, never compete.

### 4. In-person QR join

Joining a team or an op by scanning a code, face to face. Unspammable by construction,
and it mirrors how trust is actually established here.

### 5. Travel

Operators moving between cities carry the app along real social ties and seed it where
they land. Supported by making cross-city presence and portable standing work well — the
propagation is a side effect of the features being good.

### 6. The directory as a public good

Resource data readable on the open web without installing anything.

Outreach workers, street medics and mutual aid groups find it useful on its own terms;
some become operators.

**This is the bridge, not an apology.** NavCom is built for
[RLSH](../positioning.md) and says so plainly. The directory is the part that's useful to
anyone facing the same night — no install, no account, readable on the open web — which
reaches adjacent communities on their own terms without diluting who the app is for.

---

## Cold start

Mechanisms bring people. They don't bring data — and the first operator in a new city
opening an empty directory is the failure that ends adoption there.

**Any metro seeds automatically from public and open sources**, marked low confidence,
and community correction upgrades it from there. This is honest because the schema
already encodes `method: website` as low confidence and displays it as such.

**Seeded entries must look visibly different from operator-verified ones** — not merely
carry different metadata. Public listings are wrong precisely in the intake-rule
dimensions that matter most, so seeded data that *looks* authoritative is more dangerous
than an empty screen.

**Onboarding offers a verification task.** Verify five local listings — offered once,
never a gate, never repeated. It teaches the app, contributes real local data, and turns
the emptiest moment in a new city into someone's first contribution.

The first operator in a city should find a thin, clearly-imperfect, obviously-useful
starting point — never a blank screen.

Rural regions are the hard case: worst public data *and* fewest operators to correct it.
Expect some areas to stay thin, and don't let the app imply that thinness is failure.

---

## Anti-patterns

Never built, regardless of effectiveness:

- Referral rewards, invite quotas, or unlocks in exchange for recruiting
- Contact list upload or address book matching
- "X people in your area" pressure messaging
- Public growth metrics or operator leaderboards
- Reminders to claim an endorsement
- Anything that makes an operator's standing depend on how many people they brought in

## Open questions

- **Seeding quality by region.** Public data varies enormously between metros. Some
  cities will seed well and some barely at all.
- **Whether the recap is good enough to post.** The artifact only propagates if operators
  actually want to share it. Design quality is the whole mechanism here.
