/**
 * Machine-readable directory export.
 *
 * Consumed by anything that is not this website — the watch state machine answering
 * `Query`, an agent looking something up, a field terminal filling its offline cache.
 *
 * The important property: **the verdicts travel with the data.** A consumer receives the
 * already-computed display decision for every field, not raw rows it would have to run
 * the staleness rules over itself. A second implementation of those rules is a second
 * place for them to drift, and the failure that drift produces is a confident wrong
 * answer at 10pm — the exact thing the schema exists to prevent.
 *
 * Also carries a ready-made `provenance` object per record, shaped to what
 * docs/spec/signals.spec.md requires on any directory-derived `20912` answer.
 */

import { abroad, type Abroad } from './abroad.js';
import { confidenceForClass, isSeeded } from './confidence.js';
import { displayField, formatDate } from './display.js';
import type { Region } from './region.js';
import type { Confidence, ResourceField, ResourceRecord, VolatilityClass } from './types.js';
import { FIELD_CLASS, STALE_AFTER_DAYS, STALENESS_MARGIN_DAYS } from './volatility.js';

/** Bump when the shape changes in a way a consumer must notice. */
export const EXPORT_VERSION = 1;

export type FieldVerdict =
  | { display: 'unknown' }
  | { display: 'call-first'; confidence: Confidence; reason: 'stale' | 'flagged' }
  | { display: 'value'; values: string[]; confidence: Confidence; verified: string | null };

export interface ExportedRecord {
  id: string;
  /** Which region's folder this came from. */
  region: string | null;
  name: string;
  type: string;
  flag: string;
  /** From a public listing rather than checked by a person [C21]. */
  seeded: boolean;
  last_verified: string | null;
  verified_by: string | null;
  method: string | null;
  /** Confidence per volatility class — staleness is per field-group, not per record. */
  confidence: Record<VolatilityClass, Confidence>;
  /** Every field's already-decided rendering. Do not recompute these. */
  fields: Record<string, FieldVerdict>;
  /** Attach verbatim to a 20912 answer derived from this record [signals.spec]. */
  provenance: { record_id: string; verified: string | null; method: string | null };
  notes: string | null;
  /**
   * Set when the service is in a different country from the region it is filed under — the
   * Windsor shelters in `detroit`, the Juárez services in `el-paso`. `null` means no evidence it
   * is abroad, not proof that it is local. See `abroad.ts` for why the evidence is the phone
   * number and never a drawn border.
   */
  abroad: Abroad | null;
}

export interface DirectoryExport {
  version: number;
  /**
   * Every region present, with the context its rows inherit — country, IANA timezone, and
   * whether anyone has actually checked the data. `hours` and `curfew` are local times and
   * are meaningless without this.
   */
  regions: Region[];
  /** When the verdicts below were computed. They are only as fresh as this. */
  built_at: string;
  /**
   * Verdicts were computed against built_at PLUS this many days, so a consumer serving a
   * slightly old copy still errs toward "call first" rather than toward a stale value.
   */
  staleness_margin_days: number;
  stale_after_days: Record<VolatilityClass, number>;
  /**
   * How a consumer must treat each verdict. Stated in the payload so it cannot be missed
   * by someone who never read the schema.
   */
  contract: string[];
  count: number;
  records: ExportedRecord[];
}

const ALL_FIELDS = Object.entries(FIELD_CLASS)
  .filter(([, cls]) => cls !== null)
  .map(([field]) => field as ResourceField);

const CLASSES: VolatilityClass[] = ['static', 'slow', 'seasonal', 'volatile'];

function verdictOf(record: ResourceRecord, field: ResourceField, now: Date): FieldVerdict {
  const d = displayField(record, field, now);
  if (d.kind === 'unknown') return { display: 'unknown' };
  if (d.kind === 'call-first') {
    return {
      display: 'call-first',
      confidence: d.confidence,
      reason: d.confidence === 'suspect' ? 'flagged' : 'stale'
    };
  }
  return {
    display: 'value',
    values: d.values,
    confidence: d.confidence,
    verified: d.age ? d.age.iso : null
  };
}

export function buildExport(
  records: ResourceRecord[],
  now: Date,
  regions: Region[] = []
): DirectoryExport {
  // Built once: a find() per record would be records × regions comparisons on every build.
  const countryOf = new Map(regions.map((r) => [r.slug, r.country]));
  return {
    version: EXPORT_VERSION,
    regions,
    built_at: now.toISOString(),
    staleness_margin_days: STALENESS_MARGIN_DAYS,
    stale_after_days: STALE_AFTER_DAYS,
    contract: [
      'Do not recompute confidence. Use the verdicts as given.',
      'display=call-first means the value is withheld deliberately. It is not missing data, and the underlying value is not included here. Answer "call first".',
      'display=unknown means nobody has confirmed it. It never means "no restriction".',
      'seeded=true means a public listing nobody has checked. Present it as visibly less trustworthy [C21].',
      'Attach `provenance` to any 20912 answer derived from a record. An answer without it must render as unverified [signals.spec].',
      'These verdicts were computed at built_at. If this copy is older than staleness_margin_days, refetch rather than serving it.',
      'hours and curfew are local times. Resolve them against the timezone of the record\'s region, listed in `regions`.',
      'A region with status=seeded has been checked by nobody. Say so when presenting its rows.',
      'abroad means the service is in a different country from its region. Say which country whenever you present it. Do not add advice about crossing a border: what crossing requires depends on who is crossing.'
    ],
    count: records.length,
    records: records.map((record) => {
      const country = (record.region && countryOf.get(record.region)) || null;
      const confidence = Object.fromEntries(
        CLASSES.map((cls) => [cls, confidenceForClass(record, cls, now)])
      ) as Record<VolatilityClass, Confidence>;

      return {
        id: record.id,
        region: record.region ?? null,
        name: record.name,
        type: record.type,
        flag: record.flag,
        seeded: isSeeded(record),
        last_verified: record.last_verified ?? null,
        verified_by: record.verified_by ?? null,
        method: record.method ?? null,
        confidence,
        fields: Object.fromEntries(
          ALL_FIELDS.map((f) => [f, verdictOf(record, f, now)])
        ),
        provenance: {
          record_id: record.id,
          verified: record.last_verified ?? null,
          method: record.method ?? null
        },
        notes: record.notes ?? null,
        abroad: abroad(record, country)
      };
    })
  };
}

/** Human-facing age string, for consumers that render one. */
export { formatDate };
