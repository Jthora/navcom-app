# Signals — Spec

Normative. Wire format for field↔watch communication.

## Event kinds

Nostr kinds, chosen so that live traffic is unstored and current watch state is
retrievable by a client that just connected.

| Kind | Range | Name | Why |
|---|---|---|---|
| `10910` | replaceable | **Watch state** | A client opening cold MUST be able to read who holds watch. Replaceable keeps only the latest per node |
| `20910` | ephemeral | **Signal** | `on-station`, `routine`, `query`, `assist`, `stood-down` |
| `20911` | ephemeral | **Distress** | Separate kind so clients and relays can prioritise it independently of routine traffic |
| `20912` | ephemeral | **Response** | Acknowledgements, query answers, escalation status |
| `20913` | ephemeral | **Peer presence** | Who is out, sent operator-to-operator with no watch involved |
| `20914` | ephemeral | **Public presence** | *"Raven is out tonight."* Unencrypted, and structurally cannot carry a position |
| `10911` | replaceable | **Card** | The one artifact an operator may publish about themselves. Signed by a contact key, never the operational one |
| `10912` | replaceable | **Key bundle** | An operator's ML-KEM-768 public key. Published because it is 1184 bytes and a pairing code is 32 |
| `1910` | regular | **Invite** | *"Here is my key. I would like to pair."* **Stored**, because an invite has to wait for somebody who is asleep |

Ephemeral kinds (20000–29999) are not expected to be stored by relays — required by
[C27], since the board MUST NOT become a queryable history.

## Encryption

Every payload here is sealed. Nothing readable crosses a relay, and a relay operator sees
routing metadata only [C36].

Peer presence (`20913`) is sealed to the operator's paired peers. Public presence (`20914`)
is not sealed at all, and carries nothing worth sealing. Everything else is sealed to the
**Watchtower**, not to whoever happens to be holding watch.

### Post-quantum, and exactly what it covers

**Sealed payloads use a hybrid construction: ML-KEM-768 alongside the classical
elliptic-curve exchange, both shared secrets mixed into one key.** If either primitive
survives, the message stays private. This is the same shape TLS 1.3 ships as
`X25519MLKEM768` — the boring, standard answer rather than anything invented here.

Nostr itself is untouched. The event, its tags and its signature are unchanged; only the
content of the envelope differs, and relays never read that anyway.

**How the two secrets are mixed**, because a second implementation cannot guess it and a
CyberDeck is a second implementation:

```
key = HKDF-SHA256(
        ikm  = classical_conversation_key || ml_kem_shared_secret,
        info = "navcom-hybrid-wrap-v1",
        len  = 32
      )
```

The classical half comes first. That order is arbitrary and is therefore **normative** — two
clients that disagree about it derive different keys and cannot read each other, while both
round-trip perfectly on their own, which is the kind of fault that ships. `info` pins this
construction so the same secrets cannot be reused to derive a key for anything else.

**What it covers:** harvest-now-decrypt-later. Traffic captured today cannot be read by a
future quantum computer.

**What it does not cover, and both MUST be stated wherever the first is claimed:**

- **Signatures remain classical.** Nostr requires secp256k1 to sign events, so authorship is
  not quantum-safe. Changing that means leaving nostr entirely
- **Metadata is untouched.** A relay still sees which key published, when, and to whom. That
  is an envelope problem and no cipher solves it

So the honest phrase is **"post-quantum message confidentiality"**, never *"quantum-safe"*.
The first is defensible indefinitely; the second is the claim that gets a project dismissed
by the people whose scepticism it most needs to survive.

> **This section reverses a note written earlier the same day** that said not to build one.
> That note dismissed post-quantum work on a cost estimate — and the cost turned out to be
> much lower than assumed, because `@noble/post-quantum` provides ML-KEM in pure JavaScript
> from the same author as the elliptic-curve library already in use. Same ecosystem, no new
> supply chain. The reasoning about public data and metadata was correct and still stands;
> the conclusion drawn from it was too broad.

**Costs, measured rather than estimated.** The KEM ciphertext is **1088 bytes per recipient
per message** and the public key is 1184 bytes. `@noble/post-quantum`'s ML-KEM-768 is **7.2 KB**
minified and gzipped — the earlier ~15 KB figure was a guess and was wrong by half. A
four-person squad's presence heartbeat goes from a few hundred bytes to about 5 KB every
interval, which is the real cost and the reason it is stated here.

### The KEM key is published, not exchanged in person

An ML-KEM public key is 1184 bytes; a pairing code is 32. Putting it in the pairing QR would
turn a code somebody can scan in the dark on a cheap phone — or read aloud — into a dense
block needing good light and a good camera, and it would do the same to a Watchtower address
handed over on paper. **The part of this system that least deserves a casual change is how
people exchange identity in person.**

So the pairing code is unchanged, and the KEM key is looked up afterwards by pubkey as a
`10912` bundle. It is signed by the operator's own key and a reader MUST check that signature
against the pubkey they already hold, so a relay cannot substitute a key it generated.

### Falling back is allowed, and MUST be reported

A sender whose recipient has published no KEM key **MUST still send**, sealed classically.
Refusing would mean the message that fails to send is a `Distress`.

The worst a hostile relay can do is therefore **withhold** a bundle and force this path. That
is why it is reported rather than silent:

- The operator MUST be told, on a screen they already read, that cover was standard rather
  than hybrid
- It MUST be told **as a note, not a warning**. The message *is* encrypted and nobody can
  read it today; what is missing is cover against it being stored now and opened later. A
  red or amber alert saying "insecure" would be alarming and also false
- It MUST say what would change it. A notice nobody can act on is worry with a colour
- **Silence when cover is hybrid.** A line that is always present is furniture, and furniture
  is not read

Each wrap is self-describing, so one message carries hybrid wraps for the recipients whose
keys the sender has and classical ones for the rest. A squad where one member has not opened
the app still receives everything, and the members who can be covered still are. A relay can
count how many wraps are hybrid — the same class of leak as the wrap count, naming nobody.

**Nothing may claim this publicly until it ships.** The status page states what is built, not
what is planned.

The event `p`-tags the Watchtower pubkey. See [`README.md`](./README.md) for why, and what
it costs.

Sealing to the *Watchtower* rather than to a person is what makes handover free: watch
changes hands without anything being re-encrypted, and a signal in flight during a handover
is still readable by whoever picks it up.

**One Watchtower may be held by more than one key.** A box holds one; a squad with no box
holds one key per phone [`bootstrap.spec.md`](bootstrap.spec.md). Both are supported, and
the wire format is the same either way:

- **One key** — NIP-44 to the Watchtower pubkey, directly
- **Several keys** — the payload is encrypted once under a fresh random key, and that key is
  wrapped separately for each member. The event still `p`-tags the Watchtower pubkey, so a
  sender needs the member list but a relay learns nothing extra

A client MUST NOT be required to know which arrangement is in use before it can send.
Discovering that a Watchtower is squad-held is part of being given its address in person,
the same conversation that already hands over the pubkey and the relay list.

**Membership changes are not retroactive.** Removing a member stops them reading *future*
signals. It cannot un-send what they could already read, and no wording anywhere may imply
otherwise.

## `20910` — Signal

```json
{
  "kind": 20910,
  "tags": [["p", "<watchtower-pubkey>"], ["t", "<signal-type>"]],
  "content": "<nip44( payload )>"
}
```

`signal-type` MUST be one of: `on-station` · `routine` · `query` · `assist` ·
`stood-down` · `log-review` · `distress-ack`

The type is an unencrypted tag so a client can filter without decrypting. This leaks
*that* a signal of a given type occurred, not its content. `distress` is deliberately not
in this set — it gets its own kind so its presence isn't inferable from tag traffic
patterns on `20910`.

### Payloads

**`on-station`**
```json
{
  "area": "string, coarse — neighbourhood or district, never an address",
  "expected_duration": 7200,
  "routine_interval": 3600,
  "share_position": false,
  "position": null
}
```
`position` MUST be null unless `share_position` is true. When present it is coarsened to
~500m by default.

**`routine`** — `{}`. Presence is the message.

**`query`**
```json
{ "text": "bed tonight, has a dog", "area": "string, coarse" }
```

**`assist`**
```json
{ "text": "string | absent", "area": "string, coarse", "urgency": "soon|now" }
```
- `urgency` MUST be present. "I need someone" and "I need someone now" ask for different
  responses, and a watch cannot tell them apart from an absent field. It is one tap
- `text` is **optional**, and this is deliberate: an assist with no text still means *I need
  someone*, and requiring a reason delays the send at the moment sending matters. The watch
  can ask. Named `text` rather than `need` so the same concept has the same name across
  `query`, `assist` and `distress`

**`log-review`** — *"show me what you have written about me"* [C33].
```json
{ "since": 1755300000, "limit": 50 }
```
Both optional. **There is no subject field, and that is the access control**: the node
answers about the pubkey that signed the request, so one operator asking for another's
record is not something the payload can express.

**`distress-ack`** — *"I have this."* The only thing that stops the escalation ladder.
```json
{ "distress_id": "<20911 event id>" }
```
- MUST be an explicit act by a person. A delivery receipt, a read receipt or an app-open
  event MUST NOT be routed into it — someone whose phone buzzed is not someone who woke up
- The executor MUST refuse an ack from a sender who is not on the on-call roster, and MUST
  log the refusal. A ladder that keeps paging is survivable; one stopped by somebody who is
  not coming is not
- An agent MUST NOT acknowledge [invariant 5]

**`stood-down`** — `{}`.

## `20913` — Peer presence

**The one kind that involves no watch at all.** An operator publishes it to the peers they
have paired with, and each peer's device draws its own picture of who is out.

```json
{
  "kind": 20913,
  "tags": [["p", "<peer-pubkey>"], ["p", "<another-peer>"]],
  "content": "<sealed( payload )>"
}
```

```json
{
  "callsign": "Wren",
  "status": "out | stood-down",
  "area": "string, coarse — or null",
  "until": 1755310000,
  "position": { "lat": 0, "lon": 0, "precision_m": 500 }
}
```

### Why a kind of its own rather than another `20910`

A `20910` is addressed to a Watchtower and a watch subscribes to all of them. Peer presence
is addressed to several operators and no watch. Overloading the signal kind would put peer
traffic in front of a watch that cannot decrypt it and has no business seeing that it
exists — so the separation is about who *receives* it, not about tidiness.

### Rules

- **Nobody holds this.** There is no server-side list. Each device keeps what it can decrypt
  and computes its own view, which expires on its own. It MUST NOT be persisted [C27]
- **One event per peer, each signed by a throwaway key.** A single event `p`-tagged to
  everybody is a **social graph published to a public relay** — anyone watching sees that
  this key sends presence to those keys, every minute, forever, which is exactly the
  Doxxer's material. Signing separate events with the real key is no better: a relay
  correlates them by author and rebuilds the same graph.

  So each peer gets an event signed by a fresh key that is discarded immediately, and the
  real sender rides inside the ciphertext. A relay sees unrelated one-off keys publishing to
  unrelated recipients and can link none of them — not across peers, and not across
  heartbeats
- **The inner content is a complete signed event**, not a payload naming its author. A
  payload that merely *says* who it is from can say anything; an inner signature is checked
  with the same function used everywhere else. The wrapper hides who is talking, the
  signature proves it. This is NIP-59's shape, built from primitives already here
- A client MUST refuse presence from a pubkey that is not on its own peer list. Without
  that, anybody who learns a pubkey can put themselves on somebody's screen — and a stranger
  in the list of who is out makes a real peer easy to miss
- **Republished on a heartbeat**, at the same interval as `10910`. Relays do not store
  ephemeral events, so a peer whose app was closed has missed everything sent meanwhile —
  a heartbeat means they see the truth within one interval of opening, and nothing is left
  on a relay to correlate later
- **Absence is never evidence of safety.** A peer who stops publishing reads as **unknown**,
  never as *home* and never as *in trouble*. Same rule as a stale `10910` reading Dark, and
  the same reason: silence is a gap in knowledge, not a fact [invariant 3]
- Standing down MUST publish `status: stood-down` rather than simply stopping. Stopping is
  what a flat battery looks like
- `position` is present only where the operator chose to share it, at the precision they
  chose. **Live only, never a track** — a peer keeps the latest and nothing before it

### What this deliberately is not

Not a feed. A peer view is **current state**: who is out, roughly where, until when. A
history of where anyone has been is the thing the rules forbid outright, and the difference
between the two is one careless `push` in a client.

## `10911` — Card

The only artifact in this system an operator publishes *about themselves*. Optional, absent
by default, and an operator who never publishes one is a complete operator.

```json
{
  "kind": 10911,
  "tags": [["d", "st-louis"]],
  "content": "{\"callsign\":\"Raven\",\"region\":\"st-louis\",\"doing\":\"Water and socks, Thursdays.\"}"
}
```

### Signed by a contact key, never the operational key

**This is normative and it is the reason a card is safe to publish at all.**

A card is signed by a second keypair whose only jobs are to sign the public events here and
to receive invites. It MUST NOT be the key that sends signals, receives peer presence, or is
known to a Watchtower.

The reason is `p`-tag routing. Presence events are `p`-tagged to their recipient in
plaintext — a relay needs that to route them, and it cannot be encrypted. That is harmless
while an operational pubkey is known only to people who scanned it in person. Publish the
same key on a card and it stops being harmless: anyone watching a public relay can count the
events addressed to it and learn when this operator is out, roughly how many peers they
have, and which nights they work. `20913` spends a throwaway key per message to prevent
exactly that, and a card signed by the operational key would hand all of it back.

### What a card may carry

`callsign`, `region`, `doing`. **A reader MUST refuse a card carrying any other field**,
rather than ignoring the extra — refusing is what makes the absence of a position field
enforceable against a client written to a looser idea of this type.

- `region` is a directory region slug: a metro, and there is nothing finer it can name
- Replaceable, so an operator has one card and not a history of cards
- **Withdrawal is discarding the contact key.** The card survives on whatever relays kept
  it. Nothing can unpublish it and no wording anywhere may imply otherwise

## `1910` — Invite

*"Here is my key. I would like to pair."* The fix for cold start: until this existed the
only way to pair was to stand next to somebody.

```json
{
  "kind": 1910,
  "tags": [["p", "<recipient>"]],
  "content": "<sealed: a complete 1910 event signed by the sender's operational key>"
}
```

Wrapped exactly like `20913`: a throwaway key signs the outer event, and the sealed content
is a complete event signed by the sender's real key. The inner signature is what **proves**
the key being offered belongs to the sender — a payload that merely states a pubkey can
state anybody's. Payload is `callsign` and an optional `note`.

**Regular, not ephemeral.** The one kind here a relay is meant to store, because a request
that expires in sixty seconds is not a request.

### An accept is an invite in the other direction

There is one message, not three. A sends to B's **contact key**, read off a card. If B
wants it, B sends back to A's **operational key**, which A's invite carried inside its
ciphertext. Pairing is complete when each holds the other's key.

**There MUST NOT be a decline message.** Ignoring sends nothing, so a sender learns nothing:
not that it was read, not that it was refused, not that the key is live. Somebody who owes a
refusal is somebody who accepts to avoid an awkward one — the same rule as unpairing, which
also tells nobody. It also means there is no pending state to expire or nag about.

## `20914` — Public presence

A name, and nothing else. It exists so the network has a pulse — so somebody opening the app
can see it is real and in use.

```json
{
  "kind": 20914,
  "tags": [["d", "st-louis"]],
  "content": ""
}
```

**Unencrypted, deliberately.** There is no point pretending otherwise: public means public,
and no amount of cryptography protects something published in the clear.

### There is nowhere to put a position, and that is the design

**The content is empty and MUST stay empty.** Not "do not include a position" — there is no
payload at all, at any precision, ever. A rule can be forgotten by a client author at 2am; a
missing field cannot.

This is the same choice made for accountability-log outcomes, for the same reason: a leak
that cannot be expressed does not need to be policed.

### Why the callsign is not in here

An earlier version of this spec put `{"callsign":"Raven","status":"out"}` in the content and
no tag on the event. Both parts were wrong, and the implementation deliberately differs:

- **The callsign lives on the card**, and a reader resolves this event against the card the
  same contact key signed. Repeating it here would create two places a callsign lives and no
  way for them to disagree honestly
- **The `d` tag is load-bearing.** Without it a client must pull every public presence event
  on a relay and filter locally, which does not scale and is wrong for the device floor
- **There is no `stood-down`.** The entry ages off the board by itself. Publishing *"I have
  finished"* would pair a public start time with a public end time, which is a schedule — and
  a phone whose battery died must be indistinguishable from one whose owner went home

- Published only while the operator has a card and asked to be listed
  [`../product/visibility.md`](../product/visibility.md), and only while signed on
- **A name, never a count.** A total invites gaming and tells a reader nothing
- Signed by the contact key, so being listed exposes no more than the card already did

## `20911` — Distress

```json
{
  "kind": 20911,
  "tags": [["p", "<watchtower-pubkey>"]],
  "content": "<nip44( { \"position\": {...}|null, \"area\": \"string|null\", \"text\": \"string|absent\" } )>"
}
```

- MUST be sendable from a locked screen
- MUST be a deliberate action. MUST NOT be generated by a timer, missed window, or
  inactivity [C24, invariant 3]
- Carries last known position where the operator shares position; otherwise `area` carries
  the last declared area, so a responder always has somewhere to start
- Client MUST retry until acknowledged, with backoff, indefinitely. **Only the operator may
  end it** — a client that gives up after N attempts has failed silently, which invariant 2
  forbids. Every attempt is reported to the operator, including ones that never left the
  device

## `20912` — Response

```json
{
  "kind": 20912,
  "tags": [["p", "<operator-pubkey>"], ["e", "<signal-event-id>"]],
  "content": "<nip44( payload )>"
}
```

```json
{
  "type": "ack | answer | escalation-status | log-review",
  "responder": { "kind": "human | agent", "callsign": "...", "pubkey": "hex | absent" },
  "text": "string|null",
  "provenance": { "record_id": "...", "verified": "2026-08-14", "method": "in_person" }
}
```

- `responder.kind` MUST be present and accurate on every response [C25, invariant 5]
- A `log-review` response carries `review: { root, entries[{entry, proof}], more }`. The
  node MUST cap `entries` and set `more` rather than exceeding a relay's message size —
  a response too large to publish is silence, and silence is never an answer
- **A client MUST check `review.root` against a root it saw published itself.** Verifying
  the proofs against the root supplied beside them always succeeds, because the watch
  produced both. A client that renders that as verified has told the operator they checked
  something when they did not
- `provenance` MUST be present on any directory-derived answer [C32, H5]. An answer
  without provenance MUST render as unverified
- Every signal MUST receive at least an `ack`. Silence is never a response

## Acknowledgement windows

*Configurable; defaults given.*

| Signal | Target |
|---|---|
| `on-station`, `routine`, `stood-down` | ack within 60s |
| `query` | answer within 120s; ack within 30s if answer will take longer |
| `assist` | ack within 60s, resolution within 300s |
| `log-review` | answer within 120s. Not urgent — nobody is in the street waiting on it |
| `distress-ack` | 10s. One tap, and somebody is waiting on it as they are waiting on nothing else |
| `distress` | see [`escalation.spec.md`](./escalation.spec.md) |

A missed window is not an error condition. It is displayed to the operator as an
unanswered signal, and it degrades the visible watch state.

## What is NOT here

No free-text chat kind. No threading, no replies to responses, no message history [C2,
principle 2]. A signal is a transaction and it closes.
