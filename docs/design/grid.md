# The grid: who reads, who writes, and where

NavCom runs on relays and IPFS nodes that other people keep: The Record on the Jetson, a Raspberry
Pi beside it, the public relays, and whatever Stationkeepers add. This is how NavCom uses them.

Status: **decided 2026-10-06** by Jono, for the Earth Intelligence Network as a whole rather than
for NavCom alone. The parts partners act on are normative in
[`../spec/mission-interchange.spec.md`](../spec/mission-interchange.spec.md) §11; this page keeps
the reasoning.

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

**Open, not decided.** NavCom's own host has the same shape of problem. When a visitor allows
location, the landing page fetches their region's index from navcom.app, so a request log can pair
an address with a region.

---

## 2. Relay lists, not a relay list

**An earlier rule here kept operator traffic on big public relays**, because a crowd of strangers'
events was supposed to hide NavCom's. Checked from first principles it mostly does not hold:

- Loading navcom.app already tells a network observer that somebody uses NavCom. Hiding the relay
  connection adds nothing that observer cannot see
- NavCom's kinds are public, so anyone can subscribe to exactly NavCom's events on any public relay
- What remains is who sees addresses and timing. A known member under a published no-records
  policy is a better custodian than strangers whose policies nobody here has read, and who have
  already banned a NavCom test machine for rate limits and answered with errors

**So operator traffic follows relay lists.** Each Watchtower, operator and publisher declares where
it can be reached (NIP-65 relay lists, NIP-17 inboxes). Clients write there and read from all of
them. Grid nodes and public relays stand side by side: `Distress` goes out on every path, routine
traffic on a few, so no single node sees everything. The two relays built into
`packages/core/src/relays.ts` remain, as the starting point for a device that has no list yet.

The honest weakness: a relay sees whatever is written to it, so a bad node sees its share. Writing
routine traffic to a few relays and auditing the nodes narrows that; it still rests on trusting
members, which the network does anyway.

---

## 3. Declared, then chosen

NavCom does not make demands of nodes it does not run. A node states its policy (what it logs, what
it keeps, what it accepts) in its NIP-11 document and as a signed attestation that Security Beu
checks, and NavCom's client chooses relays whose stated policy fits the traffic. It is
[`attestation.md`](../attestation.md) aimed at relays: belief rests on what a node can show.

The attestation's shape is not settled. Mecha Jono's side is asked to draft it, since Security Beu
already audits every public address hourly.

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
copy of each package wins), and the Pi becomes
one of the places a watch can list once relay lists ship.

---

## 5. What this replaced

- The note in `packages/core/src/events/kinds.ts` that called kind `30078` the only one that could
  cross a small relay
- The build order's deferral of the RelayNode. Both conditions it waited for were met the same day:
  a public relay failing NavCom, and a second person to run one
- [`map.md`](map.md) §2's account of what The Record learns, which left out the address log
