/**
 * A line you scribble about a place, on the phone, for yourself.
 *
 * You learn that a shelter shut intake at 20:30 while standing outside it in the rain, one
 * hand on the phone, gloves on. You cannot pick a field and choose an enum value in that
 * moment, and a correction you meant to make later is a correction that never happens.
 *
 * So: capture cold, correct warm. Jot the line now; turn it into a correction when you are
 * somewhere with light and both hands.
 *
 * ## It goes nowhere
 *
 * Never transmitted, never published, never seen by a peer or a watch. It is a note to
 * yourself about a place, and the moment it stops being that is the moment it should have
 * become a correction instead.
 *
 * ## Wipeable, deliberately
 *
 * The riskiest free text in the whole system is written here — in the field, in a hurry,
 * about something that just happened, which is exactly the situation where a line about a
 * *person* gets written despite every rule saying not to [invariant 1].
 *
 * So a note lives in the tier a panic wipe destroys. Losing an un-promoted note to a wipe is
 * the correct trade: a wipe exists for the night when losing tonight is the point, and a
 * scribble that survived it would be the one thing that did.
 */

import { get, set } from './storage';

const FIELD = 'record_notes';

/**
 * A note, and enough about the place to get back to it.
 *
 * The Status screen said *"N waiting — jotted, not yet corrections"* and offered **no way to
 * reach them**. An operator had to remember which of sixty-eight areas each note belonged to,
 * open the directory, find the record and correct it from memory — so in practice the note
 * never became a correction, which is one reason the whole directory holds exactly one
 * `in_person` check.
 *
 * The region and the name are both free at the moment of jotting: the screen writing the note
 * is the record's own. Nothing else is stored, and nothing here is ever transmitted.
 */
export interface Note {
  text: string;
  /** The area this record is in, so Status can offer a way back to it. */
  region?: string;
  /** The place's own name, so the way back is readable rather than an id. */
  name?: string;
}

/** What is on disk. Older notes are bare strings and are still read. */
type Stored = Record<string, string | Note>;
type Notes = Record<string, Note>;

/**
 * Reads tolerantly, because the shape changed after notes already existed.
 *
 * A note lives in the wipeable tier and is a thing somebody wrote in the rain. Dropping the
 * ones written before this change would be losing exactly the material this whole mechanism
 * is for, so a bare string still reads — it simply has no way back, and the screen says so
 * rather than hiding it.
 */
export function notes(): Notes {
  const raw = get<Stored>('wipeable', FIELD) ?? {};
  const out: Notes = {};
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[id] = { text: value };
    else if (value && typeof value.text === 'string') out[id] = value;
  }
  return out;
}

/** What you wrote about one place, or null. */
export function noteFor(recordId: string): string | null {
  return notes()[recordId]?.text ?? null;
}

/**
 * Keeps a note, or clears it when the text is empty.
 *
 * One note per record rather than a list: this is a reminder, not a log. A second thought
 * about the same place replaces the first, because by the time there are two you should be
 * writing a correction.
 */
export function keepNote(recordId: string, text: string, about?: { region?: string; name?: string }): void {
  const all = { ...notes() };
  const clean = text.trim();
  if (clean) {
    all[recordId] = {
      text: clean,
      // Kept from the previous note when this caller does not know them, so re-editing a
      // note from somewhere with less context cannot strip its way back.
      ...(about?.region ?? all[recordId]?.region ? { region: about?.region ?? all[recordId]?.region } : {}),
      ...(about?.name ?? all[recordId]?.name ? { name: about?.name ?? all[recordId]?.name } : {})
    };
  } else delete all[recordId];
  set('wipeable', FIELD, all);
}

export function clearNote(recordId: string): void {
  keepNote(recordId, '');
}
