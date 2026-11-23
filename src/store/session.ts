import { useSyncExternalStore } from 'react';
import type { Range } from '../engine/range';
import type { SolverConfig } from '../solver/solver';
import { presetSpots } from '../engine/preflop';
import { parseCards } from '../engine/cards';

export interface SizeText { bet: string; raise: string }
export interface SolverSetup {
  spotName: string;
  oopName: string;
  ipName: string;
  board: number[];
  pot: number;
  stack: number;
  oopRange: Range;
  ipRange: Range;
  sizes: Record<'flop' | 'turn' | 'river', [SizeText, SizeText]>;
  maxRaises: number;
  allIn: boolean;
  allInThreshold: number;
  /** extra streets of betting beyond the current one (0 = check down after this street) */
  depth: number;
  iterations: number;
  targetPct: number;
}

const s = (bet: string, raise: string): SizeText => ({ bet, raise });
export function defaultSetup(): SolverSetup {
  const p = presetSpots()[0];
  return {
    spotName: p.name, oopName: p.oop, ipName: p.ip,
    board: parseCards('Ks7d2c9h'), pot: p.pot, stack: p.stack, oopRange: p.oopRange, ipRange: p.ipRange,
    sizes: {
      flop: [s('33, 75', '60'), s('33, 75', '60')],
      turn: [s('66', '60'), s('50, 100', '60')],
      river: [s('75', '60'), s('50, 125', '60')],
    },
    maxRaises: 2, allIn: true, allInThreshold: 0.9, depth: 1, iterations: 300, targetPct: 1,
  };
}

const parseSizes = (t: string) => t.split(/[,\s]+/).map((x) => parseFloat(x)).filter((x) => x > 0).map((x) => x / 100);

export function toConfig(st: SolverSetup): SolverConfig {
  const conv = (a: [SizeText, SizeText]) => a.map((x) => ({ bet: parseSizes(x.bet), raise: parseSizes(x.raise) })) as SolverConfig['sizes']['flop'];
  const last = Math.min(5, st.board.length + st.depth) as 3 | 4 | 5;
  return {
    board: st.board, pot: st.pot, stack: st.stack, ranges: [st.oopRange, st.ipRange],
    sizes: { flop: conv(st.sizes.flop), turn: conv(st.sizes.turn), river: conv(st.sizes.river) },
    maxRaises: st.maxRaises, allIn: st.allIn, allInThreshold: st.allInThreshold, lastStreet: last,
  };
}

let setup: SolverSetup = defaultSetup();
const ls = new Set<() => void>();
export const getSetup = () => setup;
export function setSetup(p: Partial<SolverSetup>) { setup = { ...setup, ...p }; ls.forEach((l) => l()); }
export function useSetup() { return useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => setup); }
