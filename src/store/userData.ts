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
export interface BuilderRecord { t: number; spot: string; score: number }
export interface BuilderStats { attempts: number; scoreSum: number; history: BuilderRecord[] }
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
  builder: BuilderStats;
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
  builder: { attempts: 0, scoreSum: 0, history: [] },
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

/** Fill in missing fields so older or partial files still import. */
function normalize(x: any): UserData {
  const d = defaultData();
  if (!x || typeof x !== 'object') return d;
  return {
    version: DATA_VERSION,
    savedRanges: Array.isArray(x.savedRanges) ? x.savedRanges.filter((r: any) => r && typeof r.name === 'string' && typeof r.range === 'string') : d.savedRanges,
    drills: { ...d.drills, ...(x.drills ?? {}) },
    stats: {
      preflop: { ...d.stats.preflop, ...(x.stats?.preflop ?? {}) },
      postflop: { ...d.stats.postflop, ...(x.stats?.postflop ?? {}) },
    },
    solverSetups: Array.isArray(x.solverSetups) ? x.solverSetups : [],
    settings: { ...d.settings, ...(x.settings ?? {}) },
    play: {
      prefs: { ...d.play.prefs, ...(x.play?.prefs ?? {}) },
      stats: { ...d.play.stats, ...(x.play?.stats ?? {}) },
      history: Array.isArray(x.play?.history) ? x.play.history.slice(-200) : [],
    },
    reports: Array.isArray(x.reports) ? x.reports.slice(-10) : [],
    builder: { ...d.builder, ...(x.builder ?? {}), history: Array.isArray(x.builder?.history) ? x.builder.history.slice(-300) : [] },
    updated: typeof x.updated === 'number' ? x.updated : Date.now(),
  };
}

export function getData() { return data; }

export function updateData(fn: (d: UserData) => UserData | void) {
  const copy = structuredClone(data);
  const res = fn(copy) ?? copy;
  res.updated = Date.now();
  data = res;
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* ignore */ }
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
  const lines = text.split(/\r?\n/);
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
    for (const k of ['preflop', 'postflop'] as const) {
      d.stats[k].attempts += incoming.stats[k].attempts;
      d.stats[k].score += incoming.stats[k].score;
      d.stats[k].history = [...d.stats[k].history, ...incoming.stats[k].history].sort((a, b) => a.t - b.t).slice(-500);
    }
    d.drills = incoming.drills;
    const rn = new Set(d.reports.map((r) => r.name));
    d.reports = [...d.reports, ...incoming.reports.filter((r) => !rn.has(r.name))].slice(-10);
    d.play.prefs = incoming.play.prefs;
    for (const k of ['hands', 'decisions', 'evLoss', 'best', 'net'] as const) d.play.stats[k] += incoming.play.stats[k];
    d.play.history = [...d.play.history, ...incoming.play.history].sort((a, b) => a.t - b.t).slice(-200);
    d.builder.attempts += incoming.builder.attempts;
    d.builder.scoreSum += incoming.builder.scoreSum;
    d.builder.history = [...d.builder.history, ...incoming.builder.history].sort((a, b) => a.t - b.t).slice(-300);
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
