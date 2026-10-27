/**
 * Where somebody said they work: one Sector, kept on this phone and nowhere else [the owner's map
 * decision D7].
 *
 * In the Wipeable tier, so a panic wipe takes it [invariant 5]: where a person goes is tonight's,
 * however large the area. Never published, never sent, never in a backup [terminal/fields.ts].
 *
 * Only from a final partition (D6): a draft's ids may change before Starcom's swap, and a Sector kept
 * under an id that went would be a place that is no longer anywhere. Kept with the manifest it came
 * from, so a later stage can say whether the id still stands.
 */

import { get, set, clearField } from '$lib/terminal/storage';

export interface WorkSector {
  id: string;
  name: string;
  zone: string;
  /** Its Zone's and its Terra or Mare's names, for the card to offer them by: absent on one kept before 2026-10-27. */
  zoneName?: string;
  container: string;
  containerName?: string;
  /** The manifest's sha256 the Sector was chosen from. */
  manifest: string;
}

export const workSector = (): WorkSector | null => get<WorkSector>('wipeable', 'work_sector');
export const keepWork = (w: WorkSector): boolean => set('wipeable', 'work_sector', w);
export const forgetWork = (): void => clearField('wipeable', 'work_sector');
