# The five things only a person can do

Everything an agent can build alone is built. These five are what is left, and none of them
is a coding task — four need a body outdoors or a device on a network, and one needs somebody
to agree to be woken up.

They are ordered by **value per minute spent**, not by milestone number.

---

## 1. Put one human on call — 10 minutes

**This is the most valuable thing anybody can do to this project.** `Distress` is specified
to terminate in a human or tell the operator it could not. Right now it always tells them it
could not, because the roster is empty. Every weekly drill reports this correctly as a
failure.

### What to do

Pick how you want to be woken. Anything that runs as a command works — the executor never
uses a shell, so nothing in a distress payload can become one.

The simplest thing that needs no account and no provider:

```bash
# Pick something unguessable. Anyone who learns this topic can page you.
curl -fsS -d "test" https://ntfy.sh/navcom-<something-random>
```

Install the ntfy app on your phone, subscribe to that topic, confirm the test arrives.

Then add yourself to `escalation.toml`:

```toml
[[escalation.oncall]]
callsign = "Jono"
channel  = "push"
command  = ["curl", "-fsS", "-d", "{{message}}", "https://ntfy.sh/navcom-<something-random>"]
```

### Prove it

```bash
navcom-escalation --check escalation.toml
```

It pages the whole roster with a message beginning `[NAVCOM TEST -- NOT AN EMERGENCY]`,
reports which commands exited zero, and exits non-zero if any failed or the roster is empty.

**A command exiting zero is not a person waking up.** Go and look at the phone. That second
half cannot be automated and it is the half that matters.

Then run a real drill:

```bash
navcom-escalation --drill escalation.toml
```

A pass requires a human acknowledgement inside the window. Once this passes, `last_drill` on
the published watch state stops being `null` and every operator who signs on can see it.

### Cheap redundancy, once that works

The keyed executor runs on one box that somebody has to keep alive. A **keyless pager** does
the *wake somebody up* half from anywhere — a friend's Raspberry Pi, a $4 VPS, a spare laptop:

```bash
cp packages/watchtower/pager.example.toml pager.toml   # add the Watchtower pubkey
navcom-pager pager.toml
```

It holds **no key**, so it sees that a Distress arrived and nothing inside one, and whoever
runs it is trusted with nothing. Run several. Duplicate pages are a nuisance; a missed page
is not.

> **A note on ntfy:** it is a third party, and your page's text passes through their server
> in the clear. Disclose that to anyone else you put on the roster.

### The better channel, and the one thing in this project that has never been proven

**Web push encrypts the page to keys only your phone holds**, so Google's or Apple's push
service relays a blob it cannot read. It is also the only way to be woken on both platforms
without an app store. It is built and **its delivery has never been observed** — key
generation and validation are tested, an actual page arriving is not.

```bash
navcom-push --keys          # once. Public half is handed over; private half stays put
```

Then on the phone that will be woken — **on iPhone, add NavCom to the Home Screen first,
or none of this exists** — open `/terminal/on-call/`, paste the public half, and copy what
it gives you back to a file on the box. Then:

```toml
[[escalation.oncall]]
callsign = "Jono"
channel  = "push"
command  = ["navcom-push", "--to", "/etc/navcom/oncall/jono.json", "{{message}}"]
```

`navcom-escalation --check` will now page it. **Watch the phone.** If a notification arrives,
that is the first time this path has ever worked, and it is worth writing down. If it does
not, the failure is in the send half and the ntfy command above still works as a fallback —
keep both on the roster, since duplicate pages are a nuisance and a missed page is not.

---

## 2. Two devices, one relay — 20 minutes

Peer presence passes twenty unit tests and **has never crossed a real relay**. The wrapping
is the part nobody has watched work: each message is signed by a throwaway key, so if the
addressing is wrong it is wrong for everybody and no test would know.

### What to do

1. Open `navcom.app/terminal/setup/` on two phones. Give each a callsign
2. On phone A, go to **Peers** and show the QR
3. On phone B, **Scan their code**, name them, **Pair**
4. Reverse it — pairing is not automatic in both directions
5. On phone A, **Sign on**: any area, any duration
6. On phone B, open **Status**

### What you are looking for

- **A's callsign appears on B's status within about a minute.** The heartbeat is 60 seconds
- Stand down on A. B should show them as home — **as a message, not by going quiet**
- Turn A's phone to airplane mode instead. B should say **unknown**, never "home" and never
  anything alarming

### If nothing appears

Both phones default to `wss://relay.damus.io` and `wss://nos.lol`, so they should meet
without configuration. Check the **Peers** screen — it prints the relays in use. A public
relay refusing ephemeral kinds would produce exactly this silence, and trying a third relay
is the fastest way to tell that apart from a bug in the wrapping.

---

## 3. Carry it for one night — one patrol

Three hours in the field finds more than three days of reading. Nothing here is a test with
a pass condition; the point is to notice friction.

### Before you go

- Set a callsign, add **somebody you would call**, and open your metro under **Directory** —
  opening it is what caches it
- Turn the phone to airplane mode and check the directory is still there. If it is not, the
  cache did not take and that is worth knowing before you rely on it

### What to watch for

- **Anything you had to read twice.** The screens are wordy on purpose, and some of that is
  certainly too much
- **Any flow with a step too many**, especially sign-on, which happens when you are already
  moving
- **Anything in the wrong place** — particularly whether `Distress` is where your thumb
  expects it in the dark
- Whether the watch state at the top of Status told you something you could act on, or was
  just a word

### Afterwards

Write down what annoyed you before you rationalise it. The first reaction is the finding.

---

## 4. Ten directory records done properly — 1–2 hours

The scraper produced **479 records across 67 metros**. Nearly all of them are skeletons: they
say a shelter exists, which is the half you can get from a website. They do not say who it
takes at 11pm, which is the half the directory exists for and the half no scraper produces.

**Ten records with real intake rules are worth more than a thousand skeletons.**

### It does not need a body outdoors

The confidence rules already rank a phone call: `in_person` is **high**, **`phone` is medium**,
and `website` — which is what all 479 of these are — is **low**. So this is ten phone calls
from a chair, not ten visits.

There is a tool for it now, and it generates the *questions*, never the answers:

```bash
# what to ask, and who to ask, ordered by where an answer helps most
npm run seed --workspace @navcom/seeder -- calls st-louis --limit=10
```

It reads the region, asks `needsChecking` which fields are blank on each place, skips anything
with no phone number, and puts the places somebody *sleeps* first. Each entry comes with the
questions phrased so you can say them out loud, and the exact command to record what you hear.

```bash
npm run seed --workspace @navcom/seeder -- record st-louis st-louis-our-ladys-inn \
  --by Wren --method phone --on 2026-08-23 \
  --pets "service animals only" --id_required "no ID needed"
```

It **refuses** an empty value, a method the confidence rules cannot weigh, and a missing
callsign — because a field nobody would answer must stay blank, and blank renders as *unknown*,
which is true. It also stamps the provenance when nothing changed, because *"I called and they
confirmed what we had"* is a real result and the commonest one: it moves a record from low to
medium and resets its age.

**Nothing in the tool knows a single fact about a single place.** That is deliberate — a
plausible-sounding `pets: yes` is somebody turned away at 11pm with a dog and nowhere to go.

### What to do

Pick places you actually know in St. Louis, or work the call sheet in order. For each, fill in the fields a website will never
tell you truthfully, in `data/regions/st-louis/resources.csv`:

| Field | What it means |
|---|---|
| `accepts` | Who they actually take — `single_men`, `single_women`, `families`, `youth` |
| `sobriety` | `service_only`, `harm_reduction_ok`, `sobriety_required` |
| `id_required` | Whether somebody with no ID gets turned away |
| `referral_required` | Whether walking up works |
| `curfew` | The time the door actually closes, not the published one |
| `intake_hours` | When you can arrive, which is rarely the same as `hours` |
| `pets` | The single most common reason somebody refuses a bed |
| `belongings` | What they can bring in |
| `notes` | The thing you would tell a person on the phone |

Set `verified_by` to your callsign or `anonymous`, `method` to `in_person` or `phone`, and
`last_verified` to today.

### Rules that are enforced

```bash
npm run check:data --workspace navcom-web
```

- **Nothing about any individual person, ever.** No names, no descriptions, no circumstances
- **No legal names** in `verified_by` — a callsign or `anonymous`
- Anything you did not verify stays **blank**. Blank reads as "unknown"; a guess reads as
  fact, and a confident wrong answer at 10pm is the worst failure this system has

---

## 4b. Promote what operators reported — minutes, weekly

Operators can now correct records from their phones, and those corrections are live on
relays. They reach other operators immediately; they reach `navcom.app` when a person
promotes them.

```bash
navcom-promote --since 7
```

It prints what is waiting, grouped by place, most-reported first, with who said it and how
they know. **It writes nothing.** Read them, decide, and edit the CSV yourself — a tool that
applied corrections would have removed the person this step exists for, and you would find
out by reading a shelter's hours you never approved.

Two people saying the same thing is evidence. One person saying it twice is a correction,
and only their latest word is shown.

---

## 5. Run the daemon and executor together — 30 minutes, needs the Jetson

Both subscribe to `20911`. It has been reasoned that two response streams do not confuse a
client. Reasoning is not the same as watching it.

### What to do

```bash
npm run build --workspace @navcom/watchtower

# Two processes, two supervisor units. If they share a unit, a crash loop in one
# restarts the other and "separate failure domains" becomes a comment.
watchtower-daemon /etc/navcom/watchtower.toml   # terminal one
navcom-escalation /etc/navcom/escalation.toml    # terminal two
```

Both read the same key from `privkey_path`. That is deliberate: the executor decrypts
`20911` itself rather than being handed events by a process that might be hung.

Then raise a real `Distress` from a phone pointed at that Watchtower.

### What you are looking for

- The operator's screen reports **every step as it happens** — paging, no answer, contact,
  exhausted
- **No duplicated or contradictory acknowledgements** from the two processes
- Killing the **daemon** mid-distress does not stop escalation. That is the entire reason
  they are separate processes, and it has never been observed
- The accountability log on disk has the entries, and `--check` still passes afterwards

---

## What none of these are

None of these is a code change, and none is blocked on one. If any of them turns up a bug,
that becomes a normal build item — but the value here is the observation, not the fix.

**Item 1 is worth more than the other four combined.** Until somebody is on call, the
project's first safety guarantee is a mechanism that works perfectly and helps nobody.
