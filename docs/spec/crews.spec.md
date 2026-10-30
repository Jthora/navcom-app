# Crews — Spec

Normative for crews, the leaf unit: a handful of people who met, with a roster, an Agreed line and a
log, held on their own phones. Where this and [`../design/groups.md`](../design/groups.md) disagree,
this wins and the narrative is a bug.

**Nothing here is built.** Each part is marked as the mission interchange spec marks its own, so the
confidence of the format never exceeds the confidence of the work:

- **DESIGNED**: decided by the owner (2026-10-09 unless dated otherwise), written in groups.md and
  [`../design/units.md`](../design/units.md), and binding on phase 2
- **PROPOSED**: written to make the design buildable, not yet decided; phase 2 may change it, and
  says so here when it does

Charters, offices and the governance statements a charter allows are units.md's, and are referenced
here, not restated. The crew card is phase 5 and is specified with it. Drafted 2026-10-30; **the
composition is reviewed by somebody who is not its author before phase 2 ships** (groups.md §7, *A
new composition, reviewed first*).

---

## 1. Constants

| Name | Value | Status |
|---|---|---|
| `CREW_ROOMS` | 4, 8, 12, 15. Fixed at founding, never widened | DESIGNED |
| `CREW_ROOM_MAX` | 15. Its own constant: `HOLDERS_MAX = 32` stays the watch's | DESIGNED |
| `CREW_NAME_MAX` | 48 characters | DESIGNED |
| `CREW_TEXT_MAX` | 280 characters: a line, and the Agreed line | DESIGNED |
| `CREW_LINE_TTL` | 604,800 (7 days) after the end of the line's blurred posting day, UTC | DESIGNED |
| `CREW_STATE_TTL` | 2,592,000 (30 days) after the end of the blurred posting day, for states, hellos and welcomes | DESIGNED |
| `CREW_ROTATE_AFTER` | 604,800 (7 days): an epoch at least this old is rotated by the first member to post | DESIGNED |
| `CREW_CODE_TTL` | 600: how long a summary or join code stays good | DESIGNED |
| `CREW_FUTURE_SKEW` | 600: an inner time further ahead of the reader than this does not count until then | DESIGNED |
| `CREW_LOG_SHOWN` | 200 lines, then *Load older* on a tap | DESIGNED |
| `CREW_STATES_PER_DAY` | A per-crew daily cap on states a phone walks; above it the phone stops and says why. Value set by phase 2's measurement | PROPOSED |
| `CREW_PADDED` | The set of padded event lengths for each envelope version and room (§6) | PROPOSED, values from phase 2's length test |

Durations are in seconds, as every spec here gives them. **Room 15 is a decision, not a limit of
the wire** (groups.md §5, *Room*).

---

## 2. Kinds

| Kind | What | Status |
|---|---|---|
| `1913` crew event | The only crew event a relay ever sees: regular, stored, expiring | DESIGNED |
| `20917` crew statement | Never published. Travels only inside a `1913`. In the ephemeral range, like `20915` and `20916`, so one published by mistake leaves nothing stored | DESIGNED |

Neither number appears in any NIP (checked against the NIP repository, 2026-10-30). Both are
allocated in `packages/core/src/events/kinds.ts` when phase 2 builds them.

### `1913` crew event

```json
{
  "kind": 1913,
  "pubkey": "<a key made for this event and thrown away>",
  "created_at": "<a random earlier time within the same UTC day>",
  "tags": [["j", "<the day's route tag>"], ["expiration", "<CREW_LINE_TTL or CREW_STATE_TTL>"]],
  "content": "<crew envelope>"
}
```

- It **MUST** carry exactly one routing tag and one NIP-40 `expiration`, and **MUST NOT** carry any
  other tag: no `p`, no `e`, no relay hint, no client tag.
- **The routing tag is `j`.** DESIGNED that it is one single-letter tag; PROPOSED which letter. The
  design proposed `y`, to be checked against the NIP index before this spec was written. Checked on
  2026-10-30: `y` is used by NIP-69 (kind 38383, the platform that created an order), and `h` by
  NIP-29 groups, whose relays enforce it. No NIP uses `b`, `j`, `o`, `v` or `w`; this spec takes `j`.
  Relays index every single-letter tag alike, so the measurement of 2026-10-29, made with `#y`,
  holds for `#j`.
- `created_at` **MUST NOT** be the send time. It is drawn uniformly from the earlier part of the same
  UTC day, and the expiry is computed from that day, never from the send time.
- It **MUST** be signed by a fresh key that is discarded at once, **except** a member's own line,
  whose key is kept in Wipeable until the line expires so that a NIP-09 deletion stays possible.
- A phone **MUST NOT** sign a `1913` with a contact key, an operational key, a watch key or a crew
  key.

### `20917` crew statement

```json
{ "v": 1, "crew": "<crew id, hex>", "epoch": 7, "t": "state | hello | welcome | line | left | withdraw | sign | <a units.md statement>", "...": "by type" }
```

Signed by the member's crew key; a hello by the joiner's new crew key. **Never** by a contact key or
an operational key, and an agent never signs one (§9). It carries no location field of any kind.

---

## 3. Keys

**Crew id**: 16 random bytes made at founding, never published, carried only inside ciphertext.
DESIGNED.

**Crew key**: a fresh secp256k1 key each member makes for each crew. Its ML-KEM-768 key is derived
from it by `kemKeypair` (`pq.ts`), so post-quantum cover needs nothing published. A crew key **MUST
NOT** be any other key this phone holds. DESIGNED.

**Epoch secret `E`**: 32 random bytes per epoch. Three keys are derived from it, with HKDF-SHA256
from `@noble/hashes`. DESIGNED:

```
K_line  = HKDF(E, "navcom-crew-line-v1")
K_state = HKDF(E, "navcom-crew-state-v1")
R       = HKDF(E, "navcom-crew-route-v1")
tag(d)  = hex(HMAC-SHA256(R, crew_id || d))[0:32]      d = the UTC day, "YYYY-MM-DD"
```

`E` **MUST** only ever travel inside a state's wraps or a welcome, addressed to the roster. Every
member's KEM key is known because their hello carried it, so every wrap is hybrid.

**A new epoch starts** on every admission, every removal, every announced leave, and every rotation
due under `CREW_ROTATE_AFTER`. A state that changes no membership (a first signature awaiting a
second, the Agreed line, a rename, card status, a move of relays) keeps the epoch. DESIGNED.

**A phone MUST delete** `E` and `K_line` `CREW_LINE_TTL` after the last day of an epoch, and
`K_state` and `R` `CREW_STATE_TTL` after it. That bounds what a phone seized later can read of what
relays kept; NIP-44 has no forward secrecy of its own. DESIGNED.

---

## 4. Statements

All PROPOSED in their field names; DESIGNED in what each must carry.

| `t` | Carries | Signed by | Sealed under | Clock |
|---|---|---|---|---|
| `state` | `prev` (id of the state it follows), `charter`, `epoch`, `change` (exactly one: admit, remove, leave, rotate, rename, agreed, relays, card, or a units.md change), `roster`, `agreed`, `was` (the Agreed line it replaced, for 7 days), `seal` (the wraps of `E`, when the epoch changes) | As the charter requires; any member for a rotation or a merge | `K_state` of the epoch it follows, under that epoch's tag | State |
| `sign` | One member's signature on an act that needs two, such as an admission or a removal | A member's crew key | Inside a `state` | State |
| `hello` | The joiner's ML-KEM public key, and the join code's nonce | The joiner's new crew key | Classical NIP-44 to the first admitter's crew key, under a tag derived from the nonce | State |
| `welcome` | The charter, the roster with its KEM keys, the relays, the new `E`, the Agreed line, and the admission | The crew key of the admitter who posts it | Hybrid to the joiner's KEM key (`envelope.ts`), under a second tag derived from the nonce | State |
| `line` | Text up to `CREW_TEXT_MAX`, and nothing else | A member's crew key | `K_line` | Line |
| `withdraw` | The id of the member's own line | That member's crew key | `K_line` | Line |
| `left` | That the member left, and said so | The leaver's crew key | `K_state` | State |

**A roster row** holds the member's crew key, the callsign they typed for this crew, their ML-KEM key
(in a state only for a new member; in a welcome for all), and how, when and by whom they were
admitted. **No row says *person*, *human* or *agent*.** Fields units.md adds to a row are units.md's.
**No statement carries a contact key or an operational key**, and no proof signed by both a crew key
and a contact key exists. DESIGNED.

**The Agreed line** is up to `CREW_TEXT_MAX` characters and may carry **one place: a directory record
id or a region id, never coordinates or an address field.** Setting it is a `state`; the newest by
inner time wins, and one dated more than `CREW_FUTURE_SKEW` ahead of the reader does not count until
then. Its previous value and author show for 7 days. DESIGNED.

---

## 5. Codes, never sent over a relay

Neither code contains a secret. Neither is ever published, and a phone **MUST NOT** send either over a
relay. Both are good for `CREW_CODE_TTL`. DESIGNED.

| Code | Prefix | Carries | Status |
|---|---|---|---|
| Summary | `navcom-crew-summary-v1` | Crew name, the charter in words, room and how many are in it, the two relays, whether the crew has or may have a public card, the admitter's crew key. Measured at 443 characters (QR version 16 at medium error correction) with units.md's charter | DESIGNED |
| Join | `navcom-crew-join-v1` | The joiner's new crew key, a 16-byte nonce, the callsign typed for this crew, and an agent flag if the joiner is an agent. No KEM key: 1,184 bytes is too dense for a cheap camera. About 170 characters | DESIGNED |

The joiner reads the summary's rules, room and relays **before** showing anything of their own
(invariant 9). The hello that follows **MUST** be signed by the key the join code named. **The
admission inside the welcome MUST carry the signature of the key the summary named**, whichever
admitter posts the welcome: groups.md's object table says the welcome itself is signed by that key,
its admission steps say the admission carries it, and only the second holds when the other admitter
posts. An admitter's phone **MUST** refuse a join code carrying the agent flag (§9).

---

## 6. Envelope and padding

**The crew envelope is its own format beside the watch's `q:` format, which is untouched.** DESIGNED:
sealing a whole padded state under the epoch key, as `group.ts` nests it, takes room 15 over 65,536
bytes (groups.md §7, measured 2026-10-09). The envelope therefore puts the wraps **beside** the
`K_state` ciphertext rather than inside it, and carries binary values (KEM ciphertexts, keys) in
base64. PROPOSED in its exact field layout, which phase 2 writes here with a version byte.

**Padding.** DESIGNED:

- A state's wraps are padded up to room with real wraps to throwaway KEM keys, in roster order.
- A state's body is padded to one length per room, sized for the largest single change.
- **Hellos and welcomes are padded to the same length as states for the room**, and posted at random
  delays from the state they belong to.
- Lines keep NIP-44's own padding.
- **The padded lengths are protocol constants per envelope version** (`CREW_PADDED`), never a per-crew
  setting. A phone **MUST** emit every `1913` at a length from the published set for its type, and a
  test on the built artifact checks it.

Expected lengths, room 4 / 8 / 12 / 15, from the measurement of 2026-10-09 with the envelope above:
state 13,893 / 21,805 / 31,077 / 38,717 bytes; welcome 16,336 / 29,988 / 40,912 / 46,372; a line
1,529 at any size. Phase 2's length test replaces these with the constants.

---

## 7. Relays and pacing

**Which relays.** Each crew uses two relays, chosen at founding by rendezvous hashing on the crew id
over the list the release ships: `DEFAULT_RELAYS` until the commons exists, the commons after
([`../design/relay-lists.md`](../design/relay-lists.md) §1). The pair travels in the summary code and
every state. DESIGNED.

- A phone **MUST** dial a crew relay only if it is on its own shipped list, whoever signed the code or
  state naming it. Otherwise: *"This crew uses relays this version of NavCom does not know: it needs
  an update."*
- **Never** The Record, its mirror, or any member-run or allowlisted relay: the refusal
  `no-operator-traffic-on-a-private-relay` names crew events.
- *Move relays* is a state naming the new pair explicitly, never recomputed.

**Pacing.** DESIGNED in principle (groups.md §7, measured 2026-10-29); PROPOSED in its numbers:

- A phone **MUST** go through the same per-relay cool-down as the routine beats
  (`web/src/lib/terminal/refusing.svelte.ts`, built 2026-10-29): after `rate-limited:` or a ban, it
  posts nothing more to that relay until the cool-down ends, and never retries into a refusal.
- A phone **MUST NOT** post more than one padded state-length event to a relay within a spacing set by
  phase 2's gentle measurement of relay.damus.io's volume limit. An admission's four events (§8) are
  spread over that spacing and over the three phones.
- A refused write reads *no relay took it*, never *sent*.

---

## 8. Admission, in person

DESIGNED (groups.md §6). Founding is two members, in person, each on their own phone; no crew exists
with one member.

1. A member taps *Admit*; their phone shows the summary code.
2. The joiner scans or pastes it and reads it before showing anything.
3. The joiner types a callsign for this crew. The field starts empty.
4. The joiner's phone makes the crew key and shows the join code.
5. Two members scan it, each on their own phone, at the same meeting. The joiner's phone posts a
   `hello`.
6. The admitters' phones open the hello, check its signature against the scanned key, and show the
   joiner's crew print in fours. *Admit* is hold-to-fire on each. *Ignore* sends nothing.
7. The first phone to hold *Admit* posts its `sign` inside a state that keeps the epoch. The second
   reads it and posts the admission `state`, carrying both signatures and starting a new epoch sealed
   to the new roster, under the old epoch's tag; and a `welcome` to the joiner. All four events are
   padded to one length and posted at random delays.
8. The joiner's phone opens the welcome, checks that the admission carries the signature of the
   admitter key from the summary code, and shows the roster.

**The admission describes; it does not gate.** What a member reads depends only on whom `E` was
sealed to. Without signal, nothing is left half-done: both codes lapse, and the people try again.

**Re-forming** (units.md): two members may found a new crew marked *re-founded from* the old one and
invite former members by their existing crew keys, sealed hybrid to the crew key and KEM key the old
roster holds. A phone accepts an invitation only from a key on a roster it holds. Each accepts with a
fresh key.

---

## 9. Agents

DESIGNED. **No agent holds a crew key.** An admitter's phone **MUST** refuse a join code carrying the
agent flag, with *"This code says it is an agent. Agents don't hold crew keys: their help reaches
crews through missions and the watch."* NavCom's own agent builds **MUST NOT** contain a crews module
or a `1913` signer, and a test on the built artifact checks it. The norm cannot be enforced against an
agent a person smuggles in unmarked; the admission screen says so.

---

## 10. Reading, and walking forward

DESIGNED. **Opening a crew is the only fetch.** It sends one REQ per day's tag since the last read,
walking through any rotation, and closes at EOSE. **No subscription is held**, so no unread count can
be computed (the refusal `no-feed`). A phone always reads for a newer state before it posts.

A returning member walks forward: each state sits under the old epoch's tag, so the phone reads the
old tags, opens the state, derives the next epoch's keys and reads again. Away longer than
`CREW_STATE_TTL`: *"This crew has moved on since this phone last read it. Ask two members to admit
you again, in person."*

**Validity**, PROPOSED (so a seized key or a hostile insider cannot drain members' prepaid data):

- a rotation less than `CREW_ROTATE_AFTER` into its epoch is void unless it changes membership;
- each member has at most one open act awaiting a second signature;
- above `CREW_STATES_PER_DAY`, phones stop walking forward and say why;
- a removal voids every pending act and signature from the removed key;
- once a phone holds a state that removes a key, it shows nothing signed by that key that it had not
  already shown.

---

## 11. Removal, crossing and leaving

DESIGNED (groups.md §7).

**Removal is only by the charter, and never automatic.** No timer, count or missed deadline removes
anybody, and membership never lapses for quiet. The state that removes a key starts a new epoch sealed
only to those who remain.

**When two states name the same `prev`:**

1. If one removes the key that signed the other, the other is void: removal wins.
2. If each removes the other's signer, neither wins. Both are shown as records with their signers, and
   each person chooses which crew to follow.
3. Otherwise both stand, and the next member to open the crew posts a state combining them. If two
   combining states cross and name the same people, phones follow the one with the lower id.

**No rule picks the lower id when that choice decides who is in**: a lowest-id tie-break can be won by
grinding `created_at`. units.md adds one exception to removal wins, for a removal that crosses an open
vote.

**Leaving.** *Leave quietly* deletes the crew from this phone and sends nothing. *Leave and say so*
sends a sealed `left` and deletes the crew; the next remaining member to open it starts a new epoch,
and a leaver never holds that epoch's secret. Neither touches anything outside the crew, or standing.

---

## 12. On the phone

DESIGNED (groups.md §8). Rosters, epoch keys, the member's crew key and the Agreed line sit in
**Wipeable**, under their own storage keys listed in `keysOf(WIPEABLE)`, and **never in a backup**. A
panic wipe ends every membership; the way back is an ordinary admission in person. The log cache keeps
events exactly as received, sealed under their epoch's line key, at most about `CREW_LOG_SHOWN` per
crew, deleted with the line key, and is the first thing dropped when storage is full.

**Pull-only is enforced.** The crews code **MUST NOT** call `Notification`, `navigator.vibrate` or
`setAppBadge`, play a sound, or register a service-worker push or sync, and a test on the built
artifact checks it. The crews chunk **MUST** be in the service worker's precache list, so the host
cannot see who opens crew screens.

---

## 13. What this does not hide

Said here because a spec that names only its protections overstates them (groups.md §11):

- **A relay sees** the time, the padded size, the day's tag, the expiry, and the address of every
  phone that posts or reads. Before the commons exists, it sees that on the same connection as the
  card and the watch traffic, and can tie them together.
- **States and lines are told apart** by their expiry as well as their size.
- **A member** can keep, copy or show a program anything they read. A member who types the same
  callsign in two crews ties those crews together for anyone who holds both rosters.
- **A phone seized unwiped** reads up to 30 days of rosters and Agreed lines and 7 days of lines still
  on relays, and reads forward until the charter removes its key.
- **The clocks bound only history.** Relays honour NIP-40 at their own discretion; the phone
  forgetting is the only bound NavCom controls.

---

## 14. Before phase 2 ships

From groups.md §15 and this draft:

- this spec reviewed, and the composition (HKDF, HMAC, NIP-44 under derived keys, ML-KEM-768 through
  `pq.ts`, and the crew envelope) reviewed by somebody who is not its author;
- `CREW_PADDED` and `CREW_STATES_PER_DAY` set from phase 2's own measurement, and the pacing spacing
  from a gentle measurement of relay.damus.io;
- the routing letter `j` re-checked against the NIP index at the time;
- the online safety record's organising row, harassment row and overall rating reassessed by a person,
  the Agreed line included;
- units.md's U1 gates.
