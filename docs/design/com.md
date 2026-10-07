# Com: the other half of the landing page

Nav is a map and [`map.md`](map.md) designs it. Com was a blank half of the screen.

The thing that clarified it: **Com is not a panel, it is a navigation stack whose root changes with
state.** Profile, groups, chat, search and the detail view of anything all live in it, which is far
more than a panel holds and exactly what a stack is for. Bottom sheets are how a stack presents on a
phone, which is why both arrived in the same sentence.

Status: **design, decided 2026-10-06. The shell is built** — the two containers, the three detents,
the search-first root and the `Distress` layer, as the landing page — **and the stack's first
screens**: the mission list, opened from the map's missions line or a tapped province, and a
mission's page, both loaded on first open. **The signed-in root has begun**: someone signed on finds
their own missions first — what they hold, what waits to be reported, what they sent and how it
settled. Profile, groups and chat are not built. Companions: [`panel.md`](panel.md) for the readout rules,
[`map.md`](map.md) for Nav, [`delivery.md`](../delivery.md) for the budgets this is measured against.

---

## 1. What Com is responsible for

| | |
|---|---|
| **Profile** | Yours, and anybody else's |
| **Groups** | Crew and organisation operations, and **looking for one to join** |
| **Chat** | Within a group. §5, which is where it collides with doctrine |
| **Search** | People and groups, by name |
| **Detail of anything** | A mission, a group, a profile, a record — pushed onto the stack |

And what it is **not**: a bulletin board. The map carries missions and reports because that is what a
map is for, and fine-grained intelligence belongs in Starcom rather than here. Com is the
*communication* half — who, and with whom — not a second feed of the same events.

**Search here asks nobody**, which is why it is permitted. The banned pattern is a search box on the
field terminal that sends a question to a human; `Query` exists for that and is the product. Finding a
group by name reads what the device already has.

---

## 2. The root changes with state, and that is the whole onboarding

**Signed out, the root of the Com stack is the directory search, with account setup one line
beneath it — and Nav is already populated behind both** (revised 2026-10-06).

The first version put setup at the root, and that was right for somebody deciding whether to join
and wrong for the other person who arrives here: somebody who needs a place to sleep tonight. The
landing page has always been the directory's front door, and putting a form in front of the search
would have made the person who most needs NavCom meet a sign-up first. Search first serves both —
nobody in need sees a form, and an operator is one tap from setup.

This is the entire first-run experience and it needs no separate flow. Public missions and live map
activity render immediately, behind and beside a setup form, so the value is visible *during*
onboarding rather than promised after it. Nothing is withheld to get somebody through the form.

**Signed in, the root is your own situation**: watch state, your open claims, your groups.

It also keeps the install-prompt rule intact without trying. There is nothing to pitch, because the
thing being pitched is already running.

---

## 3. Mobile is a different layout, not a narrower one

**A map at half a phone screen is unusable**, so the two-pane split is a desktop arrangement only.

| | |
|---|---|
| **Desktop** | Nav takes the larger pane; Com is a stack in a sidebar beside it |
| **Mobile** | **Nav takes the whole viewport. Com is a bottom sheet with three detents** |

The three detents are what make it work:

1. **Peek** — a collapsed bar carrying watch state and your open claim. The one thing worth seeing
   while looking at the map.
2. **Half** — lists, search, a group. Enough to read and act, with the map still oriented behind.
3. **Full** — one detail view, filling the screen.

Signed out on a phone, the sheet opens at **peek**, and peek is sized to hold the whole search field:
**12.75rem, measured** on a Pixel 5 and an iPhone SE rather than guessed. Focusing the search lifts it
to half, where the results are. The first draft opened at half with setup in it; §2's revision put the
search first, and a search that fits in the peek leaves the map at full size behind it. Which is the
point: somebody who has not signed up is looking at real missions while they decide.

This is mobile-first in the sense that matters here — **the field case is the phone case.** Somebody
standing in a car park at 1am gets the map at full size and summons everything else.

---

## 4. `Distress` is a fixed layer that nothing can cover

**Decided, and it is an invariant question rather than a layout preference.** A sheet at full height
would cover `Distress`, and invariant 2 says the ladder may fail but never fail silently — a control
nobody can reach has failed silently.

So **`Distress` lives in its own layer, outside both panes, on every screen, and no sheet, map, detail
view or modal may ever cover it.** It costs permanent vertical space on a phone and that is the right
price: it is the only arrangement where reaching it does not depend on what state the interface
happens to be in.

The rejected alternative is instructive. Pinning it to the sheet's top edge would have been reachable
at every detent and saved the space — but then reaching it depends on the sheet behaving correctly,
and [`verification.md`](../verification.md) records that this project has shipped three mechanisms
whose logic was right and whose output was not. `panicWipe` had no button for weeks. A dependency is
exactly what this control must not have.

**This needs the test that `panicWipe` lacked**: not that the component renders, but that the control
is reachable from every screen with the sheet at every detent.

---

## 5. Chat is pull-only, and nothing ever announces itself

**Decided 2026-10-06, against the alternative that would have worked better.**

The collision is real: the field terminal is silent — no badges, no activity, no nudges — and
`Distress` paging to registered on-call operators is the single exception. A chat that cannot announce
a message is a chat whose messages are read late.

It is still the right answer, for one reason that outweighs the convenience. **A second interrupting
channel degrades the first one.** Alarm fatigue on group chat bleeds into the channel where failure
means somebody is hurt, and that channel's reliability is the thing nothing here is allowed to spend.

So: messages are there when you look. The app never interrupts, never badges, never buzzes.

**The honest consequence, written down rather than hidden:** crews will keep using Signal for anything
time-critical, and they should. Chat here is for the durable things — who is in this group, what was
agreed, where to meet — not for raising somebody now. If a group needs somebody *now*, that is
`Distress` and on-call registration, which already exists and is already consented.

---

## 6. The script budget, and how Com fits inside it

**Measured 2026-10-06 against the built artifact:** the root console is **54.8 kB of JavaScript
against a 60 kB budget**, already past its 52 kB warning line, with a page total of 96.1 kB of 120 kB.
Headroom is **5.2 kB**. A navigation controller, bottom sheets, chat, profile search, group operations
and detail views do not fit in that, and it is not close.

The budget is derived from a time — about 3 seconds to interactive on a congested cell at 0.8 Mbps —
so it is protecting something real rather than expressing a preference.

**Decided: code-split, so first paint ships the peek bar only.** The landing page loads the map and a
collapsed Com bar inside the existing budget. The stack, chat, search and detail views load the moment
somebody opens the sheet.

This preserves precisely what the budget was protecting — **how fast the first screen becomes
usable** — while putting no ceiling on what Com eventually holds. Raising the number would have
removed the pressure that has kept the first screen fast for its whole life, and that pressure is the
only reason it still is.

Two things this requires, and the first one is the opposite of what an earlier draft of this
document said.

**The budget already measures first paint correctly, and that is the problem.** `assetsOf` reads each
page's HTML and counts only what the HTML references, so a chunk pulled by a dynamic `import()` is
invisible to it. The peek bar stays measured and capped — that part is fine. What goes wrong is the
line the report prints at the end: *"15,398 unreferenced files, 11,498 kB gzipped — emitted by the
client build, loaded by no page."* **That claim becomes false the day Com code-splits**, because those
chunks will be loaded, just later. A budget that silently stops describing what a reader downloads is
worse than a budget that fails.

So the script needs a **third measurement**: the weight reachable by dynamic import from a page,
reported separately from first paint. The Vite manifest already records `dynamicImports` per chunk, so
the graph is available without parsing JavaScript. Reported first, then enforced once there was
something to enforce — which is how every other budget here was set, derived from a measurement rather
than chosen to fit. **Set 2026-10-06** when the mission screens split off: 27.7 kB measured, a 33 kB
ceiling and a 30 kB warning line.

**An opened sheet on a dead connection must say so.** A chunk that fails to arrive is a blank sheet,
and offline is a normal state here [C10]. The service worker's whole-origin cache covers this after
one visit — but the *first* visit is exactly the case the device floor exists to protect, so the
failure has to read as a failure rather than as an empty panel.

---

## 7. The three smaller questions, answered

**A mission tap opens the sheet at *half*, never full.** A mission is about a place, and the map is
what makes the place mean anything — losing the map to read the mission discards the context that
made it legible. Full height is for profiles and long-form, where there is no map to lose.

**The peek bar has fixed slots and silence is a readout.** It carries watch state, which is never
empty — somebody is on watch or nobody is, and both are answers — and your claim slot, which reads
*nothing claimed* rather than disappearing. A bar whose contents come and go is a bar nobody learns
the shape of, and [`panel.md`](panel.md) already settled that: fixed slots, and silence reads as a
readout rather than as absence.

**Desktop keeps the sidebar; mobile gets the sheet. One stack, two containers.** A sheet on a large
display is wrong, and the saving from a single container is small because the stack's *contents* are
identical either way — panel.md's fixed-slot discipline means a group view renders the same rows in a
sidebar as in a sheet. Only the container and its gestures differ.
