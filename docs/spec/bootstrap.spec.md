# Bootstrap — Spec

Normative. Identity, configuration, and discovery — the things that must exist before a
single signal can be sent.

## The Watchtower keypair

One secp256k1 keypair identifies a Watchtower. **Its pubkey is the Watchtower address**:
signals are `p`-tagged to it and the `10910` watch state event is signed by it.

Where the private half lives depends on who is holding watch, and there are two supported
answers. Both are first-class; neither is a degraded version of the other.

### On a box

Generated on the node, stored there, never copied off. This is the answer for a watch that
is up all night.

- MUST be generated on the node, not on a laptop and copied
- MUST be readable only by the node processes — file permissions, not a secret store, for MVP

### On the phones of a squad

A squad with no hardware and no technical member is the common case, and requiring a box to
have a watch at all means those squads have none. So the watch may instead be **held in the
app by whoever is awake**, and handed to whoever is awake next.

This requires signals to be readable by more than one key, which is specified in
[`signals.spec.md`](signals.spec.md). Consequences, stated rather than discovered:

- **Every member of the squad can read every signal, on watch or off.** That is the trade,
  and it is only acceptable where the squad already knows who is out — which is what being
  a squad means. It is not acceptable for a wider network
- **The watch is Dark whenever nobody is holding it**, which will be most of the night. Dark
  is a supported state and is reported honestly; it is not a failure of this arrangement, it
  is the arrangement
- Adding a member changes what future signals are readable by. It MUST NOT retroactively
  open past ones

### Common to both

- **Compromise means the whole board is readable.** There is no key rotation story yet; it
  is a Mk1 requirement, not an MVP one, and it is recorded here so nobody assumes one exists
- **The private key is never transmitted to a server.** A phone-held Watchtower key is
  generated in the app and stays there, exactly as an operator's own key already does.
  `navcom.app` serves code, never keys, so there is nothing at the host to subpoena in
  either arrangement

## Starting with no watch at all

**A client MUST be fully usable before any Watchtower is configured**, and MUST NOT present
that state as an error or an incomplete setup.

An operator who knows nobody is the common case, not the edge one. With no Watchtower they
still get the cached directory, their own patrol record, their own emergency contact, and
the ability to pair with peers. A watch is something they **add** when they find one.

Setup therefore asks for a callsign and nothing else. Watchtower pubkey and relays are a
later, optional step.

## Pairing with a peer

Two operators exchange public keys so each can read the other's presence [`signals.spec.md`](signals.spec.md).
No watch, no server and no third party is involved.

- **In person, by QR code**, as the primary path. One shows a code, the other scans it, and
  the scanner's client sends a sealed hello carrying its own key back. The first operator
  accepts. **One scan, and an explicit acceptance** — pairing is mutual and deliberate rather
  than something that happens to somebody
- A link or 64 hex characters are fallbacks. Both are weaker: they travel through whatever
  channel carried them
- Unpairing is unilateral, immediate, and needs no notification. It stops *future* presence
  being readable and cannot recall what was already sent
- A client MUST NOT suggest or rank peers. Discovery is limited to what operators have
  chosen to publish about themselves — see below

## Being findable, or not

**Hidden is the default and it is complete.** An operator who publishes nothing can still
pair by QR, use everything, and be watched. Nothing is withheld from them and nothing
suggests they are half set up.

**Hidden is the absence of an event, not a flag.** There is no "hidden: true" anywhere,
because a stored flag is a thing that can be published by mistake. A hidden operator simply
has no profile on any relay.

Publishing one is a single opt-in, and it carries:

- Callsign
- Optionally a region, at **metro granularity** — *St. Louis* is a city, *Swansea IL*
  narrows somebody to a few thousand people
- That they will accept an invite

It MUST NOT carry an address, a schedule, a position, or who they patrol with. It uses the
standard nostr metadata event, so nothing new is invented and other tools understand it.

### Why this is not the forbidden directory

An earlier rule here forbids a directory of Watchtowers, *"because a list of Watchtowers is
a list of where operators are."* That still holds, and it is about **where the watches
physically live.**

A person choosing to be findable is a different thing, and conflating the two would leave
the most common user — somebody who knows nobody — with no way into the network at all. A
published profile says *"I exist and you may write to me."* It does not say where anyone is.

## Operator keypairs

Generated on the operator's device. Never transmitted, never escrowed, never registered.

The node learns an operator's pubkey the first time it receives a signal from them.

## Who may sign on

**MVP: any pubkey.** The first Watchtower is a closed test among people who know each
other, and an allowlist would be ceremony without security.

**Mk1 MUST NOT ship this.** An open board means anyone who learns the Watchtower pubkey
can place entries on it, consume watch attention, and observe the watch state. Mk1 needs
one of:

- An operator allowlist held on the node, or
- An endorsement check — sign-on accepted from pubkeys presenting a valid credential from
  a known endorser

The second is preferred; it reuses [`../product/identity.md`](../product/identity.md)
rather than adding a second trust mechanism. **Flagged as the largest known gap between
MVP and Mk1.**

## Configuration

**Node** (`watchtower.toml` or equivalent):

```toml
[identity]
privkey_path = "/var/lib/navcom/watchtower.key"

[relays]
urls = ["wss://relay.example", "wss://relay2.example"]

[watch]
routine_interval_default = 3600
overdue_grace = 1800
hard_expiry = 14400

[escalation]
page_window = 300
contact_window = 300

[oncall]
# operators paged when a Distress reaches this watch, up to its paging budget
# a channel is a condition of the role — see opt-ins.md
```

**Client**:

```toml
[identity]
privkey_path = "..."          # device-local

[watchtower]
pubkey = "hex"
relays = ["wss://..."]
```

All timing values *configurable*, defaults per
[`watch-state.spec.md`](./watch-state.spec.md).

## Discovery

**MVP:** the operator is handed the Watchtower pubkey and relay list out of band, and puts
them in a config file. That is honest for a closed test.

**Mk1:** join by QR — a scanned code carrying pubkey and relays, exchanged in person. This
is the same in-person trust path propagation already relies on, so it adds no new
mechanism. See [`../product/propagation.md`](../product/propagation.md).

Nothing auto-discovers a Watchtower. There is no directory of nodes, and there should not
be one — a list of Watchtowers is a list of where operators are.

## Relay selection

**MVP: public relays.** Zero operational burden, works immediately, and self-hosting
before the loop is proven is infrastructure built on a guess.

Accept the tradeoff knowingly: relay operators see that a pubkey published an ephemeral
event of a given kind, when, and how large. They do not see contents. This is the
metadata exposure noted in [`../principles.md`](../principles.md).

**A self-hosted RelayNode is declined while the refusal *no-operator-traffic-on-a-private-relay*
stands** (2026-10-08): a relay a member runs would carry operator traffic in a small room. Operator
traffic stays on large public relays, inside the commons NavCom keeps
([`../design/relay-lists.md`](../design/relay-lists.md), [`../declined.md`](../declined.md)).

## What the node MUST NOT do

- Persist board state to disk [C27]
- Log positions, areas, or query text in the accountability log
- Accept an unsigned or badly-signed event
- Publish anything about an operator to a relay other than the `20912` addressed to them
