/**
 * Screen brightness as a tactical property.
 *
 * Every operator using this is outdoors at night, and none of them had a control for it. A
 * phone at full brightness does two things on a dark street: it destroys the dark adaptation
 * you need for the next ten minutes, and it makes you the brightest object for a hundred
 * metres.
 *
 * **Low signature is not a dark theme.** The terminal is already dark. This removes white
 * entirely, drops luminance to the floor, and goes amber-dominant — which is what marine and
 * aviation panels have used for decades, because long-wavelength light is what dark-adapted
 * eyes keep working through.
 *
 * ## The cost, stated
 *
 * Amber-dominant means state is carried by **brightness and wording rather than hue**: bright
 * amber for good, mid for warning, dim for cold, and red kept for the alarm channel alone.
 * That is a real reduction in how quickly a state reads, and it is the trade being made — a
 * screen you can read without ruining your night vision, against one that sorts by colour.
 *
 * Document mode is one tap away from every screen for exactly that reason: reading a directory
 * record properly is a different job from watching a board.
 *
 * Accruing tier. It is a preference about how somebody works, not something about tonight.
 */

import { loadIdentity } from './identity';
import { get, set } from './storage';

const FIELD = 'signature';

export type Signature = 'low' | 'document';

/**
 * What this device is set to, and what it defaults to when nobody has said.
 *
 * ## The default, decided
 *
 * Neither "always on" nor "always off" survives contact with who opens this.
 *
 * **Not on a timer.** The obvious answer is to dim after dark, and `tokens.css` rules it out
 * in its own words: *"a terminal that changed appearance with the phone's theme would be a
 * terminal you could not learn by muscle memory."* It would also be keyed to a clock this app
 * has a documented Dark reason for distrusting, and inferring where somebody is standing is
 * the kind of guessing invariant 3 exists to forbid.
 *
 * **The failure modes are asymmetric.** Defaulting off and being wrong means an operator holds
 * a bright phone on a dark street: night vision gone, and the brightest object for a hundred
 * metres — a cost they never see and may never connect to a setting they never found.
 * Defaulting on and being wrong means somebody indoors sees a dim amber screen, which is
 * visible, recoverable, and one tap from fixed. This project picks the safe answer over the
 * true one everywhere else; it should here.
 *
 * **But not from the first screen.** A newcomer must never meet something that reads as
 * degraded — the whole Alone position — and a dim amber first impression does exactly that.
 *
 * So the default follows the one thing the operator has actually declared: **a callsign.**
 * Somebody who only wants the directory never needs one, and the terminal's directory works
 * without it. Choosing a callsign is a deliberate statement of *I intend to work as an
 * operator*, and operators work outdoors at night. That is not a guess about the world; it is
 * honouring something a person said.
 *
 * **`prefers-contrast: more` outranks all of it.** Somebody who has asked their whole device
 * for more contrast has already answered this question, and dimming them would be overriding a
 * stated need with a default. It is the one signal here that is neither inference nor proxy.
 */
export function signature(): Signature {
  const stored = get<string>('accruing', FIELD);
  if (stored === 'low' || stored === 'document') return stored;
  return defaultSignature();
}

/** What it is before anybody has chosen. See above for why it is not simply on or off. */
export function defaultSignature(): Signature {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-contrast: more)')?.matches) {
    return 'document';
  }
  return loadIdentity() ? 'low' : 'document';
}

export function setSignature(value: Signature): void {
  set('accruing', FIELD, value);
  apply(value);
}

/**
 * Puts it on the document.
 *
 * On the root element rather than on `.terminal`, so it is set before the terminal renders and
 * there is no flash of full brightness — which on a dark street is the whole thing this exists
 * to avoid.
 */
export function apply(value: Signature = signature()): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.signature = value;
}
