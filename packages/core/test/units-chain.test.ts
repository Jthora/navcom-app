import { describe, expect, it } from 'vitest';
import { ancestorsOf, isConcurrent, linearize, tipsOf, type Parents } from '../src/units/chain.js';

/**
 * Order from parent links alone. Hand-built DAGs, where the ids are letters so a failure reads.
 *
 *        root
 *        /  \
 *       a    b
 *       |    |\
 *       c    d e      e names `a`'s parent (root) and b: posted on a stale prev
 *        \  /
 *         f
 */
const dag = (): Map<string, string[]> =>
  new Map([
    ['a', ['root']],
    ['b', ['root']],
    ['c', ['a']],
    ['d', ['b']],
    ['e', ['b', 'root']],
    ['f', ['c', 'd']]
  ]);

const shuffle = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

describe('failure paths', () => {
  it('ends on a cycle, which hash links make impossible but a hostile map can claim', () => {
    const p = new Map([['x', ['y']], ['y', ['x']]]);
    expect([...ancestorsOf('x', p)].sort()).toEqual(['y']);
    // Neither is ever ready, so a cycle places nothing rather than looping.
    expect(linearize(['x', 'y'], p, () => 0)).toEqual([]);
  });

  it('treats a parent with no entry as a root, not an error', () => {
    const p = new Map([['x', ['unheld']]]);
    expect([...ancestorsOf('x', p)]).toEqual(['unheld']);
    expect(linearize(['x'], p, () => 0)).toEqual(['x']);
  });
});

describe('ancestry and concurrency', () => {
  it('includes every ancestor and not the act itself', () => {
    const p = dag();
    expect([...ancestorsOf('f', p)].sort()).toEqual(['a', 'b', 'c', 'd', 'root']);
    expect(ancestorsOf('f', p).has('f')).toBe(false);
    expect([...ancestorsOf('e', p)].sort()).toEqual(['b', 'root']);
  });

  it('memoises per map, and a fresh map is computed afresh', () => {
    const p = dag();
    expect(ancestorsOf('f', p)).toBe(ancestorsOf('f', p));
    const q = dag();
    q.set('f', ['c']);
    expect(ancestorsOf('f', q).has('d')).toBe(false);
  });

  it('calls acts concurrent when neither descends from the other, stale prev included', () => {
    const p = dag();
    const anc = (id: string) => ancestorsOf(id, p);
    expect(isConcurrent('a', 'b', anc)).toBe(true);
    expect(isConcurrent('c', 'e', anc)).toBe(true);
    // e names root, an ancestor of a; that does not make it a's sibling or its descendant.
    expect(isConcurrent('a', 'e', anc)).toBe(true);
    expect(isConcurrent('a', 'f', anc)).toBe(false);
    expect(isConcurrent('d', 'f', anc)).toBe(false);
    expect(isConcurrent('f', 'f', anc)).toBe(false);
  });

  it('finds the tips', () => {
    expect(tipsOf(['a', 'b', 'c', 'd', 'e', 'f'], dag())).toEqual(['e', 'f']);
    expect(tipsOf(['a', 'b'], dag())).toEqual(['a', 'b']);
  });
});

describe('linearize', () => {
  it('places parents first', () => {
    const p = dag();
    const out = linearize(['a', 'b', 'c', 'd', 'e', 'f'], p, () => 0);
    for (const [id, ps] of p) for (const q of ps) if (out.includes(q)) expect(out.indexOf(q)).toBeLessThan(out.indexOf(id));
  });

  it('does not depend on the order it is handed the acts', () => {
    const p = dag();
    const classOf = (id: string) => ({ a: 3, b: 1, c: 0, d: 2, e: 1, f: 0 })[id] ?? 0;
    const first = linearize(['a', 'b', 'c', 'd', 'e', 'f'], p, classOf);
    for (let i = 0; i < 50; i++) expect(linearize(shuffle(['a', 'b', 'c', 'd', 'e', 'f']), p, classOf)).toEqual(first);
  });

  it('orders concurrent acts by class before id, and by id only within a class', () => {
    const p: Parents = new Map([['z', ['root']], ['y', ['root']], ['x', ['root']]]);
    expect(linearize(['x', 'y', 'z'], p, (id) => ({ x: 2, y: 0, z: 1 })[id]!)).toEqual(['y', 'z', 'x']);
    expect(linearize(['x', 'y', 'z'], p, () => 4)).toEqual(['x', 'y', 'z']);
  });

  it('never lets class jump causality', () => {
    // b descends from a, so a goes first even though b's class is lower.
    const p = new Map([['a', ['root']], ['b', ['a']]]);
    expect(linearize(['a', 'b'], p, (id) => (id === 'a' ? 5 : 0))).toEqual(['a', 'b']);
  });

  it('treats parents outside the set as already placed', () => {
    expect(linearize(['c', 'f'], dag(), () => 0)).toEqual(['c', 'f']);
  });
});
