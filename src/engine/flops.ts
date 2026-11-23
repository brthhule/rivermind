// Strategically distinct flops (suit isomorphism) and texture labels.
import { RANKS, rankOf, suitOf } from './cards';

export interface FlopClass { cards: number[]; weight: number; key: string }

/** Canonical key: ranks high to low + suit pattern, so isomorphic flops share a key. */
export function flopKey(cards: number[]): string {
  const cs = [...cards].sort((a, b) => rankOf(b) - rankOf(a) || suitOf(a) - suitOf(b));
  // relabel suits in order of first appearance, trying all orderings of equal ranks
  const perms = (arr: number[]): number[][] => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])));
  let best = '';
  for (const p of perms(cs)) {
    if (p.some((c, i) => i > 0 && rankOf(c) > rankOf(p[i - 1]))) continue;
    const map = new Map<number, number>();
    const k = p.map((c) => { if (!map.has(suitOf(c))) map.set(suitOf(c), map.size); return RANKS[rankOf(c)] + 'abcd'[map.get(suitOf(c))!]; }).join('');
    if (!best || k < best) best = k;
  }
  return best;
}

let all: FlopClass[] | null = null;
export function allFlops(): FlopClass[] {
  if (all) return all;
  const m = new Map<string, FlopClass>();
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++) {
    const k = flopKey([a, b, c]);
    const f = m.get(k);
    if (f) f.weight++;
    else m.set(k, { cards: [c, b, a].sort((x, y) => rankOf(y) - rankOf(x)), weight: 1, key: k });
  }
  all = [...m.values()].sort((x, y) => {
    for (let i = 0; i < 3; i++) { const d = rankOf(y.cards[i]) - rankOf(x.cards[i]); if (d) return d; }
    return x.key.localeCompare(y.key);
  });
  return all;
}

/** An evenly spread subset of n flops, each carrying the weight of the flops it stands for. */
export function flopSubset(n: number): FlopClass[] {
  const f = allFlops();
  if (n >= f.length) return f;
  const out: FlopClass[] = [];
  const total = f.reduce((s, x) => s + x.weight, 0);
  // walk the sorted list in equal-weight buckets and take the middle flop of each
  let acc = 0, bucket = 0, cur: FlopClass[] = [];
  for (const x of f) {
    cur.push(x);
    acc += x.weight;
    if (acc >= ((bucket + 1) * total) / n || x === f[f.length - 1]) {
      const pick = cur[Math.floor(cur.length / 2)];
      out.push({ ...pick, weight: cur.reduce((s, y) => s + y.weight, 0) });
      cur = [];
      bucket++;
    }
  }
  return out;
}

export function texture(cards: number[]) {
  const suits = new Set(cards.map(suitOf)).size;
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const paired = new Set(ranks).size < 3;
  const span = ranks[0] - ranks[2];
  const wheelish = ranks[0] === 12 && ranks[1] <= 3;
  const connected = !paired && (span <= 4 || (wheelish && ranks[1] - ranks[2] <= 3));
  return {
    suit: suits === 1 ? 'Monotone' : suits === 2 ? 'Two-tone' : 'Rainbow',
    paired,
    connected,
    high: RANKS[ranks[0]],
  };
}
