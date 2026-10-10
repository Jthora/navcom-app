/**
 * Order in a unit's chain: ancestry, concurrency and one fixed linear order, from parent links alone.
 *
 * **Needs outside review before any screen uses it**, with the evaluator that relies on it. It
 * knows nothing about governance, so it can be read and tested on its own.
 *
 * ## Order comes only from parent links
 *
 * Every act names the acts it was built on (`prev`). That is the only order there is. A claimed
 * time can be written to be anything, and an array's position is whatever a relay or a phone
 * happened to hand over, so neither ever decides what came first.
 *
 * Two acts are **concurrent** when neither is in the other's ancestry. That includes an act
 * deliberately posted on a stale `prev`, so the rules that settle crossing acts are written in terms
 * of concurrency, not of two acts naming the same parent.
 *
 * ## One linear order, for applying effects
 *
 * {@link linearize} is Kahn's algorithm: of the acts whose parents are all placed, it places the
 * smallest by (class, id). The class orders acts with no causal relation between them. The id only
 * orders acts of one class whose effects commute (the evaluator says why for each class), so a ground
 * id never decides who is in.
 */

/** Parent links: act id → the ids it names. An id with no entry is a root, or not held. */
export type Parents = ReadonlyMap<string, readonly string[]>;

const memo = new WeakMap<Parents, Map<string, ReadonlySet<string>>>();

/**
 * Every id `id` descends from, not including itself. Ids named as parents are included whether or
 * not they have entries of their own. Memoised per `parents` map.
 */
export function ancestorsOf(id: string, parents: Parents): ReadonlySet<string> {
  let cache = memo.get(parents);
  if (!cache) {
    cache = new Map();
    memo.set(parents, cache);
  }
  const hit = cache.get(id);
  if (hit) return hit;

  // Iterative post-order, so a long chain cannot overflow the stack; a visited set, so even a
  // malformed map with a cycle ends.
  const order: string[] = [];
  const seen = new Set<string>();
  const stack: [string, boolean][] = [[id, false]];
  while (stack.length > 0) {
    const [node, done] = stack.pop()!;
    if (done) {
      order.push(node);
      continue;
    }
    if (seen.has(node)) continue;
    seen.add(node);
    stack.push([node, true]);
    for (const p of parents.get(node) ?? []) if (!seen.has(p) && !cache.has(p)) stack.push([p, false]);
  }
  for (const node of order) {
    if (cache.has(node)) continue;
    const set = new Set<string>();
    for (const p of parents.get(node) ?? []) {
      set.add(p);
      for (const a of cache.get(p) ?? []) set.add(a);
    }
    set.delete(node);
    cache.set(node, set);
  }
  return cache.get(id)!;
}

/** Neither is in the other's ancestry. An act is never concurrent with itself. */
export function isConcurrent(a: string, b: string, anc: (id: string) => ReadonlySet<string>): boolean {
  return a !== b && !anc(a).has(b) && !anc(b).has(a);
}

/**
 * The acts in `ids` in one fixed order: parents first, and among acts that are ready together the
 * smallest (class, id). Parents outside `ids` count as already placed. The result does not depend
 * on the order `ids` arrives in.
 */
export function linearize(ids: Iterable<string>, parents: Parents, classOf: (id: string) => number): string[] {
  const set = new Set(ids);
  const waiting = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const id of set) {
    const inside = [...new Set(parents.get(id) ?? [])].filter((p) => set.has(p) && p !== id);
    waiting.set(id, inside.length);
    for (const p of inside) {
      const list = children.get(p);
      if (list) list.push(id);
      else children.set(p, [id]);
    }
  }
  const before = (a: string, b: string): boolean => {
    const ca = classOf(a);
    const cb = classOf(b);
    return ca !== cb ? ca < cb : a < b;
  };
  const ready = [...set].filter((id) => waiting.get(id) === 0);
  const out: string[] = [];
  while (ready.length > 0) {
    let best = 0;
    for (let i = 1; i < ready.length; i++) if (before(ready[i]!, ready[best]!)) best = i;
    const id = ready.splice(best, 1)[0]!;
    out.push(id);
    for (const c of children.get(id) ?? []) {
      const left = waiting.get(c)! - 1;
      waiting.set(c, left);
      if (left === 0) ready.push(c);
    }
  }
  return out;
}

/** The acts in `ids` that no other act in `ids` names as a parent, sorted. */
export function tipsOf(ids: Iterable<string>, parents: Parents): string[] {
  const set = new Set(ids);
  const named = new Set<string>();
  for (const id of set) for (const p of parents.get(id) ?? []) named.add(p);
  return [...set].filter((id) => !named.has(id)).sort();
}
