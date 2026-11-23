// Card encoding: card = rank * 4 + suit, rank 0..12 (2..A), suit 0..3 (c,d,h,s)
export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];

export const rankOf = (c: number) => c >> 2;
export const suitOf = (c: number) => c & 3;

export function parseCard(s: string): number {
  const r = RANKS.indexOf(s[0].toUpperCase());
  const su = SUITS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error(`Bad card: ${s}`);
  return r * 4 + su;
}

export function cardStr(c: number): string {
  return RANKS[rankOf(c)] + SUITS[suitOf(c)];
}

export function parseCards(s: string): number[] {
  const clean = s.replace(/[^2-9tjqkaTJQKA cdhsCDHS]/g, '').replace(/\s+/g, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseCard(clean.slice(i, i + 2)));
  if (new Set(out).size !== out.length) throw new Error('Duplicate cards');
  return out;
}

// 13x13 grid labels. Row i, col j, ranks listed high to low (A first).
// i === j pair; i < j suited (upper right); i > j offsuit.
export const GRID_RANKS = 'AKQJT98765432';
export const HAND_CLASSES: string[] = [];
for (let i = 0; i < 13; i++) {
  for (let j = 0; j < 13; j++) {
    const a = GRID_RANKS[i];
    const b = GRID_RANKS[j];
    if (i === j) HAND_CLASSES.push(a + b);
    else if (i < j) HAND_CLASSES.push(a + b + 's');
    else HAND_CLASSES.push(b + a + 'o');
  }
}
export const CLASS_INDEX = new Map(HAND_CLASSES.map((h, i) => [h, i]));

export function classCombos(label: string): [number, number][] {
  const r1 = RANKS.indexOf(label[0]);
  const r2 = RANKS.indexOf(label[1]);
  const out: [number, number][] = [];
  if (label.length === 2) {
    for (let s1 = 0; s1 < 4; s1++) for (let s2 = s1 + 1; s2 < 4; s2++) out.push([r1 * 4 + s1, r2 * 4 + s2]);
  } else if (label[2] === 's') {
    for (let s = 0; s < 4; s++) out.push([r1 * 4 + s, r2 * 4 + s]);
  } else {
    for (let s1 = 0; s1 < 4; s1++) for (let s2 = 0; s2 < 4; s2++) if (s1 !== s2) out.push([r1 * 4 + s1, r2 * 4 + s2]);
  }
  return out;
}

export function comboCount(label: string): number {
  return label.length === 2 ? 6 : label[2] === 's' ? 4 : 12;
}

/** Hand class label for two hole cards. */
export function classOf(c1: number, c2: number): string {
  let a = c1, b = c2;
  if (rankOf(b) > rankOf(a)) [a, b] = [b, a];
  const ra = RANKS[rankOf(a)], rb = RANKS[rankOf(b)];
  if (ra === rb) return ra + rb;
  return ra + rb + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

/** Unique combo id 0..1325 for an unordered pair of cards. */
export function comboId(c1: number, c2: number): number {
  const hi = Math.max(c1, c2), lo = Math.min(c1, c2);
  return (hi * (hi - 1)) / 2 + lo;
}

export function comboStr(c1: number, c2: number): string {
  if (rankOf(c2) > rankOf(c1) || (rankOf(c2) === rankOf(c1) && c2 > c1)) [c1, c2] = [c2, c1];
  return cardStr(c1) + cardStr(c2);
}

export function fullDeck(): number[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** Small fast PRNG (mulberry32) so drills and Monte Carlo can be seeded. */
export function rng(seed = Date.now() >>> 0) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
