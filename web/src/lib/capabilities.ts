/**
 * What this app offers a person, declared once.
 *
 * Four hand-written tests used to guard four versions of one idea — that a claim on a screen
 * corresponds to something real, that a screen is cached, that a control exists, that a page
 * does not secretly depend on a watch. Each was written *after* the failure it guards.
 * Together they were this file, discovered one incident at a time.
 *
 * Three things derive from it, and none is written per capability:
 *
 *  1. **The screen is in the build**, and is cached for offline
 *  2. **Every claim appears on it**, in the built HTML
 *  3. **`requires` is the truth** — a browser test seeds exactly what is declared and
 *     nothing more, then operates the control. A capability that needs more than it admits
 *     to fails, which is how peer presence secretly requiring a Watchtower would have been
 *     caught on the day it was written
 *
 * ## Why the claims must be unconditional
 *
 * A claim is checked against the prerendered HTML, so it cannot sit behind `{#if}` on state
 * a fresh visitor lacks. That reads like a limitation and is the opposite: five times this
 * session an important sentence was hidden behind a conditional, and each time the fix was
 * to move it to where somebody reads it *before* deciding — how unpairing works, before the
 * pairing form; what a wipe does not reach, before the wipe button; what a check proves,
 * before the record is fetched.
 *
 * **Putting the claim where the test can see it puts it where the operator can.**
 */

/** What must be on a device before a capability works at all. */
export type Requirement =
  /** A callsign and keypair. The only genuinely required setup step. */
  | 'identity'
  /** A configured Watchtower. Most operators have none, and most capabilities need none. */
  | 'watch'
  /** At least one paired peer. */
  | 'peers'
  /**
   * Somebody the operator said they would call.
   *
   * Added because "Your person, before the app loads" declared only an identity and its
   * control is a `tel:`/`sms:` link that exists **only when a contact has been saved** —
   * so the browser check seeded a device with no contact, found no link, and had been
   * silently passing for as long as the control went undeclared.
   */
  | 'contact';

export interface Capability {
  name: string;
  /** Route, relative to the site root, with its trailing slash. */
  screen: string;
  /**
   * Words that must appear on that screen: its own label, or the one line it cannot be operated
   * without. **Often none** since 2026-11-01, when the owner directed that screens explain nothing
   * they need not: a capability is its screen, its control and what it requires, and an
   * explanation is not a claim this manifest keeps on screen.
   */
  claims: string[];
  /**
   * A CSS selector for the thing a person operates. Checked in a real browser.
   *
   * **Exactly one of `control` and `readOnly` must be set**, and that is the whole point of
   * this pair existing. It used to be optional with a hand-written list of five capabilities
   * that "should operate" — so the other nineteen could quietly have nothing, and nine of
   * them did. Two of those nine were `terminal/wipe/` and `terminal/patrols/`: the screens
   * where *a mechanism nobody can reach* has actually happened, twice, to `panicWipe` and
   * to the patrol export's `includeNotes`.
   *
   * A guard whose coverage is an allow-list only ever covers the failures somebody already
   * remembered. Making the declaration mandatory turns an omission into a sentence somebody
   * had to write.
   */
  control?: string;
  /**
   * Why this screen has nothing to operate — set instead of `control`, never as well.
   *
   * A real answer, not a placeholder. "You read it" is a fact about a page of prose; it is
   * not a fact about a screen with a button somebody forgot to declare.
   */
  readOnly?: string;
  /**
   * How this screen survives losing signal.
   *
   * `precache` — in the service worker's shell, available before it is ever opened. The
   * default, and right for every screen an operator might need cold.
   *
   * `on-visit` — cached the first time it is opened, and not before. Right for the directory
   * regions: *"only what you open is kept"*, because carrying every metro would fill a cheap
   * phone with places nobody will go. The manifest models it because the app already does,
   * and a check that demanded precaching here would be demanding the wrong thing.
   */
  cached?: 'precache' | 'on-visit';
  /**
   * Whether the control only exists where the browser can be woken.
   *
   * Declared because it is true, not to excuse a failure. **iOS supports Web Push only for
   * an installed PWA**, so in a Safari tab this screen has no registration control at all —
   * correctly, and it says so in as many words. The first cross-engine run turned that into
   * four red tests for an app that was behaving properly, which is the manifest failing to
   * describe reality rather than the screen failing to meet it.
   *
   * Where this is set and the platform cannot be woken, the check becomes: the screen must
   * say so, and say what would change it. That is the same standard applied everywhere else
   * here — a capability that is unavailable has to be legible as unavailable.
   */
  needsPush?: boolean;
  requires: Requirement[];
}

export const CAPABILITIES: Capability[] = [
  {
    /*
     * Decided 2026-10-18 (decision 2): every sealed claim and report NavCom ever sent to Mecha Jono
     * went to a key whose secret had already leaked, so whoever holds it can open them and show
     * which card sent each. The rows in a phone's own mission history say it of what that phone
     * sent; this is the one general sentence, for every phone, wiped or not, before anybody asks.
     */
    name: 'What was sealed to a key whose secret leaked',
    screen: 'terminal/',
    // Said on a device with a profile, the only kind that could have sealed anything (2026-11-01).
    claims: [],
    readOnly:
      'A statement of what already happened to messages this app sent. Nothing sent can be recalled, so there is nothing to operate; the rows it is about are in Your missions.',
    requires: []
  },
  {
    name: 'Create a profile',
    screen: 'terminal/setup/',
    claims: [
      // A name and a button, as any profile asks (2026-11-01), and the way in from another device.
      'Create profile',
      'Sign in with your backup'
    ],
    control: '#callsign',
    requires: []
  },
  {
    name: 'Add a watch',
    screen: 'terminal/setup/',
    claims: [
      // Who can read what you send: the one line kept before the field it governs.
      'Everyone listed can read what you send'
    ],
    control: '#holders',
    requires: []
  },
  {
    name: 'Somebody you would call',
    screen: 'terminal/setup/',
    claims: [
      'ready for you to send'
    ],
    control: '#cnumber',
    requires: []
  },
  {
    name: 'Cached directory',
    screen: 'terminal/directory/',
    claims: ['to keep it on this phone'],
    // Opening an area is what caches it, so the link IS the mechanism -- not navigation
    // decoration. A region nobody can open is a region nobody has offline.
    control: 'a.area',
    requires: []
  },
  {
    name: 'Report a problem with a record',
    screen: 'terminal/directory/st-louis/',
    // Nothing said about it since 2026-11-01. The per-record controls are built in the browser
    // since 2026-09-19, so the browser suite is where `control` below is proven.
    claims: [],
    control: '[data-report-open]',
    cached: 'on-visit',
    requires: []
  },
  {
    name: 'Go out',
    screen: 'terminal/sign-on/',
    claims: ['Sign on'],
    control: '#area',
    requires: ['identity']
  },
  {
    name: 'Share where you are',
    screen: 'terminal/sign-on/',
    // Who sees it: the one line kept beside the choice (2026-11-01).
    claims: ['Only your watch and paired peers see it'],
    control: '#share',
    requires: ['identity']
  },
  {
    name: 'Distress',
    screen: 'terminal/distress/',
    claims: [
      // The retrying is timers in the page, so the one thing to do is keep it open.
      'Keep this screen open'
    ],
    control: 'button.raise',
    requires: ['identity']
  },
  {
    /*
     * The screen a repeat page opens: the person who acknowledged an operator, paged again because
     * that operator's phone is still sending. Its one action widens -- it asks the watch to page the
     * roster -- and never closes anything [escalation.spec.md, "Wake the others"]. The claim is the
     * sentence that is there whatever the page carries; the action needs the attempt a page names.
     */
    name: 'Waking the others',
    screen: 'terminal/wake/',
    claims: ['Distress again from'],
    readOnly:
      'Its one action needs the attempt a repeat page carries; opened without one it says there is nothing to send. e2e/wake-others.spec.ts operates it from a page address.',
    requires: ['identity', 'watch']
  },
  {
    name: 'Your person, before the app loads',
    screen: 'terminal/distress/',
    claims: [],
    control: '[data-contact] a',
    requires: ['identity', 'contact']
  },
  {
    name: 'Your own patrols',
    screen: 'terminal/patrols/',
    claims: ['It stays on this phone'],
    // Whether a year of your nights survives a seized phone. Always on the screen, unlike
    // the export controls, which need a patrol to exist first.
    control: '[data-keep]',
    requires: ['identity']
  },
  {
    name: 'Post-quantum cover',
    screen: 'terminal/setup/',
    // Nothing said on the profile screen since 2026-11-01: the notice that fires when cover is
    // missing is state-dependent, and a browser test creates that state instead.
    claims: [],
    readOnly:
      'A readout of whether your peers can be sealed against a future quantum computer. ' +
      'There is nothing to set: coverage follows from whether they have published a key, ' +
      'and the only action it implies is asking somebody to open the app.',
    requires: []
  },
  {
    name: 'Peers',
    screen: 'terminal/peers/',
    claims: [
      // The one that decides whether an operator who knows nobody here has anybody at all.
      // Pairing never required a peer to be an operator, and every word on the screen said
      // otherwise. The one line the screen keeps (2026-11-01).
      "They don't have to be an operator"
    ],
    control: '#code',
    requires: ['identity']
  },
  {
    name: 'Your card',
    screen: 'terminal/card/',
    // Its name. The one line kept, that publishing can't be undone, is beside the button, which a
    // device with no profile does not have.
    claims: ['Public profile'],
    // Where its holder says they are, Earth until they choose: the first thing on the form since
    // 2026-10-27, and the metro's list appears only once a city is the level chosen.
    control: '[data-card-where] input[name="where"]',
    requires: ['identity']
  },
  {
    name: 'Find somebody',
    screen: 'terminal/find/',
    // Nothing said beyond what the board is (2026-11-01).
    claims: ['published a public profile'],
    control: '#area',
    requires: ['identity']
  },
  {
    name: 'The live map',
    screen: 'terminal/map/',
    // Its name, and nothing explained (2026-11-03). It needs nothing set up: with nobody sharing where
    // they are, it says there is nobody to show.
    claims: ['Map'],
    control: '[data-live-map]',
    requires: []
  },
  {
    name: 'Take the watch',
    screen: 'terminal/watch/',
    // 4.3: everything below it looks like a safety monitor and is not one. The one line kept
    // (2026-11-01).
    claims: ['This app does not watch anybody. You do'],
    control: '[data-start-watch]',
    requires: ['identity']
  },
  {
    name: 'Being on call',
    screen: 'terminal/on-call/',
    // Somebody agreeing to be interrupted is told when, before the button (2026-11-01).
    claims: ['reaches this watch'],
    control: '#sender',
    needsPush: true,
    requires: []
  },
  {
    name: 'Resupply',
    screen: 'terminal/resupply/',
    // Invariant 1, in the same words the Query screen uses.
    claims: ['Write about the supply, not the person'],
    control: '#r',
    requires: ['identity', 'watch']
  },
  {
    name: 'Standing',
    screen: 'terminal/standing/',
    // Nothing said on the screen since 2026-11-01 beyond what it holds.
    claims: [],
    control: '#cred',
    requires: ['identity']
  },
  {
    name: 'Backup and recovery',
    screen: 'terminal/backup/',
    claims: ['Sign in with a backup'],
    control: '#rblob',
    requires: []
  },
  {
    name: 'Support',
    screen: 'terminal/funding/',
    // The cost that catches people out, stated before they enable anything.
    claims: ['Converting to cash usually is not'],
    control: '#mine',
    requires: []
  },
  {
    name: 'Wipe this device',
    screen: 'terminal/wipe/',
    // What a wipe also stops, before the hold: a Distress still going is silenced by it.
    claims: ['Also stops anything this tab is still sending'],
    // `panicWipe` is the original instance of a mechanism nobody can reach -- it had no
    // button for weeks. It is declared here so that can never be true silently again.
    control: '[data-act]',
    requires: ['identity']
  },
  {
    name: 'What the watch wrote',
    screen: 'terminal/log/',
    claims: ['The watch writes down what it does'],
    control: '[data-ask]',
    // The button is disabled while the watch is dark, so this needs a watch that is
    // actually there -- not merely configured. Declared rather than worked around: an
    // operator with no watch opens this screen to a true answer (nobody has written
    // anything about you), and the control is the part that needs somebody to ask.
    requires: ['identity', 'watch']
  },
  {
    name: 'Query',
    screen: 'terminal/query/',
    claims: [
      // Nothing about the person being helped is ever recorded [invariant 1].
      'Write about the need, not the person'
    ],
    control: '#q',
    requires: ['identity', 'watch']
  },
  {
    name: 'Assist',
    screen: 'terminal/assist/',
    claims: ['use Distress'],
    control: '#a',
    requires: ['identity', 'watch']
  },
  {
    name: 'Somebody else\'s card',
    screen: 'terminal/who/',
    claims: [
      // In the prerendered page: reached with a key in the link, so what a fresh visitor meets
      // before any card can load is the empty state, and it says where to go instead.
      'Browse an area'
    ],
    readOnly:
      'Nothing on this screen is operated. A card is one person\'s own published claims, rendered ' +
      'from a key in the link — there is nothing here to change, because the person it describes ' +
      'publishes it from their own device and nobody else can edit it.',
    requires: []
  }
];

/** Every distinct screen a capability lives on. */
export const CAPABILITY_SCREENS = [...new Set(CAPABILITIES.map((c) => c.screen))];
