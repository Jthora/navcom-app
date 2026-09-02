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

export interface Review {
  from: number;
  to: number;
  drill: Drill | null;
  drillOverdue: boolean;
  nextDrillAt: number | null;
  escalations: Escalation[];
  oncall: readonly string[];
  log: ReviewInput["log"];
  /** The whole point: what a person has to do something about. Empty is the good week. */
  attention: string[];
}

const day = 86_400;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

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
