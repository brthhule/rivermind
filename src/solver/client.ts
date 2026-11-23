import type { Hand, NodeInfo, SolverConfig } from './solver';

export interface SolveStatus {
  state: 'idle' | 'building' | 'running' | 'done' | 'error';
  iteration: number;
  exploit: number;
  elapsed: number;
  nodes?: number;
  mb?: number;
  error?: string;
  stopped?: boolean;
}

type Listener = () => void;

/** Owns the solver Web Worker. One shared instance for the app. */
export class SolverClient {
  private worker: Worker | null = null;
  private reqId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Set<Listener>();
  status: SolveStatus = { state: 'idle', iteration: 0, exploit: NaN, elapsed: 0 };
  hands: [Hand[], Hand[]] | null = null;
  config: SolverConfig | null = null;
  version = 0;

  private ensure() {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => this.onMessage(e.data);
    w.onerror = (e) => { this.set({ state: 'error', error: e.message || 'Solver crashed' }); };
    this.worker = w;
    return w;
  }

  private onMessage(m: any) {
    if (m.reqId !== undefined && this.pending.has(m.reqId)) {
      const p = this.pending.get(m.reqId)!;
      this.pending.delete(m.reqId);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
      return;
    }
    if (m.type === 'built') { this.hands = m.hands; this.set({ state: 'running', nodes: m.nodes, mb: m.mb }); }
    else if (m.type === 'progress') this.set({ iteration: m.iteration, exploit: m.exploit, elapsed: m.elapsed });
    else if (m.type === 'done') { this.version++; this.set({ state: 'done', iteration: m.iteration, exploit: m.exploit, elapsed: m.elapsed, stopped: m.stopped }); }
    else if (m.type === 'error') this.set({ state: 'error', error: m.message });
  }

  private set(p: Partial<SolveStatus>) {
    this.status = { ...this.status, ...p };
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getStatus = () => this.status;

  solve(config: SolverConfig, maxIterations: number, targetPct: number) {
    if (this.status.state === 'running' || this.status.state === 'building') {
      // restart worker to abandon the old solve
      this.worker?.terminate();
      this.worker = null;
    }
    this.config = config;
    this.hands = null;
    this.set({ state: 'building', iteration: 0, exploit: NaN, elapsed: 0, error: undefined, stopped: false });
    this.ensure().postMessage({ type: 'solve', config, maxIterations, targetPct });
  }

  /** Solve and resolve when finished (rejects on error). */
  solveAsync(config: SolverConfig, maxIterations: number, targetPct: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const un = this.subscribe(() => {
        const s = this.status;
        if (s.state === 'done') { un(); resolve(); }
        else if (s.state === 'error') { un(); reject(new Error(s.error)); }
      });
      this.solve(config, maxIterations, targetPct);
    });
  }

  stop() { this.worker?.postMessage({ type: 'stop' }); }

  private request<T>(msg: object): Promise<T> {
    const reqId = ++this.reqId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.ensure().postMessage({ ...msg, reqId });
    });
  }

  async query(path: number[]): Promise<NodeInfo> {
    const r = await this.request<{ info: NodeInfo }>({ type: 'query', path });
    return r.info;
  }

  async estimate(config: SolverConfig): Promise<{ nodes: number; mb: number }> {
    return this.request({ type: 'estimate', config });
  }
}

export const solverClient = new SolverClient();

/** Separate solver used by full-hand practice so it never replaces the study solution. */
export const practiceClient = new SolverClient();

/** Solver used to batch-solve flops for aggregate reports. */
export const reportClient = new SolverClient();
