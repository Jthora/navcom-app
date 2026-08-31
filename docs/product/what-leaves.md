# What Leaves Your Phone

Everything this app sends, what an observer sees of it, and what never leaves at all.

Written because it was true and unreadable. The facts were correct and spread across
[`signals.spec.md`](../spec/signals.spec.md), [`watch-state.spec.md`](../spec/watch-state.spec.md),
[`visibility.md`](visibility.md), `refusals.ts` and half a dozen docblocks — so an operator
deciding whether to trust this had to read a specification, and nobody does that at 11pm.
Nothing here is new behaviour. It is the same behaviour, in one place, in order.

**Adjacent RLSH research proposes a tool that audits what is findable about your persona on
the open internet. That is [declined](../declined.md)** — its own queries create the trail it
looks for. This is the half NavCom can honestly do: an exact account of what *this app*
emits.

---

## The three keys, which is the whole design

Almost everything below follows from this. Your phone holds more than one key, and they are
kept apart on purpose.

| Key | Signs | Why separate |
|---|---|---|
| **Operational** | Signals, `Distress`, the *inner* peer-presence message, your post-quantum key bundle, endorsement withdrawals | Your identity as an operator. Anything signed with it is linkable to everything else it signs |
| **Contact** | Your card, public presence, corrections, places you add | So that **publishing costs no operational exposure**. Somebody watching the directory learns nothing about when you are out |
| **Throwaway** | The *outer* wrapper of peer presence and invites — one per message, never stored | So two messages from you are unlinkable to anyone but their recipients |

The separation is the point. A correction you file at a door and a `Distress` you raise an
hour later are signed by different keys and cannot be tied together by anyone watching a
relay.

## What goes out, exactly

`sealed` means NIP-44 to the recipients and unreadable by a relay. Tags are **always in the
clear** — that is how a relay routes anything at all.

| | Kind | In the clear | Sealed | Signed by |
|---|---|---|---|---|
| Signal (`Query`, `Assist`, routine, sign-on, stand-down) | `20910` | Watchtower pubkey, signal *type* | Everything else — your area, position, question | Operational |
| `Distress` | `20911` | Watchtower pubkey | Everything else. **No type tag**, so a subscriber filtering types cannot miss one | Operational |
| Peer presence | `20913` | **The recipient's pubkey** | Callsign, area, position, until | Throwaway |
| Invite | `1910` | The recipient's pubkey | Everything else | Throwaway |
| Your card | `10911` | Region | *Nothing* — a card is public by definition | Contact |
| Public presence | `20914` | Region | Nothing; the content is deliberately **empty** | Contact |
| Correction | `30911` | The record id | Nothing — a correction is meant to be read | Contact |
| A place you add | `30915` | Place id, region | Nothing | Contact |
| Post-quantum key bundle | `10912` | Your public KEM key. **No tags at all** | Nothing to seal — it is a public key | **Operational** |
| Endorsement withdrawal | `30914` | The credential id | Nothing | **Operational** |
| Watch state | `10910` | All of it | Nothing | Watch key, if you hold the watch |
| Response | `20912` | Recipient, the signal answered | The answer | Watch key, if you hold the watch |

**Two of those rows are worth reading twice.** A key bundle and an endorsement withdrawal
are the only routine things signed by your **operational** key that are also public and
unencrypted. Neither says anything about a night — a bundle is a public key and nothing else,
a withdrawal names only a credential id — but both put that key on a relay under its own
name, where a card or a correction never does. A bundle is published only once somebody
exists to talk to, which is the difference between advertising and answering.

**Credentials are not on this list, and that is not an omission.** A credential
(`30912`) and its claim (`30913`) are **never published**. They are handed over however the
two of you already talk. Nothing indexes them, so no graph of who vouched for whom exists to
breach.

## What a relay operator can actually learn

Stated as capability rather than intent, because you do not get to choose who runs the relay.

**They can see:**

- That an operator pubkey sent a signal to a particular Watchtower, and its type — but not
  the area, the position, or the question
- That a `Distress` occurred, addressed to a Watchtower — but nothing inside it
- **Who receives peer presence, and how often.** The sender is unlinkable; the recipient is
  not. Somebody watching one relay learns that a given pubkey is being kept updated by
  *somebody*, on a rhythm
- Everything about your card, public presence, corrections and places — all public by
  design, and none of it tied to your operational key
- **Which pubkeys endorsed you**, if they watch your subscription filters. Named here rather
  than buried: it is the one place standing is not private, and it is priced in `standing.ts`

**They cannot see:**

- Anything sealed, which is every operational payload
- Which peers you have, from your presence traffic — each message is wrapped in its own
  throwaway key
- Any link between your operational key and your contact key
- Who holds a Watchtower with you. A single-holder watch and a squad produce the same shape
  on the wire

## What never leaves at all

| | Where it stays |
|---|---|
| Your secret keys | Never transmitted, never escrowed, never registered |
| Field notes | Wipeable tier, this device. `notes.ts` — never published, never seen by a peer or a watch |
| Your patrol record | This device, unless you deliberately export it |
| Your emergency contact | This phone. The escalation ladder's contact rung is *device-initiated* — your phone reaches your person, so no number is stored anywhere else |
| Credentials you hold | Held and presented by you. Nothing looks them up |
| Anything about a person you helped | No field, no convention, no exception [invariant 1] |
| Your exact position, publicly | There is **no setting that publishes one.** Not as an advanced option, not behind a warning |

## The honest gaps

- **Traffic is traffic.** Sealing hides content, never that a message happened. A relay sees
  timing and volume, and a quiet phone at 3am is itself a fact. The protection is the
  anonymity set — which is why `refusals.ts` refuses to move operator traffic onto a small
  private relay, where the same events would name exactly who is active tonight
- **The overdue contact is inferable by timing.** It is the one message a node sends unasked,
  and a `20912` arriving with no signal of yours just before it can be guessed at. Weaker
  than the aggregate it replaced, which announced it in the clear, and still real
- **Your endorser set is exposed to the relay you ask.** Above, and in `standing.ts`
- **Nothing here covers what you post elsewhere.** This document is about what the app emits.
  A photograph of your gear on another platform is outside it, and outside what this project
  will build a tool to check
