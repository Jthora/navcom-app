#!/usr/bin/env node
import type { SimplePool } from "nostr-tools/pool";
import type { Event } from "nostr-tools/core";
import {
  DEFAULT_RELAYS,
  KIND_CORRECTION,
  KIND_PLACE,
  readCorrection,
  readPlace,
  type Correction,
  type Place,
} from "@navcom/core";
import { nodePool } from "../shared/nostr-node.js";

/**
 * Collecting live corrections so a person can promote the good ones.
 *
 * Milestone 6.8 is deliberately human: somebody reads what operators reported and writes the
 * good ones into the CSV. A public artifact anybody can rewrite is not one anybody can rely
 * on, and that bottleneck is the point.
 *
 * **But a bottleneck that takes an evening does not happen.** This is the difference between
 * "minutes a week" and "I will do it at the weekend" — it fetches, groups and prints what is
 * waiting, and gets out of the way.
 *
 * Operator-added places (`30915`) are shown in their own section, for the same reader and the
 * same reason: a place somebody stood at is a candidate for the CSV, not an entry in it.
 *
 * It deliberately does **not** write to the CSV. Reviewing is the job; a tool that applied
 * corrections automatically would have quietly removed the human this milestone is built
 * around, and the reviewer would find out by reading a shelter's hours they never approved.
 *
 *   navcom-promote --relays wss://relay.damus.io,wss://nos.lol --since 7
 */

interface Options {
  relays: string[];
  sinceDays: number;
  json: boolean;
}

function parse(argv: string[]): Options {
  const at = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  // The same defaults the client picks, from the one place they live. This was a literal copy,
  // which is how a checker ends up reading relays the app no longer uses.
  const relays = (at("--relays") ?? DEFAULT_RELAYS.join(","))
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return {
    relays,
    sinceDays: Number(at("--since") ?? 30),
    json: argv.includes("--json"),
  };
}

/** Latest word per author per record. An operator's newer correction replaces their older. */
export function latestPerAuthor(
  corrections: readonly (Correction & { by: string })[],
): (Correction & { by: string })[] {
  const best = new Map<string, Correction & { by: string }>();
  for (const c of corrections) {
    const key = `${c.by}:${c.record}`;
    const held = best.get(key);
    if (!held || c.last_verified > held.last_verified) best.set(key, c);
  }
  return [...best.values()];
}

/**
 * Groups by record, so a reviewer reads a place rather than a stream.
 *
 * Sorted by how much is waiting: a shelter three people corrected is more likely to have
 * actually changed than one somebody mentioned once.
 */
export function byRecord(
  corrections: readonly (Correction & { by: string })[],
): { record: string; corrections: (Correction & { by: string })[] }[] {
  const groups = new Map<string, (Correction & { by: string })[]>();
  for (const c of corrections) {
    const held = groups.get(c.record) ?? [];
    held.push(c);
    groups.set(c.record, held);
  }
  return [...groups.entries()]
    .map(([record, cs]) => ({ record, corrections: cs }))
    .sort((a, b) => b.corrections.length - a.corrections.length || a.record.localeCompare(b.record));
}

/** Latest word per author per place, the same rule as corrections. */
export function latestPlaces(places: readonly (Place & { by: string })[]): (Place & { by: string })[] {
  const best = new Map<string, Place & { by: string }>();
  for (const p of places) {
    const key = `${p.by}:${p.id}`;
    const held = best.get(key);
    if (!held || p.last_verified > held.last_verified) best.set(key, p);
  }
  return [...best.values()].sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));
}

export interface Collected {
  events: Event[];
  /** Relays that sent end-of-stored-events before anything closed their subscription. */
  answered: string[];
  /** Relays that did not, and what they said. */
  missed: { url: string; reason: string }[];
}

/**
 * Reads each relay on its own, and says which of them actually answered [F23].
 *
 * One subscription across every relay could not tell an empty answer from no answer:
 * nostr-tools settles a relay that refused the connection exactly as it settles one that sent
 * EOSE, so this printed "Nothing waiting" with every relay down. A relay counts as read only
 * when its EOSE arrives before anything closes its subscription. nostr-tools fires `oneose`
 * immediately before `onclose` when a subscription fails, so the EOSE is judged a tick later.
 */
export async function collect(opts: {
  pool: Pick<SimplePool, "subscribeMany">;
  relays: readonly string[];
  since: number;
  timeoutMs?: number;
}): Promise<Collected> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const events: Event[] = [];
  const answered: string[] = [];
  const missed: { url: string; reason: string }[] = [];

  await Promise.all(
    [...new Set(opts.relays)].map(
      (url) =>
        new Promise<void>((resolve) => {
          let closed = false;
          let done = false;
          let closer: { close: (reason?: string) => void } | null = null;
          const finish = (outcome: { answered: true } | { reason: string }) => {
            if (done) return;
            done = true;
            clearTimeout(guard);
            if ("answered" in outcome) answered.push(url);
            else missed.push({ url, reason: outcome.reason });
            // Never close a subscription whose own onclose fired: nostr-tools counts it twice.
            if (!closed) {
              closed = true;
              closer?.close();
            }
            resolve();
          };
          // Relays that never send end-of-stored-events must not hang a weekly chore. Cleared
          // when the relay settles: left armed, it held the process open for the full fifteen
          // seconds after every answer had arrived.
          const guard = setTimeout(
            () => finish({ reason: `no answer within ${Math.round(timeoutMs / 1000)}s` }),
            timeoutMs,
          );
          try {
            closer = opts.pool.subscribeMany(
              [url],
              { kinds: [KIND_CORRECTION, KIND_PLACE], since: opts.since },
              {
                onevent: (event: Event) => {
                  if (!done) events.push(event);
                },
                oneose: () => {
                  queueMicrotask(() => {
                    if (!closed) finish({ answered: true });
                  });
                },
                onclose: (reasons: { url: string; reason: string }[]) => {
                  const wasOurs = closed;
                  closed = true;
                  if (!wasOurs) finish({ reason: reasons[0]?.reason ?? "closed" });
                },
                // Longer than the guard, so nostr-tools' own EOSE timeout cannot pass for an
                // answer from a relay that never sent one.
                maxWait: timeoutMs + 5_000,
              },
            );
          } catch (err: unknown) {
            closed = true;
            finish({ reason: err instanceof Error ? err.message : String(err) });
          }
        }),
    ),
  );
  return { events, answered, missed };
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  const since = Math.floor(Date.now() / 1000) - options.sinceDays * 86_400;
  const pool = nodePool();
  const read = await collect({ pool, relays: options.relays, since });
  pool.destroy();

  const notReached = read.missed.map((m) => `${m.url}: ${m.reason}`).join(", ");
  if (read.answered.length === 0) {
    // Not "nothing waiting". Nothing was read, which says nothing about what is waiting.
    console.error(`No relay answered (${notReached}). Nothing was checked.`);
    process.exit(1);
  }

  const corrections: (Correction & { by: string })[] = [];
  const places: (Place & { by: string })[] = [];
  for (const event of read.events) {
    const correction = readCorrection(event);
    if (correction) corrections.push(correction);
    const place = readPlace(event);
    if (place) places.push(place);
  }
  const groups = byRecord(latestPerAuthor(corrections));
  const added = latestPlaces(places);

  if (options.json) {
    console.log(
      JSON.stringify(
        { read: { answered: read.answered, notReached: read.missed }, corrections: groups, places: added },
        null,
        2,
      ),
    );
    return;
  }

  const total = new Set(options.relays).size;
  if (read.missed.length > 0) {
    console.log(
      `Read ${read.answered.length} of ${total} relays; not reached: ` +
        read.missed.map((m) => `${m.url} (${m.reason})`).join(", "),
    );
    console.log("");
  }

  if (groups.length === 0 && added.length === 0) {
    console.log(`Nothing waiting from the last ${options.sinceDays} days.`);
    return;
  }

  if (groups.length > 0) {
    console.log(`${groups.length} record(s) with corrections, most-reported first.\n`);
    for (const { record, corrections: cs } of groups) {
      console.log(`${record}`);
      for (const c of cs) {
        const fields = Object.entries(c.fields)
          .map(([k, v]) => `${k}=${v}`)
          .join("  ");
        console.log(`  ${c.last_verified}  ${c.verified_by.padEnd(12)} ${c.method.padEnd(16)} ${fields}`);
      }
      console.log("");
    }
  }

  if (added.length > 0) {
    // A separate section because it is a separate claim: not "this field changed" but "this
    // building exists". A wrong one sends somebody to an address that is not there.
    console.log(`Places added (${added.length}), by region.\n`);
    for (const p of added) {
      const extras = Object.entries(p.fields ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join("  ");
      console.log(`${p.region}  ${p.name} -- ${p.address}`);
      console.log(
        `  ${p.last_verified}  ${p.verified_by.padEnd(12)} ${p.method.padEnd(16)} ${p.type}` +
          (extras ? `  ${extras}` : ""),
      );
    }
    console.log("");
  }

  console.log(
    "Nothing here has been written anywhere. Read them, decide, and edit the CSV yourself —\n" +
      "a tool that applied these would have removed the person this step exists for.",
  );
}

// Importable for tests without running the subscription.
if (process.argv[1]?.includes("promote")) {
  main().catch((err: unknown) => {
    console.error(`[promote] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
