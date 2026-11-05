/**
 * Who may sign on.
 *
 * Session One's brief said "any pubkey" and that this "must not ship beyond MVP", and
 * bootstrap.spec.md "Who may sign on" says Mk1 must not ship it. So the box is **closed by
 * default** (SC7, 2026-11-04): an operator is heard when their code is on `[authorization]
 * allowed_pubkeys`, and the old open board exists only where the config says `open = true` in
 * as many words. An open board means anyone who learns the watch's key can place entries on it,
 * spend the watch's attention and read its state; that is a choice to make on purpose, for a
 * closed pilot among people who know each other, not one a config drifts into by leaving a
 * section out.
 *
 * Still a plain function given the settings rather than reading config itself, so it stays
 * testable without a file on disk.
 */
export interface Authorization {
  /** Operators' codes, lowercase 64-char hex: the "Your code" on their Peers screen. */
  allowedPubkeys: string[];
  /** Anyone who knows the watch's key may sign on. Only ever by `open = true`. */
  open: boolean;
}

export function isAuthorizedOperator(pubkey: string, auth: Authorization): boolean {
  if (auth.open) return true;
  return auth.allowedPubkeys.includes(pubkey);
}

/**
 * Why this daemon must not start, or null when it may.
 *
 * A box closed to everyone would come up, publish a watch state, and then drop every sign-on,
 * every question and every Distress without a word, which is the worst way for it to fail: it
 * looks up. So it refuses at startup instead, and says the two ways forward.
 */
export function refusalToStart(auth: Authorization): string | null {
  if (auth.open || auth.allowedPubkeys.length > 0) return null;
  return (
    "this watch would hear nobody: [authorization] lists no operators. " +
    "Add each operator's code to allowed_pubkeys (the \"Your code\" on their Peers screen, or the pairing link it gives), " +
    "or set open = true to let anyone who knows this watch's key sign on, for a closed pilot among people who know each other"
  );
}
