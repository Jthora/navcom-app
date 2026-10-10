import type { Drill } from "@navcom/core";
import type { LogEntry } from "@navcom/core";

/**
 * The week, for the person who reads it.
 *
 * `CLAUDE.md` names a **log reviewer** as one of two roles the design requires a human for:
 * somebody who reads drill results and agent logs on a cadence, "minutes per week, and it
 * cannot be the agent or verification is theatre".
 *
 * Nobody holds that role. Build order 10.b defers the reviewer's retrieval path with the
 * trigger *"a reviewer is named"* — and nobody is going to accept a job whose tooling is
 * `ssh` and a JSONL file. The two halves wait on each other, which is the shape four separate
 * items in this project share. This breaks that one on purpose, by building the smaller half
 * first and accepting it may sit unused: **"minutes per week" is a claim the software has to
 * make true before anybody can take the job.**
 *
 * Same shape as `watchtower-daemon --check`, which was written for a Stationkeeper who does
 * not exist yet either.
 *
 * ## What it does not do
 *
 * It does not score anybody, and it does not total contributions. Escalations are listed with
 * their dates rather than counted, which is the same rule the rest of the system follows —
 * provenance by name, because a number invites gaming. The one figure it does print is the
 * size of the log, which is a fact about a file rather than about a person.
 */

export interface ReviewInput {
  /** Seconds. The end of the window being reported. */
  now: number;
  /** How far back to look. */
  days: number;
  lastDrill: Drill | null;
  /** When the next drill is scheduled, unix seconds. */
  nextDrillAt: number | null;
  entries: readonly LogEntry[];
  /** On-call callsigns, in roster order. */
  oncall: readonly string[];
  log: {
    entries: number;
    startsAt: string | null;
    /** How the on-disk chain verified at boot -- the reason this role exists. */
    intact: boolean;
    reason: string | null;
  };
}

export interface Escalation {
  at: number;
  reachedHuman: boolean;
}

/**
 * A repeat `Distress` answered with an acknowledgement a person had already given, inside
 * `ack_holds_seconds` (`escalation.spec.md`, "An acknowledged Distress, sent again").
 */
export interface Resent {
  at: number;
  /**
   * Whether any relay took it, on either of its two sends. When neither did, the watch stopped
   * holding that answer, and that operator's next attempt was escalated as a new Distress [#14]
   * -- and a relay refusing this watch's own events is the reviewer's business either way.
   */
  sent: boolean;
}

/**
 * The person who acknowledged, paged again about a repeat `Distress` inside `ack_holds_seconds`
 * (decided 2026-10-07). Recorded as `contacted`, about the person paged -- the only `contacted`
 * this log writes.
 */
export interface Repaged {
  at: number;
  /** Who, by callsign, as the roster named them when they acknowledged. */
  who: string | null;
  /** Their key, which is what tells two people with one callsign apart. */
  pubkey: string | null;
  /**
   * `paged`: a channel took it, which is not anybody waking. `failed`: every channel failed.
   * `unpaged`: there was nothing to try -- off the roster, reachable only at a console, or at their
   * re-page ceiling; the entry does not say which, and the executor's output from that moment does.
   * The page budget is no longer one of them: it counts first pages only (decided 2026-10-07).
   *
   * Not what came after. The watch escalates such an attempt as new, unless it was stopping as the
   * page failed -- and nothing here records which [review: hold decisions].
   */
  outcome: "paged" | "failed" | "unpaged";
}

/**
 * A long-running start of the executor with a key of its own, recorded as `took-watch`
 * (`escalation.spec.md`, *The executor has a key of its own*). `--drill` and `--check` record none.
 */
export interface KeyStart {
  at: number;
  /** The key it signed with, which is the entry's actor. */
  pubkey: string | null;
  /** False when its file check found anything: readable or changeable by another user, or nothing confirming the daemon's user. */
  ownKey: boolean;
}

/**
 * A response a relay took under one of the box's two keys and refused under the other, recorded as
 * `answered` once per ladder, hold or wake answer (`escalation.spec.md`, *Every relay the box uses must
 * take both keys*).
 */
export interface OneKey {
  at: number;
  /** Which no relay took: the executor's own key, or the watch key's copy. */
  refused: "executor" | "watch";
}

export interface Review {
  from: number;
  to: number;
  drill: Drill | null;
  drillOverdue: boolean;
  nextDrillAt: number | null;
  escalations: Escalation[];
  resent: Resent[];
  repaged: Repaged[];
  /**
   * The latest start with a key of its own, from the whole log rather than the window: it is the box's
   * standing state, and a quiet box may not have restarted for months. Null where none is recorded.
   */
  lastStart: KeyStart | null;
  /** Starts in the window whose key was not its own. */
  keyNotOwn: KeyStart[];
  /** Responses in the window that reached relays under one key only. */
  oneKey: OneKey[];
  oncall: readonly string[];
  log: ReviewInput["log"];
  /** The whole point: what a person has to do something about. Empty is the good week. */
  attention: string[];
}

const day = 86_400;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * How many times one person may be paged again in a night before `--review` names them (option E,
 * decided 2026-10-07). Since *Silence widens*, one operator sending through a hold pages the person who
 * acknowledged them once, and then the roster with a first page; only where the hold cannot widen --
 * nobody else on call pageable, the first-page budget spent, or the roster already paged about that
 * operator inside `ack_holds_seconds` -- are they paged again alone, at most
 * six times through a whole hold. Past that is more than one hold's worth of that: several operators
 * they acknowledged all still sending, which is within the rules, or a phone that keeps starting its
 * Distress again, or a relay withholding the watch's answers -- and only the repeated game shows it.
 */
export const REPAGED_A_NIGHT = 6;
/** A night, for {@link REPAGED_A_NIGHT}: any twelve hours. */
export const NIGHT_SECONDS = 12 * 3_600;

/** The most pages any `NIGHT_SECONDS` span holds, and when that span began. */
function busiestNight(times: readonly number[]): { count: number; from: number } {
  const sorted = [...times].sort((a, b) => a - b);
  let best = { count: 0, from: sorted[0] ?? 0 };
  for (let i = 0, j = 0; j < sorted.length; j++) {
    while (sorted[j]! - sorted[i]! >= NIGHT_SECONDS) i++;
    if (j - i + 1 > best.count) best = { count: j - i + 1, from: sorted[i]! };
  }
  return best;
}

/**
 * Everything is derived here and nothing is fetched, so the hard part is testable without a
 * box, a log file or a clock.
 */
export function buildReview(input: ReviewInput): Review {
  const from = input.now - input.days * day;

  const escalations: Escalation[] = input.entries
    .filter((e) => e.action === "escalated" && e.at >= from)
    .map((e) => ({ at: e.at, reachedHuman: e.outcome === "escalation-reached-human" }))
    .sort((a, b) => a.at - b.at);

  /*
   * Listed, because a held acknowledgement is the one thing this log records that pages nobody else
   * on the roster -- a week of them read "nothing needs a look" until the reviewer could see them
   * [review: D2]. The one person it does page, the one who gave it, is listed below.
   */
  const resent: Resent[] = input.entries
    .filter((e) => e.action === "acked" && e.at >= from)
    .map((e) => ({ at: e.at, sent: e.outcome !== "ack-not-sent" }))
    .sort((a, b) => a.at - b.at);

  const repaged: Repaged[] = input.entries
    .filter((e) => e.action === "contacted" && e.at >= from)
    .map((e) => ({
      at: e.at,
      who: e.subject?.callsign ?? null,
      pubkey: e.subject?.pubkey ?? null,
      outcome:
        e.outcome === "contact-attempted" ? ("paged" as const) : e.outcome === "contact-failed" ? ("failed" as const) : ("unpaged" as const),
    }))
    .sort((a, b) => a.at - b.at);

  const starts: KeyStart[] = input.entries
    .filter((e) => e.action === "took-watch" && (e.outcome === "held" || e.outcome === "key-not-its-own"))
    .map((e) => ({ at: e.at, pubkey: e.actor.pubkey ?? null, ownKey: e.outcome === "held" }))
    .sort((a, b) => a.at - b.at);
  const lastStart = starts.at(-1) ?? null;
  /*
   * The window's, not the whole log's, though a copy once taken stays taken. The last start is the box's
   * standing state, so it is read from the whole log; an exposure that a passing start has since fixed is
   * an event, said in the review whose window holds it, as every other event here is. Said again every
   * week after, for as long as the key is in use, it is a line the reviewer learns to skip -- and the one
   * remedy, a new key handed to every operator, is theirs to choose the week they first read it.
   */
  const keyNotOwn = starts.filter((s) => !s.ownKey && s.at >= from);

  // `answered` is what the executor writes for nothing else, so these never count as escalations, held answers or re-pages.
  const oneKey: OneKey[] = input.entries
    .filter((e) => e.action === "answered" && (e.outcome === "executor-key-refused" || e.outcome === "watch-key-refused") && e.at >= from)
    .map((e) => ({ at: e.at, refused: e.outcome === "executor-key-refused" ? ("executor" as const) : ("watch" as const) }))
    .sort((a, b) => a.at - b.at);

  // Overdue means the schedule has passed, or nothing has ever run. Both demote the watch
  // state a client reads, so both are the reviewer's business.
  const drillOverdue =
    input.lastDrill === null ||
    (input.nextDrillAt !== null && input.nextDrillAt < input.now);

  const attention: string[] = [];
  if (input.lastDrill === null) {
    attention.push("no drill has ever run, so nothing has proven the ladder works");
  } else {
    if (input.lastDrill.result === "fail") {
      attention.push(`the last drill failed (${iso(input.lastDrill.at)})`);
    }
    if (drillOverdue) attention.push("a drill is overdue");
  }

  const unanswered = escalations.filter((e) => !e.reachedHuman);
  if (unanswered.length > 0) {
    attention.push(
      unanswered.length === 1
        ? `an escalation reached nobody (${iso(unanswered[0]!.at)})`
        : `${unanswered.length} escalations reached nobody`,
    );
  }

  /*
   * Said as what the log knows. A held answer that reached no relay on either send ends the hold,
   * and the operator's next attempt is escalated as new [#14], so "nobody was paged" stopped being
   * true; and what the operator heard is not something this log can see [#25].
   */
  const unsent = resent.filter((r) => !r.sent);
  if (unsent.length > 0) {
    attention.push(
      unsent.length === 1
        ? `an earlier acknowledgement re-sent to a repeat Distress reached no relay (${iso(unsent[0]!.at)}), so the watch stopped holding it and escalated that operator's next attempt as new -- check the relays still take this watch's events`
        : `${unsent.length} earlier acknowledgements re-sent to a repeat Distress reached no relay, so the watch stopped holding them and escalated the next attempt as new -- check the relays still take this watch's events`,
    );
  }

  /*
   * A person who answered and could not be told the operator was still sending -- and a channel that
   * fails here fails on the night it is the only one. Said as what the entry knows: that the page did
   * not go, and for a failed one that their channel is why. Not "the watch escalated it as new",
   * which an executor stopping as the page failed does not do [review: hold decisions]; whether a
   * ladder that opened reached anybody is that ladder's own `escalated` entry.
   */
  for (const r of repaged) {
    if (r.outcome === "paged") continue;
    const who = r.who ?? "the person who acknowledged";
    attention.push(
      r.outcome === "failed"
        ? `${who} could not be paged again about a repeat Distress (${iso(r.at)}) -- every channel failed; check their channel`
        : `${who} could not be paged again about a repeat Distress (${iso(r.at)}) -- off the roster, only at a console, or at their re-page ceiling; the executor's output from then says which`,
    );
  }

  /*
   * By person, never as a total: the number is how many times one person was woken, which is the
   * thing to ask them about. Pages that were tried count, whether or not a channel took them.
   */
  const byPerson = new Map<string, { who: string; times: number[] }>();
  for (const r of repaged) {
    if (r.outcome === "unpaged") continue;
    const key = r.pubkey ?? r.who ?? "?";
    const person = byPerson.get(key) ?? { who: r.who ?? "the person who acknowledged", times: [] };
    person.times.push(r.at);
    byPerson.set(key, person);
  }
  for (const { who, times } of byPerson.values()) {
    const night = busiestNight(times);
    if (night.count <= REPAGED_A_NIGHT) continue;
    attention.push(
      `${who} was paged again ${night.count} times in one night (${iso(night.from)}) -- more than one hold's worth: ` +
        "several operators they acknowledged all still sending, a phone that keeps starting its Distress again, " +
        "or a relay withholding the watch's answers. Ask them, and check the relays",
    );
  }

  /*
   * The key a phone ends a Distress on. Its last start is the standing state, whenever it was; a failing
   * start in the window that a passing one followed, with the same key, is still the reviewer's business,
   * because a fixed file says nothing about who read it while it was not.
   */
  if (lastStart && !lastStart.ownKey) {
    attention.push(
      `the executor's key was not its own at its last start (${iso(lastStart.at)}) -- whoever can read it can sign ` +
        `"a person has it", and a phone given it believes that. navcom-escalation --check says why; hand it to nobody until it passes`,
    );
  } else if (lastStart) {
    const exposed = keyNotOwn.filter((s) => s.pubkey === lastStart.pubkey).at(-1);
    if (exposed) {
      attention.push(
        `the executor's key was not its own at a start on ${iso(exposed.at)}, and passed its file check at its last ` +
          `(${iso(lastStart.at)}) -- whoever could read it then may have kept a copy, which nothing here can show`,
      );
    }
  }

  const ownRefused = oneKey.filter((o) => o.refused === "executor");
  if (ownRefused.length > 0) {
    const what =
      ownRefused.length === 1
        ? `an answer reached relays only under the watch key (${iso(ownRefused[0]!.at)})`
        : `${ownRefused.length} answers reached relays only under the watch key`;
    attention.push(
      `${what} -- a phone given the executor key cannot end a Distress on it. navcom-escalation --check names the ` +
        "relays that refuse the executor's key; drop them",
    );
  }
  const copyRefused = oneKey.filter((o) => o.refused === "watch");
  if (copyRefused.length > 0) {
    const what =
      copyRefused.length === 1
        ? `an answer reached relays only under the executor's key (${iso(copyRefused[0]!.at)})`
        : `${copyRefused.length} answers reached relays only under the executor's key`;
    attention.push(
      `${what} -- every phone handed this watch before it named that key heard nothing from it. navcom-escalation ` +
        "--check names the relays that refuse the watch key's copy; drop them",
    );
  }

  if (input.oncall.length === 0) {
    attention.push("nobody is on call, so a Distress would page nobody and say so");
  } else if (input.oncall.length === 1) {
    attention.push(`the on-call roster is one person deep (${input.oncall[0]})`);
  }

  if (!input.log.intact) {
    // The reason this role exists at all. A chain that does not verify is a watch that cannot
    // be held to what it did, and no drill result matters more than that.
    attention.push(
      `the accountability log does not verify${input.log.reason ? `: ${input.log.reason}` : ""}`,
    );
  }

  return {
    from,
    to: input.now,
    drill: input.lastDrill,
    drillOverdue,
    nextDrillAt: input.nextDrillAt,
    escalations,
    resent,
    repaged,
    lastStart,
    keyNotOwn,
    oneKey,
    oncall: input.oncall,
    log: input.log,
    attention,
  };
}

/** Plain lines, shortest useful form, most important last so it is what stays on screen. */
export function render(review: Review): string[] {
  const out: string[] = [`[review] ${review.from ? iso(review.from) : "?"} to ${iso(review.to)}`, ""];

  out.push("DRILLS");
  if (!review.drill) {
    out.push("  none has ever run");
  } else {
    const who = review.drill.acknowledged.map((a) => a.callsign ?? "someone").join(", ");
    const speed =
      review.drill.firstAckMs === null
        ? "nobody answered"
        : `${who} answered in ${Math.round(review.drill.firstAckMs / 1000)}s`;
    out.push(
      `  ${iso(review.drill.at)}  ${review.drill.result.toUpperCase()}  ` +
        `paged ${review.drill.paged.join(", ") || "nobody"}; ${speed}`,
    );
  }
  if (review.nextDrillAt !== null) {
    out.push(`  next due ${iso(review.nextDrillAt)}${review.drillOverdue ? "  -- overdue" : ""}`);
  }

  out.push("", "ESCALATIONS");
  if (review.escalations.length === 0) out.push("  none in this window");
  for (const e of review.escalations) {
    out.push(`  ${iso(e.at)}  ${e.reachedHuman ? "reached a human" : "REACHED NOBODY"}`);
  }

  out.push("", "HELD -- a repeat Distress answered with an earlier acknowledgement");
  if (review.resent.length === 0) out.push("  none in this window");
  for (const r of review.resent) out.push(`  ${iso(r.at)}  ${r.sent ? "sent" : "REACHED NO RELAY"}`);

  out.push("", "PAGED AGAIN -- the person who acknowledged, about a repeat Distress");
  if (review.repaged.length === 0) out.push("  none in this window");
  for (const r of review.repaged) {
    const what = r.outcome === "paged" ? "paged" : r.outcome === "failed" ? "EVERY CHANNEL FAILED" : "COULD NOT BE PAGED";
    out.push(`  ${iso(r.at)}  ${r.who ?? "?"}  ${what}`);
  }

  out.push("", "THE EXECUTOR'S KEY");
  if (!review.lastStart) out.push("  no start with a key of its own recorded");
  else {
    out.push(
      `  last start ${iso(review.lastStart.at)}  key ${review.lastStart.pubkey?.slice(0, 8) ?? "?"}  ` +
        (review.lastStart.ownKey ? "passed its file check" : "NOT ITS OWN"),
    );
  }
  for (const s of review.keyNotOwn) {
    if (s === review.lastStart) continue;
    out.push(`  ${iso(s.at)}  key ${s.pubkey?.slice(0, 8) ?? "?"}  NOT ITS OWN`);
  }

  out.push("", "ONE KEY ONLY -- an answer a relay took under one of the box's keys and refused under the other");
  if (review.oneKey.length === 0) out.push("  none in this window");
  for (const o of review.oneKey) out.push(`  ${iso(o.at)}  ${o.refused === "executor" ? "EXECUTOR KEY REFUSED" : "WATCH KEY REFUSED"}`);

  out.push("", "THE LOG");
  out.push(
    `  ${review.log.entries} entries${review.log.startsAt ? ` since ${review.log.startsAt}` : ""}, ` +
      (review.log.intact ? "chain intact" : `CHAIN DOES NOT VERIFY${review.log.reason ? ` -- ${review.log.reason}` : ""}`),
  );

  out.push("", "ON CALL");
  out.push(`  ${review.oncall.length ? review.oncall.join(", ") : "nobody"}`);

  out.push("", review.attention.length === 0 ? "NOTHING NEEDS A LOOK" : "NEEDS A LOOK");
  for (const item of review.attention) out.push(`  - ${item}`);

  return out;
}
