# Research

Background that informs the design. Useful as input, not as authority.

## What's here

| | |
|---|---|
| [`lore.md`](./lore.md) | **Read first.** Fiction as design source, and why |
| [`what-fiction-skips.md`](./what-fiction-skips.md) | The problems no story has to solve — where original design lives |
| [`archetypes.md`](./archetypes.md) | Twelve field-operator archetypes for stress-testing designs |
| [`ecosystem-roster.md`](./ecosystem-roster.md) | Watch, analysts, agents, infrastructure, outside, adversaries |
| [`constraints.md`](./constraints.md) | What those stresses demand of any feature |
| [`prior-art.md`](./prior-art.md) | What already exists, and what it teaches |
| [`rlsh-brief-reconciliation.md`](./rlsh-brief-reconciliation.md) | An outside brief's ~85 proposals, checked against the code one at a time. **Read before acting on external research** — most of it converged, and the value was the eight defects it found here |

## How to use the archetypes

They're a **stress-testing device**, constructed from published material about real-life
superhero and volunteer street outreach communities — not interviews, not evidence about
real people.

The correct use is: *design a feature, then check it against the twelve to find what
breaks.* Breakage tells you what the feature needs — a visibility setting, an offline
path, a smaller footprint, clearer semantics.

The incorrect use is to treat a failure as a verdict. The roster is deliberately weighted
toward operators who refuse, break or abandon software, because that's what surfaces
problems early. A roster weighted that way will reject almost anything if you let it
vote. **It surfaces requirements; it does not decide scope.**

When an archetype refuses a feature, the first question is always *"what setting would
let them opt out while everyone else keeps it?"* Removal is the last resort, not the
first.

## What real evidence looks like

Everything here is hypothesis until operators use the thing. Real signal comes from:

- Someone corrects a directory entry without being asked
- Someone adds knowledge nobody prompted them for
- Someone opens the app on a night with no op scheduled
- Someone travelling uses it to work with people they've never met
- Someone says they'd notice if it disappeared

Those beat any amount of analysis in this folder.
