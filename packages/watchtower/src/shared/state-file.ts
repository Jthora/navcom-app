import { closeSync, constants, fchmodSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Writes a small file one process writes and another only reads -- the drill file and the hearing
 * file, both written by the escalation executor for the daemon -- so that nothing at the path can
 * turn the write against the writer.
 *
 * ## Why it exists
 *
 * Both files lived beside things the daemon's user can write, by default and in the examples, while
 * the executor may run as a user of its own (`ops/systemd/README.md`, 4b). The hearing writer opened
 * `<path>.tmp` with a plain write and the drill writer opened the path itself, and both follow a
 * link. So the daemon, or the agent beside it, could plant
 * `ln -s /var/lib/navcom-escalation/watchtower.key /var/lib/navcom/hearing.json.tmp`, and the
 * executor's next write -- within thirty seconds -- replaced its own key with hearing JSON, with the
 * executor's privileges. The next restart printed `NO WATCH KEY ... Not starting`, and no `Distress`
 * paged anybody: a compromised agent impairing escalation, which `CLAUDE.md` calls non-negotiable.
 *
 * ## How
 *
 * - **The directory must be this user's own, and nobody else's to write.** A directory another user
 *   owns, or that its group or anybody can write, is one where whoever can write it can swap what is
 *   there between two writes, so nothing is written there and the caller says why. Made, where it is
 *   missing, `0750`: never group-writable, whatever the umask
 * - **A new file every time, made with `O_CREAT | O_EXCL`**, which refuses anything already at the
 *   temporary name, a link included, dangling or not. Whatever is left there is removed first, and
 *   removing a link removes the link, never what it names
 * - **Then a rename over the path**, which replaces whatever is at the path, a link included, and
 *   never writes through it. A reader sees the old file or the new one, never half of either
 * - **`mode`, set on the open file** with `fchmod`: a umask narrows the mode a file is made with,
 *   and the daemon reads both files through their group
 *
 * Throws with the reason; each caller says it and goes on, because a write that fails must never
 * stop the executor.
 */
export function writeStateFile(path: string, text: string, mode = 0o640): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o750 });
  refuseShared(dir);
  const tmp = `${path}.tmp`;
  // A leftover, or something planted: removed, never followed.
  rmSync(tmp, { force: true });
  let fd: number | undefined;
  try {
    fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), mode);
    try {
      fchmodSync(fd, mode);
    } catch {
      // best effort on a file system without modes; the daemon says when it cannot read the file
    }
    writeSync(fd, text);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, path);
  } catch (err: unknown) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
    }
    try {
      rmSync(tmp, { force: true });
    } catch {
      // the error that matters is the one below
    }
    throw err;
  }
}

/**
 * Throws where `dir` is not this user's alone to write: owned by another user, or writable by its
 * group or by anybody. Says which, and what to do.
 */
function refuseShared(dir: string): void {
  // No uids on this platform, so no owner to compare: the file system decides.
  if (typeof process.getuid !== "function") return;
  const uid = process.getuid();
  const st = statSync(dir);
  if (st.uid !== uid) {
    throw new Error(
      `${dir} belongs to uid ${st.uid}, not to this user (uid ${uid}), so whoever owns it could swap what is ` +
        "written there for a link to one of this user's files. Nothing was written. Put the file in a directory " +
        "this user owns and nobody else can write: the drill directory, for an executor running as a user of its " +
        "own (ops/systemd/README.md, 4b)",
    );
  }
  if ((st.mode & 0o022) !== 0) {
    throw new Error(
      `${dir} can be written by its group or by anybody (mode ${(st.mode & 0o7777).toString(8)}), so another user ` +
        "could swap what is written there for a link to one of this user's files. Nothing was written. Make it " +
        `writable by its owner only (chmod g-w,o-w ${dir}), or put the file in a directory that is`,
    );
  }
}
