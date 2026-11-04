/**
 * The playbook: what to press, and who the city says to call, for the nights a patrol meets most.
 *
 * The owner, 2026-11-03: "perhaps a playbook is a good idea", with no named people. Written by an agent
 * under two limits that keep the reason for `CLAUDE.md`'s rule standing — the Medic's kill trigger is
 * confident wrong guidance, and plausible-sounding safety content is worse than none:
 *
 * - **NavCom's own controls**, which this repository is the authority on, and nothing else of ours.
 * - **What a public authority says, in its words**, with the page it says it on and the day somebody
 *   read it there. Never a technique for a person's body: no first aid, no cold injury care, no
 *   overdose response. Those are taught by people who can be asked questions, and linked, not written.
 *
 * A step with a source is volatile data and shows its age [invariant 7]: `playbook.test.ts` fails the
 * build once one is older than `STALE_AFTER_DAYS`, the community list's own rule, so a city's routing
 * that changed is never repeated here as if it had not. No step names a person [invariant 6], and
 * none tells anybody what to do to somebody being served [invariant 1].
 */

export interface Source {
  /** Who says it, as they name themselves. */
  by: string;
  url: string;
  /** ISO date somebody last read it there. */
  checked: string;
}

export interface Step {
  /** One thing to do, in plain words. */
  say: string;
  /** Where it comes from, when it is not NavCom's own. */
  source?: Source;
}

export interface Play {
  id: string;
  /** The situation, as somebody in it would put it. */
  title: string;
  steps: Step[];
}

/** The community list's rule, for the same reason: a page that rots is worse than none [community.ts]. */
export const STALE_AFTER_DAYS = 180;

const NYC_311_OUTREACH: Source = {
  by: 'NYC 311, Homeless Outreach Assistance',
  url: 'https://portal.311.nyc.gov/article/?kanumber=KA-01037',
  checked: '2026-11-03'
};

const BAD_JACKETING: Source = { by: 'Wikipedia, Bad-jacketing', url: 'https://en.wikipedia.org/wiki/Bad-jacketing', checked: '2026-11-03' };

const SIMPLE_SABOTAGE: Source = { by: 'CIA, The Art of Simple Sabotage', url: 'https://www.cia.gov/stories/story/the-art-of-simple-sabotage/', checked: '2026-11-03' };

export const PLAYS: readonly Play[] = [
  {
    id: 'cold-night',
    title: 'Somebody needs somewhere warm on a cold night in New York',
    steps: [
      { say: 'The City follows Code Blue when it is 32°F or lower, wind chill included.', source: NYC_311_OUTREACH },
      { say: 'Somebody on the tracks, in danger, or who needs medical help: call 911.', source: NYC_311_OUTREACH },
      { say: 'Ask the watch on Query. Go there, beside the answer, opens the place it names; Directions hands it to your map app.' },
      { say: 'Call the place before you walk anybody there. The directory says when a listing was last checked.' },
      { say: 'Or ask 311 for homeless outreach, and the City sends a team.', source: NYC_311_OUTREACH }
    ]
  },
  {
    id: 'no-signal',
    title: 'No signal, or your phone locks',
    steps: [
      { say: 'A locked phone pauses NavCom, and a locked iPhone sends nothing. Open it to check in.' },
      { say: 'Distress keeps sending only while its screen is open. If you added your person, it also opens a text to them, which goes when data does not.' },
      { say: 'The areas you carried in Cached directory still open, and the streets you saved still draw.' },
      { say: 'Answers are not kept. If one never came, ask again once you have signal.' }
    ]
  },
  {
    id: 'register-first',
    title: 'Somebody says you must register with them before you can go out',
    steps: [
      { say: 'Nobody can require it. NavCom keeps no list of members to be on, and going out needs nobody’s permission.' },
      { say: 'A watch is your choice, from a code somebody gives you, and you can go out under none.' },
      { say: 'Before you sign on, NavCom names who holds the watch you chose, so you know who is behind you.' }
    ]
  },
  {
    id: 'rumour',
    title: 'Somebody says another operator is a fake, a fed or an informer',
    steps: [
      { say: 'NavCom has no field for it, and never will: no flag, no warning, no list of suspects.' },
      { say: 'Spreading false suspicion that a real member is an informer or a fed has a name, bad-jacketing, and the FBI used it in COINTELPRO.', source: BAD_JACKETING },
      { say: 'Two people can share a callsign, never a key. Ask for the start of theirs where you already know them, and compare.' }
    ]
  },
  {
    id: 'committees',
    title: 'Every decision has to go to one more committee',
    steps: [
      { say: 'Referring everything to committees for “further study and consideration”, as large as possible, is how the OSS taught sabotage in the Second World War.', source: SIMPLE_SABOTAGE }
    ]
  }
];
