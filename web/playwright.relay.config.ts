import base from './playwright.config';

/**
 * The real-relay check, which the ordinary config deliberately ignores.
 *
 * Same browser, same built output, same phone viewport — the only difference is that this one
 * is allowed to run, and that it runs serially. Two browser contexts sharing one relay is a
 * sequence, not a set of independent tests.
 */
export default {
  ...base,
  testIgnore: [],
  fullyParallel: false,
  workers: 1
};
