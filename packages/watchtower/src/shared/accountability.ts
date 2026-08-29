import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import {
  appendEntry,
  asCompleteLog,
  emptyLog,
  entriesAbout,
  inclusionProof,
  merkleRoot,
  verifyChain,
  type ChainCheck,
  type CompleteLog,
  type InclusionProof,
  type LogEntry,
  type LogReview,
  type LogRoot,
  type NewEntry,
} from "@navcom/core";

/**
 * The accountability log, on disk.
 *
 * The board and this file have opposite rules and live in opposite places for that reason:
 * the board is Live, in memory, and expires [C27]; this is append-only, on disk, and
 * retained [C33]. It records actions, never positions, areas or query text -- and since
 * `LogOutcome` is a closed union, the free-text channel that could have carried one of
 * those does not exist.
 *
 * Durability matters more here than throughput. Every entry is fsynced before `record()`
 * returns, because a watch that crashes having "recorded" an escalation it never wrote to
 * disk is exactly the account nobody can check afterwards. At this volume -- a handful of
 * entries per operator per night -- the cost is irrelevant.
 *
 * **Lives in `shared/`, not `daemon/`, on purpose.** Both the daemon and the escalation
 * executor open their own instance of this class, pointed at their own separate file --
 * the executor cannot import from `daemon/` at all [`separation.test.ts`], and duplicating
 * this class into `escalation/` instead would be the "two implementations of one behaviour"
 * mistake this project has already paid for once (`packages/watchtower/README.md`).
 */

/**
 * The hard cap on one review response.
 *
 * Relays cap message size and these are encrypted, so a full 90 days for a busy operator
 * would simply fail to publish -- silently, from the operator's point of view. A page plus
 * `more` is the honest shape.
 */
const REVIEW_PAGE = 50;

interface Meta {
  /**
   * What the first surviving entry's `prev` should be.
   *
   * Null while the log still has its original genesis. Retention sets it, because dropping
   * the oldest entries leaves the next one pointing at a hash that is gone -- which reads
   * as tampering unless the node declares the new start.
   */
  startsAt: string | null;
  /**
   * Every chain break ever observed, and they are never removed.
   *
   * A break is evidence. Papering over it by starting fresh would hand a hostile watch the
   * repair tool, so a break is recorded permanently and the daemon keeps going.
   */
  breaks: { at: number; index: number; reason: string }[];
}

const EMPTY_META: Meta = { startsAt: null, breaks: [] };

/**
 * Reads the file line by line, stopping at the first line that will not parse.
 *
 * A raw `JSON.parse` over every line used to throw straight out of `open()` on a torn
 * write -- a crash mid-`writeSync` for the last line, the one failure mode fsync-per-entry
 * exists to guard against -- which meant the log never opened at all, on every restart,
 * forever. A fully-dropped or fully-edited line is a `verifyChain` finding; a line that is
 * present but unparseable needs to become one too, not an uncaught exception.
 */
function readEntries(path: string): { entries: CompleteLog; corruptLine: number | null } {
  if (!existsSync(path)) return { entries: emptyLog(), corruptLine: null };
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");

  const parsed: LogEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      parsed.push(JSON.parse(lines[i]!) as LogEntry);
    } catch {
      return { entries: asCompleteLog(parsed), corruptLine: i };
    }
  }
  return { entries: asCompleteLog(parsed), corruptLine: null };
}

export interface OpenResult {
  log: AccountabilityLog;
  /** How the on-disk chain verified at boot. Reported loudly by the caller, not swallowed. */
  check: ChainCheck;
}

export class AccountabilityLog {
  private entries: CompleteLog;
  private meta: Meta;
  private fd: number | null = null;

  private constructor(
    private readonly path: string,
    private readonly retentionDays: number,
    entries: CompleteLog,
    meta: Meta,
  ) {
    this.entries = entries;
    this.meta = meta;
  }

  private get metaPath(): string {
    return `${this.path}.meta.json`;
  }

  /**
   * Reads the log and verifies it.
   *
   * A failed verification does **not** stop the daemon. People's safety depends on the
   * watch running, and a watch that refuses to start because its own record looks edited
   * has turned an accountability problem into an availability one -- which is the trade a
   * hostile watch would happily make. It records the break permanently instead, and the
   * caller shouts about it.
   */
  static open(path: string, retentionDays: number): OpenResult {
    mkdirSync(dirname(path), { recursive: true });

    const meta: Meta = existsSync(`${path}.meta.json`)
      ? { ...EMPTY_META, ...(JSON.parse(readFileSync(`${path}.meta.json`, "utf8")) as Partial<Meta>) }
      : { ...EMPTY_META };

    const { entries, corruptLine } = readEntries(path);
    let check = verifyChain(entries, { startsAt: meta.startsAt });
    // A line that fails to parse is treated exactly like a truncated tail, because that is
    // what fsync-per-entry makes it: only the very last write can ever be torn by a real
    // crash, and everything after an unreadable line cannot be trusted regardless. A chain
    // that verifies clean up to a point it silently stopped reading is not intact -- it is
    // unread, and reporting it as intact would hide the loss entirely.
    if (corruptLine !== null && check.intact) {
      check = {
        intact: false,
        brokenAt: entries.length,
        reason: `line ${corruptLine} could not be parsed as an entry -- log truncated there`,
      };
    }

    const log = new AccountabilityLog(path, retentionDays, entries, meta);

    if (!check.intact) {
      meta.breaks = [
        ...meta.breaks,
        { at: Math.floor(Date.now() / 1000), index: check.brokenAt, reason: check.reason ?? "unknown" },
      ];
      log.writeMeta();
    }
    return { log, check };
  }

  private writeMeta(): void {
    writeFileSync(this.metaPath, JSON.stringify(this.meta, null, 2), { mode: 0o600 });
  }

  private open(): number {
    if (this.fd === null) this.fd = openSync(this.path, "a", 0o600);
    return this.fd;
  }

  /** Appends, and does not return until the bytes are on the platter. */
  record(entry: NewEntry): LogEntry {
    const next = appendEntry(this.entries, entry);
    const written = next.at(-1);
    // appendEntry always adds exactly one; this is here so a future change that stops doing
    // so fails at the write rather than persisting `undefined` into the chain.
    if (!written) throw new Error("appendEntry returned an empty log");
    const fd = this.open();
    writeSync(fd, `${JSON.stringify(written)}\n`);
    fsyncSync(fd);
    // Only committed to memory once it is durably on disk. This used to run first: a
    // write or fsync failure above (a full disk, say) still throws, but `this.entries`
    // already held the phantom entry -- permanently, since the next successful record()
    // chains from a hash that was never written, leaving `root()`/`about()` reporting an
    // entry that does not exist and the on-disk file with a real gap that reads as
    // tampering on the next restart.
    this.entries = next;
    return written;
  }

  /** Every entry. The whole-log view, which is the only one the chain can verify. */
  all(): CompleteLog {
    return this.entries;
  }

  /**
   * What one operator may review [C33].
   *
   * Not chain-verifiable, and core's types say so: the links point at entries about other
   * people. Until inclusion proofs ship, this is the watch's account of itself.
   */
  about(pubkey: string): LogEntry[] {
    return entriesAbout(this.entries, pubkey);
  }

  /**
   * A commitment to the log as it stands, for publication in `10910`.
   *
   * Recomputed on demand rather than cached: at this size it is microseconds, and a cached
   * root that drifted from the entries would be the single most misleading value in the
   * system -- a signed statement about a log that is not the log.
   */
  root(nowSeconds: number): LogRoot {
    return merkleRoot(this.entries, nowSeconds);
  }

  /**
   * The entries about one operator, each with a proof that it is in the published tree.
   *
   * The proof is `log₂(n)` sibling hashes and nothing else, so it discloses nothing about
   * any other operator. This is what makes C33 reviewable rather than merely promised: the
   * operator checks their entries against a root they saw published, without being handed
   * everyone's record and without taking the watch's word for it.
   */
  reviewFor(pubkey: string, opts: { since?: number; limit?: number } = {}): LogReview {
    const matching: { entry: LogEntry; proof: InclusionProof }[] = [];
    this.entries.forEach((entry, index) => {
      if (entry.subject?.pubkey !== pubkey) return;
      if (opts.since !== undefined && entry.at < opts.since) return;
      matching.push({ entry, proof: inclusionProof(this.entries, index) });
    });

    // Newest first, then capped. An operator wanting last night should not page through
    // three months to reach it -- and relays cap message size, so something is always
    // dropped. Dropping the oldest is the choice that needs no explanation.
    matching.reverse();
    const limit = Math.min(opts.limit ?? REVIEW_PAGE, REVIEW_PAGE);
    return {
      root: this.root(Math.floor(Date.now() / 1000)),
      entries: matching.slice(0, limit),
      more: matching.length > limit,
    };
  }

  status(): { entries: number; startsAt: string | null; breaks: Meta["breaks"] } {
    return { entries: this.entries.length, startsAt: this.meta.startsAt, breaks: this.meta.breaks };
  }

  /**
   * Drops entries past the retention window and declares the new chain start.
   *
   * Rewrite-then-rename, so a crash mid-rotation leaves the old file intact rather than a
   * half-written one. Returns how many were dropped.
   */
  rotate(nowSeconds: number): number {
    const cutoff = nowSeconds - this.retentionDays * 86_400;
    const firstKept = this.entries.findIndex((e) => e.at >= cutoff);
    if (firstKept <= 0) return 0;

    const dropped = this.entries.slice(0, firstKept);
    const kept = asCompleteLog(this.entries.slice(firstKept));

    const temp = `${this.path}.rotating`;
    writeFileSync(temp, kept.map((e) => `${JSON.stringify(e)}\n`).join(""), { mode: 0o600 });
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
    renameSync(temp, this.path);

    this.entries = kept;
    // The dropped tail's last hash is what the new first entry points at. Without this the
    // log would accuse itself of tampering every retention period.
    // `firstKept > 0` above guarantees this slice is non-empty.
    this.meta.startsAt = dropped.at(-1)!.hash;
    this.writeMeta();
    return dropped.length;
  }

  close(): void {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }
}
