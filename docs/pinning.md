# Holding a copy of the directory

For whoever runs an IPFS node and is willing to keep NavCom's directory alive. Written so the
ask can be said yes to in one command and refused without breaking anything.

## What it is

`data/regions` — 479 records across 68 regions, plus the manifests that carry the country,
timezone and languages each row inherits. It is the only durable public artifact NavCom
produces. Everything else here expires on purpose: presence, the board, corrections and
places are device-local and merged at read time, because [C27] makes a queryable history the
failure mode rather than a feature.

**Roughly 1.3 MB, non-growing except as regions fill.** For scale against the EIN's ratified
Jetson allocation, that is smaller than the Academy's 2.9 MB corpus and about 0.08% of
RevNow's 1.62 GB episode window. It is the cheapest pin in the network by two orders of
magnitude, which is the main argument for it.

## The command — and NavCom holds no credential for your node

```
curl -sL https://navcom.app/_ipfs/navcom-directory.car | ipfs dag import
```

**That is the whole integration, and it is the default rather than the fallback.** The archive names its own root, so nothing needs to be
configured and no identifier has to be copied by hand. The current one, with what it holds,
is at [`/.well-known/navcom-health.json`](https://navcom.app/.well-known/navcom-health.json)
under `directory`.

## If you would rather NavCom pushed it to you

Set `IPFS_RPC_API_ENDPOINT` and `IPFS_RPC_API_KEY` in the build environment and the deploy will
`POST {endpoint}/api/v0/dag/import?pin-roots=true` with a bearer token. Deliberately the plain
Kubo shape, so it works against a self-hosted node behind an auth proxy, a hosted RPC, or
anything else that speaks it.

It has one genuine advantage: `dag/import` pins the directory root itself, so the identifier in
the receipt is the one a gateway serves, and it happens without anybody remembering.

**It is still the lesser option, and the cost is worth naming.** An RPC token is a bearer
credential — possession is authorization, with no origin check and nothing tying it to NavCom's
build. On a store shared with four other projects, anyone who obtains it can fill the quota,
enumerate what everybody holds, and — if the surface includes `pin/rm` — remove it. The worst
case is not storage: it is somebody pinning content that gets the shared account terminated,
which takes the whole network's permanence layer with it and no CID re-pins itself.

A build environment is a poor home for that, and NavCom's is poorer than most — its CI was
deleted rather than repaired, so nothing verifies it between deploys.

So: **pull if you can, push if you must.** If you do push, scope the token to this project if the
provider allows it, keep it out of preview builds, and know that the failure you are insuring
against is smaller than the one you are accepting.

## Why the archive rather than a pinning API

NavCom holds no credential for your node and does not want one. The build computes a CAR and
a CID from bytes already in the repository — pure local work, because content addressing is
deterministic — and publishes the archive over ordinary HTTPS. You fetch it if and when you
want it.

That is the same reasoning as the keyless distress pager: **the thing doing the work holds
nothing, so anybody can run it and a compromise costs nothing.** It also means this document
does not become stale if you rotate a token, and that no swarm key, node credential or API
scope has to exist for the arrangement to work.

If you would rather it were automatic later, a Kubo RPC token scoped to add-and-pin is the
smallest thing that would do it. `/api/v0/` unscoped is effectively root on the node and is
not worth it for 1.3 MB a release.

## Checking that the identifier is honest

The directory data is just files, so it packs byte-identically — unlike the site build, where
asset hashes move every release. That makes NavCom's published identifier **reproducible by
anyone**, which is the one thing no node in this network can currently say about any other:

```
git clone https://github.com/Jthora/navcom-app && cd navcom-app
git checkout <the commit named in navcom-health.json>
cd web && npm run car          # should print the same CID
```

If that prints `bafybei…` matching the receipt, NavCom's verification claim stops being
self-reported. It costs one command and it is the highest-value thing in this document.

## What a CID does and does not prove

It proves these bytes hash to this identifier. Anyone who fetches the archive from anywhere —
you, a gateway, a stranger with a USB stick — can verify they received exactly what NavCom
published, without trusting the host, the domain or the person who handed it over. **That is
the property NavCom actually needs**, given a threat model that includes the account going
away.

It proves nothing about *when* it was published. Ordering in time needs a timestamp authority
— Bitcoin, or OpenTimestamps as the cheap version — and that is a separate mechanism this
does not pretend to be. The accountability log is where that will matter; the directory is
not it.

And it proves nothing about who is holding a copy. Until a node imports it, the receipt says
so in as many words: `"held_by": "nobody, until a node imports and pins it"`.

## Public or private

A **swarm key makes it a private network** — only peers holding the same pre-shared key can
connect, so no public gateway serves the content. That is a real capability and a fine home
for this if the goal is *EIN nodes can recover each other's data*.

It is not the anti-eviction mirror, and it should not be described as one. A reader whose
access to `navcom.app` is cut needs to fetch by CID from any gateway, which requires a node
on the public network. A second Kubo repo on the same device with no swarm key covers both;
one node cannot.

## The identity that signs the pointer

`/.well-known/navcom-node.json` names the pubkey NavCom signs artifact announcements with,
derived at build time from the key that actually signs rather than written down — so the
published identity cannot drift from the real one.

It is published at a path a peer can fetch rather than handed over in a message, because *"somebody
told me in a chat"* is a weak method and this project weighs claims by method everywhere else.

The file says, in the artifact, what the key is **not**: not an operator key, not a Watchtower key,
not a permission. A published identity is exactly where an authority quietly accretes, and saying
no in the file is cheaper than arguing about it after somebody has built a gate on it.

**A valid signature proves this pipeline published something. It is never evidence the pointer is
correct** — verify the CID against the content.

## Sharing the store with the other projects

The bucket and the node are shared, so NavCom holds itself to three rules and enforces the
first one in code rather than intending it:

- **One prefix.** Everything NavCom writes is under `navcom/`. `pin.mjs` refuses any key outside
  it, and refuses `..` and `//`, before a request is signed — a prefix that only existed as a
  convention would hold until somebody built a key by concatenation, which is how all of these
  go wrong
- **No deletes, ever.** There is no delete path in this codebase and there will not be one. On a
  shared store the blast radius of a wrong key is somebody else's work
- **Bounded growth.** Objects are keyed by the directory's content identifier, so a deploy with
  unchanged data rewrites the same key. Growth tracks how often the *data* changes, not how
  often anybody deploys — roughly 1.3 MB per distinct snapshot

The prefix is published in `navcom-health.json` under `directory.pin.s3.prefix`, so an audit of
the bucket can attribute every object without having to ask anyone.

**One thing worth raising rather than solving here.** A shared store reached with one credential
means every project's build can write over every other project's objects, and an RPC key that can
pin can generally also unpin. That is the same shape as a shared swarm key: a network-wide
credential, held by whichever node has the weakest build pipeline. NavCom's CI has been dead since
2026-08-19, so today that node is probably this one. Per-project keys, or per-project buckets, cost
nothing and remove the question.

## What must never go on it

Only bytes that are already public: the directory data, and nothing operator-side. No
corrections, no places, no presence, no keys, no board state.

**A swarm key is a peering restriction, not a confidentiality boundary** — anyone who obtains
the PSK reads everything on the network. So "it is private" must not become the reason to put
something there that could not have been published openly. That is invariant 1 holding
regardless of transport, and it is the one line in this document that is not negotiable.

## Declining

Fine, and nothing breaks. The identifier is still computed and published, the archive is still
downloadable, and the directory still works exactly as it does today from `navcom.app`. The
only thing lost is that it stops being retrievable if that host does — which is a real risk
this network has already experienced twice, and not an urgent one.
