# Positioning

The document you hand someone instead of explaining.

---

## The sentence

> **NavCom is infrastructure for acting without authority while remaining accountable.**
>
> Someone is always on watch while operators are out. Not an app people check — a post
> someone holds.

An institution is believed because of what it is. Everyone here works without one — no
badge, no warrant, no agency behind them — so **the only thing that can carry belief is what
they can show.** Every part of this system is built out of
[checkable claims](attestation.md) rather than authority, and that is not a security
posture. It is the condition of the work.

## Who it's for

**Real-life superheroes.** Volunteer patrol and outreach networks — people who go out under
a callsign, on their own time, with nobody behind them.

The genre's actual moral core is not power, it is accountability without authority. A hero
has no warrant; the good ones are obsessively answerable, just not to an institution. That
is the same condition as a street medic, an outreach volunteer, or a citizen analyst — which
is why the design serves all of them without being aimed at any of them.

The [resource directory](product/directory-schema.md) is readable by anyone on the open web,
no account and no install. That's deliberate: it is useful to people facing the same night
who will never be operators.

The community already has hubs of its own — Herocore, RLSH.net, the RLSH Wiki. NavCom
doesn't replace them; [`community-continuity.md`](product/community-continuity.md) says
where they are and where to go instead when one has decayed or been taken over.

## Star and Nav

The architecture is encoded in the names, and it wasn't designed that way on purpose.

**Star** is the fixed reference — distant, above, true wherever you stand.
[Starcom](ecosystem.md) looks down and out: orbital altitude, long horizon.

**Nav** is not a map. Navigation is getting from *here* to *there* through real terrain. It
only exists while you're moving.

**You navigate by the stars.**

> **Starcom is the guy in the chair for the world. NavCom is the guy in the chair for
> tonight.**

On a ship's bridge, Navigation and Communications are separate stations. NavCom fuses them
into one post that both knows where everyone is and can talk to them. That fusion *is* the
watch.

## What operators need from it

1. **Someone in your ear who knows where you are.** The most reliable trope in the genre
2. **A call that is heard.** Not a message — a summons that *lands*. Which is why every
   signal is acknowledged and silence is never a response
3. **Knowing who else is out.** Solidarity, not surveillance
4. **Going on duty meaning something.** The threshold act that turns a person into an operator
5. **Coming home and being counted.** The genre almost never shows it, and it may matter most
6. **The thing that makes you more than one person.** A lone vigilante is someone in a mask.
   A network with a watch, a protocol and a record is an organisation

## What it is not

| Not | Because |
|---|---|
| A social app | No feed, no browsing people, no comments, anywhere |
| A tactical map | The device floor is a prepaid Android 8 with 400MB free, and a live position map drew the most refusals of any feature tested |
| A humanitarian directory | The directory is what operators *do*. The watch is the product |
| **A dispatch system** | **Nothing here can task anyone.** The watch tells you what is happening; it never assigns. There is no dispatch verb, and there will not be one |
| A chat app | Discord and Signal already work. This builds what chat structurally can't: defined responders and response windows |

**That fourth row is load-bearing and was got wrong once.** An earlier draft of this page
called NavCom "non-institutional dispatch," which is a good description of the *shape* and a
dangerous description of the *authority*. Dispatch assigns. A network of volunteers with no
hierarchy cannot assign, and a system that appears to would be sending people toward danger
on its own initiative.

## What it never does

- Records anything about the people being served. No field, no convention, no exception
- Lets a `Distress` signal end anywhere but in a human — or tells the operator it couldn't
- Infers duress from silence, missed windows, or inactivity
- Presents an agent as a person
- Holds a legal name

Full set and conflict-resolution order in [`principles.md`](principles.md).

## The short version

NavCom is a watch. When operators go out, a named person at a console — or an agent when
nobody is on station — holds a board showing who's out, roughly where, and when they last
made contact. Operators signal rather than browse. Every signal gets an answer.

The one that makes it worth having on an ordinary night is `Query`: you're outside a closed
shelter at 10pm with someone who needs a bed, and instead of tapping through a database
one-handed in the cold, you ask the person with both hands free.
