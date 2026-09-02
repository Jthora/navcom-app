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

## How to know it is working

This section did not exist, and the word *check* did not appear anywhere on this page. That
was the gap: somebody was being asked to take the highest-privilege position in the system and
given no way to check their own work. The first thing that would have noticed a box publishing
nothing readable was an operator at sign-on, being told Dark.

Four commands, and none of them needs anybody else to be awake.

```
watchtower-daemon --check   /etc/navcom/watchtower.toml
navcom-escalation --check   /etc/navcom/escalation.toml
navcom-escalation --drill   /etc/navcom/escalation.toml
navcom-escalation --review  /etc/navcom/escalation.toml
```

**`watchtower-daemon --check` answers the question you cannot answer for yourself:** *what
would an operator see if they pointed at this box right now?* It publishes nothing and starts
nothing — it reads what is already on the relays, with the same filter and the same reader the
Field Terminal uses, so it cannot quietly disagree with what an operator is actually shown. It
names each relay separately, because being up on one of three is real and otherwise invisible,
and it exits non-zero when an operator would be shown Dark, so it can be a cron line rather
than something you have to remember to read.

When it says Dark it says **which** Dark, because the four causes have four different fixes
and only one of them is "the daemon is not running":

| What it says | What to go and change |
|---|---|
| `absent` | The daemon is not running, or it is publishing to relays this config does not list |
| `stale` | It is running and has stopped republishing, or cannot reach the relays it thinks it can. **The quietest of the four** — everything looks right from the box and every operator reads Dark |
| `corrupt` | Something else is publishing `10910` from this key, or your daemon is a different version than the operators are reading |
| `clock` | This machine's clock has moved backwards. Fix that before trusting anything else here |

If no relay was reachable it says so and declines to blame the daemon, because telling you to
rebuild a working box while your network is down is worse than telling you nothing.

**The middle two are about waking people.** `--check` pages your roster with a test message, so
you learn your channels work from you rather than from somebody's 3am. `--drill` runs the whole
ladder on the same code path a real `Distress` takes — a test mode that exercised something
else would be testing something nobody depends on. Expect the first drill to fail; that is
what it is for.

**`--review` is the fourth, and it is not for you.** It prints one week: the last drill and who
answered it, every escalation with its date, whether the accountability log still verifies, and
who is on call — then a closing **NEEDS A LOOK** section, which on a good week reads *nothing
needs a look*. It exits non-zero only when that section has something in it, so it can be a
weekly cron that stays silent until it shouldn't.

It exists because `CLAUDE.md` asks for a **log reviewer** — *"minutes per week, and it cannot be
the agent or verification is theatre"* — and nobody has taken the job. That is not surprising
when the tooling on offer is `ssh` and a JSONL file. **"Minutes per week" is a claim this
software has to make true before anybody can accept it**, so the command was written before the
reviewer, the same way `--check` was written before a second Stationkeeper existed.

It does not score anybody. Escalations are listed with their dates rather than counted, because
[a number invites gaming](../principles.md) and the only figure it prints is the size of a file.
If you are running a station and no reviewer exists yet, run it yourself and mail the output
somewhere you will read it — but note that a reviewer who is also the Stationkeeper is the
theatre the role was defined to avoid, and the arrangement is a stopgap, not the answer.

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

If this is what you want to take on: `Jthora/navcom-watchtower` is a lightweight, real clone
of just the daemon and CLI — no web app, no docs, no directory data — kept for exactly this.
It's a read-only mirror, refreshed from this monorepo rather than developed on directly
(`packages/watchtower/README.md` has why and how), so it's always current. The example
configs (`watchtower.example.toml`, `escalation.example.toml`, `pager.example.toml`) are the
actual starting point today — TOML editing and all, until 9.4 makes it shorter.
