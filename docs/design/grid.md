# The grid: who reads, who writes, and where

NavCom runs on relays and IPFS nodes that other people keep: The Record on the Jetson, a Raspberry
Pi beside it, the public relays, and whatever Stationkeepers add. This is how NavCom uses them.

Status: **decided 2026-10-06** by Jono, for the Earth Intelligence Network as a whole rather than
for NavCom alone. The parts partners act on are normative in
[`../spec/mission-interchange.spec.md`](../spec/mission-interchange.spec.md) §11; this page keeps
the reasoning. §2 was corrected on 2026-10-08, after the refusal it had argued against was kept and
the commons was decided.

---

## 1. Reading is private; acting is accountable

**A grid relay keeps no record of who reads it.** It is a library's rule, and it holds for everyone
who reads, not only for the people NavCom serves.

It was found, not planned. The landing page reads missions live from The Record, so every visitor
opens a connection there, including somebody looking for a bed tonight, and strfry logs the address
of every connection. Ranked by how harm would actually arrive:

1. **Operators.** Callsigns and personas exist so a volunteer cannot be named. An address log is one
   request to an internet provider away from a legal name
2. **Trust.** If opening NavCom puts you in a log, the people with most reason to fear records stop
   opening it. That cost arrives without any breach
3. **The box.** The Jetson runs an agent that reads outside content all day; anything it can read,
   it can in principle be talked into sending
4. **Legal demands.** Rare, and a log that does not exist cannot be produced

Against that, an address log buys a read-only archive very little. Floods and abuse are handled at
Cloudflare's edge, which keeps its own security log. Writers are few and already accountable through
their keys. Usage needs counts, not addresses.

So: address lines are dropped from relay logs, every write is recorded with its address, key, kind
and verdict, and each relay says so in its NIP-11 document. The mechanics are in the interchange
spec, §11.1.

**What it cannot do.** It does not make a reader anonymous: Cloudflare and NavCom's host still see
addresses, and no page may imply otherwise. It removes the one long-lived copy the grid itself would
hold. Anyone who needs more can read the Pi's mirror over Tor (§4).

**Decided 2026-10-06: location stays on the phone.** NavCom's own host had the same shape of
problem: when a visitor allowed location, the landing page fetched their region's index from
navcom.app at once, so the host's request log could pair an address with the region somebody was
standing in, before they had asked for anything. Location now only places them — which region's
figures Com shows, which region the search starts from — and their region's records load when they
search or pick a region, like any page somebody chooses to read.

---

## 2. Relay lists, inside a commons

**Operator traffic stays on large public relays.** The refusal
`no-operator-traffic-on-a-private-relay` in `packages/core/src/refusals.ts` stands as written
(decided 2026-10-07): presence, `Distress`, signals, corrections, places, cards and invites never
cross a private or allowlisted relay. A squad among thousands of strangers reveals nothing; the same
traffic in a small room tells its operator who is active tonight.

An earlier version of this section withdrew that argument, on three grounds: loading navcom.app
already tells a network observer that somebody uses NavCom; NavCom's kinds are public, so anyone can
subscribe to them on any public relay; and a known member under a no-records policy looked a better
custodian of addresses than strangers who have banned a NavCom test machine and answered with
errors. The first two still hold, and neither changes what a small relay's operator learns. The
third meets §1: a grid relay records every write with its address, so operator traffic there would
put each operator's address, a `Distress` included, in a log on a grid relay.

**So operator traffic follows relay lists inside a commons** (decided 2026-10-08). NavCom keeps a
list of large public relays, each run by a different stranger: no upper cap, a floor of three
independent relays, admission on evidence that is costly to fake, retirement in steps, and changes
that reach phones only by release. The two relays built into `packages/core/src/relays.ts` are its
meeting set, where public work is published and partners read. A watch says where it listens with a
NIP-65 relay list, and a phone follows it only when a key it was handed in person signed it, and
only into the commons. `Distress` goes out on every path: every commons relay this phone has for the
watch. A card publishes no relay list.

**No grid node carries operator traffic while the refusal stands**: not The Record, not the Pi's
mirror, and not a relay a member runs. They are read, and an operator's phone sends them nothing.

The honest weakness: each commons relay sees the addresses and timing of the phones whose watches
use it. Each watch lists two of them, chosen by rendezvous hashing, so no single relay sees every
watch. It still rests on strangers whose policies nobody here can hold them to, which is the cost
of keeping the refusal.

The design, its order and its costs are in [`relay-lists.md`](relay-lists.md).

---

## 3. Declared, then chosen

NavCom does not make demands of nodes it does not run. A node states its policy (what it logs, what
it keeps, what it accepts) in its NIP-11 document and as a signed attestation that Security Beu
checks, and NavCom's client chooses relays whose stated policy fits the traffic. It is
[`attestation.md`](../attestation.md) aimed at relays: belief rests on what a node can show.

The attestation's shape is not settled. Mecha Jono's side is asked to draft it, since Security Beu
already audits every public address hourly.

**That choice covers reads.** While the refusal stands no grid node carries operator traffic (§2),
and the commons admits a relay on what it is seen to do, not on what it declares.

---

## 4. The Pi

A Raspberry Pi 4 beside the Jetson, run by a second person. Mecha Jono's brief sets out its setup,
which was tested on the Jetson; NavCom's companion page adds what was decided here.

- **A mirror of The Record**, read-only, keeping no reader records
- **The first peer of the private IPFS swarm.** A swarm key restricts who can connect; it keeps
  nothing confidential, so nothing goes there that could not have been published openly
- **A Tor onion for the mirror**, from the start, for anyone who needs to read without their address
  reaching anybody, Cloudflare included
- **Its tunnel lives in Jono's Cloudflare account**, and the Pi holds only the connector token. A
  token with tunnel or DNS permissions cannot be narrowed below the account and the zone, so a
  separate key would also reach The Record's own tunnel and name

NavCom reads missions from the mirror and The Record at once (built 2026-10-06; the newest signed
copy of each package wins), and nothing else. A watch cannot list the Pi: the mirror takes no writes,
and the refusal keeps operator traffic off it (§2). A watch the Pi's operator runs must listen on
commons relays for a phone to reach it.

---

## 5. What this replaced

- The note in `packages/core/src/events/kinds.ts` that called kind `30078` the only one that could
  cross a small relay. With the refusal kept it is true again, and the docblock that calls it
  withdrawn is due a correction ([`relay-lists.md`](relay-lists.md) §11)
- The build order's deferral of the RelayNode. Both conditions it waited for were met the same day:
  a public relay failing NavCom, and a second person to run one. It is now declined while the refusal
  stands, since it would be a relay a member runs for operator traffic
  ([`../declined.md`](../declined.md))
- [`map.md`](map.md) §2's account of what The Record learns, which left out the address log
