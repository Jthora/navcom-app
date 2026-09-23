/**
 * Where a complaint about something shown on navcom.app reaches whoever maintains it.
 *
 * ## Why an address, and why only one
 *
 * Several of the defences available to a site that shows other people's words turn on the same
 * two things: somebody could tell you, and you acted once told. The UK's website-operator
 * regulations, Australia's digital-intermediary defence, Quebec's IT framework act and New
 * Zealand's safe harbour each ask for a way to complain and a prompt response, and none of them
 * asks for a legal name. So this is an email alias used for nothing else, and what happens to a
 * message sent to it is `docs/product/notices.md`.
 *
 * ## The placeholder, and what does not guard it
 *
 * `.invalid` is a reserved domain that can never receive mail. A notice page printing it would
 * invite complaints into a void, which is worse than offering no channel: the site would look as
 * though it acted on notice and could not — so nothing renders this yet.
 *
 * **No guard enforces that.** An earlier version of this comment said `notice.test.ts` fails the
 * build until a real address replaces the placeholder. It does not: that test never imports this
 * module and never mentions `.invalid`, so the sentence described a guard nobody wrote. The guard
 * goes in with the address, and `docs/product/notices.md` now says the same thing, so a reader
 * does not have to find this comment to learn the channel is missing.
 */
export const NOTICE_ADDRESS = 'notices@navcom.invalid';

/** From a notice that qualifies to the card no longer being shown. See `docs/product/notices.md`. */
export const NOTICE_HOURS = 48;
