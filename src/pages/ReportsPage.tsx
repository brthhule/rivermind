import { useMemo, useRef, useState } from 'react';
import { flopSubset, texture } from '../engine/flops';
import { presetSpots } from '../engine/preflop';
import { reportClient, SolverClient } from '../solver/client';
import type { NodeInfo, SolverConfig } from '../solver/solver';
import { updateData, useUserData, type ReportRow, type SavedReport } from '../store/userData';
import { Board } from '../components/cards';
import { actionColors } from '../components/colors';
import { getSetup, setSetup } from '../store/session';
import { useNavigate } from 'react-router-dom';

function rangeStats(info: NodeInfo, p: 0 | 1) {
  let ev = 0, eq = 0, w = 0;
  info.reach[p].forEach((r, h) => {
    if (r <= 0) return;
    if (isFinite(info.ev[p][h])) ev += r * info.ev[p][h];
    if (isFinite(info.equity[p][h])) eq += r * info.equity[p][h];
    w += r;
  });
  return { ev: w ? ev / w : NaN, eq: w ? eq / w : NaN };
}
function actionFreqs(info: NodeInfo) {
  const p = info.player!, n = info.reach[p].length, A = info.labels!.length;
  const f = new Array(A).fill(0);
  let w = 0;
  for (let h = 0; h < n; h++) { const r = info.reach[p][h]; if (r <= 0) continue; w += r; for (let a = 0; a < A; a++) f[a] += r * info.strategy![a * n + h]; }
  return f.map((x) => (w ? x / w : 0));
}
const short = (l: string) => l.replace(/ \(\d+%\)/, (m) => m).replace(/^Bet [\d.]+ \((\d+)%\)/, 'Bet $1%').replace(/^All-in.*/, 'All-in');

function FreqBar({ labels, freqs }: { labels: string[]; freqs: number[] }) {
  const colors = actionColors(labels);
  return (
    <div title={labels.map((l, i) => `${l}: ${(freqs[i] * 100).toFixed(1)}%`).join('\n')}>
      <div className="abar" style={{ height: 14 }}>{freqs.map((f, i) => <div key={i} style={{ width: `${f * 100}%`, background: colors[i] }} />)}</div>
    </div>
  );
}

type SortKey = 'flop' | 'oopBet' | 'ipBet' | 'oopEq' | 'oopEv';

export function ReportsPage() {
  const data = useUserData();
  const navigate = useNavigate();
  const presets = useMemo(presetSpots, []);
  const [spotName, setSpotName] = useState(presets[0].name);
  const [count, setCount] = useState(25);
  const [betSize, setBetSize] = useState('33, 75');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [report, setReport] = useState<SavedReport | null>(data.reports[data.reports.length - 1] ?? null);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'flop', dir: 1 });
  const [filter, setFilter] = useState('all');
  const stop = useRef(false);
  const poolRef = useRef<SolverClient[]>([]);

  const run = async () => {
    const spot = presets.find((p) => p.name === spotName)!;
    const flops = flopSubset(count);
    const sizes = betSize.split(/[,\s]+/).map(parseFloat).filter((x) => x > 0).map((x) => x / 100);
    const s = (bet: number[]) => ({ bet, raise: [0.75] });
    stop.current = false;
    setRunning(true);
    const rows: ReportRow[] = [];
    const rep: SavedReport = { name: `${spot.name} · ${flops.length} flops`, t: Date.now(), spot: spot.name, pot: spot.pot, sizes: betSize, rows };
    setReport({ ...rep });
    // independent flops: solve several at once, one worker per spare CPU core
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
    const pool = Array.from({ length: Math.max(1, Math.min(6, cores - 1, flops.length)) }, (_, k) => (k === 0 ? reportClient : new SolverClient()));
    poolRef.current = pool;
    let next = 0, started = 0;
    const byIdx: (ReportRow | undefined)[] = [];
    const solveOne = async (client: SolverClient, f: (typeof flops)[number]) => {
      const cfg: SolverConfig = {
        board: f.cards, pot: spot.pot, stack: spot.stack, ranges: [spot.oopRange, spot.ipRange],
        sizes: { flop: [s(sizes), s(sizes)], turn: [s([0.66]), s([0.66])], river: [s([0.75]), s([0.75])] },
        maxRaises: 1, allIn: true, allInThreshold: 0.67, lastStreet: 3,
      };
      await client.solveAsync(cfg, 120, 1.5);
      const root = await client.query([]);
      const ipNode = await client.query([0]);
      const a = rangeStats(root, 0), b = rangeStats(root, 1);
      return {
        flop: f.cards, weight: f.weight,
        oop: { labels: root.labels!.map(short), freqs: actionFreqs(root) },
        ip: { labels: ipNode.labels!.map(short), freqs: ipNode.kind === 'action' ? actionFreqs(ipNode) : [] },
        ev: [a.ev, b.ev] as [number, number], eq: [a.eq, b.eq] as [number, number],
      };
    };
    await Promise.all(pool.map(async (client) => {
      while (next < flops.length && !stop.current) {
        const i = next++, f = flops[i];
        setProgress({ done: rows.length, total: flops.length, current: `${++started} of ${flops.length} started` });
        try {
          byIdx[i] = await solveOne(client, f);
          rows.splice(0, rows.length, ...byIdx.filter((r): r is ReportRow => !!r));
          setReport({ ...rep, rows: [...rows] });
        } catch (e) { if (!stop.current) console.warn(e); }
      }
    }));
    pool.slice(1).forEach((c) => c.dispose());
    poolRef.current = [];
    setProgress((p) => ({ ...p, done: rows.length }));
    setRunning(false);
    if (rows.length) updateData((d) => { d.reports = [...d.reports.filter((r) => r.name !== rep.name), { ...rep, rows }].slice(-10); });
  };

  const rows = useMemo(() => {
    if (!report) return [];
    let r = report.rows.map((x) => ({ ...x, tex: texture(x.flop) }));
    if (filter !== 'all') r = r.filter((x) => (filter === 'paired' ? x.tex.paired : filter === 'connected' ? x.tex.connected : x.tex.suit === filter));
    const bet = (f: { labels: string[]; freqs: number[] }) => f.freqs.reduce((s, x, i) => s + (/Check|Fold|Call/.test(f.labels[i]) ? 0 : x), 0);
    const key = (x: (typeof r)[number]) => (sort.k === 'flop' ? -x.flop[0] * 10000 - x.flop[1] * 100 - x.flop[2] : sort.k === 'oopBet' ? bet(x.oop) : sort.k === 'ipBet' ? bet(x.ip) : sort.k === 'oopEq' ? x.eq[0] : x.ev[0]);
    return r.sort((a, b) => (key(a) - key(b)) * sort.dir);
  }, [report, filter, sort]);

  const summary = useMemo(() => {
    if (!rows.length) return null;
    const W = rows.reduce((s, r) => s + r.weight, 0);
    const avg = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + r.weight * f(r), 0) / W;
    const labelsO = rows[0].oop.labels, labelsI = rows[0].ip.labels;
    return {
      oop: { labels: labelsO, freqs: labelsO.map((_, i) => avg((r) => r.oop.freqs[i] ?? 0)) },
      ip: { labels: labelsI, freqs: labelsI.map((_, i) => avg((r) => r.ip.freqs[i] ?? 0)) },
      eq: [avg((r) => r.eq[0]), avg((r) => r.eq[1])], ev: [avg((r) => r.ev[0]), avg((r) => r.ev[1])],
    };
  }, [rows]);

  const th = (k: SortKey, label: string) => <th style={{ cursor: 'pointer' }} onClick={() => setSort({ k, dir: sort.k === k ? (-sort.dir as 1 | -1) : -1 })}>{label}{sort.k === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>;
  const spot = report ? presets.find((p) => p.name === report.spot) : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Aggregate reports</h1>
          <p>Solve one spot across a spread of flops and compare strategies at a glance. Each flop stands in for its share of all 22,100 flops, so the averages are weighted. Reports solve the flop and check down later streets, with one raise allowed.</p>
        </div>
      </div>
      <div className="panel row" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
        <label className="field">Spot
          <select value={spotName} onChange={(e) => setSpotName(e.target.value)} disabled={running}>{presets.map((p) => <option key={p.name}>{p.name}</option>)}</select>
        </label>
        <label className="field">Flops
          <select value={count} onChange={(e) => setCount(+e.target.value)} disabled={running}>
            {[12, 25, 49, 85].map((n) => <option key={n} value={n}>{n} representative flops</option>)}
          </select>
        </label>
        <label className="field">Flop bet sizes (% pot)<input value={betSize} onChange={(e) => setBetSize(e.target.value)} disabled={running} style={{ width: 100 }} /></label>
        {running ? <button className="danger" onClick={() => { stop.current = true; poolRef.current.forEach((c) => c.stop()); }}>■ Stop</button> : <button className="primary" onClick={run}>▶ Run report</button>}
        {data.reports.length > 0 && !running && (
          <select value="" onChange={(e) => setReport(data.reports.find((r) => r.name === e.target.value) ?? null)}>
            <option value="" disabled>Saved reports…</option>
            {data.reports.map((r) => <option key={r.name}>{r.name}</option>)}
          </select>
        )}
        {running && <span className="muted small">Solving {progress.done + 1} of {progress.total} ({progress.current})…</span>}
      </div>
      {running && <div className="progress" style={{ marginBottom: 16 }}><div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>}
      {report && summary && (
        <div className="grid2" style={{ marginBottom: 16 }}>
          <div className="panel col">
            <h3>OOP first action, weighted average</h3>
            <FreqBar {...summary.oop} />
            <div className="row small">{summary.oop.labels.map((l, i) => <span key={i} className="chip">{l} {(summary.oop.freqs[i] * 100).toFixed(1)}%</span>)}</div>
            <span className="small muted">OOP equity {(summary.eq[0] * 100).toFixed(1)}% · EV {summary.ev[0].toFixed(2)}bb</span>
          </div>
          <div className="panel col">
            <h3>IP after a check, weighted average</h3>
            <FreqBar {...summary.ip} />
            <div className="row small">{summary.ip.labels.map((l, i) => <span key={i} className="chip">{l} {(summary.ip.freqs[i] * 100).toFixed(1)}%</span>)}</div>
            <span className="small muted">IP equity {(summary.eq[1] * 100).toFixed(1)}% · EV {summary.ev[1].toFixed(2)}bb</span>
          </div>
        </div>
      )}
      {report && (
        <div className="panel col">
          <div className="row">
            <h2 style={{ margin: 0 }}>{report.name}</h2>
            <div className="spacer" />
            <div className="seg">
              {['all', 'Rainbow', 'Two-tone', 'Monotone', 'paired', 'connected'].map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}</button>)}
            </div>
          </div>
          <table className="t">
            <thead><tr>{th('flop', 'Flop')}<th>Texture</th>{th('oopBet', 'OOP strategy')}{th('ipBet', 'IP vs check')}{th('oopEq', 'OOP equity')}{th('oopEv', 'OOP EV')}<th>Weight</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.flop.join()}>
                  <td><Board cards={r.flop} /></td>
                  <td className="small muted">{r.tex.suit}{r.tex.paired ? ', paired' : ''}{r.tex.connected ? ', connected' : ''}</td>
                  <td style={{ width: '22%' }}><FreqBar {...r.oop} /></td>
                  <td style={{ width: '22%' }}><FreqBar {...r.ip} /></td>
                  <td>{(r.eq[0] * 100).toFixed(1)}%</td>
                  <td>{r.ev[0].toFixed(2)}</td>
                  <td className="muted small">{(r.weight / 221).toFixed(2)}%</td>
                  <td><button className="ghost" title="Open in the solver" onClick={() => {
                    if (spot) setSetup({ spotName: spot.name, oopName: spot.oop, ipName: spot.ip, oopRange: spot.oopRange, ipRange: spot.ipRange, pot: spot.pot, stack: spot.stack, board: r.flop, depth: 0, locks: [] });
                    else setSetup({ ...getSetup(), board: r.flop });
                    navigate('/solver');
                  }}>Study ›</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <span className="small muted">Hover a bar for exact frequencies. Click a column header to sort.</span>
        </div>
      )}
    </div>
  );
}
