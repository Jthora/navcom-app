/**
 * A real calendar date, not just `YYYY-MM-DD` shape.
 *
 * Found by robustness audit, duplicated across three files that each rolled their own
 * shape-only regex: `"2023-02-29"` (2023 is not a leap year) and `"2024-04-31"` (April has
 * 30 days) passed every one of them, and `Date.parse` silently reinterpreted both as the
 * following day rather than rejecting what an operator actually typed — a `last_verified`
 * date this project's own staleness math then trusted at face value.
 *
 * A round trip back to the same string is cheap and closes it: a date that survives being
 * parsed and re-formatted was real. One place, so the three call sites stop being three
 * chances to fix it separately.
 */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
