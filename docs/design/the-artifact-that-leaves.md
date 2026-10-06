# The Artifact That Leaves

**A plan, not a build.** [`propagation.md`](../product/propagation.md) §2 names this mechanism —
*"a scrubbed, well-made recap of an operator's own op, designed to be posted publicly"* — and
calls design quality the whole mechanism rather than decoration. This page is what that would
take, measured against what the app already has, after an audit on 2026-10-05.

It exists because Archangel Agency proposed a wire format for the same subject and the honest
answer to *"is that your op recap?"* turned out to need an audit: **the content is built and
reachable, and nothing publishes it.**

## 1. What already exists

| | |
|---|---|
| [`contribution.ts`](../../web/src/lib/terminal/contribution.ts) | *"What you contributed, in a form you can hand to somebody"* — nights out, fields corrected, places added. Reachable today on the patrol screen, rendered as text with a copy button and three toggles |
| [`patrol.ts`](../../web/src/lib/terminal/patrol.ts) | The record, plus `exportPatrols`/`patrolLines`. Three states stated in its own header: transmitted is live position only, local is whatever the operator keeps, **exported carries no coordinates at any precision** |
| `keepsHistory()` | Off by default, and the trade is priced where the operator makes it: the Protest Medic wants it off, the Public Face wants it on |
| `corrections.svelte.ts` | The template for an operator publishing a public record, including its unsent queue |
| `DOES`, the card, `listed()` | The activity vocabulary capped at three, and the one operator-side switch that makes anybody findable |

**What the existing record already refuses** is the same list a consumer would ask for: no
coordinates, no counts of people helped, no other operator's callsign, no notes, no keys, no
association data. Two designs arrived at that separately, which is the strongest evidence the
shape is right.

## 2. The finding that sets the order: Instagram will not take text

The Web Share API has carried files since Chrome 75, with `navigator.canShare({ files })` as the
feature test. But **Instagram's share target is image-oriented** — `image/*` with a stream — so a
text-only share never reaches it.

`propagation.md` sets the quality bar at *"whoever has the most demanding feed"*, and that
operator is the Public Face, whose feed is Instagram. So the rendered image is not a nicety on
top of a text share; **it is the only version of this that reaches the archetype the mechanism
was written for.** The text share serves Mastodon, Bluesky, Signal, email and a grant committee —
everything except the case that matters most.

That is `propagation.md`'s own sentence arriving from the outside: visual design is the mechanism.

## 3. The plan, ranked by value over cost

### P1 — The share sheet. Hours, no bundle cost.

**We built a careful, scrubbed, safe-to-post artifact and stopped one step before the act it
exists for.** There is no `navigator.share` anywhere in the app; the only way out is the
clipboard, after which the operator leaves to find an app themselves.

`navigator.share({ text })` behind a `canShare` test, with Copy kept as the fallback. It serves
the Public Face today, needs no new object, no kind, and nobody's permission.

### P2 — The rendered card. Canvas 2D, no library.

1080 × 1080 is the one size to draw: square posts well on Instagram and Bluesky, and Mastodon's
1200 × 675 can come later if anybody asks. `toBlob` → `File` → `navigator.share({ files })`,
guarded by `canShare({ files })`, with a download as the fallback.

What it carries is already decided by §2 of `propagation.md` and C22: callsign, date, the activity
in words, the region if the operator left it on, and a quiet mark of provenance. No counts, no
impact claims, no call to action, no referral code.

**The font is an open decision rather than an inherited one.** P8 closed webfonts for the
interface because a font that has not loaded is text that is not there, and a reflow while
somebody reaches for `Distress` moves the layout under their thumb. *Neither argument reaches an
image drawn after a deliberate tap* — nothing reflows and no text is missing, and the
`FontFace` API loads a face and adds it to `document.fonts` before the first `fillText`. So the
choice is: a subset face for the canvas alone, or the system stack and an artifact that looks
different on every phone. The second is the default if nobody decides, and it is the one that
costs `propagation.md`'s quality bar.

**Alt text ships beside the image.** The share sheet carries no alt field, so the operator has to
paste it in the app: generate it with the card and offer it to copy. Worth knowing while writing
it — Instagram shows alt only to screen readers, and Mastodon cannot edit alt after posting.

### P3 — The signed report.

Kind `1912`, reserved rather than allocated, and gated on two things that are not code: the
allocation decision, and one operator who actually wants to post. The object mirrors
`observation.ts`; there is no `g` tag, for the reason in
[`verified-capabilities.md`](../product/verified-capabilities.md)'s neighbourhood — a
region-indexed per-operator work report is C27's *queryable history of who was out where*, built
by us, on public relays, permanently.

### P4 — Correction, and withdrawal that tells the truth.

Correction is nearly free: a new report carrying `supersedes`, the pattern `1911` already uses.

Withdrawal is new code — **NIP-09 kind 5 exists nowhere in this codebase** — and its copy matters
more than its implementation. The specification is explicit that relays *may* honour or ignore a
deletion request, that there is no enforcement, and that deleting from all relays and clients is
impossible. So the screen says what is true: this changes what you share from now on, and it
cannot unshare what is already out.

A **local list of what was published** comes with this, because nobody can correct what they
cannot see. Wipeable tier, and panic wipe takes the list while the events stay where they are.

### P5 — The throttle, which is a privacy control.

Excluding `patrol` from the publishable vocabulary does not remove the pattern it was excluded
for: one callsign, one metro, a date, weekly, is the same series read the same way. So the client
warns before a second report in the same region inside a short window, and refuses same-day
publication by default. Both advisory — the wire cannot enforce either, and a rule we cannot keep
is worse than one we do not claim.

**No queue.** `observations.svelte.ts` already refuses one, in those words, because a queue that
survives a panic wipe is a store of where an operator has been, while `corrections.svelte.ts`
queues because a correction is about a door rather than a person. A report is about the operator.
So a delay cannot mean *we will publish it for you later*; it means *not tonight, come back* —
nothing on the device to seize, and the operator stays the one who acts.

### P6 — Export to Herocore.

`propagation.md` calls this primary because the audience is already there, and it is unbuilt.
Blocked on their accepted format rather than on us.

## 4. UX rules for the publish path

- **Extend the patrol screen. Do not add a twenty-first route.** The material, the toggles and the
  export block are already there.
- **Draft from the record, never a blank form.** Date, activity and region prefilled from the
  patrol and the corrections it came from; the operator edits down. A form invites typing, and
  typing is how free text gets in.
- **Region is a per-report toggle**, mirroring `includeAreas`, with the consequence in the readout
  rather than in a paragraph.
- **Silence is a readout.** `PUBLISHED — nothing yet` is a statement; an empty state with a call to
  action is the first step back toward streaks, which C5 forbids.
- **Name the trap once.** Patrol history is off by default, so for most operators there is nothing
  to draft from. Say it plainly, once, and never nag.
- **Offline is "not now"**, per P5.
- **No count of reports, ever** — C20.

## 5. Found while auditing: three mechanisms nobody can reach

The project's own standard is that a mechanism nobody can reach is not built. A scan of every
exported name in `lib/terminal` for callers outside its own file and tests found three worth
naming:

- **`setCallsign` has no caller anywhere.** An operator cannot change their callsign. That was
  tolerable while a callsign was a label; it matters more once a published report binds a callsign
  to a key permanently, and more again because retiring a persona is ordinary in this community.
- **`setRelays` has no caller outside its own test.** The terminal's relay list is fixed to
  `DEFAULT_RELAYS`. The relay box on the setup screen configures *the watch*, through `config.ts` —
  not the client. Mk1 defers a self-hosted RelayNode, but the client-side mechanism exists and
  nothing reaches it, so an operator whose relays are slow, blocked or self-hosted has no move.
- **`tierSizes` is used only by its test.** No screen tells an operator what is using space on a
  device floor defined as 400 MB free.

Smaller, same shape: `dialable`, `noteFor`, `watchCover`, `clearStorageError`.

## 6. Declined up front, so they stop being proposed

A weekly cadence prompt or a streak (C5). Auto-publishing or scheduling — `propagation.md` says
generated on request, never automatically. Any count of anything (C20). A public per-operator
archive page on navcom.app (C27). `patrol` as a publishable activity term, for the reason
Archangel gave first: a public series of patrols by one callsign in one metro is the pattern the
Doxxer reads.
