/// <reference lib="webworker" />
import { Solver, type SolverConfig } from './solver';

let solver: Solver | null = null;
let stopFlag = false;
const MAX_MB = 1200;

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

async function solve(config: SolverConfig, maxIterations: number, targetPct: number) {
  stopFlag = false;
  solver = null;
  const s = new Solver(config);
  s.build(false);
  const mb = s.estimateMB();
  if (mb > MAX_MB) throw new Error(`This tree needs about ${Math.round(mb)} MB, over the ${MAX_MB} MB limit. Remove bet sizes or raises, or model fewer streets.`);
  s.build(true);
  solver = s;
  post({ type: 'built', nodes: s.nodes, mb, hands: s.hands });
  const t0 = performance.now();
  let lastYield = t0, exploit = NaN;
  const checkEvery = Math.max(5, Math.min(25, Math.round(maxIterations / 10)));
  while (s.iteration < maxIterations && !stopFlag) {
    s.iterate();
    const now = performance.now();
    if (s.iteration % checkEvery === 0 || s.iteration === maxIterations) {
      exploit = s.exploitability().pctPot;
      post({ type: 'progress', iteration: s.iteration, exploit, elapsed: now - t0 });
      if (exploit <= targetPct) break;
    } else if (now - lastYield > 250) {
      post({ type: 'progress', iteration: s.iteration, exploit, elapsed: now - t0 });
    }
    if (now - lastYield > 100) {
      await new Promise((r) => setTimeout(r, 0));
      lastYield = performance.now();
    }
  }
  exploit = s.exploitability().pctPot;
  post({ type: 'done', iteration: s.iteration, exploit, elapsed: performance.now() - t0, stopped: stopFlag });
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'solve') await solve(m.config, m.maxIterations, m.targetPct);
    else if (m.type === 'stop') stopFlag = true;
    else if (m.type === 'estimate') {
      const s = new Solver(m.config);
      s.build(false);
      post({ type: 'estimate', reqId: m.reqId, nodes: s.nodes, mb: s.estimateMB() });
    } else if (m.type === 'explain') {
      if (!solver) throw new Error('No solution loaded');
      post({ type: 'explain', reqId: m.reqId, info: solver.explain(m.path, m.hand) });
    } else if (m.type === 'query') {
      if (!solver) throw new Error('No solution loaded');
      const info = solver.query(m.path);
      post({ type: 'node', reqId: m.reqId, info });
    }
  } catch (err) {
    post({ type: 'error', reqId: m.reqId, message: err instanceof Error ? err.message : String(err) });
  }
};
