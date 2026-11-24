// All user state lives in the browser. It can be exported to a text file and imported later,
// so the app works as a static site with no accounts.
import { useSyncExternalStore } from 'react';

export const DATA_HEADER = 'RIVERMIND-USER-DATA';
export const DATA_VERSION = 1;

export interface SavedRange { name: string; range: string; note?: string }
export interface DrillPrefs {
  preflopKinds: string[]; // 'rfi' | 'vsopen' | 'vs3bet' | 'vs4bet' | 'vs5bet'
  positions: string[];
  postflopSide: 'oop' | 'ip' | 'random';
}
export interface DrillRecord { t: number; spot: string; hand: string; chosen: string; grade: string; evLoss?: number }
export interface DrillStats { attempts: number; score: number; history: DrillRecord[] }
export interface PlayRecord {
  t: number; spot: string; hero: string; heroCards: number[]; villainCards: number[]; board: number[];
  runout?: number[]; seed?: number; prefs?: PlayPrefs;
  net: number; evLoss: number; decisions: number; log: { street: string; who: string; text: string; grade?: string; evLoss?: number }[];
}
export interface PlayStats { hands: number; decisions: number; evLoss: number; best: number; net: number }
export interface PlayPrefs { start: string; heroSide: 'oop' | 'ip' | 'random'; heroPos: string; sizing: 'simple' | 'standard'; accuracy: 'fast' | 'standard'; autoObvious: boolean; rng: boolean }
export interface ReportRow { flop: number[]; weight: number; oop: { labels: string[]; freqs: number[] }; ip: { labels: string[]; freqs: number[] }; ev: [number, number]; eq: [number, number] }
export interface SavedReport { name: string; t: number; spot: string; pot: number; sizes: string; rows: ReportRow[] }
export interface SavedSolverSetup { name: string; setup: unknown }
export interface UserData {
  version: number;
  savedRanges: SavedRange[];
  drills: DrillPrefs;
  stats: { preflop: DrillStats; postflop: DrillStats };
  solverSetups: SavedSolverSetup[];
  settings: { fourColor: boolean };
  play: { prefs: PlayPrefs; stats: PlayStats; history: PlayRecord[] };
  reports: SavedReport[];
  updated: number;
}

export const defaultPlay = (): UserData['play'] => ({
  prefs: { start: 'preflop', heroSide: 'random', heroPos: 'random', sizing: 'simple', accuracy: 'fast', autoObvious: true, rng: true },
  stats: { hands: 0, decisions: 0, evLoss: 0, best: 0, net: 0 },
  history: [],
});

export const defaultData = (): UserData => ({
  version: DATA_VERSION,
  savedRanges: [],
  drills: { preflopKinds: ['rfi', 'vsopen', 'vs3bet'], positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'], postflopSide: 'random' },
  stats: { preflop: { attempts: 0, score: 0, history: [] }, postflop: { attempts: 0, score: 0, history: [] } },
  solverSetups: [],
  settings: { fourColor: true },
  play: defaultPlay(),
  reports: [],
  updated: Date.now(),
});

const LS_KEY = 'rivermind:userdata';
let data: UserData = load();
const listeners = new Set<() => void>();

function load(): UserData {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* storage unavailable */ }
  return defaultData();
}

// Helpers that coerce untrusted values (from storage or an imported file) into safe shapes.
const num = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const nums = (v: unknown) => arr(v).filter((x) => typeof x === 'number' && isFinite(x));
const cards = (v: unknown) => nums(v).filter((c) => Number.isInteger(c) && c >= 0 && c < 52);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);

function drillStats(x: unknown): DrillStats {
  const o = obj(x);
  return {
    attempts: Math.max(0, num(o.attempts)),
    score: Math.max(0, num(o.score)),
    history: arr(o.history).filter((r) => r && typeof r === 'object').map((r) => ({
      t: num(r.t), spot: str(r.spot), hand: str(r.hand), chosen: str(r.chosen), grade: str(r.grade),
      ...(typeof r.evLoss === 'number' && isFinite(r.evLoss) ? { evLoss: r.evLoss } : {}),
    })).slice(-500),
  };
}

function playPrefs(x: unknown): PlayPrefs {
  const d = defaultPlay().prefs, o = obj(x);
  return {
    start: str(o.start, d.start) || d.start,
    heroSide: oneOf(o.heroSide, ['oop', 'ip', 'random'] as const, d.heroSide),
    heroPos: str(o.heroPos, d.heroPos) || d.heroPos,
    sizing: oneOf(o.sizing, ['simple', 'standard'] as const, d.sizing),
    accuracy: oneOf(o.accuracy, ['fast', 'standard'] as const, d.accuracy),
    autoObvious: bool(o.autoObvious, d.autoObvious),
    rng: bool(o.rng, d.rng),
  };
}

function playRecord(r: any): PlayRecord | null {
  if (!r || typeof r !== 'object') return null;
  const heroCards = cards(r.heroCards);
  if (heroCards.length !== 2) return null;
  return {
    t: num(r.t), spot: str(r.spot), hero: str(r.hero), heroCards, villainCards: cards(r.villainCards), board: cards(r.board).slice(0, 5),
    ...(Array.isArray(r.runout) ? { runout: cards(r.runout).slice(0, 5) } : {}),
    ...(typeof r.seed === 'number' && isFinite(r.seed) ? { seed: r.seed, prefs: playPrefs(r.prefs) } : {}),
    net: num(r.net), evLoss: num(r.evLoss), decisions: num(r.decisions),
    log: arr(r.log).filter((l) => l && typeof l === 'object').map((l) => ({
      street: str(l.street), who: str(l.who), text: str(l.text),
      ...(typeof l.grade === 'string' ? { grade: l.grade } : {}),
      ...(typeof l.evLoss === 'number' && isFinite(l.evLoss) ? { evLoss: l.evLoss } : {}),
    })),
  };
}

const freqSet = (x: unknown) => { const o = obj(x); const labels = arr(o.labels).map((l) => str(l)); return { labels, freqs: labels.map((_, i) => num(arr(o.freqs)[i])) }; };
const pair = (x: unknown): [number, number] => { const a = arr(x); return [num(a[0], NaN), num(a[1], NaN)]; };

function report(r: any): SavedReport | null {
  if (!r || typeof r !== 'object' || typeof r.name !== 'string') return null;
  const rows = arr(r.rows).map((x) => {
    const o = obj(x);
    const flop = cards(o.flop);
    if (flop.length !== 3) return null;
    return { flop, weight: Math.max(0, num(o.weight)), oop: freqSet(o.oop), ip: freqSet(o.ip), ev: pair(o.ev), eq: pair(o.eq) };
  }).filter((x): x is ReportRow => !!x);
  return { name: r.name, t: num(r.t), spot: str(r.spot), pot: num(r.pot), sizes: str(r.sizes), rows };
}

/** Fill in missing fields and drop anything malformed, so older, partial or hand-edited files still import safely. */
function normalize(x: any): UserData {
  const d = defaultData();
  if (!x || typeof x !== 'object' || Array.isArray(x)) return d;
  const drills = obj(x.drills), stats = obj(x.stats), play = obj(x.play), pstats = obj(play.stats), settings = obj(x.settings);
  const strs = (v: unknown, dflt: string[]) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : dflt);
  return {
    version: DATA_VERSION,
    savedRanges: arr(x.savedRanges).filter((r) => r && typeof r.name === 'string' && typeof r.range === 'string')
      .map((r) => ({ name: r.name, range: r.range, ...(typeof r.note === 'string' ? { note: r.note } : {}) })),
    drills: {
      preflopKinds: strs(drills.preflopKinds, d.drills.preflopKinds),
      positions: strs(drills.positions, d.drills.positions),
      postflopSide: oneOf(drills.postflopSide, ['oop', 'ip', 'random'] as const, d.drills.postflopSide),
    },
    stats: { preflop: drillStats(stats.preflop), postflop: drillStats(stats.postflop) },
    solverSetups: arr(x.solverSetups).filter((s) => s && typeof s.name === 'string' && s.setup && typeof s.setup === 'object').map((s) => ({ name: s.name, setup: s.setup })),
    settings: { fourColor: bool(settings.fourColor, d.settings.fourColor) },
    play: {
      prefs: playPrefs(play.prefs),
      stats: {
        hands: Math.max(0, num(pstats.hands)), decisions: Math.max(0, num(pstats.decisions)), evLoss: Math.max(0, num(pstats.evLoss)),
        best: Math.max(0, num(pstats.best)), net: num(pstats.net),
      },
      history: arr(play.history).map(playRecord).filter((r): r is PlayRecord => !!r).slice(-200),
    },
    reports: arr(x.reports).map(report).filter((r): r is SavedReport => !!r).slice(-10),
    updated: num(x.updated, Date.now()),
  };
}

export function getData() { return data; }
/** True when the last change could not be written to browser storage. */
export let saveFailed = false;

export function updateData(fn: (d: UserData) => UserData | void) {
  const copy = structuredClone(data);
  const res = fn(copy) ?? copy;
  res.updated = Date.now();
  data = res;
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); saveFailed = false; } catch (e) {
    // Storage full or blocked (private mode). Keep working in memory and tell the user on My data.
    saveFailed = true;
    console.warn('Rivermind could not save to browser storage', e);
  }
  listeners.forEach((l) => l());
}

export function useUserData(): UserData {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => data);
}

/** Text file format: a header line, then JSON. */
export function serialize(d: UserData = data): string {
  return `${DATA_HEADER} v${DATA_VERSION}\n# Exported ${new Date().toISOString()}. Import this file in Rivermind > My data to restore.\n${JSON.stringify(d, null, 2)}\n`;
}

export function deserialize(text: string): UserData {
  if (text.length > 20_000_000) throw new Error('This file is too large to be a Rivermind data export.');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!lines[0]?.startsWith(DATA_HEADER)) throw new Error('This file is not a Rivermind data export.');
  const json = lines.filter((l, i) => i > 0 && !l.startsWith('#')).join('\n');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('The data in this file is damaged and could not be read.'); }
  return normalize(parsed);
}

export function importData(text: string, mode: 'replace' | 'merge') {
  const incoming = deserialize(text);
  updateData((d) => {
    if (mode === 'replace') return incoming;
    const names = new Set(d.savedRanges.map((r) => r.name));
    d.savedRanges.push(...incoming.savedRanges.filter((r) => !names.has(r.name)));
    const setups = new Set(d.solverSetups.map((s) => s.name));
    d.solverSetups.push(...incoming.solverSetups.filter((s) => !setups.has(s.name)));
    // Importing the same file twice must not double count: only add results that are not already here.
    const key = (r: { t: number; hand?: string; spot: string }) => `${r.t}|${r.spot}|${r.hand ?? ''}`;
    for (const k of ['preflop', 'postflop'] as const) {
      const have = new Set(d.stats[k].history.map(key));
      const fresh = incoming.stats[k].history.filter((r) => !have.has(key(r)));
      const dup = incoming.stats[k].history.length - fresh.length;
      if (fresh.length > 0 || dup === 0) {
        // count the attempts that came with new history
        const share = incoming.stats[k].history.length ? fresh.length / incoming.stats[k].history.length : 1;
        d.stats[k].attempts += Math.round(incoming.stats[k].attempts * share);
        d.stats[k].score += incoming.stats[k].score * share;
      }
      d.stats[k].history = [...d.stats[k].history, ...fresh].sort((a, b) => a.t - b.t).slice(-500);
    }
    d.drills = incoming.drills;
    const rn = new Set(d.reports.map((r) => r.name));
    d.reports = [...d.reports, ...incoming.reports.filter((r) => !rn.has(r.name))].slice(-10);
    d.play.prefs = incoming.play.prefs;
    const haveHands = new Set(d.play.history.map((h) => `${h.t}|${h.seed ?? ''}`));
    const freshHands = incoming.play.history.filter((h) => !haveHands.has(`${h.t}|${h.seed ?? ''}`));
    if (freshHands.length > 0 || incoming.play.history.length === 0) {
      const share = incoming.play.history.length ? freshHands.length / incoming.play.history.length : 1;
      for (const k of ['hands', 'decisions', 'evLoss', 'best', 'net'] as const) d.play.stats[k] += incoming.play.stats[k] * share;
      d.play.stats.hands = Math.round(d.play.stats.hands);
      d.play.stats.decisions = Math.round(d.play.stats.decisions);
      d.play.stats.best = Math.round(d.play.stats.best);
    }
    d.play.history = [...d.play.history, ...freshHands].sort((a, b) => a.t - b.t).slice(-200);
    return d;
  });
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function recordDrill(kind: 'preflop' | 'postflop', rec: DrillRecord, score: number) {
  updateData((d) => {
    const s = d.stats[kind];
    s.attempts++;
    s.score += score;
    s.history.push(rec);
    if (s.history.length > 500) s.history = s.history.slice(-500);
  });
}
