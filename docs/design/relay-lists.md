# Relay lists: where a watch listens, and where a Distress goes

Where a watch says it can be reached, how a phone follows it, and where every `Distress` goes. G3
in [`../build-order.md`](../build-order.md), designed after the relay-paths pass in
[`../audit.md`](../audit.md) made each path safe to multiply.

Status: **decided.** D2 and D3 on 2026-10-07. D1, D4 and D5 on 2026-10-08: the owner asked for the
most secure, fair and future-proof answer, and a game-theory model of the three as one mechanism was
adopted as written (§12). **Built:** the honest `Distress` path on the phone and in the box's client
(§6, 2026-10-07, finished 2026-10-09 with the executor's hearing file and *heard on k of N*), and
the executor's own key (2026-10-08). **Not built:** the commons, boxes or squads following lists, per-member keys with vouching, and the
per-`Distress` reply key. Each spec changes in the commit that builds its step, and until then the
specs describe what runs. The interchange spec is corrected and republished to partners as rev 6, and
NavCom's Pi page updated (2026-10-09).

---

## 1. What G3 is, now that the refusal stands

**D3 kept the refusal `no-operator-traffic-on-a-private-relay` as written**, so no private or
allowlisted relay carries an operator's traffic: not The Record, which takes writes only from its
allowlist and keeps everything, not the Pi's mirror, which refuses every write, and not a relay a
member or a Stationkeeper runs. The refusal's reason is the crowd: a squad among thousands of
strangers reveals nothing, and the same traffic in a small room tells its operator who is active
tonight.

No Nostr field can tell a crowd from a small room, so the code can keep D3 only against a list.
**That list is the commons (D5): large public relays NavCom keeps, each run by a different stranger,
with today's built-in pair inside it as the meeting set**, where public work is published and
partners read.

- **No upper cap, and a floor of three independent relays**, grown so that NavCom stays a small
  share of each relay
- **Admitted on evidence that is costly to fake**, as well as on behaviour: months of passing
  NavCom's own check from two vantage points; no two entries sharing an operator, network, CDN or
  jurisdiction; no archiving of short-lived kinds; a published date from which it is eligible. Each
  entry is a dated, signed [attestation](../attestation.md)
- **Retired in steps:** a grace period for a degraded relay; at once for a hostile one, one that
  requires sign-in, or one that archives. **Never below the floor.** Below it, D3 goes back to the
  owner, rather than traffic concentrating on what is left
- **Monitored as a by-product** of boxes' own `--check` runs. A second person can ship a removal,
  and anyone can propose or contest an entry by a public route
- **It reaches phones only by release**, never fetched at run time, so no key, stolen or coerced,
  can reroute a phone

**Watch traffic goes only to commons relays, whoever names a relay:** a list, a watch code, a backup
or Setup. That is D3 enforced strictly, and it is what makes following a list safe. Following one
adds exactly one harm a watch's key does not already carry, sending every operator's address and
`Distress` timing to a relay the signer chose, and inside the commons the signer chooses none.

One list already ships: a poster's NIP-17 inbox, kind `10050`. Sealed claims and reports follow it,
and nothing else uses it.

**So G3 is four things: the `Distress` path says what it can and cannot hear (§6, built), a watch
says where it listens inside the commons (§3), a phone follows that at once when a key it was handed
signed it (§4), and no operator key publishes a list (§10).**

---

## 2. The rule

**A person hands a phone its watch's first relays. The watch's own signed list adds to them and
never takes one away. Only commons relays count, whoever names them. A `Distress` goes to every
one, and never to fewer while it runs.** For a phone, that is what *every path* means in
[`grid.md`](grid.md) §2.

**A list counts at once, with nobody asked, when a key this phone was handed in person signed it**
(D1): a box's own key, or a squad member's own key for that watch while two other holders vouch for
it (§4). Nobody is asked about a relay address they cannot judge. Consent is asked once, in person,
about people.

The list is an [attestation](../attestation.md): a claim the watch signs, weighed against what each
relay shows (§7) and never taken as proof that the watch can be reached there. A watch that
publishes no list is using the relays it was handed. That is information, not an unfinished setup,
and no screen says otherwise.

In the specs it adds a watch's list, and writes down that an answer goes where its signal arrived,
which everything already does. It replaces the Mk1 RelayNode in
[`../spec/bootstrap.spec.md`](../spec/bootstrap.spec.md) with the commons, and deletes the
executor's exception from [`../spec/watch-state.spec.md`](../spec/watch-state.spec.md). The refusal
and the sentences that argue it stay as written.

---

## 3. Who publishes which list

| Key | Publishes | Where |
|---|---|---|
| A watch on a box | NIP-65 kind `10002` (D2), signed by the box's key, naming only commons relays | Only where it publishes its state, which after §6 is where the daemon and the escalation executor both hear. Never to an indexer, and never on a relay it has left |
| A watch held on phones | The same, under each holder's own key for that watch, once squads have per-member keys and vouching (§11). Until then a squad's relays change only in person | Where that holder hears. The newest from each key counts, as for the state, and a wipe or a burn stops it as it stops the beat |
| A publisher | Its NIP-17 inbox, as now | Where it chooses. Mecha Jono is asked to put it on The Record as well (§9) |
| An operator's operational key | Nothing | Declined (§10) |
| An operator's contact key | Nothing | Declined, not deferred (D4, §10) |

**A box lists a few commons relays, not all of them.** `--check` prints a default subset for each
watch: two relays, chosen by rendezvous hashing on the watch's address over the commons, drawn first
from commons relays outside the meeting set, so boxes do not all crowd onto the same two. A box
lists those, where both the daemon and the executor hear, unless one does not work. Each relay then
carries, and sees, its share of the watches rather than all of them.

**A box listens on every commons relay it has ever been configured on or listed**, not on the whole
commons. A repeat `Distress` sent where a phone learned the watch earlier is still heard, which keeps
*page the person who acknowledged* and *a live ladder comes first* working, and a commons relay a
watch never used never learns that watch or its box's address. The list changes when a config does,
not when a relay drops for a minute: where the watch can be heard *now* is what its state says (§7).

One rule in core, `listable(url)`, decides where a phone may send. Built today, it refuses the
mission relays and anything the pool cannot parse; with the commons it refuses anything outside it,
matched by exact host name. The box writes a list with it and the phone reads one with it, so the
two cannot drift. A configured relay that refuses the box's subscription, such as one that wants
AUTH, stays listed until the Stationkeeper removes it; the box says so at start, `--check` names it,
and no phone counts it as heard.

**A box whose config names no commons relay says so at every start, and `--check` exits non-zero.**
A watch listening only on a relay on its own machine is such a box: operators can send it nothing. A
Stationkeeper who wants a relay outside the commons proposes it for the commons.

A box also gets a **recovery key**, kept offline by the Stationkeeper and a second person. It can
only retire the watch, never redirect it, so a seized box can be retired from a distance.

---

## 4. What a phone takes from a list

A list counts when:

- one of the watch's keys this phone was handed signed it, checked on a copy rebuilt from its own
  fields, as `inboxRelays` already does. For a box that is the box's key. For a squad it is a
  holder's own key for that watch, and that key counts only while two other holders vouch for it
  (one, in a squad of two) in states less than about thirty days old
- it is that key's newest by `created_at`, then the lower id, across every relay it was read on, so
  one honest relay is enough
- it is dated no more than 120 seconds ahead of this phone's clock, the watch state's own tolerance.
  One dated further ahead waits, and Setup says one of the two clocks is wrong

From those lists the phone takes at most four relays beyond those it was handed, in each list's
order, each one in the commons. An entry marked `write` alone is a place the watch publishes and
does not listen, so it is left out.

**The phone asks only on the watch's own relays, in the subscription that already names the
watch.** Kind `10002` is a second filter there, since the state's `limit: 1` would return one kind or
the other. No socket opens for it, and no relay is asked about the watch that was not asked already.

The phone uses a relay a list adds at once (D1). A newer list replaces what the last one added for
routine traffic, and a running `Distress` keeps every relay it has. Only the operator removes a relay
a person handed over, and Setup marks one the newest list leaves out.

**Vouching.** The vouches ride in the holder states that per-member keys bring, in place of a roster
digest, so no new event kind is needed. When two holders leave a key out, every phone that sees their
states removes it, and the receipt says so before the next sign-on (*Raven and Wren removed Kestrel,
3 Oct*); Setup can undo it. A squad that nobody holds for the whole window fades to Dark, which is a
supported state, and wakes when two holders come back. A former holder's power lasts at most the
vouching window; under the shared key it lasts for good.

It is kept per watch in the accruing tier, beside the watch: a wipe keeps it and a burn destroys it.
**It is never carried in a backup or restored from one** — a crafted kit could choose where a
restored phone's `Distress` goes, which is F02 again. A restored phone learns the list from the
watch.

---

## 5. Where each kind of traffic goes

| Traffic | Goes to | In G3 |
|---|---|---|
| `Distress`, and a person's `distress-ack` | Every commons relay this phone has for the watch: those handed over, and every one a list has added | The list's relays are added |
| Other signals: sign-on, check-in, `Query`, `Assist`, stand-down | The handed relays and the newest lists'. A watch's list already names few relays (§3) | The list's relays are added |
| Answers | Every relay the signal arrived on, and the responder's own | None: a box and a holder already do this, and now the spec says so |
| The watch's state and list | Published where the watch hears (§6), and read on every relay this phone has for the watch | The executor's hearing counts |
| Holders' key bundles, the overdue contact | Read on every relay this phone has for the watch | One function for all of it |
| Presence, invites, key bundles, the card, public presence, corrections, places, observations, open claims and reports | Unchanged: the watch's handed-over relays beside the operator's own list or the built-in pair, and the pair as well for missions. Public work also reaches the meeting relays by default, where partners read (D4); an operator who left them out keeps that choice, with its cost stated | **A watch's list never steers them** |
| Sealed claims and reports | The poster's inbox and nowhere else, as NIP-17 requires | The order (§9) |
| Mission packages | The Record and the Pi's mirror | None |

**One function, `watchTargets()`, serves everything sent to or read from the watch.** Today
`session`, `relay.ts`, `overdue`, the board and `pq` each read the watch's relays their own way, so a
moved watch would split them: the overdue contact would be listened for where the watch no longer
is.

**The Record and the Pi's mirror are never sent operator traffic, whatever a list, a config or a
backup says.** Built: `listable()` refuses every spelling of them. They refuse it anyway, and under
G1 The Record logs every attempt with its address, key and kind, so a `Distress` sent there would be
a permanent line that reaches nobody. Both may be read, and Setup says why nothing is sent.

**A relay only the watch names never carries the contact key.** It sees what a handed-over relay
sees of watch traffic and nothing the card signs, so it cannot tie the two keys together: the key
split, kept on that relay without a second socket.

---

## 6. `Distress`: out, back, and to the ladder

**Out** and **Back** are built (2026-10-07, in `packages/core/src/transport.ts`, the `Distress`
screen and the box's client). **To the ladder** is built too (2026-10-09).

**Out.**

- The first attempt goes to what is stored, and waits on no list, no read and no handshake
- The relays are read again before every attempt, and the set only widens. A relay added mid-run
  gets a listener and then the next attempt; nothing is dropped until the operator stands down
- An attempt is said to have left at the first relay's OK, and accounted for once every relay has
  answered or timed out: which took it, which refused and why, and how many of those the watch was
  heard on in the last five minutes, as far as this phone has read
- For that, `publishOrThrow` returns each relay's answer, and `sendDistressUntilAcknowledged` takes
  a list or a function returning one, which leaves the CLI as it is

**Back.**

- One listener per relay for the whole `Distress`, and one on any relay added
- **A listener counts only once its relay has sent a real end-of-stored-events**, the rule
  `subscribe.ts` and the box's listener already kept. The loop did not, so *no answer*, and ten
  minutes on *nobody is answering*, were said even when nothing was listening: a relay that wants
  AUTH closes the listener, and it reopened for ever
- Now the loop says when it is listening nowhere, and when it is listening again, and an attempt that
  could not hear says that instead of *no answer*

**To the ladder.**

- **The executor writes down where it hears**, every thirty seconds and on any change, to a file the
  daemon reads, as it already writes `drill.json`. The file goes one way, so nothing the daemon does
  can reach the executor
- The daemon publishes the watch's state, and its list, only where both of them hear. Today it
  publishes where it hears itself
- A file that is configured but missing, or older than ninety seconds, means the executor hears
  nowhere, and the log says why. A daemon given no file keeps today's rule and says so at every
  start
- Failing to write the file is logged, and never stops the executor

That closes the gap [`../watch/stationkeeper.md`](../watch/stationkeeper.md) names — *a `Distress`
sent only there pages nobody* — before a list can widen it to more relays. A relay where only the
agent would answer then counts as not heard, and a watch where that is true everywhere reads Dark,
before anyone signs on [invariant 4]. The cost is plain: a box whose executor is down reads Dark,
though its agent would still answer a `Query`.

**The executor's own key is built** (2026-10-08;
[`../spec/escalation.spec.md`](../spec/escalation.spec.md), *The executor has a key of its own*). A
phone handed it ends a box's `Distress` only on an answer that key signed, so a compromised agent, or
the daemon beside it, can tell an operator anything but that a person has them. D1 put it before any
box follows a list.

**Off the relays.** The contact rung, this phone calling or texting the operator's own person, is
untouched. It is the only route with no data, or with no relay the watch is heard on.

---

## 7. Said before anyone relies on it

**A relay counts as heard on** when it is one this phone would send a `Distress` to, its
subscription there has answered, a watch state under five minutes old arrived there, and it did not
refuse this phone's last signal. After §6 that means whoever holds the watch hears a `Distress`
there. A list entry or a handover never counts on its own, and what each relay showed is kept in
memory only.

The capability receipt gains one line before sign-on [invariant 9]: heard on *k* of *N* relays. Its
`Why` gives each relay, where it came from (handed over, or listed by the watch on a date), when the
watch was last heard there, and any refusal of this phone's last signal, with its reason. **A count
of relays is not a count of people**, and a test asserts the wording. **No relay answering this phone
is not a count of none**: offline, or with every relay failing, the phone could not ask, so the count
reads *Unknown* and never *if the watch moved* [invariant 7], and an attempt's account leaves out
where the watch was heard until the phone has a count to say it from.

The `Distress` screen shows the count this phone already holds, with its age. It opens no read of
its own until a `Distress` starts, when the read tells the watch's relays nothing the `Distress`
does not.

| When | What is said |
|---|---|
| Before sign-on | *Heard on 2 of 3 relays* · *Heard on 1 relay only: if it fails, nothing would hear a Distress* · *Not heard on any of 3 relays. If the watch moved, ask whoever gave you its address* |
| On Setup | Each relay a list added, with the list's date and whose key signed it · each line left out, and why · a handed relay outside the commons, named and not sent to · a list dated ahead of this phone's clock · a holder removed by two others, with an undo |
| Each attempt | *No relay took it* · *Left, but only on relays your watch hasn't been heard on. Still sending* · *Left on 2 relays your watch is heard on* |
| While it runs | *This phone can't hear answers right now, so a reply would be missed. Still sending* · *No answer heard, and this phone could not hear* · *Also sending on wss://x, which your watch now lists* |
| On the box | `[relays] no commons relay in this config` · the state withheld where the executor does not hear, and why · `--check` naming each listed relay the executor or the pager does not hear on, this watch's default subset, and the date of the commons |

---

## 8. Moving a watch

A procedure in [`../watch/stationkeeper.md`](../watch/stationkeeper.md), not a mechanism:

1. Pick the new relay from this watch's default subset, which `--check` prints
2. Add it to the daemon's, the executor's and the pager's configs
3. Keep at least one old relay until operators' phones have shown the watch's state since. The last
   list on it names the new relay, so a phone opened late can still follow while that relay keeps it
4. Then drop the old relay from the list. The box goes on listening there (§3)

A phone that missed the overlap reads Dark on every relay it has, and says so (§7). A `Distress` it
sends on a commons relay the box once used is still heard.

**Leaving a relay because it is no longer trusted is the exception.** Drop it before adding the new
one, so the last list it holds never names where the watch went. A relay retired from the commons
leaves every phone with the release that retires it.

---

## 9. What it costs, and what it does not hide

**New exposure.**

- The watch's list is a signed, public statement tying the watch key to its relays. Each of them
  already carries the watch's state under that key; what is new is the relays a reader was not
  watching. As kind `10002`, crawlers copy it from big public relays by habit, whatever NavCom does,
  so the set can become findable by key in one place. It names only commons relays, never a home
  relay
- A relay the list adds learns what a handed-over relay learns now of watch traffic: this phone's
  address, its operational key, each signal and `Distress` to the watch and when, including a
  `Distress` already running, and that it follows this watch. It is always a commons relay, so no
  signer can choose one of their own
- Once squads have per-member keys, each holder's shifts are visible per key on public relays,
  though never with a name
- A searched phone shows the listed relays beside the watch

**Fixed alongside**, because timing and order tie keys together where relays do not:

- **Public presence leaves on its own clock.** Today it goes out in the same second as the peer
  wraps at sign-on, seconds after the on-station signal, and its five-minute beat lands on every
  fifth peer beat all night, so anyone reading the relays can tie a card to an operational key by
  timestamp. It moves to a random two to ten minutes after sign-on, then every five minutes, give or
  take one. A listed operator appears up to ten minutes later than today
- **A sealed claim or report goes first to the poster's inbox relays that carry nothing else from
  this phone**, `relay.primal.net` before `nos.lol` today, and the screen says when only a relay that
  also carries the card took it. If that one relay drops it, the poster never counts it. The
  interchange spec's *no relay learns who took what* is corrected to what holds
- **The poster's inbox is read when missions load, on the mission relays, not at the moment of
  sealing**, once the poster's list is there (Q16; the Pi's session found The Record does not take
  kind `10050`). Today the question goes out over the connection that carries the card, a moment
  before the sealed claim does

**Not fixed, and named**, as [`../product/what-leaves.md`](../product/what-leaves.md) already names
it:

- Each commons relay sees the address and timing of every phone whose watch uses it. D3 accepts that
  from any stranger's relay, and the subsets keep it to a share of the watches
- One short published commons is also a list to block and to subpoena. A network that blocks every
  commons relay leaves only the contact rung
- One connection per relay still carries both keys wherever the watch's relays meet the operator's
  own. Every example box config uses the built-in pair, so on a standard box that is both relays. A
  subset drawn outside the meeting set moves watch traffic onto relays that never carry the card
- Every relay a `Distress` crosses sees that one happened
- Whoever fronts several relays, Cloudflare included, sees them together
- A listed operator's evenings can still be compared with an operational key's over months
- A holder you were handed can still lie to you, as any trusted person can

---

## 10. Declined, and deferred

**Declined.** Two are owner decisions and are in [`../declined.md`](../declined.md); the rest are
this design's own, recorded here with their costs.

- **A relay list on the card** (D4), and **a relay a member runs for operator traffic while D3
  stands** (D5). Both with their costs in `declined.md`
- **A relay list under the operational key**, kind `10002` or `10050`. It would publish, signed and
  for good, where the key that peers address presence to can be reached. *Cost:* the watch learns
  where an operator listens only from where their signals arrive
- **NIP-42 sign-in from the phone** with any key of the operator's. *Cost:* a relay that wants
  sign-in is closed to operators' phones, and the phone names it. The per-`Distress` reply key is
  the answer if the commons starts to require it
- **Spreading any list to indexers, or looking one up anywhere but the watch's own relays**, though
  NIP-65 and NIP-17 both advise spreading. *Cost:* a phone that has lost every relay its watch was on
  needs a person to find it again
- **A `Distress` sent "just in case" to relays the watch does not list.** Nobody listens there, and
  each learns this key raised one. *Cost:* a keyless pager on a relay the watch never listed hears
  nothing
- **NIP-11 fetches from the phone.** Weight is derived, never declared: the commons admits a relay on
  what it is seen to do. *Cost:* no warning about a relay's stated policy before connecting
- **Listed relays in a backup.** *Cost:* a phone restored after its watch moved reads Dark until the
  watch is handed over again
- **A second socket per key.** Same address, same second. *Cost:* the keys stay linkable on any relay
  that carries both
- **A list removing a handed-over relay, or a running `Distress` narrowing.** *Cost:* a relay the
  watch has left keeps getting that operator's sealed `Distress` until they remove it
- **Relay hints in clear tags** on anything published to or about a recipient. *Cost:* other clients
  find less
- **Dialling a relay named by somebody this phone was not handed**, such as a stranger's invite if
  invites ever carry relays. *Cost:* a stranger who shares no relay with this phone cannot be
  answered
- **Publishing a watch's list on relays it has left.** It would tell a relay the watch may have fled
  where it went, and §8's overlap does the same job. *Cost:* a phone that misses the overlap needs a
  handover

**Deferred**, each with its trigger:

| Deferred | Until |
|---|---|
| The per-`Distress` reply key: a fresh key for each `Distress`, so a phone can sign in to a crowded relay without proving any lasting key | To be designed now, and built before D3's reopen trigger can fire: the commons falling below its floor of three, or its relays starting to require sign-in or payment |
| Publishers' NIP-65 lists for missions | G4. Followed on the landing page, one would send every visitor's address to relays whose policy nobody here has read |
| NIP-42 for the box, with the watch key | A relay a Stationkeeper wants that requires it. The relay would hold a signed statement of what it now only sees, and a keyless pager cannot follow |
| Peers' relays in the pairing code and the sealed hello | An operator able to choose a relay besides the built-in pair. Dialled only after an explicit yes for that peer |
| One key per relay | Boxes on commons relays outside the meeting set. Until then it holds for no operator on a standard box, opens more sockets, and changes the pairing code, invites and presence |
| A sealed reply-to inside a `Distress` | A phone that cannot hear while its `Distress` is heard. It opens the box to relays a sender names, so it needs a cap no flood can exhaust |

---

## 11. The order

Decided 2026-10-08, with D1, D4 and D5. No squad is in the field yet, so the one migration costs
the least now.

| | What | Status |
|---|---|---|
| 0 | **Words.** This page, [`grid.md`](grid.md) §2, the build order and `declined.md`. The specs change with the code that keeps them: bootstrap.spec's *Relay selection*, watch-state.spec, signals.spec, escalation.spec's failure modes, stationkeeper.md. Still saying the refusal's argument was withdrawn: the `KIND_ANNOUNCE` docblock in `packages/core/src/events/kinds.ts`, and CLAUDE.md's relay-topology row, which is the owner's. Interchange rev 6 (§5.0 and §5.1, §11.2 as the commons, Q16) and NavCom's Pi page, telling the Pi's operator that a watch cannot list the Pi and that a watch the Pi runs must listen on commons relays | The four pages above done 2026-10-08; the docblock, CLAUDE.md's row and the interchange spec corrected, and the partner copy (rev 6, with Q16) and the Pi page republished, 2026-10-09. Done |
| 1 | **The `Distress` path, honest before it widens.** §6, with the receipt line from §7, `watchTargets()`, mission relays never written to, and the box's start line and `--check` | Built on the phone and in the box's client, 2026-10-07, mission relays included; `watchTargets()` and the receipt line, 2026-10-09: *heard on* before sign-on, its `Why` relay by relay, and the count held on the `Distress` screen; the executor's hearing file, the daemon publishing only where both hear, and the box's start lines and `--check`s (the daemon's, the executor's and the pager's), also 2026-10-09. §7's commons wording on the box waits on phase 3 |
| 2 | **The executor's own key** | Built, 2026-10-08 |
| 3 | **The commons.** §1's rules, in `packages/core/src/relays.ts` with the meeting set inside it, the build failing when an entry goes stale; `listable()` refusing what is outside it; `--check` printing each watch's subset | Not built |
| 4 | **Boxes follow lists.** §3, §4, §5 and §8 for a box's key | Not built. Waits on phases 1 to 3 |
| 5 | **Per-member keys, with vouching**, and the box's recovery key. Every squad re-forms once, in person | Not built |
| 6 | **Squads follow lists.** §3 and §4 for holders' keys | Not built. Waits on phase 5 |

Beside the order, waiting on nothing: §9's three timing fixes, the inbox read waiting on Q16.

**Tests** run on `web/e2e/relay-server.ts` and `packages/watchtower/test/helpers/local-relay.ts`,
and each runs first against the code before it, and fails there. The ones that carry the weight:

- a relay that refuses every listener, and the loop saying it cannot hear rather than *no answer*
  (phase 1, built)
- an executor deaf on one relay, and the state withheld there (phase 1)
- The Record never sent an `EVENT` (phases 1 and 4)
- a phone handed A, a list on A naming B, a `Distress` landing on B, and a person's answer published
  only on B ending it; then the same with the list arriving mid-run (phase 4)
- forged, older and future-dated lists leaving B undialled, a list naming a relay outside the commons
  leaving it undialled whoever signed it, and a handed relay the list leaves out still sent to
  (phase 4)
- a holder's list and answers ignored once two other holders leave their key out (phase 5)
- the REQ's two filters checked in a unit test, since the test relay ignores `limit` (phase 4)
- sockets counted in `relays.spec.ts` for Alone, Paired, and Watched on a stock box config (phase 4)
- every control in it tapped, not just rendered

**On the device floor**, a list adds a filter to a subscription already open, and a socket only for
each relay it adds. The reader stays in the terminal's graph, out of the root console's, which is
near the top of its 60 kB.

---

## 12. Decided

**D2, 2026-10-07: NIP-65, kind `10002`, for a watch's relay list.** *Cost:* crawlers copy it from big
public relays by habit, so a watch's set of relays can become findable by its key in one place; and
it is one more event to publish and to read.

**D3, 2026-10-07: the refusal `no-operator-traffic-on-a-private-relay` stays as written.** *Cost:*
no grid relay carries operator traffic, whatever G4 says, so operator traffic stays on public relays
NavCom can hold to nothing, accepted by choice. The Pi's built inbox for private claims stays off.
[`grid.md`](grid.md) §2, which had withdrawn the refusal's argument, is corrected to agree with it.

**D1, D4 and D5, 2026-10-08,** adopted together, as written, from a game-theory model of the three
as one mechanism. The owner asked for the most secure, fair and future-proof answer; the model found
it the only combination that stays an equilibrium as NavCom grows.

- **D1: handed keys inside the commons** (§2, §4), with vouching shipped alongside per-member keys,
  the executor's key before any box follows a list, and a box listening on every commons relay it
  has ever been configured on or listed (§3)
- **D4: never.** No relay list on the card, declined rather than deferred. If the meeting relays must
  change, the meeting set moves as a whole, by release and a notice in the interchange spec. If an
  operator cannot reach it, partners read the commons
- **D5: a commons NavCom keeps** (§1), each watch's default subset by rendezvous hashing (§3), the
  member-run relay declined while D3 stands, and the per-`Distress` reply key as the hedge (§10)

**What they cost**, as the model listed them:

- Every squad re-forms once, in person, when per-member keys ship. No squad is in the field yet, so
  this is the cheapest it will be. An older cached app fails safe for a squad: it reads Dark and
  keeps sending
- Two more keys for each Stationkeeper: the executor's own, and a recovery key kept offline with a
  second person
- A standing duty for NavCom. Keeping the commons falls today on the busiest person, who is also the
  only on-call. The keeper still decides admissions: the visible structure
  [`../research/lore.md`](../research/lore.md) asks for, dated and open to challenge
- D3 enforced strictly: no relay outside the commons ever carries watch traffic
- Each holder's shifts are visible per key on public relays, though never with a name
- Holder states carry the roster, and a quiet squad reads Dark once the vouching window passes. A
  squad of two that loses one member re-forms in person
- A new relay waits months before it is eligible, and boxes must update within a retired relay's
  grace period
