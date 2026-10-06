/**
 * Records filed under a region in one country that are, in fact, in another.
 *
 * Found on 2026-10-06, not reported: the `detroit` region held seven shelters in Windsor,
 * Ontario, `el-paso` held five services in Ciudad Juárez, and `san-diego` one in Tijuana. Their
 * coordinates were right. The importer drew a rectangle around each US city, and a rectangle
 * does not stop at a river. To somebody in Detroit, a shelter across an international border is
 * not a local option — and nothing on the page said so.
 *
 * ## Why the evidence is the phone number, and never the map
 *
 * The obvious test — is this point inside Canada's polygon? — is the wrong one, and was measured
 * as wrong before this was written. Every public basemap generalises borders, and border cities
 * sit on the line: at Natural Earth's 1:50m, **El Paso's own shelters fall inside Mexico**, and
 * at 1:10m twelve records are still drawn on the wrong side. A rule built on drawn borders would
 * tell somebody that the El Paso Rescue Mission is in another country, which is worse than the
 * problem it set out to fix.
 *
 * A phone number's country does not depend on anybody's drawing. North American area codes are
 * each assigned to exactly one country, and every other country has its own calling code. On the
 * real directory this rule flags exactly the thirteen cross-border records and none of the
 * border-city records that geometry gets wrong.
 *
 * ## What it says, and what it deliberately does not
 *
 * It states a fact and its evidence: *filed under this region, but its number is Canadian*. It
 * says **nothing about what crossing requires.** One of the thirteen is a migrant shelter, and for
 * somebody seeking asylum the honest answer to "what do I need to cross" is complicated enough
 * that a confident sentence would be the Medic's kill trigger — plausible safety guidance that is
 * wrong for the person most likely to read it.
 *
 * ## When it says nothing
 *
 * Whenever the evidence is weak, which is the safe direction: a claim that a local service is
 * abroad is far worse than a missed one. No phone, a toll-free or other non-geographic number, a
 * Caribbean number in the shared North American plan, a calling code not in the table below, or
 * a malformed number — all return `null`. Malformed matters most: several records carry North
 * American numbers missing their `+1`, so `+2693640566` (Benton Harbor, Michigan) reads as a
 * Comoros number. That is a data fault for `check:data` to report, not a shelter in Comoros.
 *
 * Normative source: docs/product/directory-schema.md
 */

/** Canadian area codes, including overlays, from the provincial tables. `743` is deliberately
 * absent: listed for Akwesasne but chiefly a North Carolina overlay, and including it would
 * flag North Carolina services as Canadian. */
const CANADIAN_NPAS = new Set(
  (
    '204 226 236 249 250 257 263 273 289 306 343 354 365 367 368 382 403 416 418 428 431 437 ' +
    '438 450 468 474 506 514 519 548 579 581 584 587 604 613 639 647 672 683 705 709 742 753 ' +
    '778 780 782 807 819 825 851 867 873 879 902 905 942'
  ).split(' ')
);

/** Countries sharing +1 that are neither the US nor Canada. A number here proves nothing about
 * which side of a US–Canada line a service is on, so it yields no verdict at all. */
const CARIBBEAN_NPAS = new Set(
  '242 246 264 268 284 345 441 473 649 658 664 721 758 767 784 809 829 849 868 869 876'.split(' ')
);

/**
 * Non-geographic North American codes: toll-free, premium, carrier and Canada's own. They say
 * where nothing is.
 *
 * Not "every 5XX". Most 5XX codes are geographic — 519 is Windsor, the case this module exists
 * for — and an early draft that excluded the whole series would have flagged none of it.
 */
const NON_GEOGRAPHIC = /^(8(00|33|44|55|66|77|88)|900|600|700)$/;

/** Calling codes this directory can meet, longest first so `+353` is not read as `+35`. */
const CALLING_CODES: [string, string][] = [
  ['353', 'IE'],
  ['44', 'GB'],
  ['52', 'MX'],
  ['61', 'AU'],
  ['64', 'NZ']
];

/** Everything filed as US shares the US's side of the plan, Puerto Rico included. */
const NANP_HOME: Record<string, string> = { US: 'US', PR: 'US', CA: 'CA' };

/**
 * The country a phone number belongs to, or `null` when it does not say.
 *
 * Expects E.164 (`+15199717595`), which is how the seed stores numbers. Anything without a
 * leading `+` is not guessed at.
 */
export function phoneCountry(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) return null;

  if (digits.startsWith('+1')) {
    if (digits.length !== 12) return null; // +1 and ten digits, or it is not a NANP number
    const npa = digits.slice(2, 5);
    if (NON_GEOGRAPHIC.test(npa) || CARIBBEAN_NPAS.has(npa)) return null;
    return CANADIAN_NPAS.has(npa) ? 'CA' : 'US';
  }

  for (const [code, country] of CALLING_CODES) {
    if (digits.startsWith(`+${code}`)) return country;
  }
  return null;
}

export interface Abroad {
  /** ISO 3166-1 alpha-2 of where the service actually is. */
  country: string;
  /** How we know. Only ever the phone number — see the module comment for why not the map. */
  evidence: 'phone';
}

/**
 * Whether a record is in a different country from the region it is filed under.
 *
 * `null` means "no evidence it is abroad", never "proven local".
 */
export function abroad(
  record: { phone?: string | null },
  regionCountry: string | null | undefined
): Abroad | null {
  const home = regionCountry ? (NANP_HOME[regionCountry] ?? regionCountry) : null;
  const found = phoneCountry(record.phone);
  if (!home || !found || found === home) return null;
  return { country: found, evidence: 'phone' };
}

/** How a country is named in a sentence. Small and explicit rather than locale-dependent. */
const COUNTRY_NAMES: Record<string, string> = {
  AU: 'Australia',
  CA: 'Canada',
  GB: 'the United Kingdom',
  IE: 'Ireland',
  MX: 'Mexico',
  NZ: 'New Zealand',
  US: 'the United States'
};

export const countryName = (code: string): string => COUNTRY_NAMES[code] ?? code;
