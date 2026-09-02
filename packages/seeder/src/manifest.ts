/**
 * Decisions about a region's own manifest, kept apart from the CLI.
 *
 * In its own file because `cli.ts` calls `main()` at module scope: importing it to reach one
 * pure function runs the whole command-line program, which under a test runner means parsing
 * the runner's argv and calling `process.exit`. That passed, and passed by luck.
 */

/**
 * Whether the manifest actually has to be written, rather than merely read.
 *
 * This tested `status !== "maintained"` and rewrote the file every apply — including for the
 * regions already marked `seeded`, where the value it wrote was the value already there. A
 * JSON round-trip is not lossless for a human-edited file: it reformats, and it drops the
 * trailing zero on a number. Reseeding nine regions moved adelaide's bounding box from
 * `-35.0` to `-35`, semantically identical and a diff nobody asked for, in a file the tool had
 * no business touching.
 *
 * Now: write only when the status is genuinely wrong. A tool that rewrites what it only needed
 * to read makes every future diff harder to read for no gain.
 */
export function needsStatusWrite(current: unknown): boolean {
  return current !== "maintained" && current !== "seeded";
}
