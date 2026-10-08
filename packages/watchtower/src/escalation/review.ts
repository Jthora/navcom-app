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

export interface Review {
  from: number;
  to: number;
  drill: Drill | null;
  drillOverdue: boolean;
  nextDrillAt: number | null;
  escalations: Escalation[];
  resent: Resent[];
  repaged: Repaged[];
  oncall: readonly string[];
  log: ReviewInput["log"];
  /** The whole point: what a person has to do something about. Empty is the good week. */
  attention: string[];
}

const day = 86_400;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * How many times one person may be paged again in a night before `--review` names them (option E,
 * decided 2026-10-07). One operator sending through a whole hold pages the person who acknowledged
 * them at most six times; past that is more than one hold's worth -- several operators they
 * acknowledged all still sending, which is within the rules, or a phone that keeps starting its
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
