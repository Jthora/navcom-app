# There is no CI here, on purpose

`web.yml` was removed on 2026-08-24. It had not executed since 2026-08-19 — forty consecutive
runs blocked before any step by a billing lock — and it is not coming back.

**A workflow file that will never run is a dead dependency**, and this project spent a week
cataloguing those in five other codebases. Leaving it in place would have meant a repository that
looked continuously verified and was not, which is worse than being openly unverified: *a check
that never runs looks exactly like a check that passes.*

## What replaced it

`vercel.json` runs every workspace's `verify` as the build command, so a deploy that ships is a
deploy whose tests passed:

```
npm run verify --workspace @navcom/core
npm run verify --workspace @navcom/watchtower
npm run verify --workspace @navcom/seeder
npm run verify:deploy --workspace navcom-web
```

The deploy is now the only gate, so it was widened to cover what CI used to. Every run writes
`build/.verify-receipt.json`, published at
[`/.well-known/navcom-health.json`](https://navcom.app/.well-known/navcom-health.json), so a
reader can see what actually ran rather than taking a badge's word for it.

## What was genuinely lost, stated rather than glossed

- **The browser suite on deploy.** 269 Playwright tests are too heavy for a build container. They
  run locally, before a push, and the receipt says `browser: false` on deploys — it never reports
  a deploy as browser-tested
- **The daily scheduled run.** Nothing now notices a dependency going bad on its own. That was a
  real property and it is gone
- **A second machine.** Everything is verified on whatever hardware the deploy or the developer
  happens to be using

The honest position is that NavCom is gated at deploy and unattended between them.
