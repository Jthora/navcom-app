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

The example also sets `[log] hearing_state_path`: the daemon publishes the
watch state only where it and the escalation executor both hear, read from
the file the executor writes (4b). Until the executor runs and has written
that file, the watch reads Dark and the daemon's log says why
(`THE EXECUTOR HEARS NOWHERE ... there is no hearing file at ...`). That is
the safe rule. Comment the line out only to run the daemon alone for now; it
then publishes wherever it hears, says at every start what that costs, and
`watchtower-daemon --check` fails until the line is back.

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

Look for `[relay] <url> listening` for each configured relay, each followed
by `[heartbeat] watch state (automated) published on <url> -- k/N relay(s)
carry it now`; on a healthy box the last of those says N/N. The watch state
goes only to relays the daemon is listening on, so a relay it cannot hear on
reads Dark rather than showing a watch that cannot hear anybody. A
relay that says `unreachable`, `closed the subscription` or `refused the
subscription` is retried by itself; one that says `auth-required` never will
deliver, because the daemon does not do NIP-42 AUTH. One that says `has not
answered` took the subscription and went quiet: treat it as down. A
`[heartbeat] NO RELAY ACCEPTED` or `LISTENING ON NO RELAY` line means
operators read Dark. With a hearing file set, `[relays] ... withheld` names a
relay the escalation executor does not hear on, with its reason, and
`THE EXECUTOR HEARS NOWHERE` or `NO RELAY WHERE THIS DAEMON AND THE
ESCALATION EXECUTOR BOTH HEAR` means operators read Dark until the executor
hears. Then run `watchtower-daemon --check` with the same config, which also
asks each relay for the box's own subscription and reads the hearing file,
and the CLI's `status` command from any machine with the right pubkey in its
`client.toml` to confirm `LIVE` end to end.

## 4b. The escalation executor, as its own user

The executor runs the Distress ladder, and it is a separate process under a separate unit
from the daemon -- a crash loop in one must never restart the other. It also holds a key of
its own, which only it may read: a phone handed that key ends a Distress only on an answer it
signed, so the daemon, and the agent beside it, can tell an operator anything but that a person
has them (`docs/spec/escalation.spec.md`, *The executor has a key of its own*). That only holds
if it runs as a user the daemon does not.

The commands below assume the daemon runs as `jono`, as in section 3; use your daemon's user
wherever `jono` appears.

```sh
sudo useradd --system --home-dir /var/lib/navcom-escalation --create-home navcom-escalation
sudo chmod 700 /var/lib/navcom-escalation

# The watch key: a copy this user owns. The daemon made it; the executor never makes one, and does
# not start without it.
sudo install -o navcom-escalation -g navcom-escalation -m 600 \
  /home/jono/.config/navcom-watchtower/watchtower.key /var/lib/navcom-escalation/watchtower.key

# The drill file and the hearing file: written by this user, read by the daemon's -- the last drill,
# and where the executor hears. A directory of its own in the daemon user's group -- the setgid bit
# gives each file made in it that group, and the executor writes both 0640.
sudo install -d -o navcom-escalation -g "$(id -gn jono)" -m 2750 /var/lib/navcom-drill

# Only if the executor ran as the daemon's user before: move what it wrote to this user. Keep the
# log -- it is how a lost executor key is noticed later.
if [ -f /var/lib/navcom/drill.json ]; then
  sudo mv /var/lib/navcom/drill.json /var/lib/navcom-drill/drill.json
  sudo chown navcom-escalation:"$(id -gn jono)" /var/lib/navcom-drill/drill.json
  sudo chmod 640 /var/lib/navcom-drill/drill.json
fi
for f in /var/lib/navcom/escalation-log.jsonl /var/lib/navcom/escalation-log.jsonl.meta.json; do
  if [ -f "$f" ]; then
    sudo mv "$f" /var/lib/navcom-escalation/
    sudo chown navcom-escalation:navcom-escalation "/var/lib/navcom-escalation/$(basename "$f")"
  fi
done

sudo install -d -m 755 /etc/navcom
sudo cp escalation.example.toml /etc/navcom/escalation.toml
```

In `/etc/navcom/escalation.toml`:

- `[identity] privkey_path = "/var/lib/navcom-escalation/watchtower.key"` -- the copy above. If the
  daemon's key ever changes, copy it again.
- `[identity] executor_key_path = "/var/lib/navcom-escalation/executor.key"` -- an absolute path,
  made on first start.
- `[identity] daemon_user = "jono"` -- whoever `navcom-watchtower.service` runs as, never root, so
  the executor can confirm that user cannot read its key. Without it the executor makes no key.
- `[escalation] drill_state_path = "/var/lib/navcom-drill/drill.json"`, and the same path as
  `[log] drill_state_path` in the daemon's `watchtower.toml`; restart the daemon after.
- `[escalation] hearing_state_path = "/var/lib/navcom-drill/hearing.json"` -- where the executor
  writes where it hears, every 30 seconds. **Not left at the default**, `/var/lib/navcom`: that is the
  daemon's directory, and the executor writes neither file in a directory another user owns or others
  can write -- a link the daemon's user left there would have the executor overwrite its own key. It
  says so (`COULD NOT WRITE WHERE IT HEARS ... belongs to uid ...`) and the watch reads Dark until the
  path is moved here. Set the same path as `[log] hearing_state_path` in the
  daemon's `watchtower.toml` **after** the executor has written the file once (`ls -l` it, owned by
  this user, group the daemon's, `-rw-r-----`), and restart the daemon; set before, the watch reads
  Dark until the file appears. The daemon then publishes the watch state only on relays where both
  processes hear.
- `[log] path = "/var/lib/navcom-escalation/escalation-log.jsonl"`. The daemon cannot read it now --
  it is this user's, `0600` -- so leave the daemon's `escalation_log_path` unset; `log-review` then
  answers from the daemon's own log, as on most boxes.

The unit runs a build from `/opt/navcom-watchtower`, with `node` on a system path; edit
`ExecStart` if yours lives elsewhere. Then:

```sh
sudo cp ops/systemd/navcom-escalation.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now navcom-escalation
sudo journalctl -u navcom-escalation -n 40
```

The first start prints `made the executor's own key`, `executor key: <64 hex>`, and then
`watch code: https://navcom.app/terminal/setup/#watch=1&...` -- a link signed by the watch key that
carries the executor's key. That link is what operators are handed, scanned or pasted; the key is
never typed. If the journal says `NO WATCH KEY`, the copy above was missed and the executor has
stopped; if it says `NO EXECUTOR KEY at ..., and not making one`, fix `daemon_user`. Then, as that
user:

```sh
sudo -u navcom-escalation node /opt/navcom-watchtower/dist/escalation/index.js --check /etc/navcom/escalation.toml
```

It fails until only this user can read the key, `daemon_user` is set and is not root, every relay
takes a test response signed by each key -- sent as the executor sends them -- no on-call entry
uses the watch key, and some relay answers the subscription the executor makes; it says which, relay
by relay, and what the running executor's hearing file says. It warns about a relay that took neither, and when no relay holds
a watch state signed by the key in `privkey_path`, which with the daemon running means that is not the
daemon's key. Once it passes it prints the watch code too. Check the daemon's journal once for
`[drill] the drill file at ... cannot be read` or `the hearing file at ... exists and cannot be read`:
either means the drill directory's group is wrong.
Leave `executor_key_path` out and the executor runs as it always did, and says at every start what
that costs.

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
