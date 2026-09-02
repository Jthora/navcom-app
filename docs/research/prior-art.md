# Prior Art

What exists, what it teaches, and the technical ground NavCom builds on.

---

## The outreach space

**[Herocore](https://herocore.online)** — Community hub where members post patrol
logs, plus a map of active and inactive individuals and groups.

*Teaches:* patrol logging is already an established behaviour — we don't have to create
the habit, only remove the friction. Herocore captures the patrol afterwards, on a
forum. NavCom captures it as it happens and **exports to Herocore**. Complement, never
compete.

The live URL for this and every other community property is held once, as data, in
`web/src/lib/community.ts` — see [`community-continuity.md`](../product/community-continuity.md).
This page is about what each one *teaches*; that one is about where they are and whether they
are still there. Two copies of an address is how one of them goes stale.

**[mutualaid.fun](https://mutualaid.fun/)** — Intake, outreach, check-in and distribution
for mutual aid. Runs on your own devices, works offline, data stays with the people doing
the work, volunteers join by scanning a QR code.

*Teaches:* the interaction pattern we want, already validated in an adjacent community.
QR-based joining, local data ownership, offline-first. Study before designing.

**211 and official directories** — Listings rot, hours are wrong, and intake rules — pets,
sobriety, ID, curfew — are usually absent entirely.

*Teaches:* the gap is not "a list of shelters." It's *who they'll actually take, tonight*,
maintained by people who were there last night.

*Corroborated externally, 2026-09-02.* Three findings from the information-and-referral field
that were arrived at here independently, and one that was not:

- **No single source is sufficient.** Around 74% of social-service directory records are
  duplicated across databases and only ~25% are unique to any one of them. So a coverage figure
  measured against a single source — OpenStreetMap, say — describes that source, not the world
- **The verification practice is phone calls and monthly line-by-line reconciliation**, described
  by practitioners as *"tedious, unglamorous work"* and *"the single most effective thing a
  housing navigator can do."* That is exactly what `callsheet` and `record` generate, and it is
  a **recurring** act rather than a cleanup — which is what the per-field volatility model
  already assumes
- **The fields that change are eligibility, intake location and waitlist status** — which maps
  onto `id_required`/`sobriety`/`accepts`, `intake_hours`, and `capacity_signal`. `ASK_FIRST`
  independently put `intake_hours`, `pets`, `id_required` and `capacity_signal` in its top four
- **The lag is the opportunity, and it had not been named here.** A new programme appears on an
  agency's own website within a week and takes **three months** to reach the databases
  front-line navigators actually use. An operator adding a place from the field closes that to
  the same night, and that — not coverage — is what this directory can offer that a
  professional one structurally cannot

One convergence is worth stating plainly: New York State's Office for the Aging requires
**monthly attestations** from providers, and reports that this produces more reliable listings
than any other mechanism they use. That is [`attestation.md`](../attestation.md)'s primitive,
reached from the opposite direction by people with an institution behind them.

**[HSDS / Open Referral](https://docs.openreferral.org/)** — the AIRS-endorsed exchange format
for exactly this data: organisations, services, locations, schedules, `required_document`,
accessibility, languages.

*Teaches:* there is a standard, and being outside it is a choice rather than an oversight.
Exporting the directory as HSDS would make field-verified records usable by 211s and navigators
instead of ending in a silo. **Deferred, with a trigger:** when there are verified records worth
somebody else's import. Today there is one record with intake hours, and publishing a skeleton
in a respected format would misrepresent it as something the ecosystem could rely on.

**Discord / Signal** — What teams already use for conversation, and it works well.

*Teaches:* don't build chat. Build what a chat app structurally cannot: a signal protocol
with defined responders and response windows, a held board, duress with a guaranteed
human terminus, and knowledge that outlives the scroll.

---

## Watch systems

The closest real analogues to the [watch model](../watch/the-watch.md), and why none of
them is what we're building.

| | |
|---|---|
| **Dispatch / CAD** (EMS, fire) | Closest functional match — a console operator holding a board of units in the field. Institutional, employment-based, and assumes authority over the people it dispatches |
| **On-call rotation** (PagerDuty et al.) | The duty-roster and escalation-ladder mechanics, applied to infrastructure rather than people |
| **Safety check-in apps** (Noonlight, bSafe) | Timer-and-escalation, but with a commercial monitoring centre rather than a peer |
| **Amateur radio net control** | Genuinely close in spirit — a volunteer holds net control for a session, calls stations, keeps a log. Ceremony, discipline, and no hierarchy |

*Teaches:* the escalation ladder is a solved problem — copy it. The **volunteer,
pseudonymous, peer-held** version doesn't exist commercially, because donated console
shifts are unmonetisable and unautomatable. Net control is the nearest living ancestor,
and it's a hobby practice rather than a product.

---

## The TAK ecosystem

The mature reference for team situational awareness. NavCom serves untrained volunteers
rather than trained operators, so the products differ — but the engineering is worth
knowing.

| Product | Notes |
|---|---|
| **ATAK-CIV** | Open source, mature, large plugin ecosystem. Android only. Steep learning curve |
| **iTAK / TAK Aware** | iOS, oriented to civilian first responders, reduced feature set |
| **TAK Tracker** (official) | Send-only, no map. Battery efficient, very limited |
| **TAK Server** | Reach beyond LAN, PKI enrollment, data sync, federation |

**Setup burden is their weak point and our opportunity.** Every TAK client needs a server
stood up and certificates enrolled before it does anything beyond the local network.
Measure NavCom against that: *time from install to seeing your team.* Target under a
minute.

**ATAK already works serverless on a LAN** — ATAK and WinTAK default to UDP multicast
Mesh SA on `239.2.3.1:6969`. Two clients on the same network see each other with no
server and no configuration. TAK Server exists to extend that reach.

### Cursor on Target — the interoperability path

CoT is the standard across ATAK, WinTAK, iTAK and hundreds of tactical apps (MITRE / US
Air Force origin). Speaking it would let NavCom operators appear on the screens of allied
responders during joint incidents.

- Framing: magic `0xbf` + version byte + magic `0xbf` + payload. `0x00` = XML,
  `0x01` = protobuf ("TAK Protocol v1")
- Sizes: XML position update ≈ 400 bytes; protobuf ≈ 150 bytes
- PLI intervals configurable 30 s – 30 min, default 5 min
- **[PyTAK](https://pytak.readthedocs.io/)** — Python asyncio library for building TAK
  clients, servers and gateways. TCP, TLS, UDP unicast/multicast/broadcast, WebSockets

**A CoT ↔ relay bridge** would translate NavCom presence into CoT for allied clients: a
userspace process listening on Mesh SA multicast, republishing to relays as encrypted
ephemeral events, and re-injecting the other direction. No ATAK plugin needed, no Android
work. Bandwidth is negligible — 20 operators at 30 s intervals is ~270 B/s. No prior art
found for CoT over Nostr as of Aug 2026.

Worth building when allied interoperability becomes a real requirement.

---

## Cryptographic foundation

**Identity.** A keypair generated on device is the persona. Nostr's identity model fits
exactly: pseudonymous by construction, no registration, no revocation authority, portable
across relays.

**Live tier.** Ephemeral event kinds (20000–29999) are not expected to be stored by
relays — the correct shape for presence and op state, which must not persist. See
[`../product/data-tiers.md`](../product/data-tiers.md).

**Op traffic.** [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md)
provides adequate encryption for the realistic threat model. Know its stated limits: no
forward secrecy ("when a key is compromised, it is possible to decrypt all previous
conversations"), no post-compromise security, no post-quantum security, no deniability.
The conversation key is static per pair.

**Upgrade path.** [Marmot](https://github.com/marmot-protocol/marmot) (MLS over Nostr)
adds forward secrecy and post-compromise security, with an
[audited Rust implementation](https://leastauthority.com/blog/audit-of-white-noise-whitenoise-rs/).
Post-quantum ciphersuites are anticipated but not shipped. Available PQ libraries are
unaudited — `ts-mls` states plainly it has had no formal security audit;
`@noble/post-quantum` was self-audited as of v0.6.1 (Apr 2026).

**Posture.** Encryption protects op traffic and duress alerts. It is not the primary
defence, because the primary threat is doxxing and harassment — and against that,
**holding no identifying data** beats any cipher. Never ship unaudited cryptography on a
security boundary protecting people at risk.

---

## Transports beyond the internet

- **Meshtastic** — X25519 + AES-CCM, 237-byte packet cap. Documented as
  harvest-now-decrypt-later, since PQ key exchange doesn't fit LoRa packets. Ships an
  [official ATAK plugin](https://github.com/meshtastic/ATAK-Plugin)
- **Reticulum / LXMF** — X25519 + Ed25519, genuinely delay- and disruption-tolerant with
  store-and-forward propagation nodes. Runs over LoRa, packet radio, serial, AX.25

For urban outreach, "offline" usually means *cached data with no signal*, which a service
worker solves. Mesh bearers matter for rural operators and for infrastructure failure
during disaster response.

**Design note:** keep encryption **above** the transport, and the weak crypto in both
stacks becomes irrelevant — they're bearers, nothing more.
