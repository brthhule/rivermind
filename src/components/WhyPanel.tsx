import { useEffect, useState } from 'react';
import type { Explanation } from '../solver/solver';
import { explainDecision } from '../engine/explain';
import { EquityHelp } from './EquityHelp';
import { RANKS, rankOf } from '../engine/cards';

const pc = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Where the hand's equity comes from: next card by rank, and opponent hand types. */
function EquityBreakdown({ e, opp }: { e: Explanation; opp: string }) {
  const { byCard, byType } = e.breakdown;
  const W = byCard.reduce((t, x) => t + x.w, 0);
  const ranks = [...RANKS].map((r, k) => {
    const xs = byCard.filter((x) => rankOf(x.card) === k);
    const w = xs.reduce((t, x) => t + x.w, 0);
    return { r, n: xs.length, eq: w ? xs.reduce((t, x) => t + x.w * x.eq, 0) / w : 0, pts: W ? xs.reduce((t, x) => t + x.w * x.eq, 0) / W : 0 };
  }).filter((x) => x.n > 0).sort((a, b) => b.pts - a.pts);
  const next = e.board.length === 3 ? 'turn' : 'river';
  return (
    <div className="col" style={{ gap: 8 }}>
      <span className="small">Your {pc(e.handEq)} equity against {opp}'s range, split two ways. Each split adds up to the total. <EquityHelp /></span>
      {ranks.length > 0 && (
        <table className="t">
          <thead><tr><th>{next === 'turn' ? 'Turn' : 'River'} card</th><th>Cards</th><th>Your equity</th><th>Adds</th></tr></thead>
          <tbody>{ranks.map((x) => <tr key={x.r}><td><b>{x.r === 'T' ? '10' : x.r}</b></td><td>{x.n}</td><td>{pc(x.eq)}</td><td>{(x.pts * 100).toFixed(1)} pts</td></tr>)}</tbody>
        </table>
      )}
      <table className="t">
        <thead><tr><th>{opp} has</th><th>Share</th><th>Your equity</th><th>Adds</th></tr></thead>
        <tbody>{byType.filter((x) => x.share >= 0.005).map((x) => <tr key={x.name}><td>{x.name}</td><td>{pc(x.share)}</td><td>{pc(x.eq)}</td><td>{(x.share * x.eq * 100).toFixed(1)} pts</td></tr>)}</tbody>
      </table>
      <span className="muted small">{opp}'s hands are grouped by what they hold now; draws are listed only for hands without a pair. The {next} card rows count only cards that are still unseen.</span>
    </div>
  );
}

/** "Why?" box: loads the solver's numbers for one decision and explains them in words. */
export function WhyPanel({ load, chosen, opp, title = 'Why?' }: { load: () => Promise<Explanation>; chosen: number | null; opp: string; title?: string }) {
  const [data, setData] = useState<Explanation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null); setErr(null);
    load().then((d) => live && setData(d)).catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [load]);
  if (err) return <div className="why small muted">Could not build an explanation: {err}</div>;
  if (!data) return <div className="why small muted">Working out why…</div>;
  const w = explainDecision(data, chosen, opp);
  return (
    <div className="why col" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}><div className="why-title">{title}</div><div className="spacer" /><EquityHelp text /></div>
      <div className="why-summary">{w.summary}</div>
      <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setDetails((x) => !x)}>{details ? 'Hide details' : 'Show details'}</button>
      {details && (
        <>
          <div className="why-head">{w.headline}</div>
          <ul className="why-list">{w.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </>
      )}
      <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setEqOpen((x) => !x)}>{eqOpen ? 'Hide equity breakdown' : `Show equity breakdown (where your ${Math.round(data.handEq * 100)}% comes from)`}</button>
      {eqOpen && <EquityBreakdown e={data} opp={opp} />}
      <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setMore((x) => !x)}>{more ? 'Hide numbers per action' : 'Show numbers per action'}</button>
      {more && (
        <div className="col" style={{ gap: 6 }}>
          {w.details.map((d) => (
            <div key={d.label} className="why-detail"><b>{d.label}</b><div className="small muted">{d.lines.join(' ')}</div></div>
          ))}
        </div>
      )}
    </div>
  );
}
