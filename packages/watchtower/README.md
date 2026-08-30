# @navcom/watchtower

The daemon that holds the board and speaks Nostr, plus the CLI client that signs on, signals
and stands down. Session one passes its seven checks.

Imported from `Jthora/navcom-watchtower@999ef2b`, which remains the origin of its history.

## Why it moved here

It was built against the self-contained session-one brief rather than the spec — because it
was in another repository and could not see one. Its own source says so: *"not built against
the actual spec text (not available to this side)."*

**A self-contained summary of a spec is a fork of it**, and six divergences followed: the
watch-state enum, the on-call shape, `last_drill`, provenance, distress carrying no position,
and a callsign the board needed but no payload carried.

Every one of them became a type error the moment this shared a package with `@navcom/core`.

## What it brought with it

The traffic was not one-way. This side had been run against a real relay and the core had
not, so it found things the core had wrong:

- **A replaceable `10910` outlives its publisher.** A relay keeps serving the last copy after
  the daemon dies, so a client checking only for absence reads a corpse as a live watch —
  invariant 4 failing exactly as written. Core now treats staleness, and unknown age, as Dark
- **`on-station` carried no callsign**, so the board had no name to show. The spec now
  requires it
- **Runtime validation** was promoted into core. It was written against real failures — a
  malformed `expected_duration` reaching `new Date(NaN * 1000)` and throwing, killing the
  acknowledgement an operator was owed — and a client parsing a response needs the same
  guarantees a daemon does
- **`Buffer.from(hex, "hex")` does not validate**, silently dropping bad characters and
  producing a valid-looking wrong key. Both sides check the hex shape first

## One bug the move surfaced

`oncall_count` was published as `board.size` — the number of operators **out in the field**,
as the number **reachable to help them**. An operator reading "3 on-call" would have believed
three people could be raised, when those three were the ones on the street.

It is now a list of authored declarations, so a count cannot exceed its evidence and a board
size cannot be assigned to it by accident.

```sh
npm run verify --workspace @navcom/watchtower   # typecheck + 221 tests
```

## A lightweight clone for deploying, not developing

`Jthora/navcom-watchtower` — the repo this package was imported from — is now a **read-only,
one-way mirror** of this directory, kept so a [Stationkeeper](../../docs/watch/stationkeeper.md)
can clone just the watchtower without the rest of the monorepo. Nobody commits to it
directly — doing so would recreate the exact divergence the reconciliation above exists to
prevent. All real development stays here, type-checked against `@navcom/core` in this
workspace; the mirror only ever moves downstream of it.

Refreshing it after a change worth publishing (there is no CI to do this automatically):

```sh
git subtree split --prefix=packages/watchtower -b watchtower-mirror
git push git@github.com:Jthora/navcom-watchtower.git watchtower-mirror:main --force
git branch -D watchtower-mirror
```

The repo's pre-reconciliation history (through `999ef2b`) is preserved as the tag
`frozen-pre-monorepo-2026-08-18` on that same repo, not lost by the force-push.
