import { useMemo, useState } from 'react';
import { parseHand, reviewHand, splitHands, SAMPLE_HH, type HandReview } from '../engine/handHistory';
import { Board, PlayingCard } from '../components/cards';

export function AnalyzerPage() {
  const [text, setText] = useState('');
  const [reviews, setReviews] = useState<HandReview[]>([]);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(0);
  const [filter, setFilter] = useState<'all' | 'flagged'>('all');

  const run = (t: string) => {
    setErr('');
    try {
      const hs = splitHands(t);
      if (!hs.length) { setErr('No hands found. Paste PokerStars-format hand histories.'); setReviews([]); return; }
      const out: HandReview[] = [];
      for (const raw of hs) {
        try { out.push(reviewHand(parseHand(raw))); } catch (e) { console.warn('skip hand', e); }
      }
      setReviews(out);
      setOpen(0);
    } catch (e) { setErr((e as Error).message); }
  };
  const loadFile = (f: File) => f.text().then((t) => { setText(t); run(t); });
  const flagged = (r: HandReview) => r.decisions.some((d) => d.grade === 'mistake' || d.grade === 'inaccuracy');
  const shown = reviews.map((r, i) => ({ r, i })).filter(({ r }) => filter === 'all' || flagged(r));
  const summary = useMemo(() => {
    const pre = reviews.flatMap((r) => r.decisions.filter((d) => d.street === 'preflop' && d.freq !== undefined));
    return {
      hands: reviews.length,
      net: reviews.reduce((s, r) => s + (r.hand.heroNet ?? 0), 0),
      preDecisions: pre.length,
      preMistakes: pre.filter((d) => d.grade === 'mistake').length,
      preAvg: pre.length ? pre.reduce((s, d) => s + Math.min(1, (d.freq ?? 0) * 2), 0) / pre.length : 0,
      flagged: reviews.filter(flagged).length,
    };
  }, [reviews]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Hand analyzer</h1>
          <p>Paste or upload hand histories (PokerStars format, No Limit Hold'em cash). Preflop decisions are graded against the 6-max model. Later streets show your equity against the opponent's modeled range and the price you were getting.</p>
        </div>
      </div>
      <div className="panel col" style={{ marginBottom: 16 }}>
        <textarea rows={8} className="mono small" value={text} placeholder="PokerStars Hand #…" onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <button className="primary" onClick={() => run(text)} disabled={!text.trim()}>Analyze</button>
          <label className="btn">Upload .txt<input type="file" accept=".txt,text/plain" hidden onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} /></label>
          <button className="ghost" onClick={() => { setText(SAMPLE_HH); run(SAMPLE_HH); }}>Try sample hands</button>
          {err && <span className="err small">{err}</span>}
        </div>
      </div>
      {reviews.length > 0 && (
        <>
          <div className="panel row" style={{ gap: 28, marginBottom: 16 }}>
            <div className="stat"><span className="muted small">Hands</span><b>{summary.hands}</b></div>
            <div className="stat"><span className="muted small">Net result</span><b style={{ color: summary.net >= 0 ? 'var(--good)' : 'var(--danger)' }}>{summary.net >= 0 ? '+' : ''}{summary.net.toFixed(1)}bb</b></div>
            <div className="stat"><span className="muted small">Preflop decisions graded</span><b>{summary.preDecisions}</b></div>
            <div className="stat"><span className="muted small">Preflop mistakes</span><b>{summary.preMistakes}</b></div>
            <div className="stat"><span className="muted small">Hands flagged</span><b>{summary.flagged}</b></div>
            <div className="spacer" />
            <div className="seg">
              <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
              <button className={filter === 'flagged' ? 'on' : ''} onClick={() => setFilter('flagged')}>Flagged</button>
            </div>
          </div>
          <div className="col">
            {shown.map(({ r, i }) => (
              <div key={i} className="panel col">
                <div className="row" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === i ? null : i)}>
                  <span className="chip">{r.heroPos ?? '?'}</span>
                  {r.hand.heroCards.map((c) => <PlayingCard key={c} card={c} />)}
                  {r.hand.board.length > 0 && <span className="muted" style={{ margin: '0 4px' }}>on</span>}
                  <Board cards={r.hand.board} />
                  <span className="muted small">#{r.hand.id}</span>
                  <div className="spacer" />
                  {r.decisions.filter((d) => d.grade !== 'info').map((d, k) => <span key={k} className={`tag ${d.grade}`}>{d.street}</span>)}
                  <b style={{ color: (r.hand.heroNet ?? 0) >= 0 ? 'var(--good)' : 'var(--danger)', minWidth: 70, textAlign: 'right' }}>{(r.hand.heroNet ?? 0) >= 0 ? '+' : ''}{(r.hand.heroNet ?? 0).toFixed(1)}bb</b>
                </div>
                {open === i && (
                  <table className="t">
                    <thead><tr><th>Street</th><th>Spot</th><th>You</th><th>Model / numbers</th><th>Grade</th><th>Notes</th></tr></thead>
                    <tbody>
                      {r.decisions.map((d, k) => (
                        <tr key={k}>
                          <td style={{ textTransform: 'capitalize' }}>{d.street}</td>
                          <td>{d.description}</td>
                          <td>{d.heroAction}</td>
                          <td className="small">{d.best ?? ''}{d.equity !== undefined ? `Equity ${(d.equity * 100).toFixed(0)}%` : ''}{d.potOdds !== undefined ? ` · needs ${(d.potOdds * 100).toFixed(0)}%` : ''}</td>
                          <td><span className={`tag ${d.grade}`}>{d.grade}</span></td>
                          <td className="small muted">{d.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
