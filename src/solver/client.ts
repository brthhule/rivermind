import type { Explanation, Hand, NodeInfo, SolverConfig } from './solver';

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

/** Errors for work that was abandoned on purpose; callers usually ignore these. */
export const abortError = (msg: string) => Object.assign(new Error(msg), { name: 'AbortError' });
export const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

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
  /** Bumped on every solve; a solveAsync caller only accepts the outcome of its own solve. */
  private solveId = 0;

  private ensure() {
    if (this.worker) return this.worker;
    let w: Worker;
    try {
      w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      const msg = `The solver could not start in this browser (${e instanceof Error ? e.message : String(e)}).`;
      this.set({ state: 'error', error: msg });
      throw new Error(msg);
    }
    w.onmessage = (e) => { if (this.worker === w) this.onMessage(e.data); };
    w.onerror = (e) => {
      e.preventDefault?.();
      if (this.worker !== w) return;
      // A crash (often out of memory) leaves the worker unusable: drop it so the next call starts fresh.
      this.kill(e.message ? `Solver crashed: ${e.message}` : 'The solver crashed, probably out of memory. Try fewer bet sizes or streets.');
      this.set({ state: 'error', error: e.message ? `Solver crashed: ${e.message}` : 'The solver crashed, probably out of memory. Try fewer bet sizes or streets.' });
    };
    w.onmessageerror = () => { if (this.worker === w) this.set({ state: 'error', error: 'The solver sent a message that could not be read.' }); };
    this.worker = w;
    return w;
  }

  /** Terminate the worker and fail anything still waiting on it, so no caller hangs forever. */
  private kill(reason: string) {
    this.worker?.terminate();
    this.worker = null;
    const pending = [...this.pending.values()];
    this.pending.clear();
    pending.forEach((p) => p.reject(abortError(reason)));
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
    // Always start from a fresh worker: it abandons any old solve and frees the old tree's memory.
    this.kill('Replaced by a new solve');
    this.solveId++;
    this.config = config;
    this.hands = null;
    this.set({ state: 'building', iteration: 0, exploit: NaN, elapsed: 0, error: undefined, stopped: false, nodes: undefined, mb: undefined });
    try {
      this.ensure().postMessage({ type: 'solve', config, maxIterations, targetPct });
    } catch { /* status already says error */ }
    return this.solveId;
  }

  /** Abandon whatever this client is doing (used when a page unmounts mid-solve). */
  cancel() {
    if (this.status.state !== 'running' && this.status.state !== 'building') return;
    this.solveId++;
    this.kill('Cancelled');
    this.hands = null;
    this.set({ state: 'idle', iteration: 0, exploit: NaN, elapsed: 0 });
  }

  /** Solve and resolve when finished (rejects on error). */
  solveAsync(config: SolverConfig, maxIterations: number, targetPct: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let id = -1;
      const un = this.subscribe(() => {
        const s = this.status;
        if (id < 0) return;
        if (this.solveId !== id) { un(); reject(abortError('Solve was replaced or cancelled')); }
        else if (s.state === 'done') { un(); resolve(); }
        else if (s.state === 'error') { un(); reject(new Error(s.error)); }
        else if (s.state === 'idle') { un(); reject(abortError('Solve was cancelled')); }
      });
      id = this.solve(config, maxIterations, targetPct);
      if (this.status.state === 'error') { un(); reject(new Error(this.status.error)); }
    });
  }

  stop() { this.worker?.postMessage({ type: 'stop' }); }

  /** Shut the worker down (it restarts on next use). */
  dispose() {
    this.solveId++;
    this.kill('Solver stopped');
    this.status = { state: 'idle', iteration: 0, exploit: NaN, elapsed: 0 };
  }

  private request<T>(msg: object): Promise<T> {
    const reqId = ++this.reqId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      try { this.ensure().postMessage({ ...msg, reqId }); } catch (e) { this.pending.delete(reqId); reject(e); }
    });
  }

  async query(path: number[]): Promise<NodeInfo> {
    const r = await this.request<{ info: NodeInfo }>({ type: 'query', path });
    return r.info;
  }

  /** Why-data for one hand of the acting player at the node reached by `path`. */
  async explain(path: number[], hand: number): Promise<Explanation> {
    const r = await this.request<{ info: Explanation }>({ type: 'explain', path, hand });
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
