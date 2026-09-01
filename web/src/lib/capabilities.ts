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
   * Sentences that must appear on that screen.
   *
   * Pick the load-bearing ones: the claim, and the limit that keeps the claim honest. Two
   * or three. This is not a copy test — it is a check that the promise still has a
   * mechanism behind it.
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
     * The Status screen was the one screen no capability declared.
     *
     * Nineteen were in this manifest and the app's own home was not -- the screen every
     * operator opens first and returns to all night. That is where the first-run audit found
     * a stranger being told "a Watchtower is configured" when none was, and the two facts are
     * the same fact: nothing here was watching it.
     *
     * The claims are the two sentences on it that are unconditional and load-bearing. The
     * rest of the screen is state -- watch, callsign, session -- and a claim behind `{#if}`
     * is not a claim.
     */
    name: 'Putting it on your home screen',
    screen: 'terminal/',
    claims: [
      // A safety fact about the icon, on the screen where somebody decides to make one, and
      // it had no test of any kind.
      'shows whatever name is on the icon',
      // This screen used to say "nothing is added", which contradicts delivery.md's own
      // honest pricing of the install and talks an operator on the device floor out of the
      // one thing that protects the layer they depend on.
      'less likely to do that to something on your home screen'
    ],
    control: '[data-home-screen] summary',
    requires: []
  },
  {
    name: 'Set up a callsign',
    screen: 'terminal/setup/',
    claims: [
      'Never a legal name',
      // 5.7. An operator reading "no account, no legal name" could reasonably conclude
      // they are anonymous. They are not, and it is said where the key is generated.
      'This is a pseudonym, not anonymity',
      'everything you sign with it links together',
      // identity.md requires this at persona creation, not after the phone is dropped.
      'Nobody can give this back to you',
      // The watch section must read as optional, or an operator who knows nobody believes
      // their setup is unfinished.
      'the section below is optional'
    ],
    control: '#callsign',
    requires: []
  },
  {
    name: 'Add a watch',
    screen: 'terminal/setup/',
    claims: [
      'Nothing discovers a Watchtower on its own',
      // Who can read what you send is the one thing an operator must know before
      // configuring a squad-held watch, and it is stated before the field.
      'whoever is on this list can read everything',
      'Usually empty'
    ],
    control: '#holders',
    requires: []
  },
  {
    name: 'Somebody you would call',
    screen: 'terminal/setup/',
    claims: [
      'you have to press send',
      // The number never leaves the phone, so there is no roster of operators' contacts
      // for a seizure to find.
      'Their number stays on this phone'
    ],
    control: '#cnumber',
    requires: []
  },
  {
    name: 'Cached directory',
    screen: 'terminal/directory/',
    claims: [
      'Opening it is what saves it',
      'Only what you open is kept'
    ],
    // Opening an area is what caches it, so the link IS the mechanism -- not navigation
    // decoration. A region nobody can open is a region nobody has offline.
    control: 'a.area',
    requires: []
  },
  {
    name: 'Report a problem with a record',
    screen: 'terminal/directory/st-louis/',
    claims: [
      // Display rule 4's own words, finally true in both halves: the app could render a
      // flag and not set one, so reporting was impossible while fixing needed a pull request.
      'Report a problem',
      // The abuse answer, said where somebody reports. Nobody adjudicates, so the shape of
      // the data has to be what makes it survivable.
      'cannot delete this listing or overrule anybody',
      'nobody has to approve it'
    ],
    control: '[data-report-open]',
    cached: 'on-visit',
    requires: []
  },
  {
    name: 'Go out',
    screen: 'terminal/sign-on/',
    claims: [
      'A district, never an address',
      // A missed check-in nudges and does nothing else. Alarm fatigue destroys the one
      // mechanism where failure means somebody is hurt.
      'never counts as distress'
    ],
    control: '#area',
    requires: ['identity']
  },
  {
    name: 'Share where you are',
    screen: 'terminal/sign-on/',
    claims: [
      'no setting that makes it public',
      'Only the latest is kept',
      'cannot follow you with the app closed'
    ],
    control: '#share',
    requires: ['identity']
  },
  {
    name: 'Distress',
    screen: 'terminal/distress/',
    claims: [
      'It keeps sending until a human answers',
      'only you can stop it'
    ],
    control: 'button.raise',
    requires: ['identity']
  },
  {
    name: 'Your person, before the app loads',
    screen: 'terminal/distress/',
    claims: [
      // The claim the pre-bundle fallback exists to keep true. It is stated on the screen
      // because an operator deciding whether to rely on this needs to know it is the part
      // that does not depend on anything arriving.
      'works before the rest of this screen does'
    ],
    control: '[data-contact] a',
    requires: ['identity', 'contact']
  },
  {
    name: 'Your own patrols',
    screen: 'terminal/patrols/',
    claims: [
      'It stays on this phone',
      'nothing here is sent to a watch, a relay or anybody else'
    ],
    // Whether a year of your nights survives a seized phone. Always on the screen, unlike
    // the export controls, which need a patrol to exist first.
    control: '[data-keep]',
    requires: ['identity']
  },
  {
    name: 'Post-quantum cover',
    screen: 'terminal/setup/',
    claims: [
      // The *policy*, which is always true and belongs where the key it derives from is
      // generated. The notice that fires when cover is actually missing is state-dependent
      // by design -- showing it while cover is hybrid would be a lie -- so it is checked by
      // a browser test that creates the state instead. This is the one place where the
      // manifest's "make the claim unconditional" rule does not apply, and the reason is
      // that the sentence is about a condition rather than about the screen.
      'A second key is derived from it',
      'the message still goes',
      'Status says so'
    ],
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
      'No watch is involved, no server holds it',
      'Best done face to face',
      'they are not told',
      // The one that decides whether an operator who knows nobody here has anybody at all.
      // Pairing never required a peer to be an operator, and every word on the screen said
      // otherwise -- so the cheapest real safety arrangement in the app was invisible to the
      // people who most needed it. Held here so it cannot quietly go back to being implied.
      'They do not have to be an operator',
      // The commitment and its limit together. Watching for somebody is a nudge, and they
      // are told you are doing it -- a private note means somebody can believe they are
      // watched while nobody is.
      'they are told you are doing it',
      'nothing escalates, nobody is paged',
      // Somebody who owes a refusal accepts to avoid an awkward one. Said before any invite
      // has arrived, since that is when it changes what a person feels obliged to do.
      'ignoring sends nothing'
    ],
    control: '#code',
    requires: ['identity']
  },
  {
    name: 'Your card',
    screen: 'terminal/card/',
    claims: [
      // The claim that makes a card safe to publish at all, and the reason the contact key
      // exists. Stated before the form, not under it.
      'signed by a',
      'separate key',
      'A card carries no position',
      // Reducing exposure is never symmetrical with increasing it, and a control that
      // implies otherwise is a false promise this community would notice.
      'Publishing cannot be undone'
    ],
    control: '#region',
    requires: ['identity']
  },
  {
    name: 'Find somebody',
    screen: 'terminal/find/',
    claims: [
      'published a card about themselves',
      'gives them your key',
      // What a reader of this board must understand before deciding to be on it.
      'not on this board unless you put yourself there'
    ],
    control: '#area',
    requires: ['identity']
  },
  {
    name: 'Take the watch',
    screen: 'terminal/watch/',
    claims: [
      // 4.3, and the sentence the whole screen exists to make unmissable. Everything below
      // it looks like a safety monitor and is not one.
      'This app does not watch anybody. You do',
      'keeping it means looking',
      // Overdue nudges and does nothing else [invariant 3].
      'marked, and nothing else happens',
      // Invariant 2: only a human ends a Distress, and no button here closes one.
      'is not closed by answering it',
      // A new holder reading an empty board as "nobody is out" is the failure mode of
      // handover, and it is silent.
      'An empty board is not the same as nobody being out'
    ],
    control: '[data-start-watch]',
    requires: ['identity']
  },
  {
    name: 'Being on call',
    screen: 'terminal/on-call/',
    claims: [
      // The rule the whole app is built on, stated on the one screen that is an exception
      // to it. Somebody agreeing to be interrupted needs to know exactly how often.
      'This is the only notification NavCom ever sends',
      'The field terminal is silent and stays silent',
      // The page carries nothing from the wire, and the reason is worth saying.
      'The page carries no detail',
      'tells nobody'
    ],
    control: '#sender',
    needsPush: true,
    requires: []
  },
  {
    name: 'Resupply',
    screen: 'terminal/resupply/',
    claims: [
      // The decision, stated where somebody would otherwise expect a tally. Most apps would
      // count handouts here, and that is a feed and a leaderboard at once.
      'Nothing counts what you handed out',
      'a request, not a report',
      // Invariant 1, in the same words the Query screen uses.
      'Write about the supply, not the person',
      'pages nobody'
    ],
    control: '#r',
    requires: ['identity', 'watch']
  },
  {
    name: 'Standing',
    screen: 'terminal/standing/',
    claims: [
      // The property everything else follows from, stated before anything is written.
      'A credential names nobody',
      'no map of who knows whom exists anywhere',
      // The cost of not naming people, said in the same breath rather than discovered.
      'whoever holds the bytes can take it up',
      'There is no free text'
    ],
    control: '#cred',
    requires: ['identity']
  },
  {
    name: 'Backup and recovery',
    screen: 'terminal/backup/',
    claims: [
      // identity.md requires this be stated plainly, and it has to be read before somebody
      // needs it rather than after.
      'there is nobody to ask for your identity back',
      'a backup you never made does not exist',
      // The passphrase is the only control, so it must not read as ceremony.
      'Nothing can recover this if you forget it'
    ],
    control: '#rblob',
    requires: []
  },
  {
    name: 'Support',
    screen: 'terminal/funding/',
    claims: [
      // funding.md's rule 2, which is the one that would be quietly broken first.
      'Nothing here counts anything',
      'This app never touches money',
      // The cost that catches people out, stated before they enable anything.
      'Converting to cash usually is not'
    ],
    control: '#mine',
    requires: []
  },
  {
    name: 'Wipe this device',
    screen: 'terminal/wipe/',
    claims: [
      'Destroys tonight and keeps your identity',
      // Where a wipe stops is the part that changes what an operator does next.
      'The watch still has your board entry',
      'The accountability log is outside both tiers'
    ],
    // `panicWipe` is the original instance of a mechanism nobody can reach -- it had no
    // button for weeks. It is declared here so that can never be true silently again.
    control: '[data-act]',
    requires: ['identity']
  },
  {
    name: 'What the watch wrote',
    screen: 'terminal/log/',
    claims: [
      'The watch writes down what it does',
      // A response carries entries, proofs AND the root they are against, all three from
      // the watch. Verifying them against each other proves nothing.
      'marking its own homework',
      // The limit that survives every green tick above it, and the reason it is stated
      // before the record is fetched rather than after.
      'whether anything is missing',
      'nothing signs yet'
    ],
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
      'write about the need, not the person'
    ],
    control: '#q',
    requires: ['identity', 'watch']
  },
  {
    name: 'Assist',
    screen: 'terminal/assist/',
    claims: [
      'An assist with no words still means you need someone',
      'use Distress',
      // 5.3. An assist that was received and an assist nobody is answering must never look
      // alike, and the operator must be told which before they decide what to do next.
      'A watch that has nobody to send will say so'
    ],
    control: '#a',
    requires: ['identity', 'watch']
  }
];

/** Every distinct screen a capability lives on. */
export const CAPABILITY_SCREENS = [...new Set(CAPABILITIES.map((c) => c.screen))];
