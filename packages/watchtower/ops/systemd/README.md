# Deploying the Watchtower daemon

Not done automatically by anything — this is how to actually run it as a
real, always-on service, once that's a decision that's actually been made
(see the main README's note on this: going live for real operators is a
separate decision from the code being ready).

## 1. Build once

```sh
cd /home/jono/workspace/ul_agent/navcom-watchtower
pnpm install
pnpm run build          # tsc -> dist/
```

The unit runs the built `dist/daemon/index.js` with plain `node`, not
`tsx` -- no on-the-fly TypeScript transform at runtime. Re-run `pnpm run
build` after pulling any update; the service needs restarting to pick it
up (`sudo systemctl restart navcom-watchtower`).

## 2. Real config, not the example

```sh
mkdir -p ~/.config/navcom-watchtower
cp watchtower.example.toml ~/.config/navcom-watchtower/watchtower.toml
```

Edit `~/.config/navcom-watchtower/watchtower.toml`: pick real relays, and
set `[identity] privkey_path` to somewhere in that same directory (e.g.
`/home/jono/.config/navcom-watchtower/watchtower.key`) rather than the
example's relative `./watchtower.key`, which would resolve against
whatever the service's working directory happens to be.

## 3. Install the unit

```sh
sudo cp ops/systemd/navcom-watchtower.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now navcom-watchtower
```

First start generates the identity key if it doesn't exist yet (same
`loadOrCreateKeypair` behavior as running it by hand) and prints the
Watchtower's pubkey to the journal -- that's what goes into every
operator's `client.toml`.

## 4. Verify

```sh
sudo systemctl status navcom-watchtower
sudo journalctl -u navcom-watchtower -f
```

Look for `[daemon] published watch state (automated). Listening for
signals.` and `[relay] connected: ...` for each configured relay. Then
run the CLI's `status` command from any machine with the right pubkey in
its `client.toml` to confirm `LIVE` end to end.

## 5. The daily rebuild of navcom.app

The public directory decides *stale — call first* when a page is built, with a one-day margin.
Without a scheduled rebuild a page can outlive its verdicts by weeks, so the box fires the site's
Vercel deploy hook once a day.

```sh
# The hook URL comes from the Vercel project settings (Git -> Deploy Hooks), for main.
# It is a secret: anyone holding it can trigger a rebuild, though not change code.
install -m 600 /dev/null ~/.config/navcom-watchtower/deploy-hook
printf '%s\n' 'https://api.vercel.com/v1/integrations/deploy/...' > ~/.config/navcom-watchtower/deploy-hook

chmod +x ops/navcom-rebuild
sudo cp ops/systemd/navcom-rebuild.service ops/systemd/navcom-rebuild.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now navcom-rebuild.timer
```

Check it: `systemctl list-timers navcom-rebuild.timer` for the next run, and
`sudo systemctl start navcom-rebuild.service && journalctl -u navcom-rebuild -n 5` for one now —
look for `[rebuild] deploy hook fired`. **A timer that stops is invisible from here**; the site's
own build date is how anybody else notices, and the public pages say what an old date means.

## Notes

- **No persistence to worry about.** The board is memory-only by design
  (`src/daemon/board.ts`) -- a restart is a real reset, not a bug, and
  `Restart=always` in the unit is safe for exactly that reason.
- **`node` is nvm-managed on this box**, not a system package -- the unit
  sources `~/.bashrc` (where nvm's init lives) instead of hardcoding a
  version-specific path like `.../v24.13.0/bin/node`, which would break
  on the next `nvm install`.
- **Not yet decided: a real allowlist.** `src/daemon/authorization.ts`'s
  `isAuthorizedOperator()` currently accepts any pubkey, matching Session
  One's documented MVP policy. That's a fine posture for continued
  testing; it stops being fine the moment this is actually depended on by
  real operators who aren't all people who already know each other.
