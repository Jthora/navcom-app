import { describe, expect, it } from 'vitest';
import { abroad, countryName, phoneCountry } from '../src/index.js';

/** Real numbers from the seed, so the tests are about the directory this runs on. */
const WINDSOR = '+15199717595'; // Welcome Centre Shelter, filed under `detroit`
const WINDSOR_226 = '+12262218464'; // Windsor Residence for Young Men
const EL_PASO = '+19155321122'; // a 915 number: Texas
const JUAREZ = '+526566870677'; // Casa del Migrante en Juárez, filed under `el-paso`
const TIJUANA = '+526642100302'; // filed under `san-diego`
const MISSING_PLUS_ONE = '+2693640566'; // Benton Harbor, MI — reads as Comoros as written

describe('the records this exists for', () => {
  it('flags Windsor, including the 519 code an early draft would have excluded', () => {
    expect(abroad({ phone: WINDSOR }, 'US')).toEqual({ country: 'CA', evidence: 'phone' });
    expect(abroad({ phone: WINDSOR_226 }, 'US')?.country).toBe('CA');
  });

  it('flags Juárez and Tijuana under their US regions', () => {
    expect(abroad({ phone: JUAREZ }, 'US')?.country).toBe('MX');
    expect(abroad({ phone: TIJUANA }, 'US')?.country).toBe('MX');
  });
});

describe('the failure that would be worse than the problem', () => {
  it('never calls a border city abroad because a drawn border puts it there', () => {
    // At 1:50m the El Paso Rescue Mission plots inside Mexico. Its number is Texan, and the
    // number is the only evidence this module accepts.
    expect(abroad({ phone: EL_PASO }, 'US')).toBeNull();
  });

  it('does not turn a malformed number into a foreign country', () => {
    // A North American number missing its +1 reads as Comoros. That is a data fault for
    // check:data, not a shelter in Comoros.
    expect(phoneCountry(MISSING_PLUS_ONE)).toBeNull();
    expect(abroad({ phone: MISSING_PLUS_ONE }, 'US')).toBeNull();
  });

  it('says nothing when the number says nothing about place', () => {
    expect(abroad({ phone: '+18005551234' }, 'US')).toBeNull(); // toll-free
    expect(abroad({ phone: '+18765551234' }, 'US')).toBeNull(); // Jamaica, shared +1
    expect(abroad({ phone: '555-1234' }, 'US')).toBeNull(); // not E.164, not guessed at
    expect(abroad({ phone: '' }, 'US')).toBeNull();
    expect(abroad({}, 'US')).toBeNull();
    expect(abroad({ phone: WINDSOR }, null)).toBeNull(); // no region country, no verdict
  });

  it('leaves 743 out, because it is chiefly North Carolina', () => {
    expect(phoneCountry('+17435551234')).toBe('US');
  });
});

describe('home is home', () => {
  it('treats Puerto Rico and every other US-filed region as the US side of the plan', () => {
    expect(abroad({ phone: '+17875551234' }, 'US')).toBeNull();
    expect(abroad({ phone: '+17875551234' }, 'PR')).toBeNull();
  });

  it('works outside North America', () => {
    expect(abroad({ phone: '+442071234567' }, 'GB')).toBeNull();
    expect(abroad({ phone: '+35312345678' }, 'GB')?.country).toBe('IE');
    expect(abroad({ phone: '+61391234567' }, 'AU')).toBeNull();
  });

  it('names countries the way a sentence needs them', () => {
    expect(countryName('CA')).toBe('Canada');
    expect(countryName('MX')).toBe('Mexico');
    expect(countryName('GB')).toBe('the United Kingdom');
  });
});
