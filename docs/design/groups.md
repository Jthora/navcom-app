# Groups: profile, search, crews and crew chat

[`com.md`](com.md) designs the stack. This page designs the screens 11.3 still has to put in it:
*"Still to build: profile, groups and chat"* in [`../build-order.md`](../build-order.md).

**A crew is the leaf unit of [`units.md`](units.md).** This page designs its wire, its chat and
where it lives on the phone. units.md designs who leads it, who may admit and remove, terms, recall,
titles, and what sits above it. Neither page restates the other.

What holds it together: **everything here either narrows what the phone already holds, or travels
sealed to the people it names.** A profile shows a card the phone already has. Search reads lists
already on the phone and sends nothing. A crew lives on its members' phones. All a relay ever sees of
it is a padded, sealed event from a throwaway key, under a tag that changes every day. No relay holds
a member list, and no relay can read or enforce one.

Status: **decided 2026-10-09 where the owner decided, proposed everywhere else. Nothing on this page
is built.**

**Decided by the owner, 2026-10-09:**

- **Crews are in, with chat.** The normative sentence in
  [`../spec/signals.spec.md`](../spec/signals.spec.md), *"No free-text chat kind. No threading, no
  replies to responses, no message history"*, is scoped to signals (`20910` to `20912`). A crews spec
  permits one Agreed line, a flat, pull-only log (§9), and the bounded governance statements
  units.md defines, and no other free text. The spec's text was scoped on 2026-10-09, and it says no
  crew kind ships before the crews spec is written, so nothing on this page that carries free text
  can be built until then.
- **A public crew card, held by one member, is allowed** (§10).
- **Crew data is Wipeable and never in a backup** (§8).
- **Post life runs on two clocks, the same for every crew:** lines 7 days, roster states 30 days (§7).
- **Agents hold no crew key and no unit key** (§5).
- **A member's card is shown in person and never stored in the crew** (§6).
- **States are padded to the crew's room** (§7).
- **The log is cached sealed, in Wipeable** (§9).
- **Rooms are 4, 8, 12 or 15.** The owner took this on figures for `group.ts`'s nesting, under
  which a 16-seat state measured 66,041 B, over the 65,536-byte event limit strfry ships with. The
  crew envelope §7 requires would probably fit a padded room 16 (about 41 kB for a state and 48 kB
  for a welcome, extrapolated, not measured). So the cap rests on that decision and the group-size
  research (§5), not on the event limit, and revisiting it is the owner's call.
- **Units:** groups may be hierarchical, with the Earth Alliance as the default top and Independent
  beside it, and eight governance decisions. All of that is in units.md. The one that orders this
  page's work: leaf units and their governance ship first, and teaming up waits for the commons.

**Decided earlier, and binding here:** [`com.md`](com.md), 2026-10-06 (Com is a stack; `Distress`
sits in a layer nothing covers; chat is pull-only; Com screens are code-split; profiles open at full
height). [`relay-lists.md`](relay-lists.md) D1, D3, D4 and D5, 2026-10-07 and 2026-10-08 (the
refusal stands; the commons; no relay list on the card or under any operator key).

**Proposed:** everything else, including every screen, the kind numbers, the derivations, the
crossing rule, the validity rules, the conditions on crew cards, the budgets and the phases. §16
lists what is still open.

**Before crews ship, the online safety record must be reassessed, and again before the log and
crew cards.** [`../product/online-safety-record.md`](../product/online-safety-record.md) rates
grooming and encouraging suicide as low because there is *"no ongoing chat"* and *"no groups,
threads or sustained contact between strangers"*, harassment as low because *"an invite reaches one
person once"*, and organising harm as negligible to low because there is *"no function suited to
organising"*. Crews make each of those premises false, and the overall rating rests on them. Before
crews ship (phase 2, units.md's U1), a person reassesses the organising row, the harassment row and
the overall rating. Before the log (phase 4) and crew cards (phase 5), a person reassesses the
grooming and suicide rows, with the overall rating again. The reassessment is a person's work, not
an agent's.

---

## 1. What it is built on

Every piece below already ships. Nothing in this design replaces any of them.

| Already there | Where | Used here for |
|---|---|---|
| The Com stack: a `Screen` union kept in browser history; screens imported lazily on first open | `web/src/routes/+page.svelte` | Each new screen is a new `Screen` kind |
| One dynamic entry re-exporting the five mission screens | `web/src/lib/components/missions/index.ts` | Split into three entries (§13) |
| A signed-in root that reads storage directly: `holding` counts wipeable `mission_claims` without loading claims code | `web/src/routes/+page.svelte` | The *Crews* row reads storage the same way |
| `Distress` in its own layer, `position: fixed` at the bottom; a viewport meta with no `interactive-widget` | `.distress-layer`; `web/src/app.html` | The keyboard question (§9) |
| Cards: `readCard` refuses any content field outside `CARD_FIELDS`; anything newer rides in tags | `packages/core/src/events/public.ts`, `profile.ts`, `links.ts` | Profiles, and the agent tag |
| Your card and its contact key: `ensureContactKey`, `myCard`, and `withdrawCard`, which throws the key away | `web/src/lib/terminal/card.ts`, editor at `/terminal/card/` | Your profile, and withdraw split in two |
| Callsigns for keys: `namesOf()`, private to its module | `web/src/lib/missions/reports.ts` | Fills the session card cache |
| The region board, and the opt-in public roster capped at 500 | `web/src/lib/terminal/public.svelte.ts`, `web/src/lib/public-roster.svelte.ts` | Search, only after a tap |
| A shareable profile, with proofs checked one tap at a time | `/terminal/who/?k=`; `packages/core/src/events/proofs.ts` | Linked from a profile, not rebuilt |
| Cards navcom.app will not display | `web/src/lib/hidden.ts` | Honoured by every new consumer, crew cards included |
| Invites: kind `1910`, 280 characters, no decline message, ignoring one sends nothing | `packages/core/src/events/invite.ts` | *Write to them*, and the knock on a crew card |
| Peers, under the names you chose | `web/src/lib/terminal/peers.ts` | Search |
| Sealing to several keys: content encrypted once, one unlabelled wrap per holder, cover reported weakest-link | `packages/core/src/crypto/group.ts`; `HOLDERS_MAX = 32` | Delivering each epoch's secret |
| ML-KEM-768 derived from a secp256k1 secret (`kemKeypair`); a one-recipient hybrid seal | `packages/core/src/crypto/pq.ts`, `envelope.ts` | Post-quantum cover with nothing published |
| A fresh throwaway key per message; `created_at` blurred | `packages/core/src/events/presence.ts`, `missions/seal.ts` | The outer signer of every crew event |
| `DEFAULT_RELAYS` (relay.damus.io and nos.lol) and `listable()`, which today refuses only the mission hosts | `packages/core/src/relays.ts` | Crew relays, plus a stricter check |
| The published refusals | `packages/core/src/refusals.ts` | Extended to name crew events |
| `MISSION_PUBLISHERS`, with an `agent` flag | `packages/core/src/missions/package.ts` | The agent mark on profiles |
| Two storage tiers; `panicWipe` deletes Wipeable, `burn` deletes both; backups carry Accruing only, at most 64 keys | `web/src/lib/terminal/storage.ts`, `backup.ts` | Where crew data lives |
| `start()` asks a relay about withdrawals, which tells the relay who endorsed this operator | `web/src/lib/terminal/standing.ts` | Com never calls it |
| QR rendering, and scanning by `BarcodeDetector` with a paste fallback | `@paulmillr/qr`, `web/src/lib/terminal/scan.ts` | The two admission codes |
| Budgets, including the per-visit *Root, later* figure | `web/scripts/budget.mjs`, `web/build/.budget.json` | §13 |
| Event kinds; `1913` and `20917` are unallocated | `packages/core/src/events/kinds.ts` | §7 |

---

## 2. What this covers, and what it does not

- **Profile**, anybody's and your own, and **search**, which only a signed-on phone has.
- **Crews**, the leaf unit: a handful of people who met, with a roster, an Agreed line and a log.
- **Not here:** offices, charters, terms, recall, orders, titles, teaming up, higher units and the
  Earth Alliance. All are [`units.md`](units.md). A body that posts missions in its own name is
  [`economy.md`](economy.md) §6 and 11.5. Standing on profiles is 11.6. Whether a card can be a group
  is taxonomy work that waits for a person ([`../product/profiles.md`](../product/profiles.md) §7).

**Alone is complete.** No screen treats having no crew as setup left unfinished. An operator with no
crew, no peers and no card still gets everything in §3 and §4 that applies to them.

---

## 3. Profile

### Anybody's

A profile opens at full height (com.md §7) as `{ kind: 'profile', h }`, where `h` is a handle that
means something only in this page's memory (see *What the back stack holds*, below).

**Cards come from a session card cache.** It is a map held in memory only, from a contact key to the
newest verified card and the time this phone saw it. Whatever already fetches cards fills it:
`namesOf()` (exported so it can), the region board, the public roster once loaded, and the profile's
own fetch. **The cache is never written to storage**, because a stored cache is a list of whom this
phone looked at.

The fixed slots, with `—` where there is nothing:

| Slot | Reads |
|---|---|
| **Name** | The callsign, with the keyPrint of the key that signed the card served. Marked *agent* when the key is in `MISSION_PUBLISHERS` or the card carries `['l', 'navcom:agent']` |
| **Card** | *from 3 d ago* · *not on this phone* · *unknown: no relay answered* · *no card at this address* · *navcom.app does not display this card* (a hidden key is never even asked for, and no reason is given) |
| **Doing** | Quoted, as the holder's own words |
| **Area** | Metro |
| **Does** | Up to three terms. An unknown term is dropped |
| **Links** | Listed as text. Checking them happens on `/terminal/who/?k=` |
| **Checked** | Always *Nobody has checked this card* |
| **With you** *(only on this phone)* | *paired since 3 Oct, you call them Wren* · *not paired* |

**There is no lit action, because a profile is a readout.** The rail has three controls:

- **Fetch newest** sends one REQ, `{kinds:[10911], authors:[contact], limit:1}`, on `relays()`. The
  line above it reads *"The relays learn that this phone asked for this card."*
- **Write to them** sends the existing invite. Only a signed-on phone has it.
- **Check links** opens `/terminal/who/?k=`, which leaves the map.

**The agent tag goes in a tag, not in content**, because every older cached app would refuse a card
with an unknown content field. Every agent NavCom ships that publishes a card carries it, and the
built artifact is tested for it. The tag can only add the mark. A card without it reads *Nobody has
checked this card*, never *human*.

**Nothing derived is shown.** That rules out:

- crews and units, and any office or title held in one;
- endorsements and watch membership, which sit on the operational key, so showing them beside a card
  signed by the contact key would publish the link the key split exists to prevent;
- standing, until 11.6 lands, and then one slot per kind computed on the viewer's phone, never a
  total. A stranger reads *no history with you*;
- counts, mutuals and suggestions;
- *out tonight*. Public presence (`20914`) is ephemeral and relays do not store it, so a one-off read
  would come back blank as if the person were not out. That would break invariant 7.

### Yours

*You* opens at full height from the Yours screen. It answers one question: *what can other people
see about me?*

| Slot | Reads |
|---|---|
| **Print** | The contact key's print, or *none yet*. Under it: *signs your card*, or *signs your claims and reports; no card* |
| **Card** | Its audience in words: *anyone* · *anyone in Philadelphia* · *only people with your address; your card is still published* · *not published* |
| **Sent** | How long since the last publish, or *not sent: no relay answered* |
| **Signed under this key** *(only on this phone)* | Held claims and history, from wipeable `mission_claims` and `mission_history`. After a wipe: *unknown: this phone forgot in a wipe* |
| **Crews** *(only on this phone)* | By name, with *your card says nothing about them* |
| **Endorsements** *(only on this phone)* | Listed by author, never as a count, with *shown to nobody unless you hand one over*. Links to `/terminal/standing/` |
| **As others see it** | On a tap, the anybody's-profile view, filled by one REQ for your own card. The relay already sees you publish it |

The lit action is **Edit card**, which opens `/terminal/card/`. With no card nothing is lit, and the
rail offers *Publish a card*, described by who would see it. There is never a strength meter, a
completeness bar or a nudge.

### The two honest fixes

1. **A contact key with no card.** Taking part in a mission creates a contact key, though `card.ts`
   says only publishing brings a public identity into existence. The screen says: *"Your claims and
   reports are signed by a key with no card: others see its print and nothing else."* The comment in
   `card.ts` is corrected to say what happens.
2. **Withdraw becomes two acts.** Today withdrawing a card throws its key away, so any claim it
   signed can only lapse. `release()`, `withdrawReplaced()` and `withdraw()` already refuse to sign
   with a key the phone no longer holds and return `card` (11.E, asserted in `claims.test.ts` and
   `reports.test.ts`), so nothing is released under the wrong key. The gap is that the operator finds
   out only after acting.
   - **Withdraw card** asks relays to drop the card with a NIP-09 deletion naming its address, and
     keeps the key, so anything it signed can still be released. The phone stops listening for
     invites to that key.
   - **Retire this print** does what withdraw does today. It is refused while any claim is held or
     any report is inside its seven-day window, and the refusal names which ones and when retiring
     becomes possible.

   Both carry [`../product/visibility.md`](../product/visibility.md)'s line word for word: *"This
   changes what you share from now on. It can't unshare what's already out."*

### What the back stack holds

Com screens live in browser history, and **browser history survives both panic wipe and burn**
([`../declined.md`](../declined.md), *Protection from someone holding your unlocked phone*). So a
screen that names a person or a crew stores only a random handle in history. The key or crew id sits
in a map held in memory, which `panicWipe` and `burn` clear. A screen reached by Back after a wipe or
a reload reads *Not on this phone* and fetches nothing.

---

## 4. Search

**A separate screen, `{ kind: 'find' }`, at half height, opened from the Yours screen, and only on a
signed-on phone.** It never merges with the landing page's directory search, which stays about
places, so somebody typing *shelter* never sees operators. Signed-out visitors keep the existing link
to `/who`.

**It asks nobody, and the typed text never leaves the phone.** There is no NIP-50, and no relay query
is ever built from what was typed. This is the act CLAUDE.md's search-box line allows: it narrows
lists already on the phone, and no person is on the other end of it.

**What it searches, in a fixed order, each result labelled with where it came from:**

1. **Your peers**, under the names you chose.
2. **Your crews:** crew names, and the callsigns on each roster (*Kestrel, in Night Owls*). A roster
   result opens the member row, never a public profile.
3. **Cards already on this phone this session**, from the card cache.
4. **A region board, only after a tap on *Load the Philadelphia board*.** That sends one REQ,
   `{kinds:[10911], '#d':[metro]}`, the same as `/terminal/find`. It names a region, never a person
   and never the typed text.
5. **The public roster, only after a tap on *Also search people listed publicly*.** It reads the
   opt-in label set, capped at 500, and says when the list is partial.
6. **Crew cards on a loaded board**, labelled *crew card*, once phase 5 ships.

**It matches names only:** callsigns, crew names and in-crew callsigns. Four or more hex characters
match a key print. A pasted 64-hex key or a navcom profile link opens that profile from the cache,
with *Fetch newest* on a tap. **It never matches `doing`, `does` terms, links or standing.** *Find a
medic* is a target list ([`../product/verified-capabilities.md`](../product/verified-capabilities.md)
§9), and *firstaid*, *welfare* and *search* are all `does` terms.

Results are grouped by source and sorted alphabetically within each group, with a keyPrint beside
every name. Hidden keys are left out. There are no counts, no ranking and no suggestions.

**When nothing matches, that is a readout too:** *"Nothing on this phone matches. Searched: 2 peers,
1 crew, 14 cards seen this session. The Philadelphia board is not loaded."* It never says *nobody
found*, because that would claim the network is empty when only the phone is.

[`../principles.md`](../principles.md) §2 still says *"no browsing people"*, and its dated note of
2026-10-09 says that narrowing what the phone holds is not browsing.

---

## 5. Crews

### What a crew is

**A crew lives on its members' phones.** Each member's phone keeps one record per crew:

- a random 16-byte crew id, never published;
- a name of 48 characters or fewer, which only ever appears inside ciphertext;
- the charter, chosen at founding from units.md's menu and fixed for the crew's life (units.md lets
  only *Higher* change), and the room;
- two relays;
- the current epoch's keys and number, and the id of the state before it;
- the roster. Each row holds the member's crew key, the callsign they typed for this crew, their
  ML-KEM public key, and how, when and by whom they were admitted. **No row says *person* or
  *agent*.** Fields units.md adds to a row, such as an office or the self-stated service line, are
  units.md's;
- the Agreed line (§9);
- this member's own crew secret;
- for the one member who holds it, the crew-card key (§10).

**Every member makes a fresh key for each crew.** The ML-KEM-768 key is derived from it by
`kemKeypair`, so post-quantum cover needs nothing published. A crew key is never the contact key or
the operational key. So a seized roster names no key that appears anywhere else, and two crews
cannot be tied together by key except on the phone of somebody in both. **That is true of keys, not
of names:** a member who types the same callsign in two crews ties them together for anyone who
holds both rosters.

**Founding is two people, in person, each on their own phone** (units.md). No crew ever exists with
one member.

### Room

**Room is 4, 8, 12 or 15, fixed at founding, shown in the summary code (*room for 12, 5 here*) and
never widened.** Decided 2026-10-09. Standing, writs and tenure never change it; the published
refusal `no-credential-gate` already says so, so no new rule is written. `CREW_ROOM_MAX = 15` is its
own constant, separate from `HOLDERS_MAX = 32`, which stays the watch's cap.

- **Why 15 and not 16.** Rooms stop at 15 by the owner's decision of 2026-10-09, taken on figures
  for `group.ts`'s nesting (16 seats: 66,041 B, over the event limit). The crew envelope this page
  requires (§7) would probably fit a padded room 16: about 41 kB for a state and 48 kB for a
  welcome, extrapolated from the room-12-to-15 slope, not measured. So the cap rests on that
  decision and on group-size research, which puts the largest group in which everyone can have met
  everyone at about this size, not on the event limit. Revisiting it is the owner's call.
  units.md's span of at most 6 follows from the chosen cap.
- **When a crew is full,** *Admit* is not offered. The screen names two ways to split, with nothing
  preselected: *another crew for a different area*, or *another crew for different work*. Growing
  past one crew is teaming up, in units.md.
- **Cost:** no crew of 16. A crew of 3 in room 12 sends a full room-12 state. The ceiling rests on
  research that agrees from several directions, not on any measurement of NavCom's users, so it is
  revisited once crews are in use.

### Agents hold no key

**Decided 2026-10-09: no agent holds a crew key or a unit key.**

- **No row, admission, line or screen says *person* or *human*.** The roster states how someone was
  admitted instead. A field asserting *person* would assert something nothing checks.
- **The admitter's phone refuses a join code carrying the agent flag:** *"This code says it is an
  agent. Agents don't hold crew keys: their help reaches crews through missions and the watch."*
- **NavCom's own agent builds contain no crews module and no `1913` signer**, and a test on the built
  artifact checks this.
- **At admission the screen says:** *"A crew key is held by the person carrying this phone. If a
  program will read this crew for them, don't admit it."*
- **Why:** one useful agent in many crews would be one address linking those crews at the relay, and
  one store that is a roster spanning them all, so seizing it exposes every crew it sits in. An
  always-on agent would also be the first reader of every line, which makes *"Read when somebody
  looks"* false.
- **Cost:** no agent summaries, translations or digests inside crews. The norm cannot be enforced: an
  agent smuggled in by a person appears unmarked. Reversing this needs an agent design that cannot
  become a hub across crews and never reads before a person does, and none exists.

### The screens

| Screen | Height | What it holds |
|---|---|---|
| **Crews** | half | With no crew: *No crew* in neutral ink, and quiet rows of equal weight with nothing lit: *Join in person*, *Start a crew*, and *Crew cards in Philadelphia* (that row only once phase 5 ships). WHY: *"Crews here form in person. Everything in NavCom works without one."*, and a pointer to the about page's list of the community's own hubs (`web/src/lib/community.ts`). With crews: one row per crew, alphabetical, never by activity: the name, *as Kestrel*, and *read 2 h ago* or *not opened since you joined*. **Opening this list fetches nothing** |
| **Crew** | half | Slots: **Agreed**, **Read**, **Roster** (*5 of 12*, a room readout, and the first names), **Rule** (the charter in words, from units.md), **Cover** (*hybrid*, from `coverOf`), **Kept** (*lines 7 days, roster 30 days*), **Relays** (with the line in §7 until the commons exists), **You here** (*as Kestrel, print 3f2a 91c0*). The lit action is *Read*. The rail has *Admit* (only if the charter lets you be one of the two), *Roster* and *Leave* |
| **Roster** | half | Alphabetical rows: crew callsign, crew print in fours, *admitted 3 Oct by Raven and Wren, in person*. If two members share a callsign: *two members are called Raven: prints differ*. **No last-seen, no online state, no activity, no *inactive*** |
| **Member** | full | The same slots. **It never links to a public profile.** It says: *"Want them to know your card? Show it on your phone: Yours, As others see it."* |
| **Start a crew** | half | The founding screen is units.md's: template, shape, room, authority and the rest, each with one line of cost |
| **Join** and **Admit** | full | §6 |

---

## 6. Admission, in person

### The rules are seen before anything is shown back

1. **A member taps *Admit*. Their phone shows the summary code:** `navcom-crew-summary-v1`, the crew
   name, the charter in words, the room and how many are in it, the relays, whether this crew has or
   may have a public card, and the admitter's crew key. **It contains no secret.** With units.md's
   charter it measured 443 characters, QR version 16 at medium error correction, or 481 and version
   17 with a lineage. Whether device-floor cameras read codes that dense is unmeasured.
2. **The joiner scans it** with `scan.ts`, or pastes it where the browser cannot scan, and reads the
   rules, room and relays **before showing anything of their own** (invariant 9). Their screen also
   says: *"Two people should be scanning, each on their own phone. The rules count phones: if one
   person holds both, this crew's rule is one person's."* and *"Anyone admitted can keep, copy or
   show a program what they read here."*
3. **The joiner types a callsign for this crew.** The field starts empty, with *"a callsign, not your
   name"* under it and a one-tap *use my card's name: Kestrel*, whose cost line reads *"anyone who
   sees this roster can look your card up"*.
4. **The joiner taps *Show my code*.** Their phone makes the crew key and shows the **join code**:
   `navcom-crew-join-v1`, the crew key, a 16-byte nonce, the callsign, and an agent flag if the
   joiner is an agent. **It contains no secret and no KEM key:** an ML-KEM public key is 1,184 bytes,
   too dense for a cheap camera reading another phone's screen. About 170 characters.
5. **Two members scan it, each on their own phone, at the same meeting.** Admission always takes two
   members present: under Any two, any two members; in a Led unit, units.md's pair. The joiner's
   phone posts a **hello**: their ML-KEM public key, signed by the new crew key and sealed to the
   first admitter's crew key under a tag derived from the nonce. It is classical NIP-44, because
   everything in it is public material; the seal hides only which key sent it.
6. **The admitters' phones read the hello** and check its signature against the key they scanned.
   Every screen shows the joiner's crew print in fours: *"Their screen should show the same."*
   *Admit* is hold-to-fire on each phone. *Ignore* sends nothing.
7. **The first phone to hold *Admit* posts its signature inside a state**, which keeps the epoch and
   looks like any other state. **The second phone reads it and posts the admission state** carrying
   both signatures, which starts a new epoch sealed to the new roster, under the old epoch's tag.
   It also posts a **welcome**, sealed hybrid to the joiner's KEM key with `envelope.ts`, under a
   second tag derived from the nonce. The welcome carries the charter, the roster with its KEM keys,
   the relays, the new epoch's secret, the Agreed line and the admission. All four events are padded
   to one length and posted at random delays from each other (§7).
8. **The joiner's phone opens the welcome**, checks that the admission in it carries the signature
   of the admitter key from the summary code, and shows the roster. Leaving still costs nothing.

**Without signal, nothing is left half-done.** Both codes stay valid for ten minutes, and the people
can try again. Neither code ever travels over a relay. The four writes from one venue's Wi-Fi share
that venue's per-IP limit on each relay, and a refused write reads *no relay took it*, never *sent*.
*Cost:* an admission at room 15 is about 185 kB of writes, spread over three phones.

### The admission is the credential

It is a statement signed by both admitters' crew keys that names the joiner's crew key, the method
(*in person*) and the date. Members hold it, sealed. **It describes; it does not gate.** What a member
can read depends on whom the epoch secret was sealed to, as with any addressed message, so what
admission describes still gates nothing. `no-credential-gate` was narrowed on 2026-10-09 only for an
office over its own unit's acts (units.md).

### Shown in person, never stored

**Decided 2026-10-09: a member's public card is shown in person and never stored in the crew.**

- No state, welcome or statement ever carries a contact key or an operational key, and no proof
  signed by both a crew key and a contact key exists.
- **Why:** a cheap, voluntary proof becomes expected, so *off by default* only decides who links
  first. A member who links in two crews ties those crew keys together. Stored proofs on other
  members' phones give a seizer signed evidence of who met whom, and cannot be revoked once out,
  which C39 requires.
- **Cost:** roster rows never lead to a public profile in the app. A lasting connection outside the
  crew means pairing in person.
- Tests on the built artifact: no contact key in a state or welcome, and the callsign field starts
  empty.

### After a wipe or a lost phone

It is an ordinary admission, in person, by two members. **The re-admission state preselects removal
of the member's old key**, which the honest owner can never use again and only a finder can; people
may untick it. The roster records how and when someone was admitted, and never says *again*, *after a
wipe*, or counts anything.

### The one remote path: re-forming

**Decided 2026-10-09 (units.md):** two members may found a new crew marked *re-founded from* the old
one, and invite former members by their existing crew keys. Each accepts with a fresh key. It reaches
only keys already admitted in person somewhere, so the in-person rule still holds for every key's
first admission. On this page's wire, the invitation is sealed hybrid to the former member's crew key
and KEM key, which the old roster already holds, and a phone accepts one only from a key on a roster
it holds. This reverses the earlier draft's declined in-app fork.

---

## 7. The wire

### Kinds and objects

| Kind | What | Signed by | Relays | Readable by |
|---|---|---|---|---|
| **`1913` crew event** (new, regular, stored) | The outer layer of every crew event. **Exactly one single-letter routing tag** (`y` proposed, never `h`, checked against the NIP index before the spec is written) and a NIP-40 `expiration`. No `p` tags, no relay hints. `created_at` is a random earlier time within the same UTC day | **A fresh throwaway key per event**, discarded at once, except for your own lines, where it is kept in Wipeable until the line expires so a NIP-09 deletion stays possible | The crew's two relays, only if on the shipped list. **Never The Record, its mirror, or any member-run or allowlisted relay** | **Content:** holders of that epoch's keys. **The relay:** the time, the padded size, the day's tag, the expiry, and the IP of each phone that posts or reads |
| **`20917` crew statement** (never published; in the ephemeral range like `20915` and `20916`, so publishing one by mistake leaves nothing stored) | `{v, crew, epoch, t, …}`, where `t` is `state`, `hello`, `welcome`, `line`, `left`, `withdraw`, `sign`, or a governance statement units.md defines | The member's crew key. Never a contact key or an operational key | None. It only travels inside `1913` | The epoch's members. A hello: the admitter. A welcome: the joiner |
| **State** (a `20917`) | `{prev, charter, epoch, change, roster, agreed, was, seal}`. **One change per state:** admit, remove, leave, rotate, rename, Agreed, move relays, card status, or a change units.md defines. The roster carries a KEM key only for a new member | As the charter requires (units.md). Any member for a weekly rotation or a merge. Never an agent | Posted under the old epoch's tag | The old epoch's members read the state; only the new roster opens the new secret |
| **Sign** (a `20917`) | One member's signature on an act that needs two, such as an admission or a removal, carried inside a state until a second member's state completes it | A member's crew key | Inside a state | The epoch's members |
| **Summary code** (not an event: a QR, or paste) | §6 | Not signed. The welcome that follows must be signed by the key it names | Never sent over a relay | Whoever sees the screen |
| **Join code** (not an event) | §6 | Not signed. The hello that follows must be signed by the key it names | Never sent over a relay | The admitters, and anyone who photographs it |
| **`10911` card** (unchanged) | New optional tag: `['l','navcom:agent']` | The contact key | `relays()`, as now | By visibility tier, as now |
| **`10911` crew card** (phase 5) | §10 | A second contact key held by one member | `relays()` | Anyone |
| **`1910` invite** (unchanged) and **knock** (new path) | *Write to them*; and the knock on a crew card, whose inner event is signed by a one-use reply key (§10) | Outer: a throwaway key. Inner: the sender's operational key, or for a knock the one-use key | As now | The one recipient |
| **`5` deletion** (NIP-09) | Your own line, signed by its throwaway key. *Withdraw card*, naming the card's address | As stated | The crew's relays; the card's relays | Anyone. It names only a key and an event or address |

### Epochs, and the two clocks

Each epoch has a 32-byte secret `E`. Three keys are derived from it:

- the line key, `K_line = HKDF(E, 'navcom-crew-line-v1')`, for lines;
- the state key, `K_state = HKDF(E, 'navcom-crew-state-v1')`, for states;
- the route secret, `R = HKDF(E, 'navcom-crew-route-v1')`.

The tag for day `d` is `hex(HMAC-SHA256(R, crew id || d))`, cut to 32 characters.

**`E` only ever travels inside a state's wraps, addressed to the roster.** Every member's KEM key is
known, because the hello carried it, so every wrap is hybrid. That is how the post-quantum property
reaches crew posts.

A new epoch starts on every admission (so a joiner reads nothing said before they arrived), every
removal, every announced leave, and **at least weekly**, posted by whoever is first to post after
seven days; that rotation changes nobody. A state that changes no membership (a first signature
awaiting a second, Agreed, rename, card status, move relays) keeps the epoch.

**Two clocks, the same for every crew. Decided 2026-10-09.**

- **Lines carry an expiration 7 days after the end of their blurred posting day. States, hellos and
  welcomes carry 30 days.** Never the real send time.
- **A phone deletes `E` and `K_line` 7 days after the last day of an epoch, and `K_state` and `R`
  30 days after.** After that a phone seized later cannot read old posts a relay kept, though NIP-44
  has no forward secrecy of its own.
- **Why two:** with one 7-day clock on everything, a member who reads less often than every week or
  two falls off and must be admitted again in person, and crews drift to Signal. With states on 30
  days, a member can walk forward for a month and comes back to the current roster and Agreed line.
- **Why the same for every crew:** the expiry rides in clear on every event, so a lifetime chosen per
  crew would sort crews into classes anyone could follow, which undoes the padding.
- **Cost:** a phone seized unwiped reads up to 30 days of rosters and Agreed lines still on relays,
  and up to 7 days of lines. Relays store states about four times longer than lines. Lines and
  states are told apart by their expiry as well as their size. **The clocks bound only history
  readable at the moment of compromise.** Reading forward stops only when the charter removes the key.
  Relays honour NIP-40 at their own discretion, so the phone forgetting is the only bound NavCom
  controls.

**A returning member walks forward.** Each state is posted under the old epoch's tag, so the member
reads the old tags, opens the state, derives the next epoch's keys and reads again. Each read is one
REQ, closed at EOSE. A phone always reads for a newer state before it posts. Away longer than 30
days, the screen reads: *"This crew has moved on since this phone last read it. Ask two members to
admit you again, in person."*

### Padding to room

**Decided 2026-10-09: states are padded to the crew's room.** The details are proposed.

- **The wraps** are padded up to room with real wraps to throwaway KEM keys, in roster order, so a
  member opens their own wrap first and spare wraps cost members no extra work.
- **The body** under `K_state` is padded to one length per room, sized for the largest single
  change: a full roster with 48-character callsigns, one new member's KEM key, a full Agreed line
  with its previous value, and a second signature. So rotation, admission, removal and an Agreed
  change all have the same length.
- **Hellos and welcomes are padded to the same length as states, and posted at random delays from the
  state.** Otherwise a reader holding a live subscription sees a welcome-sized event arrive with a
  state, and learns that somebody was admitted and how big the room is. *Cost:* the welcome is the
  largest of the three, so every rotation carries its length: about 41 kB instead of 31 at room 12.
  The alternative, each at its own length, saves about a quarter on every state and lets a live
  subscriber see admissions.
- **Lines keep NIP-44's own padding.** Padding lines to a fixed size stays declined (§14).
- **The padded lengths are protocol constants for each envelope version**, never a per-crew setting,
  because a per-crew choice is itself a fingerprint. A test on the built artifact checks that every
  `1913` a phone emits has a length from the published set for its type.

**Measured 2026-10-09**, with nostr-tools 2.24.2 NIP-44 and @noble/post-quantum 0.7.0 ML-KEM-768 on
Node 22.23.2, by a scratch script outside the repository that reimplements the composition from
`group.ts` and `envelope.ts`. Phase 2's length test replaces it. Complete events in bytes, for the
largest single change:

| Room | 4 | 8 | 12 | 15 |
|---|---|---|---|---|
| State, with the wraps nested inside the epoch layer, as `group.ts` output would be | 22,349 | 38,733 | 55,117 | **66,041: over the limit** |
| State, with the wraps outside the epoch layer and binary values in base64 | 13,893 | 21,805 | 31,077 | 38,717 |
| Welcome, with roster KEM keys in hex | 21,796 | 35,452 | 57,296 | **68,220: over the limit** |
| Welcome, with roster KEM keys in base64 | 16,336 | 29,988 | 40,912 | 46,372 |

- **Room 15 fits only with a crew envelope:** the wraps sit beside the `K_state` ciphertext rather
  than inside it, and KEM values are base64 rather than hex. Sealing a whole padded state under the
  epoch key, as `group.ts`'s envelope nests, takes room 15 over 65,536 bytes. So crews need their own
  envelope format beside the watch's `q:` format, which is untouched.
- **A line is 1,529 bytes as a complete event, at any crew size.** Sealing every line to every member
  instead would cost about 25 kB a line at ten members and show the relay the crew's size on every
  line. That is why lines are sealed under the epoch's key.
- **Time.** On a Mac, sealing a 14-wrap state takes about 33 ms and opening one up to about 39 ms,
  because `hybridOpen` re-derives the KEM keypair for every wrap it tries; computing that once brings
  it to about 9 ms. The device floor is unmeasured, plausibly 10 to 30 times slower.
- **Not yet known:** whether relay.damus.io and nos.lol keep strfry's 65,536-byte default, whether
  they store and serve `1913` events from throwaway keys without proof of work, how long they keep
  events that carry an expiration, whether they index the routing tag, and their per-IP limits.
  Phase 0 measures each. A relay that cannot take the room-15 padded length cannot carry crews.

### Relays: a list the release ships, not a name a code supplies

- **Each crew uses two relays, chosen at founding by rendezvous hashing on the crew id** over the
  list the release ships. Until the commons exists that list is `DEFAULT_RELAYS`, the meeting pair.
  After, it is the commons ([`relay-lists.md`](relay-lists.md) §1, D5). The two relays travel in the
  summary code and in every state.
- **A phone only dials a crew relay on its own shipped list, whoever signed the code or state that
  names it.** A crew whose relays this version does not know reads *"This crew uses relays this
  version of NavCom does not know: it needs an update."* `listable()` refuses only the mission hosts
  today, and a relay named in an admitter's code could be one the admitter runs, which is the small
  room the refusal `no-operator-traffic-on-a-private-relay` exists to prevent. Until relay-lists
  phase 3 makes `listable()` refuse anything outside the commons, the crews code checks the shipped
  list itself.
- **Move relays** is a state under the charter that names the new pair explicitly. It is never
  recomputed, because two releases with different lists would split a crew.
- **Before the commons exists, every crew sits on relay.damus.io and nos.lol**, on the same connection
  as the card and the watch traffic, so those relays can tie a crew's tag to the card's and the
  watch's keys by connection. Leaf crews ship before the commons (units.md, decision 8), so the Crew
  screen's Relays slot says so: *"These relays also carry your card and watch traffic from this phone,
  and can tie this crew to them."* A second socket stays declined (relay-lists §10).

### Validity rules

Proposed, so a seized key or a hostile insider cannot drain members' prepaid data with states:

- a rotation less than 7 days into its epoch is void unless it changes membership;
- each member has at most one open act awaiting a second signature;
- above a per-crew daily cap of states, phones stop walking forward and say why;
- **a removal voids every pending act and signature from the removed key.**

### Removal

- **Only by the charter.** Under Any two, removing takes two members other than the one removed,
  or the one other member in a crew of two, whose screen says *either of you can remove the other*.
  A Led unit's rule is units.md's.
- **Never automatic.** No timer, count or missed deadline removes anybody, and **membership never
  lapses because someone has gone quiet.** Whether two members may remove a quiet member's key with a
  stated reason is open in units.md. Squad holders under relay-lists D1 differ on purpose, because a
  watch has to answer `Distress`.
- One state may remove several keys. The remover's screen lists every key the removed key admitted
  since a date the remover picks, so those can go in the same state; a person decides, and nothing
  cascades.
- **The state that removes someone starts a new epoch, sealed only to those who remain. The removed
  key cannot read anything sent after that, or even find it.**
- The receipt: *"Raven and Wren removed Kestrel, 3 Oct. Kestrel keeps everything already sent, and
  reads nothing from now on. Phones that have not opened the crew since still include them."*
- **Once a phone holds a state that removes a key, it shows nothing signed by that key that it had
  not already shown.**
- *Cost:* removal cleans up afterwards and prevents nothing before. A taken phone reads until two
  members act.

### When two changes cross

Two states can name the same state before them. Then:

1. **If one removes the key that signed the other, the other is void. Removal wins.**
2. **If each removes the other's signer, neither wins.** Both are shown as records, with who signed
   each, and each person chooses which crew to follow. It is a split, as it would be in person.
3. **Otherwise**, for example two rotations, both stand. The next member to open the crew posts a
   state combining them, sealed to everyone either included. If two combining states cross and name
   the same people, phones follow the one with the lower id; grinding an id buys nothing there,
   because both name the same people.

**No rule picks the lower id when that choice decides who is in.** A lowest-id tie-break can be won
by grinding `created_at`, and under that rule a removed member could undo their own removal.

units.md adds one exception to *removal wins*: a removal that crosses an open vote is void if the
person the vote is about signed it, or if it removes one of that vote's electors.

### Leaving, renaming, moderation

- **Leave quietly** deletes the crew from this phone and sends nothing, like unpairing. The crew still
  lists you until somebody removes you, and the screen says so.
- **Leave and say so** sends a sealed `left` and deletes the crew. The next remaining member to open
  the crew starts a new epoch without you; a leaver never starts it, so never holds its secret.
  *"Leaving costs nothing. They keep what was already sent."*
- *Leave and say so* is the default in the copy (units.md), so people who stop coming do not sit on
  the roster as permanent no votes.
- Neither kind of leaving has any effect outside the crew, and neither touches standing.
- **Renaming** is a state.
- **The charter's removal is the only moderation inside a crew.** NavCom hosts nothing and reads
  nothing, and `hidden.ts` does not reach sealed crew traffic. It does reach crew cards (§10).
- **A crew is not a watch.** A crew post never carries a watch code, and nothing here merges crews
  with squads.

### A new composition, reviewed first

HKDF and HMAC from `@noble/hashes`, NIP-44 under derived symmetric keys, ML-KEM-768 through `pq.ts`,
and the crew envelope are audited parts in a new arrangement. The header of `group.ts` says this
project does not ship its own cryptography on a boundary that protects people at risk, so **the
composition is reviewed by somebody who is not its author before phase 2 ships.** `contentKeyFor` is
exported from `group.ts` rather than written a second time.

---

## 8. On the phone: Wipeable, never backed up

**Decided 2026-10-09.** The roster, the epoch keys, the member's crew key, the Agreed line and, for
its holder, the crew-card key all sit in Wipeable.

- **Never in a backup.** Backups carry Accruing only (`backup.ts`), so keeping crews out needs no
  code. A test on a made kit checks that no crew field appears.
- **Under their own storage keys.** Crews, and the log cache (§9), each get a key listed in
  `keysOf(WIPEABLE)`, rather than a field in the tier blob. A crew record at room 15 is about 40 kB,
  mostly KEM keys, and inside the blob every read would parse every crew. That needs work first:
  `keysOf` (`storage.ts`) returns only the blob and its salvage copy today; each new key needs a
  write path with quota reporting and salvage; `tierSummary` and `tierSizes` need extending so the
  Wipe screen can name them; and `write()` needs eviction, which today only reports a failure.
- **A wipe ends every membership.** The way back is an ordinary admission in person (§6). There is no
  recovery screen and no remote rejoin. The Wipe screen says before the act: *"Your crews are
  forgotten too. Members can admit you again, in person, when two of them are together. Nothing they
  hold is lost."*
- **Why:** it is the only choice where a deliberate wipe protects crew-mates. Rosters are other
  people's data, and C38 lets an operator waive protections for themselves, never for a third party.
  A backup copy can never be recalled, and a restored crew key is the same key a finder holds.
- **Cost:** rejoining waits for a meeting with two members. It does nothing for a phone taken
  unwiped, which is bounded only by the two clocks, the room, and how fast the charter removes the
  key. `removeItem` unlinks rather than scrubs, so it is not a secure erase. Peers survive a wipe
  and crews do not: a peer row is a relationship the operator is party to, while a roster carries
  edges between third parties.
- **Not encrypted at rest.** Like every tier, crew data sits in the browser's storage as plain text
  ([`../declined.md`](../declined.md), *Protection from someone holding your unlocked phone*). Whether
  to seal it under a passphrase is open (§16).
- **Memory only:** the session card cache and the back-stack handle map.

---

## 9. Chat: one Agreed line, then a log

com.md §5 says chat is for three durable things: *who is in this group, what was agreed, where to
meet.* The roster covers the first and the Agreed line the other two, which is why it ships first.

**Decided 2026-10-09: crews have chat, and the exception is scoped.** signals.spec.md's sentence is
scoped to signals, which stay transactions that close. A crews spec permits one Agreed line, a flat
log with no replies and no threads, and the bounded governance statements units.md defines, each
length-capped and with no replies or threads. No other free text. The spec edit and dated notes on
principles.md §2 were made on 2026-10-09. §2's *"no scrolling timeline"* and *"no replies or threads
on anything"* are what the log narrows: it is fetched when opened, closed at EOSE, and has no replies
or threads.

### The Agreed line

- One line per crew, 280 characters or fewer. It can carry **one place: a directory record id or a
  region, never coordinates or an address field.**
- **Setting it is a state** (proposed), signed by a member's crew key and sealed under `K_state`. So
  it lives on the 30-day clock, every state carries the current line, the welcome hands it to new
  members, and a returning member reads it from the newest state.
- **The newest replaces the last**, by its inner time. A line dated more than ten minutes ahead of
  the reading phone does not count until that time, so nobody can pin a line by dating it in the
  future.
- It shows its author and its age. After seven days it reads *"7 d old: ask the crew"*.
- **When it changes, the previous value and its author show for 7 days:** *"changed by Raven 2 h ago,
  was: …"*. A seized key can move the agreed place to a trap; this is the only warning short of
  removal. *Cost:* members who do not open the crew in time can still go to it. Putting a change of
  place under two signatures was considered and not taken, because a real change would wait days on
  pull-only reads.
- It keeps no other history, and nobody replies to it.

It is free text between members, so it needs the principles §2 note and the safety record review
before it ships.

### The log

**What a line can be.** Text of 280 characters or fewer, in a flat list: oldest at the top, newest at
the bottom where the thumb is. Each line shows the crew callsign, a short print (four hex characters;
the full print is on the roster), its age and the text. **There are no replies, threads, reactions,
mentions, edits, pins, polls, RSVPs or verbs that assign work. There are no images, files, voice
notes or link previews**: a URL stays inert text and is never fetched. Lines carry no location.

**Withdrawing your own line** sends an inner `withdraw`. Members' phones show *withdrawn by its
author* in its place, so nothing reflows, and the phone sends a NIP-09 deletion signed by that line's
throwaway key. *"This cannot recall copies already read."*

**Reading.** Opening the crew is the only fetch. It sends one REQ for the current epoch's tags for
each day since the last read, walking through any rotations, and closes at EOSE. It shows at most 200
lines, with *Load older* on a tap. The top of the list always says one of *Start of this crew*,
*Older lines lapsed from relays*, or *Showing 200: load older*. Offline it reads *"as of 14:02: no
relay answered since"*. A divider marks *since you last looked*, with no number.

**No subscription is held, so an unread count cannot even be computed.** That keeps the log on the
right side of the refusal `no-feed`, which refuses *"a subscription NavCom must keep up with"*.

**The cache. Decided 2026-10-09: sealed, in Wipeable.**

- Events are kept exactly as received, encrypted under their epoch's line key, and decrypted only to
  display, under their own storage key in `keysOf(WIPEABLE)`.
- At most about 200 lines per crew, with a byte cap per crew and in total. *Load older* fetches
  without storing.
- Deleted with its line key at 7 days. A withdraw deletes the event. Either kind of leaving clears it,
  and so does reading your own removal.
- **The first thing dropped when storage is full**, so a patrol is never refused for room. Named on
  the Wipe screen.
- **Why:** any phone holding the line key reads unexpired lines from relays anyway, so the sealed copy
  adds only offline reading, and it dies with the key by construction. A memory-only log would make
  every open name every day's tag in one REQ, linking the days at the relay, and would push members
  to screenshots a wipe never reaches.
- **Cost:** about 300 kB per full crew, three times plaintext; decrypting on every open, believed
  small and unmeasured; one more key in the destroy list. An unwiped phone reads a week of lines
  offline, which it could do online.
- Tests: no crew log key survives a panic wipe, and after 7 days no cached event decrypts with
  anything on the phone.

**The composer** is one line at the bottom. A character counter appears only in the last 40
characters. Two fixed lines sit under it: *"About the work. Never about the people you serve."* and *"Read
when somebody looks. Somebody needed now: Distress."* The send states are *Sending*, *Sent: 2 relays
took it*, and *Not sent: no relay answered*, with *Send again*. **A line that did not send stays in
the composer, in memory. Nothing is queued.**

**Pull-only is enforced, not promised.** The crews chunk calls no `Notification`, `navigator.vibrate`
or `setAppBadge`, plays no sound, and registers no service-worker push or sync. There is no unread
dot, count or bold row anywhere: not on the root, the Yours screen, the Crews list or the peek bar. A
test against the built artifact checks this. The WHY keeps com.md §5 word for word: crews will keep
using Signal for anything time-critical.

### The keyboard and `Distress`

`.distress-layer` is `position: fixed` at the bottom, and `app.html`'s viewport meta has no
`interactive-widget`. On Chrome for Android, whose default is believed to have been
`resizes-visual` since version 108, the keyboard probably covers `Distress` while any text field has
focus. **That already applies to today's directory search**, and a composer would make it common.
Phase 0 checks it on a device and adds a case to the reachability test with a text field focused and
the visual viewport shrunk. The fix is open (§16).

---

## 10. The crew card

**Decided 2026-10-09: a public crew card, held by one member, is allowed.** The conditions below are
proposed, and most of them come from asking how the card is abused.

- **What it is.** A `10911` card under a second contact key, made for this purpose and held by the
  one member who chose to be the crew's public face. It is never shared. The holder volunteers;
  nobody is named holder who did not ask. The crew agrees under its charter's rule (units.md).
- **What it carries:** a public name typed fresh, never prefilled from the crew's private name; the
  region whose board it sits on; and the placeholder `crew` term. **No roster, no count, and no
  meeting place, time or schedule.** The knock is its only route. Without this, two members could
  publish where and when every member meets, which is contact detail beyond the one person who opted
  in (C38, invariant 6).
- **When a crew may get one** is open (§16, question 2). Either way, the summary code says whether the
  crew has or may have a card before a joiner shows anything.
- **The knock carries a one-use reply key, never the operational key.** A knock is a `1910` invite,
  and today an invite's inner event is signed by the sender's operational key. A fake crew card would
  then collect the operational keys and callsigns of operators who know nobody, the most exposed
  people here. Admission makes a fresh crew key anyway, so the operational key adds nothing. The
  holder answers under the one-use key. Admission is still in person, by two members.
- **The readout beside every crew card:** *"A crew card is one person's word. Nothing shows that a
  crew stands behind it."*
- **Renewal.** The card expires 14 days after its scheduled start. A web app can publish only while
  it is open, so the phone renews at the first open after each 7-day boundary, but dates the renewed
  card to the boundary, blurred, never to the open. Readers cannot tell from the card when the holder
  opened the app; the relay still sees when it arrived. *Cost:* a holder who does not open the app
  for two weeks lets the card lapse, and a lapse is public.
- **The crew cannot withdraw it.** A removed or hostile holder, or whoever holds their unwiped phone,
  can keep renewing it, because the card key alone signs a card. After a holder's wipe the card stays
  up for up to 14 days and answers nobody. This sits against C39's *revocable*, and the tension is
  recorded rather than hidden. The crew record keeps the card term, the holder's callsign and the
  expiry, never the card key.
- **Moderation.** Crew cards are cards navcom.app renders, so `hidden.ts` and the notice procedure
  apply. That is the one moderation act the developer holds over crews. A `hidden.ts` entry stays in
  public git history.
- **Enumeration.** Anyone can load every region board and list the carded crews. A seized member's
  record points at one of the region's crew cards.
- **No standing.** Crews and crew cards hold no ceiling, rungs or Honor, so nothing is stranded by a
  holder's wipe or removal. A unit that posts missions in its own name becomes a body under
  [`economy.md`](economy.md) §6, designed in units.md and 11.5, not here. That the claim cap raised
  by rung (economy.md §9) is not conserved by §6 is recorded as an open item for 11.5 and 11.6.
- **Doctrine it bends, by name.** principles.md §2's *"no discoverable directory of operators"* and
  C11's *"Growth follows existing trust paths"* each get a dated note recording a crew card as an
  owner-decided exception: growth outside existing trust paths, reaching one operator, the holder,
  by knock. They are exceptions, not things outside the rules.
- **Gates:** phase 2 shipped; the online safety record reassessed for contact between strangers, where
  the grooming rating widens from individuals to crews; and the person who owns the activity
  vocabulary confirming `crew`. Meeting a stranger belongs to that review, by people. No agent writes
  guidance for it.

---

## 11. What each relay and an outsider learns

| Who | Learns | Does not learn |
|---|---|---|
| **Each crew relay's operator** | The IP of every phone that posts or reads a crew's tag, and when: **the crew's members, by address, on that relay**. A read across several days ties those days together. The padded size bucket, which is the room. The real arrival time, since `created_at` is blurred but arrival is not. **On the meeting pair, before the commons, the same connection also carries the card's contact key and any watch traffic**, so the relay can tie a crew's tag to those keys. This is accepted, not irreducible: fetching every crew event and cover traffic are both declined | Names, rosters, callsigns, crew keys. Which state is an admission, a removal or a rotation |
| **Another reader of the relay** | Event counts per tag per day, padded size buckets, and expiries | Anything that links one day to the next, since the tag changes daily and with every epoch. Who the members are |
| **A reader holding a live subscription** | When events arrive | That an admission happened, since every admission event is the length of a state and they are posted at random delays |
| **Whoever photographs a summary code** | The crew name, charter, room and size, relays, whether it has or may have a card, and the admitter's crew key | Anything readable. No routing secret |
| **Whoever photographs a join code** | A crew key and a nonce: enough to see that a hello and a welcome were sent | Their contents |
| **A member** | Every crew key, callsign, who admitted whom, the Agreed line and every line of their epochs, **for good**. Nobody inside a crew can be stopped from listing it, and the join screen says so | Any crew-mate's contact key or operational key |
| **A removed member** | Everything up to the removal, plus old-epoch lines sent by phones that had not yet read it | Anything after |
| **A seized phone, wiped** | No crew secret. History entries that are handles meaning nothing. Unlinked pages may be recoverable by somebody patient and equipped | — |
| **A seized phone, unwiped** | Every crew on it: up to 14 other callsigns per crew, up to 30 days of rosters and Agreed lines, up to 7 days of lines. It can post as the member, move the Agreed place, and read forward until the charter removes its key | A crew-mate's contact key or operational key |
| **A later compromise of an epoch secret** | That epoch's lines and states, at most about a week of lines | Earlier epochs whose keys are already deleted |
| **A compelled or compromised release of the web app** | Whatever phones decrypt while it runs, for as long as it runs. It could also add a relay to the shipped list. Detection would need release transparency or reproducible builds, which are not built | Anything a phone never decrypted |
| **Anyone loading region boards** | Every crew card in each region | Who is in any crew |
| **Opening a profile** | Nothing, if the card is in the cache. *Fetch newest* tells the relays this phone asked for that key | — |
| **Search** | Nothing, unless a board or roster load is tapped. A board load names a region; a roster load names the opt-in label | The typed text |
| **NavCom's host, The Record, its mirror, partners** | Nothing. They are never sent crew traffic. The host cannot see who opens crew screens because the service worker precaches every chunk of the build; a test keeps the crews chunk in that list, since splitting entries could otherwise let the host see it | — |

**What the developer holds and decides.** NavCom's developer publishes the code members' phones run
and holds nothing a crew depends on: no server in the crew path, no copy of any roster, key or line,
no backup, recovery or escrow path, and no part in any admission or removal. The developer decides
only floors that apply to every crew alike: the room menu, the padded lengths, the two clocks, no
agent keys, and the shipped relay list, which is a decision made on everyone's behalf. What any of
this does to anyone's legal liability is a question for a lawyer, and nothing here claims to reduce
it.

As [`../product/what-leaves.md`](../product/what-leaves.md) already says: *sealing hides content,
never that a message happened*. The protection is the anonymity set. A commons relay may throttle or
ban one address writing from many throwaway keys, and the screen reports that as *no relay took it*,
never as sent.

---

## 12. How each invariant holds

| Invariant | How |
|---|---|
| **1. Nothing recorded about the people served** | No field anywhere can hold a person. Callsigns are capped at 48 characters, Agreed and log lines at 280. A place is a directory record id or a region, never coordinates. No image, file, voice note or fetched link. The camera only reads a code and keeps no frame. Free text cannot be policed, so the composer guides rather than pretending to enforce: *"About the work. Never about the people you serve."* Nothing in a crew can settle a mission. A test on the built chunks finds no `<input type=file>`, no `getUserMedia` outside `scan.ts`, and no media element in a Com screen |
| **2. `Distress` ends in a human or says it couldn't, and nothing borrows it** | Every new screen (`profile`, `you`, `find`, `crews`, `crew`, `roster`, `member`, `start`, `join`, `admit`) renders under the existing `Distress` layer, and the reachability test taps `Distress` from each at peek, half and full, and with a text field focused. Crew traffic uses only `1913` and `20917`, never `20910` to `20912`. There is no *page the crew*, and the copy sends *now* to `Distress` |
| **3. Duress is always deliberate** | No read receipts, typing indicator, online status, last seen, unread count or *inactive*. Membership never lapses from silence. *Leave quietly* sends nothing. *Read* describes the relays' answer, never a person |
| **4. Agents always identified** | On a profile: `MISSION_PUBLISHERS` or the `navcom:agent` tag, and absence reads *nobody has checked*, never *human*. In a crew there is nothing to identify, because no agent holds a key; an agent-flagged join code is refused, and NavCom's agent builds contain no crews module. No crew path reaches `Distress` |
| **5. Panic wipe destroys Wipeable only; burn destroys everything** | Crews and the log cache are Wipeable, under keys in `keysOf(WIPEABLE)`, so both destroy paths take them. Own-line throwaway keys are Wipeable. The card cache and handle map are memory only. Tests on the built artifact check that no crew secret survives a panic wipe. Copies on other members' phones are beyond one person's wipe, and the screens say so |
| **6. No legal names** | A callsign typed fresh for each crew, starting empty, with *"a callsign, not your name"*. A crew name of 48 characters or fewer. No contact details anywhere. A crew card carries no meeting place or time. Card rules unchanged |
| **7. Volatile data shows its age** | Card age, *Sent* age, Agreed age with *7 d old: ask the crew*, *Read* age. *Unknown: no relay answered* is always kept apart from *nothing*. *Older lines lapsed from relays*. *Unknown: this phone forgot in a wipe*. No *out tonight*, because a blank there would lie |
| **8. Nothing tasks anyone without their asking** | Nothing on this page has an addressee field or a verb that directs anyone. Nobody joins without making their own key and showing their own code in person. Leaving is free and touches no standing. The Alone screen lights nothing. A unit whose charter chose orders narrows invariant 8 inside that unit, as units.md states with its dated note; an order is units.md's object, not a kind of crew line |
| **9. A state is visible before commitment** | The summary code shows the charter, room, size, relays and whether the crew has or may have a card before the joiner shows anything. The crew screen shows *Read* and the roster, so you can see whether anybody is behind it. A profile shows *Nobody has checked this card* before *Write to them*. *Fetch newest* says what the relay learns before it is tapped. A removal names whom it leaves out and when |
| **Membership is a credential; nobody outside can enumerate members** | Admission is a signed statement held by members. Rosters exist only inside sealed states and welcomes. Outer keys are throwaway and tags rotate. No NIP-29, NIP-72, kind `10009` or NIP-58 award. **The exception, stated in missions.md §2 in phase 0:** each crew's two relay operators can list its members by IP address, and before the commons the meeting pair can tie them to card and watch keys by connection |
| ***no-credential-gate*** | The admission describes who admitted whom. Reading comes from whom an epoch was sealed to. Room is never raised by standing |
| ***no-operator-traffic-on-a-private-relay*** | Crew relays come from the shipped list, and nothing a code or state names outside it is dialled. Crew and unit events were added to the refusal's text on 2026-10-09; phase 0 still regenerates the well-known JSON and extends its test. An end-to-end test checks that The Record and its mirror never receive an `EVENT` from any crew screen |
| ***no-feed*** | No subscription is held. Each read closes at EOSE |
| ***no-tasking*** | No crew line or state type carries a task. The refusal binds what NavCom accepts from integrators; it is not a filter on sealed lines NavCom cannot read. Where units.md narrows it for orders, units.md says so |
| **Contact and operational keys never joined** | No roster holds either key. No filter names a crew tag beside either key. Endorsements and watch membership never appear on a profile anyone else can see. Com never calls `standing.ts` `start()` |
| **Standing is several kinds, never a total** | Crews show and produce no standing. Profiles get one slot per kind when 11.6 lands |
| **Name the audience, not the category** | No screen says *private*, *members only* or *anonymous*. It says who can read: *the 5 keys on this roster*, *anyone in Philadelphia* |

---

## 13. The script budgets

**Measured 2026-10-09** (`web/build/.budget.json`):

| Surface | Now | Ceiling | Left |
|---|---|---|---|
| Root, first paint | 60,906 B | 61,440 B | **534 B**, past the 52 kB warning |
| **Root, later**: what one landing-page visit downloads on opening the sheet | **70,520 B (68.9 kB)** | None yet. **Reported, not enforced** | — |
| Deferred, dynamic imports | 42,781 B | 46,080 B | 3,299 B, past the 40 kB warning |
| Terminal | 167,141 B | 225,280 B | 58,139 B, past the 160 kB warning; its worst page is `terminal/find` |
| Roster | 96,176 B | 97,280 B | 1,104 B, past the 86 kB warning |
| Public | 0 B | 0 B | — |

**The per-visit figure is the one a Com screen spends.** The deferred line counts what the whole app
can pull in later and leaves out any chunk some page loads at first paint, so the signature-checking
crypto the terminal loads up front was never counted for a reader who only opened a mission from the
map. *Root, later* counts it: 68.9 kB against the deferred line's 41.8. com.md §6 says it is enforced
once a ceiling is derived from its measurement, **before profile, groups and chat add to it.** So
phase 1 derives that ceiling, from the measurement plus the same headroom every surface here gets,
before its first screen merges.

*Root, later* walks every chunk the landing page can reach, so once Com splits into entries it counts
the crews entry too, and overstates one visit that opens only missions. Phase 0 makes the script
report a figure per entry beside it: everything reachable from that entry that first paint did not
load. It has entries to report once phase 1 splits them, and stays reported, not enforced, until
each has a measurement to derive a ceiling from.

**Root, first paint: not re-derived.** Its ceiling comes from about 3 seconds to interactive at
0.8 Mbps. Raising it to fit this work would be the silent raise `budget.mjs` exists to stop.

- **Phase 1 changes how the root renders Com screens.** Today `+page.svelte` has one branch per
  screen. The people and crews entries each export one host component that renders its own screens,
  so the root gains one branch per entry, not one per screen. The host lives inside its entry's
  chunk, already loaded when a screen opens, so it adds no round trip. If the measurement needs it,
  the five mission branches move into a missions host the same way. Unmeasured, **measured before
  merge.**
- **Phase 3 adds one fixed row, *Crews*,** reading the crews storage key directly the way `holding`
  reads `mission_claims`, names only. Estimated at 150 to 300 B gzipped. With 534 B left, **if it does
  not fit, the row lives in the Yours screen instead.**

**Split the entry (phase 1).** `$lib/components/missions/index.ts` becomes three entries: *missions*
(unchanged), *people* (profile, you, find, the card cache) and *crews* (crews, crew, roster, member,
start, join, admit, the log). Opening a mission never loads crew code. Each entry then gets its own
ceiling from its measurement plus headroom, because a person waits for the one entry they open, not
the total of every screen they might.

**Estimates, to be replaced by measurement (gzipped):**

| Entry | Its own code | Shared chunks it pulls cold |
|---|---|---|
| people | about 3 to 8 kB | `card.ts`, the pool, nostr-tools: probably already loaded by missions |
| crews, phase 2 | about 9 to 15 kB | `group.ts`, `pq.ts` with ML-KEM (6.9 kB), NIP-44 (26.3 kB, probably already in the missions closure), `@paulmillr/qr`, `scan.ts` |
| crews, phase 4 adds | about 3 to 5 kB | — |

At [`../research/device-floor.md`](../research/device-floor.md)'s figure of about 1.05 s per 100 kB at
0.8 Mbps, a 50 kB cold crews closure costs about half a second after the first tap, and the service
worker caches it after that. **First paint does not change.**

**Terminal and roster: unchanged.** No terminal page imports the people or crews modules,
`/terminal/who` is untouched, and `namesOf` stays in the missions chunk. A test checks that the
terminal figure does not rise.

**On the wire and on the phone**, from §7's measurements: a line is 1,529 bytes; a padded state,
hello or welcome is about 16, 30, 41 or 46 kB at rooms 4, 8, 12 and 15, sent on each change and at
least weekly, so about 177 kB a member a month at room 12 from the weekly rotation alone. A crew's
record keeps each member's KEM key, about 40 kB at room 15. However many crews a phone holds, they
sit under one storage key, and their logs under another.

---

## 14. Declined

Each is written into [`../declined.md`](../declined.md) in phase 0, with its cost.

- **Crews in Accruing**, in or out of backups, and a per-crew choice of tier. *Cost:* a wipe or a lost
  phone ends every membership.
- **A lifetime chosen by the founder.** *Cost:* no crew can keep posts longer than the two clocks.
- **Room raised after founding, or by standing, writs or tenure.** The published refusal
  `no-credential-gate` covers it. *Cost:* a crew that outgrows its room splits or teams up.
- **Flat groups above 15:** split delivery across events, sender keys, MLS or Marmot. *Cost:* no single
  sealed room larger than 15.
- **NIP-29 relay-enforced groups.** The relay holds the roster and reads every message, and private
  reads need NIP-42 sign-in, which relay-lists §10 declines. *Cost:* no interoperability with NIP-29
  clients.
- **NIP-72 communities, NIP-51 kind `10009` lists and NIP-58 awards as membership.** Each publishes a
  roster. *Cost:* none beyond interoperability.
- **NIP-17 direct messages and kind `1059` wraps for crew traffic.** They need a published `10050`
  under a member key, which relay-lists §10 declines, and the NIP's own advice stops at ten members. A
  conversation with one person is a crew of two. *Cost:* other clients cannot message a NavCom crew.
- **Marmot and MLS.** The mandatory suite is classical only, which would walk back ML-KEM; key
  packages are published under the account key; the wire format is pre-1.0; stateful epochs break
  when a pull-only member misses a commit. *Cost:* no forward secrecy within an epoch.
- **Sealing every line to every member.** About 25 kB a line at ten members, with the room on every
  line.
- **A shared key for a crew.** A removed holder keeps signing as the crew; `group.ts` already says
  *"Sharing a secret is not a membership model."*
- **Agent crew keys**, and any *person* or *agent* field on a roster. *Until:* an agent design that
  cannot become a hub across crews and never reads before a person does.
- **Stored card links** between a crew key and a contact key. *Cost:* roster rows never lead to a
  public profile.
- **Exact sizes on the wire, and dummy wraps without body padding.** *Cost:* every crew sends
  room-sized states.
- **A plaintext log cache, and a memory-only one.**
- **Earlier lines for new members.** Nothing earlier is sealed again to a joiner. units.md's
  checkpoint gives a joiner a signed summary of terms, never earlier lines.
- **Membership lapsing from silence.**
- **Changing a charter in place**, except *Higher*, which units.md lets change under a founding term.
  Re-forming is the path.
- **Replies, threads, reactions, mentions, edits, pins beyond the Agreed line, polls, RSVPs and verbs
  that assign work, in the log.** units.md's endorsements and petitions are governance statements,
  not log features.
- **Read receipts, typing indicators, online status, last seen, unread counts, badges, push, sound,
  vibration and background sync.**
- **Images, files, voice notes, link previews, fetched attachments, and any location in a line.**
- **A crew-wide alert, or *page the crew*.** `Distress` and on-call registration already exist and
  are already consented to.
- **Any public crew object** beyond the one-member crew card: a member list, a member count, or
  looking up crews by relay.
- **A meeting place, time or schedule on a crew card, and a knock that carries the operational key.**
- **Search sent anywhere** (NIP-50, or any relay query built from typed text), **search by activity,
  capability or standing**, a people view for signed-out visitors, and people in the landing page's
  directory search.
- **Keeping other people's cards on the device.** No mutuals, no *people you may know*.
- **Crews, units, offices, endorsements, watch membership, standing or visibility presets on any
  profile someone else can see**, and ***out tonight*** on a profile.
- **Contact keys or operational keys in a roster.**
- **NavCom moderating sealed crew traffic.** `hidden.ts` reaches crew cards only.
- **A crew post carrying a watch code, or merging crews with squads.**
- **Fetching every crew event on a relay to hide which crew is read.** *Cost:* the relay sees which
  tags a connection asks for; the download would be unbounded on the device floor.
- **Cover traffic, and padding lines to a fixed size.**
- **A writ cost for founding a private crew.** It posts nothing in its own name.

**Reversed:** the earlier draft declined *an in-app fork*. Re-forming with lineage, decided
2026-10-09 in units.md, replaces it (§6).

---

## 15. Phases, each useful alone

People first: it needs no new kind, no new storage, and sends nothing without a tap.

| Phase | What | Useful alone | Size | Gate |
|---|---|---|---|---|
| **0. Words and guards** | Edit signals.spec.md's *What is NOT here* to scope it to signals (done 2026-10-09), and draft `crews.spec.md` as a design. Dated notes in principles.md §2 (narrowing is not browsing; the log is an exception to *no scrolling timeline*; the crew card exception), C11, and missions.md §2 (the Crew row points at units.md; the enumeration exception) and §4 (crews hold no Honor, rungs or writs), and pointers in watch/signals.md, field-terminal.md, positioning.md, prior-art.md and lore.md, all written 2026-10-09. Crew and unit events were added to the text of the refusal `no-operator-traffic-on-a-private-relay` on 2026-10-09; phase 0 still regenerates the well-known JSON and extends its test. Per-entry figures in `budget.mjs`, reported. The keyboard device check and its reachability case. **Measure** the meeting pair: maximum event size, whether it stores and serves throwaway-signed `1913` events without proof of work or bans, how long it keeps events carrying an expiration, whether it indexes the routing tag, and its per-IP write limits. Open the online safety record reassessment (the record notes it, 2026-10-09; the reassessment is a person's). Correct profiles.md §7, which still lists *a global roster* and *handle proofs* as open when both exist. Write §14 into `declined.md` | The spec stops contradicting a decided design. The budget stops understating what a cold visitor downloads. Today's directory search is protected if the keyboard does cover `Distress` | S | None: the owner's decisions are made |
| **1. People** | The *profile*, *you* and *find* screens. The session card cache in memory, filled by `namesOf`. *Fetch newest* only on a tap. Back-stack handles. The `navcom:agent` tag, tested for NavCom's own agents. The two honest fixes. Com's index split into missions and people, each through its own host. Tests: `Distress` tapped from each new screen at every height; typing in search sends no REQ to the test relay; no card ever written to storage; a hidden key never asked for | An operator sees exactly what their contact key has put out and what withdrawing would cost, and can open anybody's card from a report, a peer or a board without leaving the map | M. People entry about 3 to 8 kB. Root measured | A ceiling derived for *Root, later* from its measurement, before merge |
| **2. Crews: roster and Agreed** (units.md's U1) | A core crews module: checking states, deriving epochs, keys and routes, the crew envelope, padding, the crossing rule, the validity rules. Kinds `1913` and `20917`. Summary and join codes, hello and welcome. Admit, remove, both leaves, rename, rotation, move relays, the Agreed line, and the charters units.md ships first. Relays from the shipped list. The crews storage key with its write path, salvage, quota and Wipe-screen line. The screens. Tests against the built artifact: a removed member's phone opens nothing after removal; two crossing removals show a split; a ground lower id never reverses a removal; a panic wipe leaves no crew secret; no crew field in a made backup; a relay outside the list is never dialled whoever names it; The Record never sent an `EVENT`; no REQ names a crew tag beside a contact or operational key; no contact key in any state or welcome; an agent-flagged join code refused; NavCom's agent builds contain no crews module; every `1913` a published length; the crews chunk in the service worker's precache list; the crews chunk calls no notification, badge or vibration API; a chunk that fails to load and a relay that does not answer each say so | A handful of people who met keep who is in, what was agreed and where to meet in one place no relay can read, without publishing a roster or any persona key. Operators who are Alone lose nothing | L. Crews entry about 9 to 15 kB of its own code | The crews spec written, and phase 0's measurements, with rooms offered only up to what the measured relays accept. Review of the composition by somebody who is not its author. The online safety record's organising row, harassment row and overall rating reassessed by a person, the Agreed line included. units.md's U1 gates |
| **3. Crews on the signed-in root** | One fixed *Crews* row, names only, read straight from storage. Crews included in search | com.md §2's *your groups* on the root, readable offline and announcing nothing | S. At most 300 B of first paint, measured, otherwise the row lives in the Yours screen | Phase 2 |
| **4. The log** | Lines of 280 characters, flat, pull-only, closed at EOSE, with withdraw, *since you last looked*, and readouts for lapsed and offline. The sealed cache with its caps and eviction. The composer. The keyboard fix, if needed. Built-artifact tests for the absence of badge, notification, vibration and sync APIs, and for the cache dying with its key | Crews keep ongoing talk in the app instead of moving everything to Signal: no interruptions, no receipts, no presence | M. About 3 to 5 kB in the crews entry | **The online safety record reassessed** for sustained contact: grooming, harassment, encouraging suicide, organising harm, and the overall rating. The keyboard question decided if the device check confirmed it |
| **5. The crew card** | A second contact key held by one member, the card on its region board, search showing crew cards, renewal dated to a fixed schedule, and the knock with a one-use reply key. Admission is still only in person | An operator who knows nobody can find a crew that chose to be found and knock once, under the rule invites already have: ignoring one sends nothing | M | **The online safety record reassessed** for contact between strangers. The vocabulary person confirming `crew`. The dated notes on principles.md §2 and C11. The question of when a crew may get a card (§16) |

Teaming up and higher units come after the commons exists, in units.md. **A mechanism nobody can
reach is not built:** each phase ships its screens with it.

---

## 16. Still open

Each option comes with its cost. None is recommended over another.

**1. If the device check confirms that the Android keyboard covers `Distress` while a text field has
focus, what changes?**

- **`interactive-widget=resizes-content` in the landing page's viewport.** *Cost:* the map and the
  sheet re-lay out whenever any text field opens the keyboard, and detent heights are worked out
  again against the smaller viewport.
- **`Distress` moves to the top edge while a text field has focus.** *Cost:* the control moves under
  the thumb at the moment somebody might reach for it, the reflow P8 refused a webfont to avoid.
- **Accept that one back gesture closes the keyboard first.** *Cost:* reaching an invariant-2 control
  then depends on the state the interface is in, which com.md §4 says it must never depend on.

**2. When may a crew get a public card?**

- **Only as a term chosen at founding and shown in the summary code.** *Cost:* a crew that decides
  later that it wants to be found founds again and re-admits everyone in person.
- **Also later, under the charter, taking effect after 7 days, with every member's Crew screen saying
  so and leaving free.** *Cost:* members who do not open the crew that week end up in a publicly
  announced crew by somebody else's act, which strains C38. One more state type and readout.

**3. Is crew data sealed at rest under a passphrase, asked when Crews opens and never in front of
`Distress`?**

- **No. Plaintext, with declined.md's boundary stated on the Wipe screen.** *Cost:* a casual search
  of an unwiped, unlocked phone reads every roster on it, other people's callsigns included, and the
  holder can act as the member until the charter removes the key.
- **Yes, the same on every phone that holds any crew, with no opt-out (C38).** *Cost:* a passphrase
  each time Crews opens, and forgetting it costs what a wipe costs. A six-digit PIN under the backup
  KDF falls to an offline search, so it must be a passphrase. Key-derivation time on the device floor
  is unmeasured. It does nothing for a phone taken with Crews open, or against compelled disclosure,
  whose legal effect is a question for a lawyer. The root's *Crews* row cannot show names while
  sealed.

**4. May machine-written text be marked inside a crew?**

- **No mark; members paste whatever they like under their own key.** *Cost:* an honest member has no
  way to say a line came from a program.
- **A member may post a line marked *quoting an agent*, under their own crew key, never on the Agreed
  line.** *Cost:* one more field and readout to build and test, and it works only for honest members.
