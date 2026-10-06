/**
 * The cross-border marker, checked on the pages a reader actually receives.
 *
 * Read from `build/`, because this project has three times shipped a rule the logic honoured
 * and the output did not [verification.md]. The logic is tested in core; this asks whether a
 * person in Detroit looking at Windsor's shelter is told it is in Canada — on the record page,
 * on paper, in the region list, and in the landing page's search — and whether the El Paso
 * shelter that a drawn border would wrongly put in Mexico is left alone.
 *
 * The records named here are real. If the directory is corrected — Windsor moved into its own
 * region, say — these fixtures should move with it, and the failure will say which one.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BUILD = fileURLToPath(new URL('../../../build/', import.meta.url));

function page(path: string): string {
  const file = join(BUILD, path, 'index.html');
  if (!existsSync(file)) throw new Error(`${path} was not built`);
  return readFileSync(file, 'utf8');
}

function index(region: string): { id: string; abroad?: string }[] {
  const file = join(BUILD, 'console-index', `${region}.json`);
  if (!existsSync(file)) throw new Error(`console-index/${region}.json was not built`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

const WINDSOR = 'detroit-overture-3cd2bf71'; // Welcome Centre Shelter, 500 Tuscarora St, Windsor
const JUAREZ = 'el-paso-overture-f96a902d'; // Casa del Migrante en Juárez
const TIJUANA = 'san-diego-overture-aa114f65';
const EL_PASO_LOCAL = 'el-paso-overture-cac6e95b'; // Rescue Mission of El Paso — plots in Mexico at 1:50m

describe('a service across a border says so, everywhere it is shown', () => {
  it('on its own page', () => {
    const html = page(`directory/${WINDSOR}`);
    expect(html).toContain('data-abroad="CA"');
    expect(html).toContain('In Canada');
  });

  it('on paper, which cannot be corrected once it leaves somebody’s hand', () => {
    expect(page(`directory/${WINDSOR}`)).toMatch(/This service is in Canada<\/strong>, across an international\s+border from Detroit metro/);
  });

  it('for Mexico too, under both US regions that reach across', () => {
    expect(page(`directory/${JUAREZ}`)).toContain('data-abroad="MX"');
    expect(page(`directory/${TIJUANA}`)).toContain('data-abroad="MX"');
  });

  it('in the region list a person scrolls in Detroit', () => {
    expect(page('directory/area/detroit')).toContain(`data-abroad="CA"`);
  });

  it('in the landing page’s search, with the name ready to print', () => {
    const windsor = index('detroit').find((e) => e.id === WINDSOR);
    expect(windsor?.abroad).toBe('Canada');
    expect(index('el-paso').find((e) => e.id === JUAREZ)?.abroad).toBe('Mexico');
  });
});

describe('the failure that would be worse than the one being fixed', () => {
  it('never tells somebody an El Paso shelter is in Mexico', () => {
    // Its coordinates fall south of a generalised Rio Grande. Its number is Texan. Only the
    // number counts, so it must carry no marker anywhere.
    expect(page(`directory/${EL_PASO_LOCAL}`)).not.toContain('data-abroad');
    expect(index('el-paso').find((e) => e.id === EL_PASO_LOCAL)?.abroad).toBeUndefined();
  });

  it('says nothing about what crossing requires', () => {
    // One of these is a migrant shelter. A confident line about documents would be safety
    // guidance that is wrong for the person most likely to read it.
    for (const id of [WINDSOR, JUAREZ, TIJUANA]) {
      expect(page(`directory/${id}`)).not.toMatch(/passport|visa|enhanced (id|driver)|nexus/i);
    }
  });
});
