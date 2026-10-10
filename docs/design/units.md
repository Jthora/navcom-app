# Units and the Earth Alliance

A unit is the crew that [`groups.md`](groups.md) designs, plus a charter. The charter says who leads
the unit, how leaders are chosen and recalled, what they may direct, and whether the unit may serve
under a higher unit. Units team up from the bottom into higher units. The default top is the Earth
Alliance, which is a published text that units sign. This page is the design as the owner decided
it. The wire, the profile, chat and search are in groups.md and are not repeated here.

Status: **decided 2026-10-09. Nothing here is built.** The owner took eight decisions that day
(§0) against stated criteria: fairness, optionality, the best experience, what the technology can
do, and game theory. Each decision can be reversed.

- **What ships first:** leaf units with their governance. That means charters, terms, recall,
  succession and re-forming. They ship as groups.md's phase 2, under its gates, and only after the
  owner has written the Articles, because a unit's charter carries their hash.
- **What waits on the commons** (G3.3 in [`../build-order.md`](../build-order.md)): teaming up,
  higher units and Alliance commands. Until units draw their relays from the commons, one relay
  operator can draw the whole tree (§3).
- **What waits on other gates:** offers inside a unit wait on writ ceilings and standing (11.5,
  11.6); orders wait on those and on a lawyer's review.
- **Specs and refusals.** In U0, on 2026-10-09, the published refusals `no-tasking` and
  `no-credential-gate` were narrowed, `no-operator-traffic-on-a-private-relay` was extended to crew
  and unit events, and signals.spec's *What is NOT here* was scoped to signals. Each says decided
  and not built. Each refusal's text changes again in the commit that ships what it covers (§16,
  §18).

---

## 0. The design in brief

- **One object: the unit.** A unit is a crew with a charter. The joiner reads the charter before
  showing anything of their own. A unit may name at most one higher unit. A higher unit is itself a
  unit, and its seats are held by the leaders of the units under it.
- **Two shapes.** A unit is either **Led**, with a CO and an XO, or **Any two**, the flat crew. Its
  room is 4, 8, 12 or 15, fixed when it is founded.
- **Templates** set vocabulary, markers and defaults. Military is one template among four, and every
  template runs on the same code.
- **Founding takes a pair, in person.** In a Led unit the two founders hold CO and XO for the first
  term only. After that, members elect, and the CO never appoints the XO.
- **Governance comes from a short, closed menu.** The menu is signed at founding and enforced by
  every honest phone with no server.
  - Every Led unit has terms of at most 24 months and a standing recall petition.
  - Silence counts as no.
- **A unit can take back what it gave you, but never what you did.** NavCom supplies the means of
  accountability, never the verdicts.
- **A higher unit is a coalition.** It holds seats only, and it never reaches inside a unit.
- **The Earth Alliance is the Articles plus a proposal rule.** It is preselected at founding.
  Independent sits beside it at the same weight, and Alone stays the operator's default.
- **Invariants 1 to 7 hold everywhere** (§15). Every rule this design does bend is listed in §16.

**The eight decisions of 2026-10-09:**

| | Decided | Where |
|---|---|---|
| 1 | Authority is a founding choice, shown before joining. There are three levels: word and offers, the default; orders, which a member may decline at no cost; and orders that may name a member, where declining may lead to removal from that unit | §10 |
| 2 | Re-forming is remote. It reaches only people already admitted in person, and the new unit carries its lineage. This reverses the in-app fork the first crews draft declined | §9 |
| 3 | The floor is the menu. Every Led unit has terms of at most 24 months and a standing recall petition. The CO's two-consecutive-terms cap is each charter's choice | §8 |
| 4 | A higher unit reaches as a coalition, seats only. It never chooses a unit's leaders and holds no roster below its own seats | §11 |
| 5 | Titles belong to each unit and are shown inside it only. The release refuses general-officer grades, *Supreme*, *High*, and any real unit's name | §13 |
| 6 | A member may say they served in a self-written line on their own roster row in one unit. It is off by default, grants nothing, and is never public | §13 |
| 7 | The Alliance's top is the Articles, which the owner writes, plus a proposal rule: any 3 Alliance commands may jointly propose a new version. There is no standing council | §12 |
| 8 | Leaf units ship first, with their governance. Teaming up and higher units ship once the commons exists | §18 |

Earlier the same day the owner decided five things:

- crews are in, with chat;
- groups may be hierarchical, with optional military structure;
- the Earth Alliance is the default top, with Independent units beside it;
- NavCom inclines people toward the Alliance;
- the leaderless "rings" of the earlier echelons answer are retired.

The crew-level decisions also made that day bind every unit. They are recorded in groups.md:

- unit data is Wipeable and never goes in a backup;
- there are two post clocks for every unit: lines last 7 days and roster states 30 days;
- states are padded to room;
- no agent holds a unit key;
- a member's card is shown in person and never stored in the unit;
- the log is cached sealed, in Wipeable;
- rooms are 4, 8, 12 and 15.

---

## 1. Why

The owner's direction, 2026-10-09:

- *"Military-structures (which are OPTIONAL ways to structure groupings) would be veteran friendly,
  and we want veterans on our system to really feel at home."*
- *"If 2 groups team up, they will need to assign a higher ranking CO (and XO, etc.) for further
  organizing the structure of it. This should also lighten the load on the data issue that Nostr
  has."*
- *"The default highest grouping structure is Earth Alliance. Also by default is an Independent (non
  federated) group, so people can also form groups not under superior structures ... the intention
  is to incline people to establish an Earth Alliance."*
- *"We're trying to get who we need on board with structures that work for them."*

The owner judged the earlier design too constrained and its "rings" *"cartel-like"*. In that
design, crews were flat, had no leaders, and were joined by rings of spokes.

**Units are autonomous.** The owner's terms:

- Units carry their own consequences: not following through, not being at post, failed objectives.
  NavCom does not run or judge them. This is a design stance, not a statement about legal
  responsibility, which §17 leaves to a lawyer.
- Every outcome is accepted: strict leaders, indifferent ones, abandonment, members re-forming after
  a leader fails, collapse, and collapse caused by sabotage.
- NavCom should still support units that do good, and let strong units survive being infiltrated:
  *"Figure out the most fair way to proceed."*

---

## 2. What the research showed

Quotes were checked against saved copies of the sources during the design passes. Sources marked
*medium* were read through a summary. **Nothing was measured on NavCom's users.**

**Echelons and span.**

- FM 6-0 (2014): *"As a rule, commanders can effectively command two to six subordinate units."*
- NIMS (2017) puts the optimal span at one supervisor to five.
- ADRP 1-02 (2013) gives the echelon markers used in §5. Its ++ marks *"a unit or units, an
  organization, or an area under the command of one individual"*, so it belongs only where one
  person leads.
- FM 3-21.8 (2007): *"The Infantry squad is a model for all tactical task organizations."* Leaders
  consolidate reports at each level rather than passing them up raw.

**Rank is not position.**

- AR 600-20 (2014): *"Command is exercised by virtue of office and the special assignment."*
- The same grade fills different positions. So rank and position are two fields here, and only
  position carries authority.
- Army succession runs on seniority and absence (*"temporarily absent"*). A temporary commander
  *"will not, except in urgent cases, alter or annul the standing orders"*.
- NavCom takes *acting* command and the standing-orders rule. It cannot take seniority, which ranks
  people on one axis, or absence, which needs something to decide that a person is absent
  (invariant 3).

**Volunteer bodies that already wear military form.**

- **The US Coast Guard Auxiliary.** Members elect the Flotilla Commander and the Vice, who serves
  *"as Executive Officer"*. Terms are one year, and *"The FC may serve no more than two consecutive
  terms"*, while the Vice is uncapped.
  - It is *"a chain of leadership and management rather than a chain of command"*, and its insignia
    *"do not reflect ranks"*.
  - Its upper levels *"exist to support the flotillas"*.
- **Inyo County's search-and-rescue posse.** Officers are elected for one year, limited to two
  consecutive terms. They can be recalled by *"a two-thirds vote of the Members present"*, after
  thirty days' notice.
- **The Civil Air Patrol is the contrast.** Commanders are appointed from above. Military grade is
  imported on a DD-214, a document that carries a legal name.
- **Team Rubicon.** Volunteers answer a call to deploy. About 64% were veterans or active duty in
  2019.

**How structures like this fail.**

| Case | What went wrong | What this design takes from it |
|---|---|---|
| Maricopa County posses, 2011 to 2019 | The DOJ's bias findings reached *"posse volunteers"* | A ranked volunteer body can be turned on the people around it. Invariant 1 binds hardest on a chain |
| Alaska State Defense Force, 2008 | A commander in post since 1996 faced a complaint of removals *"without due process"* | Terms, recall, and a reply before removal |
| Salvation Army, 1929 | The General claimed the right to name his successor, and the High Council removed him | Nobody names their own successor |
| US Army Volunteer Reserve Association, 2006 to 2008 | It sold ranks, from $95 for sergeant to $335 for lieutenant general | A portable grade invites sale |
| Cajun Navy, 2016 to 2026 | About six groups share the name. One posted *"WE ARE THE ONLY LEGIT CAJUN NAVY!"* | Legitimacy has to come from something anyone can check |
| Hong Kong, 2019 | Police made a Telegram administrator export a member list of 20,000 to 30,000 | No phone holds a formation's roster |
| WOSM, the world Scout body (medium) | It recognises one organisation per country, which leaves many outside | A monopoly default produces outsiders |

**Terms and recall.**

- Every durable body found either bounds how long someone holds office or has a way to remove them
  that the leader does not control.
- Short terms make the election itself the recall: *"Flotillas have been known to deny
  self-important FCs a second term."*
- Peru shows what happens when recall is made too easy. From 1997 to 2013, 5,304 local authorities
  faced recall and 1,739 were removed. Recall became *"el recurso de los que perdieron las
  elecciones"*: the resource of those who lost the elections.
- Peru's 2015 reform filled a removed seat from the removed official's own list. Authorities facing
  recall then fell from 1,304 in 2012 to 89 in 2017.
- Pirate articles (Leeson 2007) were agreed before sailing and never amended mid-cruise. A crew that
  split drew up new articles.

**Reach.**

- JP 3-16: nations *"rarely, if ever, relinquish national command"*. A foreign commander may not
  *"administer discipline, promote anyone, or change the US force's internal organization"*.
- Federations sanction the member body, not its people. The IFRC suspended the Belarus Red Cross in
  2023 when it would not dismiss its Secretary General (medium-high).
- Deep reach rests on an outside anchor: CAP's on an Air Force agreement, the Army's on personnel
  law. NavCom deliberately has none.

**Autonomy and sabotage.**

- Graduated sanctions work: *"gossip or a gentle reminder is sufficient, but more severe forms of
  punishment must also be waiting in the wings"* (Wilson, Ostrom and Cox 2013).
- Exit and voice are how a body learns it is failing (Hirschman).
- The adversary's real tool was suspicion. Under COINTELPRO, the FBI's San Diego office reported that
  members of a group it targeted had *"taken to running surveillances on one another"* (Church
  Committee).
- Procedure is a sabotage surface. The OSS manual (1944) advised *"Insist on doing everything through
  'channels'"*.
- Removing a leader rarely ends a group (Jordan 2009). Of 315 GitHub projects that lost their core
  developers, 41% survived under new ones (Avelino et al. 2019).

**Veterans.**

- 47% of post-9/11 veterans said readjusting to civilian life was difficult (Pew 2019).
- What they miss is common goals and a unit. A peer who has already made the transition helps
  (Ahern et al. 2015).
- A central military identity predicted *lower* social connectedness (Flack and Kite 2021), so mixed
  and plain units help veterans too.
- Meaningless work drives veterans out (VetAdvisor and IVMF 2014), and many are uncomfortable being
  thanked for their service (Cohen Veterans Network 2019, medium).
- Veterans are not one constituency. About 1 in 3 women and 1 in 50 men report military sexual
  trauma when screened by the VA.
- *"Veterans in the process of military to civilian transition are particularly vulnerable to
  extremist recruitment"* (START 2023). The "white hats" story that courts them is the one
  [`../lineage.md`](../lineage.md) calls the Earth Alliance psyop.
- Every official proof of service runs on legal identity. **NavCom cannot check service without
  breaking invariant 6.**

---

## 3. What the wire allows

Units use groups.md's wire unchanged:

- outer kind `1913` events from throwaway keys, under daily routing tags;
- inner `20917` statements signed by per-unit keys;
- epoch secrets sealed to the roster with hybrid ML-KEM-768;
- two relays per unit, taken from the list the release ships.

The sizes below were measured with the repo's own primitives. None was measured on a relay.

**What it allows:**

- **A sealed state holds at most 15 seats, and that is a protocol constant.**
  - Rooms stop at 15 by the owner's decision of 2026-10-09, taken on figures for `group.ts`'s
    nesting, under which 16 seats is 66,041 B, 505 B over strfry's default limit of 65,536.
  - groups.md §7's crew envelope, which units use, fits room 15: about 38.7 kB for a state and
    46.4 kB for a welcome, the length every room-15 event is padded to. It would probably fit a
    padded room 16 too: about 41 kB for a state and 48 kB for a welcome, extrapolated from the
    room-12-to-15 slope and not measured.
  - So the cap now rests on that decision and on the group-size research (groups.md §5), not on the
    event limit. Revisiting it is the owner's call.
  - The rooms stay fixed, so padding buckets do not split, and a relay that cannot take the room-15
    length cannot carry units. Above 15 people, units nest.
- **Every echelon gets its own sealed net, with no new cryptography.**
  - A leaf net holds the unit's members.
  - A higher net holds its own CO and XO, any senior NCO or staff seat, and the CO and XO of each
    unit under it.
  - Each person makes a fresh key for each net.
  - With the room capped at 15, 2 + 2s ≤ 15 gives a span of at most 6, which is FM 6-0's *"two to
    six"*.
  - Higher nets use the same envelope and rooms as leaf units, so a reader of the relay cannot tell
    them apart by size.
- **What a phone holds is bounded by span, not by the size of the network.**
  - A member holds at most 14 other callsigns.
  - A leader holds about 28 at the caps, or 18 in an illustrative model of squads of 10 and a span
    of 4.
- **Teaming up re-keys nothing below.** Founding a higher net is one founding state, plus a hello
  and a welcome for each seat holder, because each makes a fresh key for the net. Every one is
  padded to the net's room like any other.
- **Taking over needs no key movement.** The XO already holds every key the CO holds.

**What it cannot do:**

- **Keep a formation-wide key secret.** Assume 2% of phones are taken a year. The chance that some
  holder's phone is taken in a given week is:

  | Holders | 10 | 40 | 160 | 640 | 2,560 | 10,240 |
  |---|---|---|---|---|---|---|
  | Chance a week | 0.39% | 1.5% | 6.0% | 21.8% | 62.5% | 98% |

  So there is no formation-wide sealed key. Word is carried down by people.
- **Hide the tree from relay operators.** A leader's phone reads two tags from one IP address,
  which ties a unit to its higher unit. Each net draws 2 relays from R relays:

  | R | 2 (today's meeting pair) | 3 (the commons floor) | 10 | 20 | 40 |
  |---|---|---|---|---|---|
  | Some operator sees a given link | every link | 100% | 37.8% | 19.5% | 9.9% |
  | One particular operator sees it | 100% | 44% | 4% | 1% | 0.25% |

  Colluding operators, a shared front such as a CDN, or an ISP see more. At R = 20, five colluding
  operators link about 20% of links.
- **Enforce unity of command.** Keys are unlinkable by design, so one person can sit in several
  chains.
- **Stop forked software.** Honest phones refuse what a fork builds, and that is all.
- **Let a higher unit act inside a unit.** It would need that unit's keys.
- **Make removal retroactive.** A removed key keeps what it already read.
- **Deliver anything in bounded time.** The wire is pull-only.
- **Prove rank or service** without a legal name.
- **Guarantee deletion.** NIP-09 deletions and NIP-40 expiry are requests that relays may ignore.
- **Write quickly from one venue's Wi-Fi.** Many writes from one address may share one rate limit.
  - Each person admitted is four padded events: a sign state, the admission state, a hello and a
    welcome (groups.md §6). The founding pair's own events are not designed yet; counting about
    three for them, founding a unit of n people at one meeting is about 4n − 5 events.
  - That is about 11 events for 4 people and 55 for 15. At 8 posts a minute, about 1.4 minutes and
    7 minutes, before the random delays groups.md §7 puts between events. At room 15 the 55 events
    are about 2.5 MB of writes.
  - The 8-a-minute figure comes from an example configuration. Whether the relays actually run it
    is unverified.

**Shapes not taken:**

- **NIP-29 groups.** The relay holds the roster and reads every message.
- **NIP-58, NIP-05 or NIP-51 for rank.** Any of them lists everyone ranked.
- **NIP-17.** Its own advice stops at ten participants.
- **MLS or Marmot.** They ship classical-only suites.
- **A formation-wide key.**
- **A higher unit holding rosters below it.** That is the Hong Kong export.
- **A maintainer-held Alliance key.**

---

## 4. The unit

**Each member's phone keeps one record per unit.** It holds:

- everything a crew record holds in groups.md §5: an id that is never published, a name inside
  ciphertext only, a roster of fresh per-unit keys, the epoch, the Agreed line and two relays;
- the charter, and the fields this page adds to a roster row: an office, and the self-stated service
  line (§13).

| Charter field | What it holds |
|---|---|
| **Template and shape** | Military, Plain, Incident or Affinity (§5). Led or Any two |
| **Room** | 4, 8, 12 or 15 |
| **Offices** | The CO's and XO's callsigns in this unit, how each is chosen, and when each term ends. Never how long anyone has served |
| **Door** | Who admits and who removes (§6) |
| **Authority** | The level chosen under decision 1, and what declining costs (§10) |
| **Higher** | *May serve under a higher unit*: yes or no. Then one of three: *Earth Alliance*, carried as the Articles' hash; *Independent*; or a named higher unit's marker, with the markers up to the top |
| **Governance** | Threshold, term and CO cap, from the menu (§7) |
| **Lineage** | *Re-founded from*, as a 16-byte hash, if the unit was re-formed (§9) |

**The summary code shows the charter before the joiner shows anything** (invariant 9).

- It is 443 characters, QR version 16 at medium error correction. With a lineage it is 481
  characters, version 17.
- Whether device-floor cameras read codes that dense is unmeasured.
- The higher unit's *name* stays out of the code. It is said in person and appears in the welcome,
  so a photographed code shows the shape of a chain but not which unit it hangs from.

**A person may belong to any number of units:** a squad, a guild and a co-op at once. Each unit has
at most one higher unit. So units form trees, while people still overlap freely, as
[`missions.md`](missions.md) §2's sets do. That section's rows map like this:

- **Crew:** a leaf unit.
- **Organisation:** any unit that posts missions in its own name. It is a body under
  [`economy.md`](economy.md) §6, and posting in its own name waits on 11.5. **Only a body holds
  Honor, rungs or delegated ceiling.** A unit that is not one holds none, as groups.md §10 says of
  crews, so a wipe or a removal strands nothing.
- **Faction:** an Independent formation under its own charter.
- **Alliance:** the Earth Alliance, which is *"the charter, and only inside it"*.

**Everything groups.md decided for crews holds for every unit, at every echelon:**

- unit data is Wipeable and never goes in a backup;
- the two post clocks;
- padding to room;
- no agent key;
- cards shown in person, never stored;
- a log cached sealed.

---

## 5. Templates and echelons

**A template is data, not code:** vocabulary, markers, defaults and copy, all on one code path.
Military and Plain ship first. Incident and Affinity follow when a real group asks for one. Later
templates (Cooperative, Mutual-aid pods, Guild) are added on request.

| Template | Shape | Names | Notes |
|---|---|---|---|
| **Military** | Led | The echelon ladder below. Positions: CO, XO, team leader, platoon sergeant, first sergeant, sergeant major, staff, signaller | Every term carries a one-line plain gloss the first time it appears |
| **Plain** | Led or Any two | Crew, Lead, Second, Group of crews | NIMS asks for *"plain language and clear text, not codes"* |
| **Incident** | Led, time-boxed | Incident Commander, Deputy, Section Chiefs, Strike Team or Task Force Leader | Stands up for one operation and stands down on a date. Positions go to whoever the unit judges fit, never by seniority. It is the template for joint operations (§11) |
| **Affinity group** | Any two | Affinity group, spoke, spokescouncil | The established vocabulary for what the retired rings tried to be. It has no offices, so it holds no seat in a higher unit, and it works with other units through joint operations |

Every template starts at word and offers, the default level (§10).

### The echelons of the Military template

A unit's echelon comes from its shape, never from a headcount:

- A leaf unit is a **Team** if its room is 4, and a **Squad** if its room is 8, 12 or 15.
- A higher unit is one echelon above its deepest unit.
- Section (●●) is an alias for Commonwealth usage.

| Echelon | ADRP 1-02 marker | Made of | Doctrine's size, as guidance only | Positions | Seats on its own net |
|---|---|---|---|---|---|
| Team | Ø | 2 to 4 people | 4 | Team leader (CO), assistant team leader (XO) | Its members |
| Squad | ● | 5 to 15 people | 9 Army, 13 USMC | Squad leader (CO), assistant squad leader (XO). Team leaders are positions inside the same net, so fire teams cost no extra net | Its members |
| Platoon | ●●● | 2 to 6 units | 16 to 50 | Platoon leader (CO), platoon sergeant (XO), optional signaller | 2 or 3, plus 2 per unit, at most 15 |
| Company | I | 2 to 6 platoons | 60 to 200 | CO, XO, optional first sergeant | The same |
| Battalion | II | 2 to 6 companies | 300 to 1,000 | CO, XO, optional sergeant major and staff (S2 situation, S3 missions, S4 supply, S6 relays and keys) | The same. **Each staff seat costs span**: four staff seats leave room for four companies |
| Brigade | X | 2 to 6 battalions | 3,000 to 5,000 | As battalion | As battalion |
| Division and up | XX and up | — | — | The data model allows them. Screens leave them unnamed until a formation needs one | — |

At squads of 10 and a span of 4, the ladder reaches 40 people at platoon, 160 at company, 640 at
battalion and 2,560 at brigade. **One net never holds more than 15 seats at any echelon.**

**Positions left out, each for a reason:**

- **No S1 (personnel).** There are no personnel files.
- **No S8 (finance).** NavCom holds no money.
- **No position for an agent** (§15).

**A first sergeant's job here is people, not paperwork.** They welcome newcomers, arrange
re-admission after a wipe, and are the peer who has already made the transition. They keep no file
on anyone.

**Words kept out of every template:** ring, cell, family, boss, capo, made or sworn member, soldiers
in the sense of a leader's followers, territory, turf, tribute, dues, outfit, syndicate, cartel,
inner circle, and brotherhood (which also excludes).

**Words used:** unit, command, chain of command, charter, stand up, stand down, change of command,
designation (*1st Squad*), joint operation, CO, XO, the Articles, Earth Alliance.

**What the screens show.** NavCom never asks whether anyone served and holds no veteran field. What
a person sees depends on the template their unit chose, plus one display preference of their own.

- **A member of a Military unit** sees:
  - the chain line with its markers, ending in *Earth Alliance* or *Independent*;
  - the CO and XO, with the date each term ends;
  - intent with its author and age;
  - carried word with its carriers;
  - change-of-command notices.
- **A non-veteran in the same unit** sees the same screens, with a gloss on each term. A display
  preference swaps in plain labels.
- **Nobody ever sees:**
  - *"Thank you for your service"*, "hero" or a veteran badge;
  - a prompt to declare service;
  - fields for branch, MOS, rank held, decorations or discharge;
  - anyone's attendance, last-seen or online state;
  - who declined, or who has not answered.

---

## 6. Founding, admission and leaving

**Founding.**

1. **Two people found a unit together, in person, each on their own phone.** No unit ever exists
   with one member.
2. **The founding screen asks, in this order:**
   - template, with nothing preselected;
   - shape;
   - room;
   - authority, with word and offers preselected;
   - the governance rows;
   - *May serve under a higher unit*;
   - *Higher*, with **Earth Alliance preselected and Independent beside it at the same size and
     weight**.

   Every option carries one line of cost.
3. **In a Led unit, one founder becomes CO and the other XO.** Each confirms their own office with
   hold-to-fire. They hold those offices for the first term only. At the first election, CO and XO
   are separate ballots, so a founder's chosen partner does not stay XO by default.
4. **Founding a private unit costs no writ.**

**Why a founder leads at all, and only for one term:**

- Founding costs the founder something, and the unit's value is shared. A first term in command is
  the founder's return, and it is the familiar shape: whoever stands a unit up commands it.
- Command with no term and no recall would make the founder's future independent of their conduct,
  and joiners could see that before joining.

**Who may sign what.** groups.md §7 defines each of these acts as a state on the wire, and leaves who
may sign it to the charter. Admission is always in person, through groups.md §6's summary code and
join code, with two members present, each on their own phone.

| Act | Led | Any two |
|---|---|---|
| **Admit** | A position holder (CO or XO) plus one other member. Command keeps the door, but never alone | Any two members |
| **Remove a member** | A position holder plus one other member, with the reason in their own words | Any two members other than the one removed. In a unit of two either can remove the other, and the screen says so |
| **Remove a leader's key** | Two members other than that leader (below) | — |
| **Rename, move relays, agree to a crew card** | The same two who may admit | The same two who may admit |
| **Set the Agreed line, post a line, rotate weekly** | Any member (groups.md §9) | Any member |
| **Intent, standing orders, carried word, offers, orders** | The CO or the XO (§10). Only a confirmed CO changes standing orders | No office, so none of these. The Agreed line carries what the members agree |
| **Stand down, leave a higher unit, or leave the Alliance** | The CO and the XO | Stand down or leave the Alliance: any two members |

- **The rules count phones, not people.** One person with two phones counts as two, and groups.md's
  join screen says so.
- **Every member sees a removal's receipt:** *"Raven and Wren removed Kestrel, 3 Oct. Kestrel keeps
  everything already sent."*
- **Removing a leader's key** is for a leader's phone that is lost, seized or taken.
  - It does not change who holds the office. The XO becomes acting CO (§8), and the charter's
    selection rule runs.
  - The leader whose key was removed may be re-admitted in person by any two members while that
    election is open, without the acting CO, and may stand in it.
  - So two members can force an election, but they cannot choose its outcome.
- **Nothing removes anyone automatically.** No timer, no count and no missed deadline removes
  anybody.

**Leaving.**

- **A member leaves any unit at any time,** quietly or by saying so.
  - Leaving costs nothing: no Karma, Hours, Supply, Intel or Honor.
  - It ends every standing order the member was under, and their phone deletes the unit.
  - *Leave and say so* is the default in the copy, so people who stop coming do not sit on the
    roster as permanent no votes (§8).
- **A unit can stand down** with one co-signed statement that carries a 280-character lessons line.
  It then reads *"stood down 9 Oct"*, never *failed*.

---

## 7. Governance: the menu, and the rules a phone cannot enforce

**Founders choose how their unit's later leaders are chosen, from a short closed menu.** The choice
is written into the charter every member signs, and every honest phone enforces it with no server.
That holds only for rules a phone can decide from signatures alone.

### The test every rule must pass

The wire has no server. Phones' clocks can be wrong by hours or days, and a relay can hold back any
event. A rule can be enforced by every honest phone only if it is one of three things:

1. **A count of signatures against a roster frozen when the vote opened.** A signature some phone
   missed can only move a result toward passing. A lost, late or withheld signature delays a
   result; it never invents one.
2. **A "not before" date on the act of whoever wants to act early.** Back-dating only makes the act
   earlier, so it fails.
3. **The order of signed states in the unit's chain.**

How the candidate rules fared, measured in a squad of 9 (8 electors) with a quarter of members never
reading, 40,000 trials a row:

| Rule, when 40% of active members want a recall | Passes, honest count | Passes when whoever closes the vote leaves out no-votes |
|---|---|---|
| Majority of the whole electorate | 4.5% | 4.5% |
| Two-thirds of the whole electorate | 1.7% | 1.7% |
| Majority of ballots cast, half voting | 21.8% | 42.8% |
| Two-thirds of ballots cast, half voting | 10.2% | 42.8% |

- **Counting ballots cast lets whoever posts the closing count choose which no-votes it carries.**
  When electors were split across relays, those rules passed falsely in 0.9% to 7.5% of trials.
  Counts against the whole roster gave no false passes in any case.
- **"No new recall this term after a failed one" protects the incumbent.** An ally opens a weak
  recall early, it fails, and the CO is immune for the rest of the term.

### The menu

Each row is chosen once, at founding, and signed by everyone founding the unit: both founders of a
leaf unit, and every joining pair of a higher unit.

**Leaf unit:**

| Row | Values | What it costs |
|---|---|---|
| **Shape** | Led · Any two | An Any two unit has no office, so the rows below do not apply to it |
| **Threshold**, for both election and recall | Majority of the electorate · Two-thirds of it | Silence counts as no under both. Two-thirds protects a good CO better, but quiet members make elections and recalls harder to pass |
| **Term** | 12 months · 24 months | The research points to about a year for a leaf unit. Two years entrench for longer |
| **CO cap** | None · Two consecutive terms, then one term out | Small units run out of candidates: a team of 4 has 3 others |

**Higher unit:**

| Row | Values | What it costs |
|---|---|---|
| **Method** | Board: one endorsement per seated unit, signed by its CO and countersigned by its XO · Rotation: the seated units' COs take the CO office in seating order, and the next in turn serves as XO | Board: each unit weighs the same whatever its size, a pair that disagrees abstains, and two units can deadlock while the incumbent holds over. Rotation: command comes by turn, not fit |
| **Threshold**, for selection, recall and sanctions | Majority of seated units · Two-thirds | The two give the same number at spans of 2, 3, 4 and 6, and differ only at 5. At a span of 3, two allied units decide alone |
| **Term** | 12 months · 24 months | The research points to about two years for a higher unit. Longer means slower relief from a captured top |
| **Reach** | Seats and expulsion only · Also suspension of a seat, confirmed by a second holder | Without suspension, the only remedy against a bad pair is expelling their whole unit. With it, a captured top plus one ally can strip honest pairs of their seats (§11) |

### Rules every charter carries

These are not on the menu, so no charter can weaken them.

- **The electorate is frozen when a vote opens**: the roster at that state, minus the person the vote
  is about. People admitted later do not vote. People removed later still count.
- **One endorsement per elector per run, which cannot be changed.** An elector who signs two is shown
  and named. If two results naming different winners cross, nobody wins and the incumbent holds over.
- **The first set of signatures to reach the threshold takes effect.** Any phone holding it posts the
  result. There is no window, no closing count, and no counter to trust.
- **Nobody names their own successor, and the CO never appoints the XO.** In a board-elected higher
  unit, the XO's first term is half a term, so the two offices are never chosen at the same time.
- **A removal that crosses an open vote is void** if the person the vote is about signed it, or if it
  removes one of that vote's electors.
- **Each change of command carries a co-signed checkpoint.** It holds:
  - the term number;
  - the count of consecutive terms;
  - the petitions this term;
  - the hash of the previous change of command.

  A member holding the older chain sees any mismatch. A joiner trusts the checkpoint's signers.
- **Each result carries its rule code and a digest of its inputs and outcome.**
  - A phone that computes something different says *"phones disagree about this result"*.
  - A phone that does not know a rule code says *"needs an update"*.
  - A code never changes meaning once shipped.
- **A statement dated in the phone's future is held back, never dropped.** A phone shows its own
  clock error before it signs anything.
- **Reasons travel as ordinary lines that expire.** A governance state carries only their hash. Once
  a result settles, phones keep the checkpoint and drop the individual signatures, so a seized phone
  is not a signed map of a unit's dissent.
- **The rules are fixed for the unit's life.** Changing them means re-forming under a new charter
  (§9), as pirate crews drew up new articles.
- **Agents take no part.** No agent endorses, petitions, holds a seat or signs a result.

### What a phone cannot enforce, so the menu does not offer it

- **Secret ballots.** These would need new cryptography on a boundary that protects people, and the
  repo has none audited. Every endorsement is visible to the unit, including to an officer facing
  recall.
- **Counting ballots cast, voting windows, deadlines, ranked rounds, lots or a teller's count.** Each
  needs someone trusted to close or count, or else lets phones that saw different ballots follow
  different results.
- **An all-member election above a unit that the higher net can verify.** One event holds at most 48
  full ballots, and the election would send members' keys upward.
- **Free-form or scripted rules.** Scripted governance is how the Beanstalk and Build Finance DAOs
  were captured.
- **Finality by a deadline.** It needs a trusted clock, and the Bitcoin anchor is not built.
- **Proof that anything happened in person.**
- **Inferring absence, or letting anything lapse on silence.**

---

## 8. Terms, recall and succession

**Decision 3: the floor is the menu.**

- Every Led unit has terms of 12 or 24 months, and a standing recall petition against each office
  holder.
- No charter may choose no term or no recall.
- The CO cap stays each charter's choice.
- *Cost:* every unit's phones enforce a rule NavCom set, and units where nobody reads still entrench
  by silence.

**Terms.**

- **The incumbent serves until a successor takes office.** An election opens no earlier than the
  term's end. Until then the unit reads *"term ended 9 Jan; no successor yet"*, with its age.
  Nothing lapses, because lapsing would let the members' silence decide.
- **Where the CO cap applies,** a CO who has served two consecutive terms may be elected again only
  by three-quarters of the whole electorate: 7 in a unit of 9, 12 in a unit of 15. The XO is never
  capped, so experience stays in the unit, as in the Auxiliary.
- **Consecutive terms are counted from the checkpoint.** This counts terms in an office, never time
  as a member.

**Recall is a standing petition.**

- **One petition may be opened against each office holder per term,** from day 31 of the term.
- **It passes the moment it holds the threshold.** There is no window, no closing count and no failed
  state, so a sham recall has nothing to use up.
- **The threshold is the charter's:** a majority or two-thirds of the electorate frozen when the
  petition opened.
- **The person recalled sees the petition and may post one line in reply.** This is Inyo's notice and
  hearing, compressed to what a pull-only wire can carry.
- **When a CO recall passes, the XO serves as CO for the rest of the term,** and only the XO seat goes
  to election.
  - This follows Peru's 2015 reform: recall stops being a rival's route to office, and the unit is
    never leaderless.
  - *Cost:* removing a bad CO and a bad XO together takes two petitions, one after the other.
- **A recalled officer keeps their membership and may stand again.** Losing office is a correction,
  not exile. For the rest of the term they may not co-sign the removal of anyone who signed the
  petition.

**Silence counts as no.** Recall counts signatures against the whole frozen roster, so a member who
never signs counts the same as one voting to keep the leader:

| Unit size | Recall electorate | Majority needs | Blocked by this many non-signers | Two-thirds needs | Blocked by |
|---|---|---|---|---|---|
| 4 | 3 | 2 | 2 | 2 | 2 |
| 9 | 8 | 5 | 4 | 6 | 3 |
| 12 | 11 | 6 | 6 | 8 | 4 |
| 15 | 14 | 8 | 7 | 10 | 5 |

**A unit whose members do not read cannot remove anyone and cannot elect anyone.** Three remedies
need neither a clock nor silence:

- leaving, which costs nothing the member did;
- removing the keys of people known to have left, by a deliberate signed act with the reason in the
  removers' own words (for people who have only gone quiet, see *Not decided here* in §18);
- re-forming with the people who are still there (§9).

Re-forming needs any 2 members, while recall needs 5 to 10 signatures in units of 9 to 15.

**Succession.**

- **Named in advance.** The XO is chosen by the same electors as the CO, after the first term.
- **Command passes in only four ways:**
  - the CO hands over;
  - the CO stands down or says they are leaving;
  - the CO's key is removed;
  - the members recall the CO.
- **Never because somebody went quiet.** There is no timer, no missed check-in and no inactive
  status.
- **The CO and XO already share the authority.**
  - Either can co-sign an admission or a removal, rotate the epoch, carry word, or post anything that
    does not gather people.
  - So a CO who is away stalls nothing, and nobody has to declare them absent.
  - The CO can countermand the XO; the XO cannot countermand the CO.
- **The XO becomes acting CO** until the selection rule confirms them or chooses someone else.
  - An acting CO cannot change standing orders, the unit's higher unit or its Earth Alliance
    affiliation.
  - The XO post goes to election.
- **If the CO and XO are both gone,** the selection rule runs again. No higher unit names an acting
  CO (§11).
- **Every change of hands is a state every member sees,** with the previous holder.

---

## 9. Re-forming, with lineage

**Decision 2.**

- **Any two members may re-form a unit remotely.** They found a new unit marked *re-founded from*
  the old one, as a 16-byte hash.
- **They invite former members by those members' existing per-unit keys.** Each invited member
  accepts with a fresh key.
- **Only keys on the old unit's roster can be invited,** so every key reached was first admitted in
  person. Anyone new is admitted in person, as always.
- **In a Led unit, the two re-formers are acting CO and XO only.** They hold no term. The members'
  first election can open at once.
- **Re-forming is also how a unit changes its rules.** The charter is fixed for a unit's life, so
  members who want different rules re-form under a new charter and carry the lineage with them.

**Why:**

- Re-forming is the cheapest recovery when a unit is captured, has collapsed, or has a leader who
  failed: 2 people instead of the 5 to 10 signatures a recall needs.
- A scattered or endangered unit should not have to meet in person to recover. A meeting of leaders
  is the most valuable target there is: in 1943 the Gestapo raided one at Caluire and arrested Jean
  Moulin.
- Capturing a unit then wins an attacker only the shell. A strong unit's real asset is its members'
  trust in each other, and re-forming carries that out with them.

**Size:** every event re-forming posts, each invitation and each acceptance included, is padded to
the new unit's room like any state, hello or welcome (groups.md §7): about 16, 30, 41 or 46 kB at
rooms 4, 8, 12 and 15. Unpadded, an acceptance would be about 4.6 kB, and a reader holding a live
subscription could tell from the sizes that a unit was re-forming and how many people accepted.

**Costs:**

- It reverses the declined in-app fork, and the in-person rule, for this one case.
- Infiltrators can re-form too, and pull people away.
- An invitation sealed to a seized member's key reaches whoever holds the phone.
- A member who wiped holds no old key, and is admitted again in person.
- Two lineages can both claim the old unit. **NavCom does not decide between them.**

---

## 10. Authority levels and the limits on orders

**Decision 1: authority is a founding choice, shown in the summary code before anyone joins.**
Joining a unit whose charter says *orders* is the member's asking.

| Level | What leaders may do | What it costs |
|---|---|---|
| **Word and offers** (the default) | Speak for the unit, keep its door, carry word, set intent and standing orders, and post unit missions that members claim | Invariant 8 and `no-tasking` stay as written. A veteran who expects to be tasked finds an offer board. Real direction may move to Signal |
| **Orders, declining free** | Also address orders to the unit, a sub-unit or a role. Declining costs nothing and is recorded nowhere | Narrows invariant 8's *"no dispatch verb"* inside such units. Compliance rests on social pressure. Signed orders become a lasting record about the CO |
| **Orders that may name a member** | Also address a named member who accepted the charter. Declining may lead to removal from that unit, by its ordinary rule (a position holder and one other member), after notice and a one-line reply | Everything above. Also narrows *"no mission may be assigned to a named person who did not claim it"* and *"abandoning it costs nothing"* inside such units. The threat bites exactly where a member's own judgement says no, including about safety. COs will keep informal lists of who declined, and the software cannot stop them |

**Orders need a CO and an XO, so an Any two unit cannot choose them.**

**Limits that bind every order:**

- **Every order expires within 7 days and says so afterwards.** Long-lived direction goes in
  standing orders, which name no place and no time.
- **Orders never travel by notification, paging, sound, badge or the `Distress` kinds.** The screen
  keeps groups.md's line: *"Read when somebody looks. Somebody needed now: Distress."*
- **Anything that would bring more than one person to a place needs both the CO's and the XO's
  signatures,** whether it is an order or an offer. One captured key cannot assemble a unit anywhere.
  With one signature, the phone shows it as *needs CO and XO*.
- **No Karma for declining** ([`economy.md`](economy.md) §9 stands). Nothing records who declined.
  A member who takes part says *"I'm in"* with their own key, and the readout lists who is in, never
  who is not.
- **Never to a non-member, never two levels down, and never onto the public map.** Public missions
  stay offers.
- **Leaving the unit ends every order for that person at once,** and touches nothing outside the
  unit.
- **An order is a mission in the unit's name.** It counts against the ceiling the unit's members
  delegated, so no unit can have more out than its members gave it.
- **A lawyer reviews orders before they ship.**

### What moves down

Each item below is a signed statement sealed to one net. **It reaches the next echelon only when that
echelon's CO or XO re-issues it, by their own act.** Nothing skips a level, and nothing propagates on
its own.

| Item | What it is | Limits |
|---|---|---|
| **Intent** | What and why, up to 280 characters. This is mission command's form | No addressee, place or time. Allowed at every level. It never tasks anyone |
| **Standing orders** | How the unit works, for example *"we go out in pairs"* | No place, time or addressee. Only a confirmed CO changes them, never an acting one |
| **SITREP** | The situation as this echelon knows it | Information, not instruction. The watch's answers stay with the watch |
| **Control measure** | One place, as a directory record id or a region, plus a time window | Never coordinates or an address. It becomes an order only inside an order |
| **Offers** | Unit missions, claimed one at a time, as [`missions.md`](missions.md) §3 defines them | Within the unit's delegated ceiling |
| **Orders** | Only at the levels above | As above |

**Re-issue converts word into the receiving unit's charter, and never passes it through.** An order
that reaches a word-and-offers unit arrives as a mission to claim. A named order that reaches a unit
that does not allow them arrives addressed to a role. **No higher unit can ever raise a member's
obligations through someone else's act.**

**Attribution.**

- Every office at every echelon has a voice key. Its public half is carried down when a member joins.
- A quote carries the original signed statement, so a carrier can drop word but cannot forge or
  alter it.
- The CO and the XO both carry word, and phones compare the copies. The readout is one of:
  - *"carried by Raven"*;
  - *"carried by Raven and Wren"*;
  - *"Raven and Wren carried different text"*.

  It never says who has not carried.

### What moves up

**Reports are consolidated at each echelon, in a closed vocabulary.** Every field carries its author
and the age of its oldest input. The fields are:

- places, as directory record ids;
- supply moved, as unit totals;
- hours on settled missions, as unit totals;
- missions done, by address;
- capacity, as what the CO declares the unit can take on, **never a headcount**;
- observations, under Raw Intel's anchor rule once it is built;
- a 280-character lessons line with no names.

**Never in a report:**

- any member's callsign, presence, position or attendance;
- who declined;
- a count of members;
- anything about a person being served.

**Refused outright:** accountability formations, personnel status reports, and *check in to receive
an assignment*. That is where feeling at home turns into surveillance. After-action reviews stay in
the unit that held them. Only the lessons line may go up.

---

## 11. Teaming up: what a higher unit carries and sees

**Teaming up.**

1. **Two to six units agree to form a higher unit.** Each must have said *may serve under a higher
   unit* at founding. A unit founded without that term re-forms first. So no member's exposure rises
   through an act they did not sign up for.
2. **The new charter sets** the higher unit's echelon, template, Earth Alliance or Independent,
   authority level and governance rows.
3. **Founding is by consent.** Every joining unit's CO and XO sign the founding state, which names the
   new CO and XO. Each of them accepts with their own key. A unit that does not sign is simply not in
   it.
4. **The stand-up is in person,** like every admission. It posts at least one founding state plus a
   padded hello and welcome for each seat holder: about 13 events when two units team up, and 29
   when six do. At 8 posts a minute from one venue's address, a figure from an example
   configuration, that is about 2 to 4 minutes on shared Wi-Fi, before random delays.
5. **Every member of every joining unit sees a change-of-chain notice before it applies to them.** It
   gives the new designation and marker, its CO and XO, what changes for them, and *Leaving costs
   nothing.*

**Authority is conserved, the way writ ceiling is.** Each person is bound only by the charters they
personally accepted. A squad leader who takes a seat in a platoon's net has accepted the platoon's
charter, while the squad's members accepted only the squad's. Forming a higher unit mints nothing,
and nothing is ever paid upward.

**Decision 4: a higher unit reaches as a coalition, seats only.**

| | Holds | Never |
|---|---|---|
| **The unit** | Its membership and door, removals, discipline, internal organisation, roster, titles, and rungs if it is a body, and its own leaders | — |
| **A higher unit** | Its own net, and whom it seats there. It sends intent, situation reports and offers to its direct units, re-issued by a person at each level. It sends orders only where both charters allow them, to a unit as a whole, through its CO and XO, expiring within 7 days. It helps on request, and it sanctions seats | Acting inside a unit; relieving anyone inside one; holding keys or rosters below its seats; choosing a unit's leaders; tasking below its direct units; reaching past the level below |
| **What a higher unit sees** | Each direct unit's CO and XO, name, marker and charter type; a *support needed* field from a closed list; consolidated reports | Rosters, member counts, attendance, last-seen, anyone two levels down |

**Sanctions fall on seats, never on people.** They come in four steps:

1. **Notice, with a reason,** as an expiring line.
2. **A one-line reply.**
3. **Suspension of a seat for a stated term.** This step exists only if the higher charter chose it,
   and it takes effect only when a second, distinct holder confirms it.
4. **Expulsion of the unit.**

How sanctions are decided:

- By the higher charter's threshold of the *other* units' pairs. The affected unit does not vote.
- Never on a deadline.
- A suspension never removes a unit's vote in an election already open.
- For a breach of the Articles' invariant clauses, notice and suspension may come together. They are
  still confirmed by a second holder, and the unit may still reply.

*Cost:* sanctions are blunt. A higher unit cannot remove a bad CO. It can only act on the seat or cut
the whole unit loose, and that falls on good members too unless they re-form.

**When a unit changes its own leaders,** the seat above follows the unit's result. The unit's XO
posts the swap with any one seat holder there, authorised by the passing petition or election. The
higher unit's officers have no veto.

**When a unit's leaders are captured,** the higher unit cannot fix it from outside, because it holds
none of the unit's keys. The members re-form (§9), and the new unit is seated like any new unit: in
person, by two seat holders. The higher net may expel the old shell.

**Leaving a higher unit.** A unit leaves when its CO and XO sign a withdrawal, which needs no wider
vote because leaving lowers everyone's exposure. Its seats drop and its delegated ceiling returns.
Missions the higher unit already has open stay open until they close. **Nothing about the unit was
held above it, so it loses nothing on the way out.** Leaving the Earth Alliance is always open on
the same terms (§12).

**Who holds what:**

| Holder | Holds | Never holds |
|---|---|---|
| **A member** | Their unit's roster, at most 14 other callsigns, under keys used nowhere else. The CO's and XO's callsigns one level up. The public voice keys of each office above | Any other unit's members. Anyone's attendance or last-seen |
| **A unit's CO or XO** | Everything a member holds, plus the higher net: its seats, lines and reports. About 18 callsigns in the model, at most about 28 at the caps | Anyone two levels down. Who declined. Who has not read |
| **A higher unit's CO or XO** | Their own higher net, and each direct unit's leaders, name, marker, charter type and reports | Any roster below the unit leaders, any member count |
| **A staff or senior NCO seat** | The higher net they sit in | Any personnel file |
| **The Earth Alliance** | Nothing. It is a hash | — |
| **An agent, the developer, The Record, its mirror** | Nothing. They are never sent unit traffic | — |
| **A unit's relay operator** | The IP address of every phone that reads or posts the unit's tag, so its members by address. Leaders stand out as the addresses that also read a second tag. Every link where it carries both ends (§3) | Names, rosters, callsigns, keys, content |

**Why the narrowest view.**

- An infiltrator who climbs gains structure, not names: about 18 callsigns per rung in the model,
  whatever the echelon.
- A seized leader phone gives up tens of callsigns, not a formation.
- missions.md §2's *"nobody can enumerate its members from outside"* holds. The one exception is
  relay operators, who see members by IP, as they already do for crews.

**Joint operations.** Two units that will not merge work together in the shape of NIMS Unified
Command: *"no one commander"*, objectives approved jointly, each unit keeping its own authority, and
an end date. This is C37's time-boxed, op-scoped shape. It is how an Alliance unit and an Independent
unit cooperate, and it stays where the build order puts C37's board half.

---

## 12. The Earth Alliance and Independent

**The Earth Alliance has two parts:**

1. **The Articles of the Earth Alliance.** A short published text, **written by the owner**, shipped
   in the release and identified by its hash.
2. **Alliance commands.** Ordinary higher units whose charter carries the Articles' hash. They form
   from the bottom up when Alliance units team up.

**A unit is in the Alliance when its own sealed charter carries the Articles' hash.**

- Until it teams up, it reads *"Earth Alliance, unattached"*, and that is a complete state.
- Nobody outside the unit sees the hash except the people it is shown to in person.
- Nothing in this design puts a unit's chain, offices or affiliation on any card.

**What the Articles say.** The owner decided their contents on 2026-10-09 and writes the final
wording. Software cannot enforce any of these, so the text has to:

- The Alliance is the units that signed these Articles. There are no hidden members and no secret
  command, and it claims no force beyond what its units can show.
- **Units sign; anyone may affirm the Articles for themselves, and an affirmation grants nothing.**
  Independent units are not lesser.
- **The protections, invariants 1 to 7, which no charter, order or vote sets aside.** Beyond them:
  agents never command, and no unit keeps service records.
- Fair dealing inside a unit, an answer when another Alliance unit asks, and the work shown.
- Any member may leave any unit at any time, at no cost in standing. Any unit may leave the
  Alliance at any time (below).
- Leaders are chosen by stated rules, can be recalled, and never name their own successors.
- A command holds only the authority and ceiling its units delegated, and nothing is paid upward.
- Rosters stay with units.
- Loyalty runs to the Articles, never to a person.
- On a breach, each unit decides whom it works with, and the higher unit that seats it may unseat
  it. There is no Alliance-wide verdict.
- It names no enemy. Resilience against the capture of every institution is one of its purposes,
  written without naming an adversary. Any scenario with a named enemy lives only in a separate
  threat model written by capabilities (infiltration, coercion, seizure, relays).
- No unit may use a name, emblem or insignia that imitates a real military unit or a veterans'
  organisation. In 2019 VVA found an impostor *"Vietnam Vets of America"* page with nearly 200,000
  followers.
- The proposal rule, below.

**Decision 7: the top is the Articles plus a proposal rule.**

- **Any 3 Alliance commands may jointly publish a proposed version; a command co-signs at most one
  open proposal at a time** (decided 2026-10-09). Units adopt it only by signing it. A new version
  is a new hash, and **no unit is moved by a version it did not sign:** each stays under the version
  it signed.
- **There is no standing council and no steward key.**
- **The rule can be used only once Alliance commands exist,** which waits on the commons.
- **Nobody leads the whole.** Each Alliance command leads only the units that joined it, so several
  unconnected Alliance trees can exist under one text.

*Cost:*

- There is no Alliance-wide voice between proposals.
- The first commands to exist shape the first revisions.
- Anyone can publish a rival text, and it is judged only by who signs it.
- A revision can leave units signed to different texts.
- The developer still decides which hash the release preselects.

**Leaving the Alliance** (changing *Higher* to Independent) **is always open, whatever the founding
terms.** It is signed by the CO and the XO, or by any two members of an Any two unit, and takes
effect at once, with a notice sent at that moment to the units it works with. Only joining, or
moving under a higher unit, needs *may serve under a higher unit*.

**Marker and naming.**

- **The Alliance has no marker.** APP-6's ++ means one commander, and the Alliance has none. Its
  commands wear their ordinary echelon markers.
- The chain line reads, for example, *"1st Squad ● · 2nd Platoon ●●● · A Company I · Earth
  Alliance"*, or *"... · Independent"*.
- Alliance commands are named by echelon and area: *"Earth Alliance, <area> Battalion"*. Nothing is
  called Supreme or High (§13).

**Independent.**

- An Independent unit has no higher unit. It is AR 600-20's *"separate"* unit: it owes nothing upward
  and is complete as it is.
- It can grow formations of its own under its own charter.
- It works with anyone through joint operations.
- **On the wire it is identical to an Alliance unit.**
- It can join the Alliance later, if its charter says *may serve under a higher unit*, and leave
  again freely.

**Alone stays the operator's default, and it is not a degraded state.** With no unit, the screen
reads *No unit* in neutral ink, with *"Everything in NavCom works without one."*

**How NavCom inclines without pressure.** At founding, Earth Alliance is preselected and Independent
sits beside it at the same size and weight. Each has one line:

- *"Earth Alliance: signs the Articles, so your unit can team up with any Alliance unit on terms
  already agreed."*
- *"Independent: answers to no higher unit; complete as it is."*

What the Alliance offers is real but modest:

- terms already agreed, so units can team up without first negotiating a charter;
- recognition in person, where one unit shows another its signed charter;
- a chain to carry word.

Stated honestly, Independent formations can team up just as well. The Alliance adds shared terms and
mutual recognition, not capability.

**What NavCom never does to incline anyone:**

- no banner, nudge or badge, and no *complete your setup*;
- nothing withheld from an Independent unit or an Alone operator: not the watch, `Distress`, the
  directory, the map, open missions or `Query`;
- no referral reward, invite quota or standing for recruiting;
- no public count of Alliance units against Independent ones;
- no copy calling Independent *unaffiliated*, *not yet* or *unassigned*.

The preselection is the whole of the inclination. A monopoly default produces outsiders, and marking
independents as lesser is how a default becomes the reason people leave.

**Legitimacy and the name.** [`../lineage.md`](../lineage.md) says *"There is no Earth Alliance ...
It is a psyop"*, and directs *"Build the real one. Not the cosmology — the capability."* This design
applies that directive by making the top the most transparent and least powerful layer: a published
text, no secret members, no hidden command and no claims. Anyone can type *Earth Alliance*. Nobody
can forge a real unit's signature, and signatures are checked in person.

---

## 13. Titles, marks and saying you served

**Position and rank are two fields.**

- **A position is an office in one unit:** CO, XO, platoon sergeant, first sergeant, sergeant major,
  team leader, staff or signaller.
  - It is filled by the charter's rule, can be revoked, and ends when the holder leaves the unit.
  - It gates only the acts the unit's members gave it.
  - It is shown inside the unit, and in the one net above where its seat sits. It is never shown on a
    card or profile.
  - It is never derived from rank, tenure, standing or claimed service.
- **A rank, where a unit uses one, is a rung.** Rungs are [`missions.md`](missions.md) §4's per-body
  Honor rungs: earned by settled missions with that unit, never by time served or attendance. Rungs
  are never added across units and never shown outside the unit. Only a unit that is a body holds
  rungs (§4), so they wait on 11.5 and 11.6.

**Decision 5: titles are each unit's own, inside that unit only.**

- The Military template fills in the usual position titles and grade names. Each unit may keep,
  rename or drop them.
- A title gates nothing. Only a position carries the unit's acts.
- A member's own record of their work with a unit may state the title they held there, dated, as
  history.

**The release refuses these titles at every echelon:**

- general-officer grades;
- *Supreme* and *High*;
- any real unit's name.

*Cost:* this is a developer-held rule over every unit's vocabulary, on a list that has to be
maintained and will be argued with. It blunts the screenshot that reads *"Earth Alliance — General
<callsign>"*, the image of the GESARA story, without ending it. The same title also means different
things in different units, and a nine-person unit's *Colonel* invites ridicule.

**The mark.** A leader wears the APP-6 echelon marker of the unit they lead: ● for a squad leader,
●●● for a platoon leader, I for a company CO.

- It marks a position, not a rank, and it drops when they leave the post.
- It copies no service's insignia: no chevrons, bars, oak leaves, eagles or stars. Veterans already
  read these markers from map symbology.

**Decision 6: saying you served.**

- A member may write one line on their own roster row in one unit. It is off by default and reads
  *"self-stated; NavCom cannot check this"*.
- It grants nothing and is never public. It appears on no card, in no search, in no report, and in no
  other unit.
- Third-party checks (DD-214, a VA card, ID.me) are excluded, because each runs on a legal name.
- *Cost:* false claims are possible inside one unit, limited by face-to-face trust. A seized phone
  lists who in that unit said they served.

**Why nothing more.** A claim of service grants nothing here, so a false one gains nothing but a lie
between people. Any field, filter or public mark of service would build a list that recruiters and
impostor pages target. It would also invite stolen-valor fights that the accused cannot answer
without a legal name.

---

## 14. Autonomy: the means of accountability, never the verdicts

**Units make the judgements. NavCom supplies the means of holding people to account, and the hard
limits that protect people outside the system. It holds nothing a unit depends on.**

**The rule that makes it fair: a unit can take back what it gave you, but never what you did.**

- **What a unit can take back:**
  - membership;
  - an office;
  - in a unit that is a body, a rung and any ceiling granted with it;
  - the unit's own judgement of you.
- **What a unit cannot take:**
  - your settled work (Hours, Supply, Intel);
  - endorsements and receipts you hold;
  - your persona and your callsigns elsewhere;
  - your Karma with everyone else;
  - your standing with anyone else.

**Why this is the fair line:**

- **A unit's hold over a member equals the value of belonging to it.** A demanding unit worth
  belonging to keeps real discipline, because removal costs the member something they value. A unit
  that is captured, failing or abandoned loses its hold as fast as it loses its value. NavCom never
  has to decide which is which.
- **If a unit could keep what a member did,** its hold would exceed its value. That surplus is exactly
  what a captured leader or a saboteur needs.
- **Judged by the worst position anyone could be in,** the design protects the worst case in each:
  - a member under a strict CO has free exit that keeps their record;
  - a member falsely accused has a reply on the record;
  - a leader facing a sham recall faces a recall that neither silence nor a closer can game;
  - the remnant of a collapsed unit can re-form;
  - a person served, who never chose any of this, is protected by invariants 1 to 7.
- **Surviving is not the same as being good.** So NavCom supports good work by making it visible and
  recoverable, never by ranking units.

**The consequences a unit already has, gentlest first.** None of them is global, and none is
automatic:

1. A word in the unit's own lines.
2. A blameless after-action lesson, with no names and no grade.
3. A rung's obligations, which the unit sets (missions.md §4).
4. Losing a rung the unit granted.
5. Losing office: not re-elected, or recalled by petition.
6. Removal by the door rule, with the reason in the removers' own words. Under orders that may name a
   member, removal for declining comes only after notice and a one-line reply.
7. Individuals withdrawing endorsements they gave.
8. For a whole unit: notice, suspension of its seat, or expulsion by the unit above.

**What NavCom refuses:**

- **Any consequence outside the unit.** Nothing reaches a person's card, other units, the map, the
  directory, the watch, `Query`, open missions, `Distress`, or their standing with anyone else.
- **Anything negative that follows a member out:** no portable warning, no *removed for cause*
  record, no shared ban list, and no *suspected informant* flag. Such a record is a dossier, and its
  documented uses are bad-jacketing and antisocial punishment.
  - *Cost:* someone removed from one unit for real harm can join another with a clean slate. The
    protection is in-person admission by two people, and the account of what happened carried by
    whoever was there.
- **Anything inferred from silence.** No attendance, last-seen, *at post* check, list of who
  declined, inactive status or lapse. A unit that judges someone *not at post* does so as people.
- **Anything automatic.** No sanction, removal, suspension or loss of rung fires on a timer, a count
  or a missed deadline, at any level.
- **Verdicts on units.** No ranking, verification, rescue, *verified unit* mark or leaderboard, and no
  ruling on which of two lineages is the real one.
- **A lever over units.** The developer has no way to remove a unit, holds no key and keeps no record
  of unit traffic. Every lever NavCom held would be one it could be pressed to use.
- **Any claim of legal effect.** Nothing on screen says what a unit's rules mean in law. The charter
  screen says only what the software does: *"This unit chose its rules from a menu NavCom wrote.
  NavCom's software enforces those rules and a floor every unit carries: terms, recall and the
  limits on orders. NavCom holds none of this unit's keys, cannot read its traffic, and judges
  nothing that happens in it."*

**What NavCom does to support units that do good:**

- **Receipts the person holds.** When a unit mission settles, the settling office can sign a receipt
  that stays on the member's phone and is shown in person.
- **Named recognition, held by the recipient,** through endorsements.
- **Honor with a unit that stood down** stays readable as dated history.
- **Stand-down as a normal ending.**
- **Help on request from the unit above.** A *support needed* field, and introductions in person to
  re-home members of a collapsed unit, without anyone holding a roster.

**What the developer still holds** are the levers left, kept few and written down:

- the code;
- the menu and its evaluator;
- the defaults, including Earth Alliance preselected;
- the Articles' hash;
- the templates;
- the refused titles;
- the shipped relay list.

A compelled or compromised release could read whatever phones decrypt while it runs. Whether any of
this changes anyone's legal exposure is a question for a lawyer, and nothing here claims to remove
it.

---

## 15. What stays protected: invariants 1 to 7

A chain of command is where these bind hardest. Maricopa's ranked posse shows why.

| Invariant | How it holds in units |
|---|---|
| **1. Nothing recorded about the people served** | No person field in any order, offer, report, review, petition, reason, receipt or sanction. Places are directory record ids or regions. No count of anyone turned away. No mission or order may be settled by evidence about a person. Free text cannot be policed, and the composer says so: *"About the work. Never about the people you serve."* |
| **2. `Distress` ends in a human, or says it couldn't** | No unit, office or Alliance body can see, filter or intercept a member's `Distress`, or be where it ends. Unit traffic never uses kinds 20910 to 20912. There is no *page the unit*. Unit office never makes anyone a watch holder or changes the on-call ladder. Every unit and governance screen renders under the `Distress` layer, and a test on the built artifact taps it from each one |
| **3. Duress is deliberate** | Nothing happens on silence: no succession, lapse, attendance, acknowledgement roster, inactive status, automatic sanction or record of declines. Leaving quietly sends nothing |
| **4. Agents identified, never sole responder** | No agent holds a unit key, a position, a seat, an endorsement, a petition or a signature, and no agent carries word or re-forms a unit. An admitter's phone refuses an agent-flagged join code. NavCom's agent builds contain no units module, and a test on the built artifact checks it. A smuggled agent cannot be detected by software; the norm is the admitter's |
| **5. Panic wipe destroys Wipeable only** | Charters, rosters, voice keys, higher-net keys, governance states, checkpoints and receipts are Wipeable and never in a backup. A wipe ends every membership on the phone, and the way back is in person. Copies on other members' phones are beyond one person's wipe, and the screens say so |
| **6. No legal names** | A callsign for each unit, typed fresh, with *a callsign, not your name*. No service records, and no DD-214 checks. A public figure named under the 2026-10-06 exception is never the object of an order |
| **7. Volatile data shows its age** | Every carried word, order and report shows its age and the age of its oldest input. Orders expire within 7 days and say so. Term ends and holdovers are shown with their age. A phone shows claimed time beside first-seen time when they differ by more than a day |

---

## 16. Every rule this bends

Each rule bent below was decided on 2026-10-09, and its dated note belongs to U0 (§18). The notes in
`docs/` were written that day, and the notes on CLAUDE.md's invariants 8 and 9, its one-number row and the README the same day. The two
refusals below were narrowed in U0 and say they are not built. Each is reworded, with the
well-known JSON and its test, in the commit that ships what it narrows.

| Rule | How it bends | Why | Decided |
|---|---|---|---|
| **Invariant 8**, CLAUDE.md: *"Nothing tasks anyone without their asking ... no mission may be assigned to a named person who did not claim it. There is still no dispatch verb"* | Narrowed for units whose charter chose orders. Joining such a unit, with its charter shown first, is the asking. Inside it a position may address orders to the unit, a sub-unit or a role, and under the third level to a named member who accepted the charter. Bounded by §10's limits. Under word and offers, untouched | A chain of command veterans recognise, chosen before joining | 2026-10-09, decision 1 |
| **Invariant 8**, *"abandoning it costs nothing"* | Only under the third level: declining may lead to removal from that one unit, after notice and a reply. Karma, Hours, Supply, Intel and Honor are never touched | Orders that cost nothing to decline are offers | 2026-10-09, decision 1 |
| **Refusal `no-tasking`**: *"Any message that assigns, dispatches, tasks or directs an operator"* | Narrowed to messages from outside an operator's own accepted chain, and to the watch, agents, nodes and integrators in every case. *"The watch tells you what is happening; it never assigns"* stays word for word. Narrowed in U0, marked not built; reworded when orders ship | Leaving the published text unchanged while shipping orders is the drift `refusals.ts` exists to prevent | 2026-10-09, decision 1 |
| **Refusal `no-credential-gate`**: *"A credential, score, standing or rank used to gate access to anything"*; *"no tiers of operator who see more by status"* | A position gates its own unit's acts, and a leader reads one more net, the one above. A position gates nothing outside the unit that granted it: the directory, map, `Query`, watch, `Distress`, open missions, other units and public data stay the same for everyone. Titles gate nothing. Rungs, in a unit that is a body, raise only the Writ ceiling missions.md §4 gives them and gate no access. Narrowed in U0, marked not built; reworded when leaf units ship | A CO and an XO who can do nothing their members cannot are not offices | 2026-10-09 |
| [`../principles.md`](../principles.md) §4: *"A network of volunteers with no hierarchy cannot give orders"* | Units may be hierarchical, and orders exist where a charter chose them. The watch still never assigns | The owner's direction | 2026-10-09 |
| principles.md §11 and [`../research/lore.md`](../research/lore.md), *What we deliberately left*: *"no hierarchy, no operator who sees more by status"*; *"Command hierarchy ... This network has none"* | A chain of command exists inside units that choose one, and a leader sees one more net. The watch stays a post, not a rank: unit office never makes anyone a watch holder or gives any view of the board | The owner's direction | 2026-10-09 |
| [`panel.md`](panel.md), *The register: bridge watch, not chain of command* | The Military template brings an army register into unit screens. The watch panel keeps the bridge register | Veterans' vocabulary is the template's purpose | 2026-10-09 |
| [`../lineage.md`](../lineage.md): *"There is no Earth Alliance"*; *"we left the chain of command"* | A real, small Earth Alliance exists as a text that units sign, and an optional chain of command exists inside units, never over the watch. *What we do not take* stays whole | lineage.md's own *"Build the real one"* | 2026-10-09, decision 7 |
| [`missions.md`](missions.md) §2: *"a tree is the wrong shape"* | Each unit has at most one higher unit, so units form trees. People still overlap freely across units, and the Alliance stays a text rather than *"a root that owns them"* | It makes clear who carries word for a unit | 2026-10-09 |
| missions.md §2, Crew row: *"Whoever founded it, or everyone in it"* | Led (the founding pair for a first term, then elected) or Any two | The owner asked for a CO and an XO | 2026-10-09 |
| missions.md §4: *"Governance weight is Honor rank within the body being voted in"* | Offices are chosen one member, one vote, not weighted by Honor | Elections and recall count one signature per member of a frozen roster (§7), and most units hold no Honor at all | 2026-10-09 |
| The anti-pattern *"Show one number that sums somebody up"*, and [`../declined.md`](../declined.md)'s *"a visible progression is a ranking whatever it is called"* | Partly. Titles and rungs are per unit, never summed, and never shown outside the unit. Grade names still order people inside one unit and leave it in screenshots | Veterans expect rank. The harm named is a single global axis | 2026-10-09, decision 5 |
| principles.md §13 and C11: no standing that depends on recruitment | Partly. A position's echelon grows with the units under it. Nothing accrues to the person for forming units or admitting members: no Honor, rung, writ or Karma | A battalion CO exists only if a battalion does | 2026-10-09 |
| C37, *"Federation without membership"*, and the build order placing crew federation behind Raw Intel | Standing higher units and the Alliance are federation with membership, and they are standing rather than op-scoped. They wait on the commons, not on Raw Intel. Joint operations keep C37's shape and its place | The owner's Alliance is meant to last | 2026-10-09, decision 8 |
| declined.md, *Disputes between operators*: *"no role with authority to rule"* | Holds everywhere outside a unit. A unit rules on its own membership and offices, never on anyone's wider standing | A unit that cannot remove anyone cannot keep its own door | 2026-10-09 |
| The first crews draft's *nothing preselected* on the founding screen | Earth Alliance is preselected for *Higher*, at equal weight beside Independent, and word and offers is preselected for authority | The owner's stated defaults. A default is a nudge made on everyone's behalf, so it is named here | 2026-10-09 |
| groups.md §14: *Changing a charter in place* is declined | *Higher* may change after founding. Joining or moving under a higher unit needs the founding terms to have said *may serve under a higher unit*, and is shown to every member before it applies. Leaving the Alliance (*Higher* to Independent) is always open, whatever the founding terms: signed by the CO and XO or by any two members of an Any two unit, effective at once, with a notice to the units it works with at that moment (§12). Everything else stays fixed | Teaming up after units exist is the owner's model | 2026-10-09 |
| The in-app fork the first crews draft declined, and in-person admission | Remote re-forming, with lineage, to people already admitted in person | The cheapest recovery from capture or collapse | 2026-10-09, decision 2 |
| groups.md §14: polls, and history for new members, are declined | Endorsements and petitions are a narrow kind of poll. The checkpoint gives a joiner a signed summary of terms, never earlier lines | Elections and recall need both | 2026-10-09 |
| groups.md §7's crossing rule, *"Removal wins"* | A removal that crosses an open vote is void if the person the vote is about signed it, or if it removes one of the vote's electors | Otherwise a CO and one ally could remove whoever opened a recall | 2026-10-09 |
| **Invariant 9**: *"A state is visible before somebody commits to it"* | Extended, and at risk in one place: a chain can change above a member through other people's acts. Guarded by the charter shown before joining, a change-of-chain notice before any move under a higher unit applies, free exit, and conservation of authority. Leaving a higher unit or the Alliance lowers exposure and takes effect at once | Joining counts as asking only if the chain was visible first | 2026-10-09 |

**Held, though close.** These are named so nobody assumes they are bent:

- **economy.md §9, *"Abandoning a claim must never reduce Karma"*.** Held. No Karma is lost for
  declining anything, at any level.
- **missions.md §2, *"nobody can enumerate its members from outside"*.** Held, because a higher unit
  holds no roster below its seats. Relay operators see members by IP, as they already do for crews.
- **missions.md §2's Alliance row, *"The charter, and only inside it"*.** Held. There is no standing
  council and no steward key.
- **principles.md §2, *"no discoverable directory of operators"*, and §6, *"Defaults lean private"*.**
  Held for chains, offices and affiliation, none of which is ever public. The one recorded exception
  is the crew card (groups.md §10, principles §2 note).
- **constraints.md, *"visibility is granted by the operator, never claimed by the lead"*.** Held. A
  CO knows where a member is only if the member says.
- **The anti-pattern *"nothing marks an operator late or absent"*.** Held.
- **Refusal `no-operator-traffic-on-a-private-relay`.** Held. Crew and unit events were added to its
  text on 2026-10-09, and on the wire every unit's traffic, a higher net's included, is crew traffic.
- **Refusal `no-person-data`.** Held.

---

## 17. Costs

**To build** (estimates; nothing is built):

- **A governance evaluator in `@navcom/core`** of roughly 400 to 600 lines. It covers:
  - freezing the electorate;
  - signatures and equivocation;
  - results and checkpoints;
  - crossing rules;
  - holding back future-dated statements;
  - the version digest.
- **Tests and review.**
  - Tests of every configuration (8 leaf, 16 higher) against about nine adversarial cases each.
  - Built-artifact tests from §15.
  - Outside review of the evaluator, the voice keys and the higher net, by someone who is not their
    author.
- **Screens:** four founding rows per level; endorse, petition, result, holdover, contested result
  and *needs an update*.
- **On the phone, the cost is small.** A 15-seat unit produces about 132 signatures a year to check:
  about 180 ms of checking on a Mac, and an estimated 2 to 5 seconds on the device floor, spread over
  the year.
- **The larger cost is human.** Defaults decide most units, so the template presets are the rules most
  units will actually have.

**On the wire.** These figures are illustrative. They come from a model of squads of 10, a span of 4
and 3 lines a person a day, using unpadded sizes, so padding to room raises them somewhat.

- **What nesting lightens: per-phone load stops growing with the network.**
  - A member downloads about 54 kB a day and a leader about 107 kB, at any size.
  - One flat group of 640 would download 11.6 MB a day.
- **What nesting does not lighten:**
  - Relays store the same total: about 2.9 MB a day at 640 people.
  - Word to everyone costs one event per unit, 85 events for a battalion.
- **Leaders pay more.** They download about double, and open up to four extra sockets.
- **Word is slow.** A battalion's word crosses three re-issues to reach its squads:
  - about 6 hours on average, and about 12 at worst, if each leader opens the app every 4 hours;
  - about 18 hours on average if they open it every 12 hours.

  Units that expect real-time command will move it to Signal. The screen says what is time-critical:
  `Distress`.

**Exposure.**

- **Relay operators can draw the tree by IP.**
  - On today's meeting pair, each operator sees every unit, every link and every leader. That is why
    higher units wait on the commons.
  - In the commons, the cover is only as good as its size: at its floor of three relays, every link is
    still seen by some operator.
  - Leader cover and edge-disjoint relays are deferred. Edge-disjoint relays need at least 14.
- **Signed word is permanent evidence.** Every member's phone, a removed member's included, holds the
  CO's signed word. That holds leaders accountable, and it exposes them to seizure and subpoena.
- **Orders put a schedule on members' phones.** A seized phone shows where the unit will be for up to
  7 days.
- **Informal decline tallies.** COs will keep them under orders. They are an absence ledger the
  software neither keeps nor can stop.

**Governance.**

- Silence counts as no, so quiet members protect incumbents.
- There is no secret ballot.
- Popularity can beat competence, and the same leaders get re-seated.
- Sock units are bounded only by in-person seating. A newly seated unit does not vote in an election
  already open.
- Infiltrators who behave impeccably are never detected, only bounded.

**Social.**

- **The name.** *Earth Alliance* beside military titles is the imagery of the GESARA and "white hats"
  story, whose influencers court veterans. Only a top that is transparent and weak defends against
  that.
- **Capture by a leader.** This is the Maricopa and Alaska risk. Terms, recall, free exit and a small
  view per rung each help, and none is enough alone.
- **Drift into dispatch.** Coordination drifts into dispatch whatever the software allows, as the
  Cajun Navy's *"citizen dispatchers"* did.
- **The Military template can repel.** It can repel civilians, and some veterans too. Plain and the
  other templates must be equals, not fallbacks.
- **Attendance creep.** SAR teams and milsim units drop members or gate promotion on attendance. The
  charter has no field that could hold an attendance minimum.
- **A word that already has a meaning.** *Squad* already names a watch's holders in the specs and on
  the funding page, and *patrol* means an operator's night out.

**Legal questions for a lawyer, not settled here:**

- a CO's exposure for directing volunteers and for signed orders;
- whether shipping a governance menu, a floor or an evaluator changes the developer's exposure;
- whether any shield covers an unincorporated unit;
- apparent agency from unit names, marks or the Alliance name;
- state laws on false claims of service.

---

## 18. Phases

Each phase ships its screens with it. **A mechanism nobody can reach is not built.**

| Phase | What | Useful alone | Gate |
|---|---|---|---|
| **U0. Words** | This page. Dated notes on each rule in §16, saying what was decided and that it is not built. `no-tasking` and `no-credential-gate` narrowed and `no-operator-traffic-on-a-private-relay` extended to crew and unit events, each marked not built, and signals.spec's *What is NOT here* scoped, all on 2026-10-09. declined.md entries, each with its cost: attendance minimums; accountability formations and check-in for assignment; personnel files; importing real rank; third-party service checks; NIP-58, NIP-05 or NIP-51 ranks; NIP-29 groups; senior-present-commands; absence-triggered succession; a formation-wide sealed key; a steward key or standing council over the Alliance; agent positions | The direction is on record and every no is written down with its cost | None |
| **U1. Leaf units** (groups.md's phase 2) | groups.md's crews, plus the charter, Led and Any two, the Military and Plain templates, markers and titles with the refused list, word authority (intent, standing orders, carried word), *Higher* recorded as the Articles' hash or Independent, the governance menu and evaluator, standing petitions, succession and acting command, leader-key removal, re-forming with lineage, the served line, and stand-down. `no-credential-gate`'s not-built wording removed, with the well-known JSON and test, in the same commit. A glossary line in the specs, where *squad* already names a watch's holders. Built-artifact tests: `Distress` reachable from every unit and governance screen; no unit path emits kinds 20910 to 20912; an agent-flagged code is refused; no field or string for attendance, inactive, branch, MOS, rank held or decorations; Earth Alliance and Independent rendered at equal weight with no *not yet* copy; no refused title accepted | A unit with a CO, an XO, terms and recall, in the vocabulary veterans know, that never has to team up with anyone | groups.md's phase 2 gates: the crews spec written, phase 0's relay measurements, review of the composition by somebody who is not its author, and the online safety record's organising and harassment rows and overall rating reassessed. Here as well: review of the governance evaluator by somebody who is not its author, and the Articles written, so their hash exists |
| **U2. Teaming up** | Higher nets and seats. Voice keys and two-carrier comparison. Consolidated reports. Change-of-chain notices. Higher-unit governance (board or rotation). Sanctions on seats. Moving a unit to a new higher unit | Units of 16 to about 2,500 people act as a formation, with no phone holding more than about 28 callsigns | **The commons exists, and units draw their relays from it outside the meeting set.** Measured relay event size and per-IP limits. Seal and open time on the device floor. Review of the voice keys and the higher net by someone who is not their author |
| **U3. Alliance commands** | Alliance commands, recognition in person, and the proposal rule | Units that never met can team up on terms already agreed, and check each other's signatures in person | U2 |
| **U4. Offers, then orders** | Unit missions that members claim, and receipts. Then orders, at the levels charters chose, with `no-tasking`'s not-built wording removed, with the well-known JSON and test, in the same commit | Units that want direction get it, inside §10's limits | Offers: writ ceilings (11.5) and standing (11.6), which must also settle how a unit's Honor, rungs and delegated ceiling are held so that one member's wipe strands nobody's writs. Orders: the same, and a lawyer's review |
| **Later, each by its own trigger** | Incident and Affinity templates, when a group asks. Joint operations, where the build order puts C37's board half. Leader cover and edge-disjoint relays. A sealed all-hands key below a platoon, if word proves too slow there. Cooperative, mutual-aid and guild templates, on request. An *open door* line to the office above, if asked for | — | Each its own |

**Not decided here:**

- **The Articles' final wording.** The owner writes it. What they must say was decided on 2026-10-09
  (§12).
- **Removing someone who has gone quiet.** groups.md §7 says removal is never automatic and
  membership never lapses because someone has gone quiet, and leaves the deliberate case here.
  Reading that as ruling out only removal by the software would let two members remove the key of
  someone who has gone quiet, with the reason in their own words. The owner has not confirmed that
  reading. Until
  they do, a leader who abandons a unit is handled by the XO's shared authority, by recall, or by
  re-forming, none of which needs it.
- **Closed lists.** The *support needed* values and the report vocabulary's exact fields belong in the
  normative spec, written before the code.
- **The legal questions in §17.**
