import { useEffect, useState } from 'react';
import type { Explanation } from '../solver/solver';
import { explainDecision } from '../engine/explain';

/** "Why?" box: loads the solver's numbers for one decision and explains them in words. */
export function WhyPanel({ load, chosen, opp, title = 'Why?' }: { load: () => Promise<Explanation>; chosen: number | null; opp: string; title?: string }) {
  const [data, setData] = useState<Explanation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [more, setMore] = useState(false);
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
      <div className="why-title">{title}</div>
      <div className="why-head">{w.headline}</div>
      <ul className="why-list">{w.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
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
