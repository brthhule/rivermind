import { useMemo } from 'react';
import type { NodeInfo, Hand } from '../solver/solver';
import { classify, DRAWS, MADE } from '../engine/categories';

interface Row { name: string; combos: number; share: number; eq: number; mix: number[] }

/** Range split into made hands and draws (with the strategy for each), plus both players' equity curves. */
export function RangeBreakdown({ info, p, hands, labels, colors, names }: { info: NodeInfo; p: 0 | 1; hands: [Hand[], Hand[]]; labels: string[]; colors: string[]; names: [string, string] }) {
  const cats = useMemo(() => hands[p].map((h) => classify(h.c1, h.c2, info.board)), [hands, p, info.board]);
  const n = hands[p].length;
  const { made, draws, total } = useMemo(() => {
    const mk = (name: string): Row & { w: number } => ({ name, combos: 0, share: 0, eq: 0, mix: labels.map(() => 0), w: 0 });
    const m = new Map<string, Row & { w: number }>(MADE.map((x) => [x, mk(x)]));
    const d = new Map<string, Row & { w: number }>(DRAWS.map((x) => [x, mk(x)]));
    let total = 0;
    for (let i = 0; i < n; i++) {
      const r = info.reach[p][i];
      if (r <= 1e-6) continue;
      total += r;
      const rows = [m.get(cats[i].made)!, ...cats[i].draws.map((x) => d.get(x)!)];
      for (const row of rows) {
        row.combos += r;
        if (isFinite(info.equity[p][i])) { row.eq += r * info.equity[p][i]; row.w += r; }
        labels.forEach((_, a) => (row.mix[a] += r * info.strategy![a * n + i]));
      }
    }
    const fin = (rows: Iterable<Row & { w: number }>) => [...rows].filter((r) => r.combos > 0.05).map((r) => ({ ...r, share: r.combos / (total || 1), eq: r.w ? r.eq / r.w : NaN, mix: r.mix.map((x) => x / r.combos) }));
    return { made: fin(m.values()), draws: fin(d.values()), total };
  }, [cats, info, p, n, labels]);

  const curve = (q: 0 | 1) => {
    const pts = hands[q].map((_, i) => ({ r: info.reach[q][i], e: info.equity[q][i] })).filter((x) => x.r > 1e-6 && isFinite(x.e)).sort((a, b) => b.e - a.e);
    const W = pts.reduce((s, x) => s + x.r, 0);
    let acc = 0;
    const out: [number, number][] = [[0, pts[0]?.e ?? 0]];
    for (const x of pts) { acc += x.r; out.push([acc / W, x.e]); }
    return out;
  };
  const W = 320, H = 150, pad = 26;
  const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(pad + x * (W - pad - 6)).toFixed(1)},${(6 + (1 - y) * (H - pad - 6)).toFixed(1)}`).join('');
  const cOOP = '#35c2b0', cIP = '#a99cff';

  const table = (title: string, rows: Row[]) => (
    <table className="t">
      <thead><tr><th>{title}</th><th>Combos</th><th>Range</th><th>Equity</th>{labels.length > 0 && <th style={{ width: '34%' }}>Strategy</th>}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td>
            <td>{r.combos.toFixed(1)}</td>
            <td>{(r.share * 100).toFixed(1)}%</td>
            <td>{isFinite(r.eq) ? `${(r.eq * 100).toFixed(0)}%` : '–'}</td>
            {labels.length > 0 && (
              <td title={labels.map((l, a) => `${l}: ${(r.mix[a] * 100).toFixed(1)}%`).join('\n')}>
                <div className="abar">{labels.map((_, a) => <div key={a} style={{ width: `${r.mix[a] * 100}%`, background: colors[a] }} />)}</div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="panel col" style={{ gap: 12 }}>
      <div className="row"><h2 style={{ margin: 0 }}>Range breakdown · {p === 0 ? 'OOP' : 'IP'} {names[p]}</h2><div className="spacer" /><span className="muted small">{total.toFixed(1)} combos</span></div>
      <div className="breakdown">
        <div className="col" style={{ gap: 12, minWidth: 0 }}>
          {table('Made hand', made)}
          {draws.length > 0 && table('Draw', draws)}
          <span className="muted small">A hand can be in a made-hand row and a draw row at once. Hover a strategy bar for exact frequencies.</span>
        </div>
        <div className="col" style={{ gap: 6 }}>
          <b>Equity distribution</b>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 420 }} role="img" aria-label="Equity distribution of both ranges">
            {[0, 0.25, 0.5, 0.75, 1].map((y) => (
              <g key={y}>
                <line x1={pad} x2={W - 6} y1={6 + (1 - y) * (H - pad - 6)} y2={6 + (1 - y) * (H - pad - 6)} stroke="#2a3547" strokeWidth={1} />
                <text x={pad - 4} y={9 + (1 - y) * (H - pad - 6)} fontSize={9} fill="#8d9ab0" textAnchor="end">{y * 100}</text>
              </g>
            ))}
            <text x={pad} y={H - 8} fontSize={9} fill="#8d9ab0">strongest</text>
            <text x={W - 6} y={H - 8} fontSize={9} fill="#8d9ab0" textAnchor="end">weakest</text>
            <path d={path(curve(1))} fill="none" stroke={cIP} strokeWidth={2} />
            <path d={path(curve(0))} fill="none" stroke={cOOP} strokeWidth={2} />
          </svg>
          <div className="row small" style={{ gap: 14 }}>
            <span><span className="dot" style={{ background: cOOP }} /> OOP {names[0]}</span>
            <span><span className="dot" style={{ background: cIP }} /> IP {names[1]}</span>
          </div>
          <span className="muted small">Each line sorts a range from its strongest to its weakest hand and plots equity against the other range. A line that stays higher has more strong hands; a steeper drop means a more polarized range.</span>
        </div>
      </div>
    </div>
  );
}
