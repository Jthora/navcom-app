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
executor, because both hold the Watchtower's own key. The executor also holds a key of its own,
which nothing else on the box may read, so it runs as a user of its own (*The executor's own key*,
below). A relay can stay the public default; somebody else can host it for you.

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

It also asks each relay for exactly what your box asks it for — the subscription every signal
and every `Distress` arrives through — and says which relays answer it. A relay can serve your
watch state to anybody and still refuse that one request (an inbox that wants NIP-42 AUTH, which
neither process does) or take it and never answer. Operators can see the watch there and cannot
reach it. `NO RELAY ANSWERS THE BOX'S SUBSCRIPTION` means that is true of every relay, and the
command exits non-zero; it is printed before the Dark remedy, because a running daemon publishes
nothing where it cannot hear, and that is then the cause of the Dark. A relay that never finishes
connecting is named unreachable after five seconds rather than leaving the command waiting.

When it says Dark it says **which** Dark, because the four causes have four different fixes
and only one of them is "the daemon is not running":

| What it says | What to go and change |
|---|---|
| `absent` | The daemon is not running, or it is publishing to relays this config does not list — or, when the same report says `NO RELAY ANSWERS THE BOX'S SUBSCRIPTION`, it is running and withholding the watch state, because it publishes only where its subscription is answered. Fix the subscription first |
| `stale` | It is running and has stopped republishing, or cannot reach the relays it thinks it can — or, with `NO RELAY ANSWERS THE BOX'S SUBSCRIPTION` beside it, the relays stopped answering its subscription and it stopped publishing there, as it should. **The quietest of the four** — everything looks right from the box and every operator reads Dark |
| `corrupt` | Something else is publishing `10910` from this key, or your daemon is a different version than the operators are reading |
| `clock` | This machine's clock has moved backwards. Fix that before trusting anything else here |

If no relay was reachable it says so and declines to blame the daemon, because telling you to
rebuild a working box while your network is down is worse than telling you nothing.

**The middle two are about waking people.** `--check` pages your roster with a test message, so
you learn your channels work from you rather than from somebody's 3am. `--drill` runs the whole
ladder on the same code path a real `Distress` takes — a test mode that exercised something
else would be testing something nobody depends on. Expect the first drill to fail; that is
what it is for.

Before it pages anybody, `--check` looks at who can end a `Distress`. It prints the watch key and
says whether any relay holds a watch state signed by it — the one way to see from the executor that
it holds the daemon's key, not a copy of some other file; that is a warning, since a daemon not yet
running looks the same. It fails on any on-call entry that uses the watch key or the executor's. With
the executor's own key configured it fails until only the executor's user can read that key, the
daemon's user is set, is not root and does not own it, and every relay takes a test response signed by
each key, sent as the executor sends them; a relay that took neither is warned about, as unreachable.
Once all that passes it prints the watch code to hand to operators. Without the key it says what that
costs and goes on (*The executor's own key*, below). It also names any `navcom-push` entry whose
command cannot yet say what kind of page it is carrying: that entry still pages, but every page,
a repeat and a drill included, reaches the phone looking like a new `Distress`. The template that says
all three is in `escalation.example.toml`.

**`--review` is the fourth, and it is not for you.** It prints one week: the last drill and who
answered it, every escalation with its date, every repeat `Distress` answered with an
acknowledgement somebody had already given, every time the person who gave it was paged again
about one — and whether a channel took it — whether the accountability log still verifies, and
who is on call — then a closing **NEEDS A LOOK** section, which on a good week reads *nothing
needs a look*. A person who could not be paged again is in it, because why the watch could not
reach them is the thing to fix. A dead channel it names; off the roster, a console-only entry and
somebody at their re-page ceiling it cannot tell apart, because the log records only that there was
nothing to try — the executor's output from that moment says which. So is anybody paged again more
than six times in one night, by name: one operator sending through a whole hold pages the person who
acknowledged them six times at most, so more is several operators they acknowledged all still sending
— which is within the rules — or a phone that keeps starting its `Distress` again, or a relay
withholding the watch's answers: worth asking them, and checking the relays. It exits non-zero
only when that section has something in it, so it can be a weekly cron that stays silent until it
shouldn't.

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

**The running processes say the same thing about each relay, once per change.** The daemon,
the executor and the keyless pager each keep one subscription per relay and reopen it by
themselves when it closes, so a box that boots before its network does catches up on its own.
What to look for in their output:

| Line | What it means |
|---|---|
| `[relay] <url> listening` | The relay answered the subscription — end of stored events, or an event — and signals sent there are heard (`[executor]` and `[pager]` say the same for theirs). Said the first time a relay answers, even one that was down at boot |
| `<url> reachable again` | A relay that had been listening, and went, is listening again |
| `<url> unreachable (...) -- retrying` | The connection went, or never came. Nothing sent only to that relay is heard until it answers. Said once, not on every retry |
| `<url> closed the subscription (...) while connected` | The relay is up and closed the subscription without saying why in NIP-01's terms — "subscription limit exceeded", or no reason at all. Not your network. Treat it as a refusal |
| `<url> took the subscription and has not answered in 10s` | Connected, and nothing back: a relay that has hung. Treat it as down. The subscription stays open, and `listening` — or `reachable again`, if it had been listening before — follows if it ever answers |
| `<url> refused the subscription: ...` | The relay is up and said no — a rate limit, a policy. `auth-required` means it wants NIP-42 AUTH, which none of these processes do: pick another relay. On a `[relay]` line — the daemon's — operators reading only that relay see the watch go Dark within five minutes, because the daemon stops publishing there. On an `[executor]` or `[pager]` line the watch stays visible there while a `Distress` sent only there pages nobody: see *What the daemon cannot see yet*, below |
| `[heartbeat] watch state (automated) published on <url> -- k/N relay(s) carry it now` | That relay took the watch state for the first time. It goes only to relays the daemon is listening on, and to each one as soon as it starts listening, so one of these follows each `[relay] <url> listening`; on a healthy box the last says N/N |
| `[heartbeat] <url> refused watch state: ...` / `could not reach <url> to publish ...` | Operators reading that relay see Dark. `NO RELAY ACCEPTED` means everyone does |
| `[heartbeat] LISTENING ON NO RELAY` | The daemon is subscribed nowhere, so it publishes the watch state nowhere and every operator reads Dark. Said on every heartbeat until a relay answers |
| `[pager] watching on k/N relay(s)` | Printed only once a relay has answered. `NOT WATCHING` means no relay is listening — since one stopped, or since the pager started fifteen seconds ago |
| `[signal] dropped: … stamped Ns away` / `[executor] … outside the age window (Ns), ignored` | A signal or `Distress` stamped further from this machine's clock than the age window: replayed by a relay, or sent from a phone whose clock is wrong. Not acted on and not answered. The window is never under five minutes — the daemon refuses a smaller `max_event_age_seconds` at startup, and the executor uses five minutes whenever `paging_window_seconds` is shorter — so if one operator's signals keep dropping, it is their clock, and that phone already reads the watch as Dark. If every operator's do, check this machine's clock |
| `[executor] NO EXECUTOR KEY. ...` | This box has no executor key of its own: every answer that ends a `Distress` is signed with the watch key, which the daemon and the agent beside it hold too. Said at every start until you set one up (below) |
| `[executor] NO WATCH KEY: there is nothing at ...` | The executor did not start: `privkey_path` names no file this user can read. It never makes one — a new key would be a watch no phone knows. Copy the daemon's key there (`ops/systemd/README.md`, 4b) |
| `[executor] made the executor's own key at ...` / `executor key: <64 hex>` | First start with `executor_key_path` set, as a user of its own. Followed by `watch code: https://navcom.app/terminal/setup/#watch=1&...` once the key passes its check: that link, signed by the watch key, is what operators are handed |
| `[executor] NO EXECUTOR KEY at ..., and not making one: ...` | `executor_key_path` is set, there is no key there, and the executor will not make one where the daemon's user could read it — `daemon_user` unset, not a user here, root, or the executor's own user. It runs as a box with no executor key until that is fixed |
| `[executor] THE EXECUTOR'S KEY IS NOT ITS OWN` | Somebody other than the executor's user can read it, the daemon runs as root, or nothing confirms the daemon's user cannot. The ladder still runs, signing with it, and no watch code is printed. Fix what it lists, then run `--check` |
| `[executor] THIS IS A NEW EXECUTOR KEY (...)` | The key file was gone and a new key was made, while the executor's log names an older one. Every phone handed the old key ends no `Distress` on this box until handed the new code. Restore the old key from a backup, or hand out the new code and then remove the `.replaced` file it names; `--check` fails until then |
| `[executor] ON CALL WITH THE WATCH'S OWN KEY: ...` | A roster entry names the watch key. The daemon and the agent hold it, so the executor refuses an acknowledgement or a wake signed with it. Give that person a key of their own |
| `[ladder] ... NO RELAY TOOK THE EXECUTOR'S OWN KEY` | A response went out only as the watch key's copy. A phone given the executor key shows it and does not end a `Distress` on it. `--check` names the relay that refuses the key |
| `[ladder] ... NO RELAY TOOK THE WATCH KEY'S COPY` | A response went out only under the executor's own key. Every phone handed the watch before it named that key heard nothing, so the executor counts it as not reported (`COULD NOT REPORT`). `--check` names the relay that refuses the watch key |
| `[drill] the drill file at ... exists and cannot be read` | The daemon's line: it cannot read what the executor wrote, so it publishes no drill and the watch reads as automated rather than automated-oncall. Usually the file's group, after the executor moved to its own user (`ops/systemd/README.md`, 4b) |
| `[page] BUDGET SPENT -- refused by the first-page budget` | More ladders paged this hour than `max_pages_per_window`: a flood. Pages to the person who acknowledged are not counted and still go |
| `[page] REFUSED by the re-page ceiling` | One person was paged again 24 times in an hour. That is a loop, not a night: the hold ended and a ladder paged the roster, them included. Tell whoever maintains this |
| `[wake] Wren asked the watch to page everyone about ...` | The person paged again asked the watch to wake the others. The hold ended and a ladder paged everyone else on call |
| `[wake] Wren asked about ... -- nobody else on call can be paged, so the hold stands` (or `refused by the first-page budget`) | The request could not widen anything, so it changed nothing: Wren is still the one paged about that operator, and was told so |
| `[executor] Kestrel (push): no "--kind", "{{kind}}" -- ...` | That entry's `navcom-push` command cannot say what kind of page it carries. It still pages |

The daemon's first lines no longer announce that it was listening whatever had happened: each
relay says when it is listening, and the heartbeat says when each relay first takes the watch
state.

**What the daemon cannot see yet.** It withholds the watch state from a relay *it* cannot hear on.
It does not know about the executor's subscription, which is a different process and is kept
that way: a relay that answers the daemon and refuses or ignores the executor still shows a fresh
watch while a `Distress` sent only there pages nobody — the operator's phone says "nobody is
coming" from its own timer. Reading the executor's state, one way, the way the daemon reads its
drill results, is not built. Until it is, run `watchtower-daemon --check`, which asks each relay
for the subscription both processes make, and read the executor's own `[executor]` lines.

## The executor's own key

The daemon holds the watch key, and the agent runs beside the daemon. If every answer that ends a
`Distress` — *"Wren is responding."* — is signed with that key, a phone cannot tell a person's answer
from one the agent made up, and stops sending on either. So the executor holds a key nothing else on
the box can read, signs every response with it, and copies each one under the watch key for phones
handed the watch before. A phone handed the executor's key ends a `Distress` only on an answer that
key signed.

Setting it up:

1. Run the executor as a user of its own, never the daemon's. `ops/systemd/navcom-escalation.service`
   does, and its README (4b) says how to create the user, give it a copy of the watch key, and let
   the daemon read the drill file it writes.
2. In `escalation.toml`, under `[identity]`, set `executor_key_path` to an absolute path in that
   user's directory, and `daemon_user` to the user the daemon runs as — not root.
3. Start it. The first start makes the key, readable only by that user, and prints
   `executor key: <64 hex>` and then `watch code: https://navcom.app/terminal/setup/#watch=1&...`.
   It makes no key where `daemon_user` is unset, unknown, root or its own user, and says so; nor does
   `--check` or `--drill`, ever.
4. Run `navcom-escalation --check` as that user. It fails until only that user can read the key and
   every relay takes both keys, and says what to change; once it passes it prints the watch code too.
5. Hand operators that watch code — scanned or pasted, never typed: the key inside it is checked
   against the watch key's signature, and a mistyped key could never end a `Distress`. A phone handed
   it ends a `Distress` only on an answer the executor signed. Phones not handed it keep the old rule
   and say this watch does not yet name its escalation key.

**Without it, the box runs exactly as it did**, and says at every start and in `--check` what that
costs. Nothing breaks the day you add it: phones handed the watch earlier hear the copies, and end on
them, as they always did.

**A backup of the key is the key.** Keep it the way you keep the watch key — and never somewhere the
daemon's user can read it. If the file is ever lost, the executor makes a new one at its next start and
says so at every start after, naming the old one, until you restore the old key or hand every operator
the new code and remove the record it names.

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
(`watchtower.key`), and so is the executor's own (`executor.key`); nothing here backs either up for
you. Lose the watch key and the watch it identified is gone — everyone who relied on it starts over
with a new one. Lose the executor's and every phone handed it can no longer end a `Distress` on this
box's answers until it is handed the new one. Copy each somewhere only you can reach, the same way
you'd protect anything whose loss is not recoverable — the executor's never where the daemon's user
can read it.

**Being the highest-privilege position in the system.** Whoever holds a station sees who's
out, where roughly, and when they last made contact. That access is [logged and reviewable
by the operators it concerns](the-watch.md) — not because you're distrusted, but because
nobody here is trusted just by holding a title, agent or human.

**Being paged, if you're also on-call.** Keeping the station running and being the person who
answers `Distress` are different roles that often land on the same person early on. Know
which one you're actually signing up for. Answering one has a tail: if the operator's phone keeps
sending afterwards — usually it missed your answer — you are paged again, with a page that opens
`NavCom REPEAT`: at once the first time for each operator you answered, then at most once every five
minutes, one page naming everybody you answered who is still sending, for up to half an hour. That
page opens a screen with one button, to wake the others, which pages everyone else on call about every
operator the page named. Where nobody else can be paged, or too many alerts have gone out this hour, it
changes nothing and says so: you are still the one paged about them.

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
