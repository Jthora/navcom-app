# Identity & Standing

Identity is the center of NavCom, not a settings screen. It's what makes the app the
operator's rather than the org's.

---

## Persona

What exists:

| | |
|---|---|
| **Callsign** | The name they work under |
| **Emblem** | Their mark. **Designed, not built** — see below |
| **City / region** | Coarse by default — metro, not neighbourhood |
| **Active since** | The date they started |
| **Focus** | Outreach, medic, patrol, logistics, support — multiple allowed |

What does not exist, anywhere in the system: legal name, phone number, email address,
date of birth, home location, employer, or any photograph of the operator.

> **The emblem is not built, and that clause used to read as though it were.** It said
> *"…photograph of the operator's face unless they deliberately upload one as their emblem"*,
> which describes an upload path that does not exist: an audit found NavCom handles no media
> anywhere — no file input, no capture-and-store, nothing. There is no way to attach an image
> to a persona, so the exception described a hole that was never open.
>
> Kept in the table because the emblem is a real part of how this community already works,
> and building it is a live option. But it would be the first media NavCom ever touches, and
> that is a threshold decision — an image is the one field whose contents nothing can check,
> and it carries EXIF, faces and backgrounds — not a small addition to a profile screen.

**Callsign and emblem are the operator's real working identity, not a privacy wrapper.**
People in this community already work under a name and a mark, often for years before
encountering NavCom. The pseudonymity is a genuine safety property — but the persona is
not a stand-in for some truer identity being concealed. It *is* the identity the work is
done under, and the app treats it with that weight.

There is no account. The keypair generated on the device **is** the identity. Nothing is
registered with anyone; nothing can be revoked by anyone.

## Standing accrues on two independent axes

This matters, and it's the part most vouching systems get wrong.

### Axis 1 — Endorsements

Signed statements from operators who have worked beside you, carrying a **scope tag** —
never free text.

`worked with` · `reliable` · `de-escalation` · `medic` · `logistics` ·
`trained with me` · `can take watch`

`can take watch` is the qualification for holding the board — granted by operators who
have worked with you, using the standing model rather than introducing a rank. See
[`../watch/the-watch.md`](../watch/the-watch.md).

Free text is prohibited deliberately. An endorser explaining *why* someone is credible
is how an operator's history leaks — the person with the most valuable knowledge is
often the one with the most to lose from it being described.

`trained with me` matters more than it looks: it's the cleanest route to first standing
for a newcomer who has nothing yet.

### Axis 2 — Contribution

Directory corrections, playbook additions, answered questions — credited to the
callsign that made them.

**Why two axes:** an operator with deep lived experience and no social history can build
real, visible standing through contribution alone, without waiting for anyone's
permission. A single-axis reputation system ranks that person as untrusted, which is
exactly backwards — they often know more than anyone endorsing them. Contribution
requires nobody's approval, and it shows.

## Endorsements are attestations about people

An endorsement is [an attestation](../attestation.md) whose subject happens to be a person:
a claim, its author, and a scope tag — signed, and **held by the recipient rather than
indexed anywhere.**

Everything else follows from the model rather than needing its own argument:

- **No central social graph exists.** Nobody, including us, can query *who knows whom*.
  One honest qualification, found by audit rather than volunteered: a device watching for
  withdrawals subscribes with `authors: <your endorsers>`, so **the relay it asks can learn
  who vouched for you**. That is one relay of the operator's choosing seeing one device's
  endorser set — not a graph anyone can query, so the claim above stands — but it is the
  seam, and it is priced in `standing.ts`'s `start()` rather than left for the next auditor.
  There is no map of pseudonymous operators' associations to breach, sell, subpoena or leak
- **Verification is local and offline.** You present your endorsements; my device checks the
  signatures against the endorsing callsigns. Works with no signal
- **Provenance by name, never a count.** You trust someone because you recognise who vouched
  for them. A tally can be manufactured; a recognised author cannot
- **Revocation is possible** — endorsers publish a revocation, checked when online
- **You choose what to present.** Everything, or only what is relevant to this op

The trade is no global leaderboard and no discovery-by-reputation. That is an acceptable
loss: the graph was the single most dangerous artifact this project could have created, and
it was never the point.

## Endorsing someone who isn't here yet

You can endorse an operator who doesn't use NavCom. The attestation is signed and exists
regardless; it becomes a **claimable credential** they can take up or ignore.

This is also how the network grows — along real working relationships rather than
recruitment. See [`propagation.md`](./propagation.md).

**The credential names no one but the endorser.** It reads *"I vouch for the holder of
this credential,"* carries a scope tag and a date, and binds to whatever persona claims
it. An endorser can never create a record naming a person who hasn't agreed to exist in
the system — which resolves the consent problem at its root rather than managing it.

- **Inspectable offline before claiming.** The recipient reads exactly what it contains
  and verifies the signature with zero network activity. Nothing phones home before they
  consent
- Claiming requires only generating a persona — no account, no verification, no approval
- **Recognition, not recruitment.** Past tense: someone you worked with vouched for you.
  Never an invitation to join anything
- **One delivery, no reminders, no expiry.** Nothing is accumulating anywhere, because
  the system never holds or delivers it. A countdown would only manufacture pressure
- **The endorser cannot see whether it was claimed.** Declining is silent and permanent
- The endorser passes it along however they already talk to that person. The app holds no
  contact details, so it cannot deliver anything itself

## What this is not

**It is not a security system, and must not be described as one.** It raises the cost of
showing up as a stranger with no history. Nothing more.

- **Sybil-resistant only weakly.** Anyone can generate keys. The value is in recognising the
  *endorsers*, which is the model's answer everywhere: provenance over count
- **Endorsements can be traded or given carelessly.** Treat volume as noise
- **Absence of standing means nothing.** New and private operators are legitimate, and an
  operator running Ghost is unendorsed by choice. The UI must never present an unendorsed
  operator as suspect — only as unknown

**Where infiltration is the actual threat — protest support, hostile environments — the
answer is out-of-band verification, not this app.** Standing raises the cost of showing up
as a stranger; it does not establish that someone is safe.

## Recovery

A lost or seized phone must not erase years of standing. Three options, all opt-in, none
required — see [`opt-ins.md`](./opt-ins.md).

- **Operator-held backup.** Identity and endorsements export as an encrypted file or
  printed recovery code, kept wherever the operator chooses. No third party involved
- **Social recovery.** Shares distributed among operators who have endorsed you; a
  threshold of them can restore your persona. Fits a network already built on
  endorsement, and needs no server to hold anything
- **Nothing.** A legitimate choice, stated plainly at persona creation: **no recovery
  method means no recovery**

There is no account-based recovery, because an account would require identifying
information. But "we don't hold an account" was never a reason to let someone lose a
decade of standing to a dropped phone — the operator chooses their own tradeoff.

## Panic wipe, burn, and what endorsements expose

Panic wipe destroys the [Wipeable tier](./data-tiers.md) — tonight's data. It does not
destroy identity, because an operator under duress should lose the evening and keep the
decade.

**But endorsements are association data.** Each one names the operator who signed it, so
a collection of them maps who has worked with whom. That's the artifact we refused to
build centrally, and it can't be avoided locally — verification requires knowing the
endorser.

The threat models are different, and the two actions match them:

| | Protects against | Destroys |
|---|---|---|
| **Panic wipe** | A taken phone being searched | Wipeable tier only. Identity and standing survive |
| **Burn** | Compulsion, seizure with intent | Everything, including persona and endorsements |

Endorsements are **encrypted at rest and require unlock to view**, so a casually searched
phone yields nothing readable. Burn is deliberate, harder to reach, clearly warned, and
irreversible.

Say this plainly to operators rather than implying panic wipe is total. An operator who
believes they're covered when they aren't is worse off than one who knows the boundary.
