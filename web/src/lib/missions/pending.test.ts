import { describe, expect, it } from 'vitest';
import { backTo } from './pending';

describe('the way back to a mission, named on a button', () => {
  it('names a short title whole', () => {
    expect(backTo({ address: 'a', title: 'Heat relief' })).toBe('Back to Heat relief');
  });

  it('drops a trailing aside before cutting anything', () => {
    expect(backTo({ address: 'a', title: 'Heat relief: California (124 forecast areas)' })).toBe('Back to Heat relief: California');
  });

  it('cuts a long title at a word, never inside one', () => {
    const named = backTo({ address: 'a', title: 'Cooling centre supply run for the whole eastern valley' });
    expect(named).toBe('Back to Cooling centre supply run for…');
    expect(named.length).toBeLessThanOrEqual('Back to '.length + 33);
  });

  it('says "the mission" when no title was kept', () => {
    expect(backTo({ address: 'a', title: null })).toBe('Back to the mission');
    expect(backTo({ address: 'a', title: '  ' })).toBe('Back to the mission');
  });
});
