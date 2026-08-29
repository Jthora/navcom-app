# The Stationkeeper

Whoever stands up and keeps a box running. Distinct from holding watch —
[named in the roster](../research/ecosystem-roster.md) because the two are different work,
and one had a recruiting pitch while the other didn't.

---

## The pitch you've heard, and the half it leaves out

[`propagation.md`](../product/propagation.md) already says the true thing about holding
watch: *"you don't have to patrol to be useful; someone has to be watching."* That's a real
post for people who can't be in the field — distance, disability, circumstance, or simply
being better at a console than on a street.

Keeping a station is a second, separate kind of service, and it's easy to undercount because
it can be done by someone who barely takes a shift personally. If your box serves a squad, or
Mecha Jono holds most of the board, you may spend far more nights maintaining the thing than
sitting at it. This page is the honest cost of that, written down before you decide, because
nobody had written it down at all.

## What it actually requires

**Not much technical depth — some.** Today, before any turnkey tooling exists
([`build-order.md`](../build-order.md), 9.4), this means editing a TOML config file and
running a daemon from a command line. If you've never done that, it's learnable in an
afternoon; if the phrase itself is unfamiliar, get someone to sit with you the first time,
the same as you would for anything else here.

**Not a dedicated machine.** The reference deployment is a Jetson running four services, but
you don't need one. Only two things need to run on hardware you personally control — a box
at home, or a rented VPS, either is fine: the watch state machine and the escalation
executor, because both hold the Watchtower's own key. A relay can stay the public default;
somebody else can host it for you.

**Not patrol experience, and not permission from anyone.** Standing up your own Watchtower is
the founder case — nobody has to endorse you into existing.

## What it actually costs

**Uptime you're honest about, not uptime you promise.** [Dark is a supported
state](../declined.md) — *"one box, run by one person... there is no SLA."* Going Dark
sometimes is not a failure of the arrangement; it's the arrangement. What you owe the people
who rely on you is not "always up," it's telling the truth about when you're not.

**Drills that will fail, and that's the finding, not a bug.** The weekly escalation drill
runs whether or not anyone is on-call, and it reports failure honestly until a real human is.
If you stand up a station with nobody on-call yet, expect a red drill every week — that's the
system working correctly, not something wrong with your setup.

**Backups, and an honest limit on what they cover.** The daemon's key is a file on disk
(`watchtower.key`), and nothing here backs it up for you. Lose it and the watch it identified
is gone — everyone who relied on it starts over with a new one. Copy it somewhere only you
can reach, the same way you'd protect anything whose loss is not recoverable.

**Being the highest-privilege position in the system.** Whoever holds a station sees who's
out, where roughly, and when they last made contact. That access is [logged and reviewable
by the operators it concerns](the-watch.md) — not because you're distrusted, but because
nobody here is trusted just by holding a title, agent or human.

**Being paged, if you're also on-call.** Keeping the station running and being the person who
answers `Distress` are different roles that often land on the same person early on. Know
which one you're actually signing up for.

## What it does not require

Nobody needs your permission and you need nobody's. It doesn't require that most shifts be
yours personally — a squad or another operator can hold the board while you keep the station
under it running. Whether that keeping-it-running work earns its own visible credit, separate
from board time, is an open question this project hasn't answered yet — said plainly so you
know what you're taking on before the recognition model catches up to it.

---

If this is what you want to take on: `packages/watchtower/README.md` has the current
`npm run verify --workspace @navcom/watchtower` path, and the example configs
(`watchtower.example.toml`, `escalation.example.toml`, `pager.example.toml`) are the actual
starting point today — TOML editing and all, until 9.4 makes it shorter.
