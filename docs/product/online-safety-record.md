# Online safety record

> **Draft — not in force.** Prepared 2026-09-13 from research, for the maintainer's review and a
> lawyer's. Not legal advice. Parts of what it describes are **not live yet** and are marked so:
> until the complaints address is published on the notice page, the complaints route this record
> relies on does not exist.

The written assessments the UK's Online Safety Act 2023 expects of a user-to-user service, and
the position NavCom intends to take under Australia's defamation and online-safety law.

Whether navcom.app is a regulated user-to-user service at all is genuinely uncertain: it stores
nothing, and cards live on relays other people run. The record is kept anyway, because the duties
it answers are cheap to meet, and a missing risk assessment is exactly the failure Ofcom has fined
a foreign service for. Procedure for complaints: [`notices.md`](notices.md).

---

## What users can do to each other here

Assessed by function, because risk follows what a person can actually do.

| | Limit | Who sees it |
|---|---|---|
| Publish a **card**: callsign, metro, a free-text line, up to three terms from a fixed list, links to their own profiles, an optional Lightning address | Callsign 48 characters; line 140; 12 links | Anyone browsing that metro; everyone, if the author chose public |
| Send a **pairing invite** to somebody whose card they found, with a note | Note 280 characters | The one recipient — sealed to them |
| Share **presence** with people they paired with | Opt-in, coarse | Paired peers only — sealed |
| Send **signals** to a watch they joined | Structured, short | The watch — sealed to its key |

**There is no image, video, audio or file anywhere** — no upload, no camera, no attachment. No
comments, no replies, no feed, no chat thread, no way to browse people beyond a metro board and the
opt-in public roster. Nothing is ranked. Nothing a user writes to a card is stored on NavCom's host.

**In place:** the notice page stating whose words are whose; the key print beside every callsign;
a fixed activity list that promises no result; invites that can be ignored with nothing sent back;
pairing that needs both sides; unpairing at any time; and the mechanism for navcom.app to stop
showing a card (`hidden.ts`), with every hide time-limited.

**Not live yet:** the complaints address, and so the 48-hour procedure that depends on it.

## Illegal content risk assessment

For each kind of priority illegal content Ofcom's register names: the level, and why.

| Kind | Level | Why |
|---|---|---|
| Child sexual abuse material, intimate image abuse, extreme pornography | **Negligible** | No images, video or files exist anywhere in the service |
| Grooming | **Low** | An adult can find a card and send an invite with a 280-character note. Mitigated by: no images, no ongoing chat, pairing needs the other person to accept, ignoring an invite sends nothing, and the audience is adult volunteers. **No age assurance exists**, so this cannot be ruled out |
| Fraud and financial offences | **Medium** | The one real one. A card can impersonate a known operator to collect Lightning payments, or make a false claim about something it sells. Mitigated by the key print and by NavCom never handling money. Impersonation is deliberately **not** grounds for a hide — a complaint must not be how a second card removes the first — so the key print carries it |
| Harassment, stalking, threats and abuse | **Low** | A card describes its author; the free-text line is 140 characters; an invite reaches one person once. A threat qualifies under the notice procedure once the address is live |
| Controlling or coercive behaviour | **Low** | A paired peer — often a partner — can see when an operator is out and past their time. Both sides opt in, the watched person is told, unpairing is immediate, and no location history exists |
| Firearms, knives and other weapons | **Low** | A card may say its author makes or repairs gear and link a shop. No marketplace, no payment handling; an unlawful offer qualifies under the notice procedure |
| Drugs and psychoactive substances | **Low** | Harm-reduction services appear in the directory; a card could offer drugs in 140 characters. No marketplace |
| Hate | **Low** | Free text is short and attached to its author's key |
| Encouraging or assisting suicide | **Low** | No groups, threads or sustained contact between strangers |
| Terrorism, human trafficking, unlawful immigration, sexual exploitation of adults, proceeds of crime, foreign interference, animal cruelty | **Negligible to low** | No function suited to organising, advertising or paying for any of them beyond a 140-character line |

**Overall: low, with fraud by impersonation the highest.** The key print is the main mitigation
and is built.

## Children's access assessment

**Children can access the service.** The Act allows concluding otherwise only where age
verification or estimation is used, and NavCom uses neither — it holds no date of birth anywhere,
by design ([`declined.md`](../declined.md), *How old anybody is*).

**Whether a significant number of children use it, or it is likely to attract them, is not
something NavCom can measure,** because it has no analytics and no accounts. What is known: the
audience is adult volunteers; nothing in it is built to engage; and the about page tells anybody
under about sixteen that NavCom is not where to start and points them at organisations that train
young people. The maintainer's view is that it is **not likely to attract a significant number of
children** — a belief that cannot be verified, not a finding. If that is wrong, a children's risk
assessment and the children's safety duties follow, and that is a question for a lawyer.

## Accountability and terms

**Accountable for this record:** the maintainer, under their callsign. Ofcom's accountability
measure is about responsibility inside the service, not public naming.

**What the terms say gets hidden, and why:** the notice page, [`/notice/`](https://navcom.app/notice/),
and [`notices.md`](notices.md) — a card named in a legal notice or found unlawful, never over a
dispute between operators, and never permanently.

## Australia

- **Defamation.** The digital-intermediary defence, where enacted, needs an accessible complaints
  mechanism and reasonable steps within seven days of a written complaint. **Once the address is
  published**, the notice page and the 48-hour procedure are intended to meet both. South
  Australia's version omits the defence, so there the procedure would be the only protection
- **Online Safety Act 2021.** If navcom.app is a designated internet service, it self-assesses as
  low risk: no images, no messaging between strangers beyond a single invite, nothing stored. A
  removal notice from the eSafety Commissioner would be acted on through the same list
- **Consumer law.** The notice page says NavCom does not review or endorse cards, which is the
  test for whether a site that merely shows a claim has made it

## Review

Look at this again before it is treated as in force, after **any** of the following, and in any
case by 2027-09-13:

- anything that stores what users write on NavCom's own host, including prerendering cards
- running a relay
- any image, file, or message thread between users
- money passing through NavCom, or anything ranked or featured
- regions or a language aimed at a new country
- a notice that qualified
