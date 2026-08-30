# Community Continuity

The RLSH community's own infrastructure decays and gets squatted while nobody is watching,
and that is fixable at zero users — nobody has to install anything for a link to point
somewhere safe instead of somewhere taken over.

**The list itself is on [the about page](https://navcom.app/about/), not here.** This page is
the doctrine behind it. The reader who needs the links is not the reader who needs this.

## The finding, checked rather than asserted

While writing this: **`therlsh.forumotion.com` redirects to `therlsh.board-directory.net`** —
a squatter, not a continuation of the forum. The last good copy of the real site predates the
takeover by about twenty months. Separately, `superheroesanonymous.org` — the domain a reader
would *guess* for an organisation that is alive and well at `.com` — has no DNS record at all,
which makes it available to anyone who wants that name's credibility tomorrow.

Neither of those is a hypothetical. Both were found by trying the links.

## Why it is data, not a page of prose

The first version of this was a markdown table with a hand-typed *"checked on"* beside each
row: a page about link rot, which rots. It shipped three defects that re-reading the sentences
could never have found — a live entry with no link at all, two archive links left on plaintext
`http://`, and a liveness note that read as doubt when the evidence was actually strong.

The list now lives in [`web/src/lib/community.ts`](https://github.com/Jthora/navcom-app/blob/main/web/src/lib/community.ts)
as typed data, and `community.test.ts` asserts against **the built HTML** what prose cannot:

- no page on this site links a domain on the blocklist, live or dead
- every URL is `https`
- every live entry is actually rendered somewhere a reader can reach — an entry present in
  the data and absent from the page is not published, which is
  [`verification.md`](../verification.md)'s rule applied to a link list
- **no check has been left to go stale in silence.** Past six months the build fails until a
  person re-verifies the links. That rule fails on its own with no code change, which is the
  intent: a squatted domain sitting unnoticed for years is the exact failure this exists to
  prevent, and a comment asking someone to re-check does not prevent it

## Three rules

**Links, never mirrors.** A live property gets a link and nothing else. No copy, no scrape, no
re-host. `propagation.md` §3 already sets this for Herocore — NavCom captures the patrol and
hands the record to where the community already gathers — and it extends to every entry.

**Archive links, not archived content.** Where a property is gone, the destination is the
Internet Archive's copy, which already exists and belongs to nobody here. Re-hosting a dead
forum's actual content on NavCom's own infrastructure is a **different act**: archiving
something abandoned needs nobody's permission, but republishing it wholesale waits on finding
an original maintainer and asking. That is real, separate, human work and it is not attempted.

**No claim about who is real.** Being listed is not a credential and absence is not a
judgement — the same refusal [`positioning.md`](../positioning.md) makes and the same one
[`attestation.md`](../attestation.md) derives everywhere else. This says where things are, not
who counts.

## How liveness is recorded

Three markers, because collapsing them loses the distinction that got this wrong once:

| | Means |
|---|---|
| `fetched` | Asked for the page from here and real content came back |
| `challenged` | A bot-mitigation challenge answered instead of the page. **The site is up and defended** — this is evidence of life, not doubt |
| `cited` | Someone else's report, not checked from here. The weakest of the three |

The middle one matters. Reporting a Cloudflare challenge as *"could not confirm"* understates
what is actually known, and understating is as inaccurate as overstating — invariant 9's
distinction between *stale* and *unknown*, aimed at a link instead of a shelter. This project
has already been bitten by the same confusion from the other direction; see the docblock in
`web/src/lib/version.test.ts`.

## What this does not do

- **No re-hosted copy** of any dead forum's content — gated on maintainer consent, above
- **No monitoring.** The staleness rule forces a periodic human re-check; it does not watch
  the domains. Nothing here notices a takeover the day it happens
- **No coverage of gear, legal reference, training or OPSEC content.** Adjacent RLSH research
  proposes all four. They are separate, larger pieces of work and none of them is implied by
  this page existing
