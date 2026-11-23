import { CLASS_INDEX, GRID_RANKS, HAND_CLASSES, RANKS, classCombos, comboCount, comboId } from './cards';

/** A range is a weight 0..1 for each of the 169 hand classes, indexed like HAND_CLASSES. */
export type Range = number[];

export const emptyRange = (): Range => new Array(169).fill(0);
export const fullRange = (): Range => new Array(169).fill(1);

const rIdx = (ch: string) => RANKS.indexOf(ch.toUpperCase());
const label = (hi: number, lo: number, kind: '' | 's' | 'o') =>
  hi === lo ? RANKS[hi] + RANKS[hi] : RANKS[hi] + RANKS[lo] + kind;

function setLabel(r: Range, l: string, w: number) {
  if (l.length === 3 || l[0] === l[1]) {
    const i = CLASS_INDEX.get(l);
    if (i !== undefined) r[i] = w;
  } else {
    // "AK" means both suited and offsuit
    setLabel(r, l + 's', w);
    setLabel(r, l + 'o', w);
  }
}

/** Parse ranges like "AA-TT, AKs, A5s-A2s, KQo+, 77+, T9s:0.5". */
export function parseRange(text: string): Range {
  const r = emptyRange();
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  for (const tokRaw of tokens) {
    let tok = tokRaw;
    let w = 1;
    const m = tok.match(/^(.*?)[:@]([0-9.]+)%?$/);
    if (m) {
      tok = m[1];
      w = parseFloat(m[2]);
      if (w > 1) w /= 100;
    }
    tok = tok.replace(/^([2-9tjqka])([2-9tjqka])/i, (_s, a, b) => a.toUpperCase() + b.toUpperCase());
    const plus = tok.endsWith('+');
    if (plus) tok = tok.slice(0, -1);
    const dash = tok.split('-');
    const parse = (t: string) => {
      const hi = rIdx(t[0]), lo = rIdx(t[1]);
      const kind = (t[2] ?? '').toLowerCase() as '' | 's' | 'o';
      if (hi < 0 || lo < 0) throw new Error(`Bad hand: ${t}`);
      return { hi: Math.max(hi, lo), lo: Math.min(hi, lo), kind };
    };
    if (dash.length === 2) {
      const a = parse(dash[0]), b = parse(dash[1]);
      if (a.hi === a.lo && b.hi === b.lo) {
        for (let x = Math.min(a.hi, b.hi); x <= Math.max(a.hi, b.hi); x++) setLabel(r, label(x, x, ''), w);
      } else {
        for (let x = Math.min(a.lo, b.lo); x <= Math.max(a.lo, b.lo); x++) setLabel(r, label(a.hi, x, a.kind), w);
      }
    } else {
      const a = parse(dash[0]);
      if (plus) {
        if (a.hi === a.lo) for (let x = a.hi; x <= 12; x++) setLabel(r, label(x, x, ''), w);
        else for (let x = a.lo; x < a.hi; x++) setLabel(r, label(a.hi, x, a.kind), w);
      } else setLabel(r, label(a.hi, a.lo, a.kind), w);
    }
  }
  return r;
}

const fmtW = (w: number) => (w >= 0.999 ? '' : ':' + (Math.round(w * 1000) / 1000).toString());

/** Compact text form of a range (pairs, suited, offsuit runs). */
export function formatRange(r: Range): string {
  const parts: string[] = [];
  const get = (l: string) => r[CLASS_INDEX.get(l)!] ?? 0;
  // pairs
  const runs = (items: { l: string; w: number }[], join: (a: string, b: string, top: boolean) => string) => {
    let i = 0;
    while (i < items.length) {
      if (items[i].w <= 0) { i++; continue; }
      let j = i;
      while (j + 1 < items.length && Math.abs(items[j + 1].w - items[i].w) < 1e-6) j++;
      const w = items[i].w;
      if (j === i) parts.push(items[i].l + fmtW(w));
      else parts.push(join(items[i].l, items[j].l, i === 0) + fmtW(w));
      i = j + 1;
    }
  };
  const pairs = [...GRID_RANKS].map((c) => ({ l: c + c, w: get(c + c) }));
  runs(pairs, (a, b, top) => (top ? b + '+' : a + '-' + b));
  for (const kind of ['s', 'o'] as const) {
    for (let hi = 12; hi >= 1; hi--) {
      const items = [];
      for (let lo = hi - 1; lo >= 0; lo--) items.push({ l: RANKS[hi] + RANKS[lo] + kind, w: get(RANKS[hi] + RANKS[lo] + kind) });
      runs(items, (a, b, top) => (top ? b + '+' : a + '-' + b));
    }
  }
  return parts.join(', ');
}

export function rangeCombos(r: Range): number {
  let n = 0;
  for (let i = 0; i < 169; i++) n += r[i] * comboCount(HAND_CLASSES[i]);
  return n;
}

export function rangePercent(r: Range): number {
  return (rangeCombos(r) / 1326) * 100;
}

export interface Combo {
  c1: number;
  c2: number;
  id: number;
  cls: number; // index into HAND_CLASSES
  w: number;
}

/** Expand a class-level range into weighted combos, dropping any that conflict with dead cards. */
export function expandRange(r: Range, dead: number[] = []): Combo[] {
  const deadSet = new Set(dead);
  const out: Combo[] = [];
  for (let i = 0; i < 169; i++) {
    if (r[i] <= 0) continue;
    for (const [c1, c2] of classCombos(HAND_CLASSES[i])) {
      if (deadSet.has(c1) || deadSet.has(c2)) continue;
      out.push({ c1, c2, id: comboId(c1, c2), cls: i, w: r[i] });
    }
  }
  return out;
}
