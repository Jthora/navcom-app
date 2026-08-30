# The Field Terminal

For someone standing outside, at night, in the cold, possibly with one hand, possibly
with someone waiting on them.

Everything about it follows from that. **It is not a small console — it is a different
instrument for a different situation.**

---

## Design constraints

- **One hand.** Every primary action reachable with a thumb
- **Dark.** Legible at night without destroying night vision; no white flashes
- **Cold.** Usable with gloves. Large targets, no precision gestures
- **Fast.** Under two seconds from unlock to signal
- **Quiet.** No notifications, no sounds, nothing that announces itself in public
- **Offline.** Fully functional with no signal; syncs when it can
- **Small.** Runs on a prepaid Android 8 with 400MB free

## Five screens

**1. Status.** The home screen, and the most important thing on it is the **watch state** —
Station, Automated + on-call, Automated, or Dark, with who holds it. An operator learns
what's behind them before they decide to go out.

Plus: signed on or off, elapsed time, next routine window.

**2. Signal.** Six buttons, one tap each. `On station` · `Routine` · `Query` · `Assist` ·
`Distress` · `Stood down`. Distress reachable from the lock screen.

**3. Directory.** Cached, offline, and deliberately simpler than the console's — nearest
first, filtered by what's open now, with intake rules visible. One-tap flag when
something's wrong, queued for sync.

For anything more complicated, send `Query` and let the console do the work.

**4. Playbook.** De-escalation, first aid, overdose response, cold exposure. Large type,
no navigation depth, works when you're panicking. One tap from anywhere.

**5. Log.** Field notes as you go — text, timestamp, coarse location. Never about
people being served. Compiles itself into the op record at stand-down.

> This said **"text, photo, timestamp"** until an audit checked. NavCom handles no media at
> all — no file input, no capture-and-store path, nothing in `static/` but icons — and the
> spec layer never specified one, so per the rule that
> [the spec wins](../../CLAUDE.md), the narrative was the bug.
>
> It should also stay that way. This field is already, by
> [`build-order.md`](../build-order.md)'s own account, *"the riskiest free text in the
> system — written in a hurry, about something that just happened, which is exactly where a
> line about a person gets written despite every rule."* A camera in that slot is invariant 1
> with no enforcement surface: an image field is a field, and nothing can check what is in it.

## What isn't here

No feed. No map of other operators. No browsing people. No chat. No profile editing. No
settings buried in menus. No engagement of any kind.

Those live on the console, or nowhere.

## Running dark

With no watch and no signal, the terminal still does real work: cached directory,
playbooks, local logging, and duress falling back to SMS to the operator's own contact.

**Safety independence, not capability independence.** Running Dark must never leave an
operator worse off than carrying no app at all — but it does leave them substantially less
capable, because `Query` is the point of having a watch. Dark is survivable, not
equivalent.

## Safety actions

**Panic wipe.** Destroys tonight — logs, cached op detail, position. Identity and
standing survive. Fast, deliberate, no confirmation dialog to fumble through under
stress.

**Burn.** Destroys everything including persona and endorsements. Deliberately harder to
reach, clearly warned, irreversible.

**Discreet mode.** Configurable app name and icon, so a glance at a borrowed or seized
phone doesn't announce affiliation.
