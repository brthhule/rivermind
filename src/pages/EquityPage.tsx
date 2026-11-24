import { useState } from 'react';
import { expandRange, formatRange, parseRange, rangePercent, type Range } from '../engine/range';
import { monteCarloEquity, type EquityResult } from '../engine/equity';
import { parseCards } from '../engine/cards';
import { RangeEditor } from '../components/RangeEditor';
import { BoardPicker } from '../components/BoardPicker';
import { RangeGrid } from '../components/RangeGrid';
import { heat } from '../components/colors';

interface Player { text: string; range: Range; exact?: [number, number]; err?: string }
const COLORS = ['#35c2b0', '#f2b33d', '#7c6cf0', '#e2603f'];

export function EquityPage() {
  const [players, setPlayers] = useState<Player[]>([
    { text: 'AKs, AKo, QQ+', range: parseRange('AKs, AKo, QQ+') },
    { text: '22+, A2s+, KTs+, QTs+, JTs, ATo+, KJo+', range: parseRange('22+, A2s+, KTs+, QTs+, JTs, ATo+, KJo+') },
  ]);
  const [board, setBoard] = useState<number[]>([]);
  const [res, setRes] = useState<EquityResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<number | null>(null);
  const [err, setErr] = useState('');

  const setText = (i: number, text: string) => {
    const next = [...players];
    const p: Player = { text, range: next[i].range };
    // exact hands like "AhKd" are accepted too
    try {
      if (/^([2-9TJQKA][cdhs]){2}$/i.test(text.trim())) {
        const [a, b] = parseCards(text.trim());
        p.range = new Array(169).fill(0);
        p.exact = [a, b];
      } else if (/^\s*(random|any|100%?)\s*$/i.test(text)) p.range = new Array(169).fill(1);
      else p.range = parseRange(text);
    } catch (e) { p.err = (e as Error).message; }
    next[i] = p;
    setPlayers(next);
    setErr('');
    setRes(null);
  };
  const playerErr = players.map((p, i) => (p.err ? `Player ${i + 1}: ${p.err}` : '')).find(Boolean) ?? '';
  const run = () => {
    setBusy(true);
    setTimeout(() => {
      try {
        const exact = players.flatMap((p) => p.exact ?? []);
        if (new Set([...exact, ...board]).size !== exact.length + board.length) { setErr('Two players, or a player and the board, share a card.'); setRes(null); return; }
        const combos = players.map((p) => (p.exact ? [{ c1: p.exact[0], c2: p.exact[1], id: 0, cls: 0, w: 1 }] : expandRange(p.range, [...board, ...exact])));
        if (combos.some((c) => !c.length)) { setErr('Every player needs at least one hand that does not clash with the board or the exact hands.'); setRes(null); return; }
        const r = monteCarloEquity(combos, board, 60000);
        if (!r.samples) { setErr('These ranges block each other too much to deal a hand. Widen a range or change the board.'); setRes(null); return; }
        setErr('');
        setRes(r);
      } catch (e) { setErr(`Could not calculate: ${(e as Error).message}`); }
      finally { setBusy(false); }
    }, 10);
  };
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Equity calculator</h1>
          <p>Range against range, or exact hands, for two to four players. Results use 60,000 Monte Carlo samples with card removal.</p>
        </div>
      </div>
      <div className="study">
        <div className="col">
          {players.map((p, i) => (
            <div key={i} className="panel col" style={{ borderLeft: `3px solid ${COLORS[i]}` }}>
              <div className="row">
                <b>Player {i + 1}</b>
                <span className="muted small">{p.exact ? 'exact hand' : `${rangePercent(p.range).toFixed(1)}% of hands`}</span>
                <div className="spacer" />
                {res && res.samples > 0 && <b style={{ fontSize: 18 }}>{(res.equity[i] * 100).toFixed(2)}%</b>}
                <button onClick={() => setEdit(i)}>Grid</button>
                {players.length > 2 && <button className="ghost" onClick={() => { setPlayers(players.filter((_, k) => k !== i)); setRes(null); }}>✕</button>}
              </div>
              <input className="mono" value={p.text} onChange={(e) => setText(i, e.target.value)} />
              {res && res.samples > 0 && <div className="small muted">Win {(res.win[i] * 100).toFixed(1)}% · Tie {(res.tie[i] * 100).toFixed(1)}%</div>}
            </div>
          ))}
          <div className="row">
            {players.length < 4 && <button onClick={() => { setPlayers([...players, { text: 'random', range: new Array(169).fill(1) }]); setRes(null); }}>+ Add player</button>}
            <div className="spacer" />
            <BoardPicker value={board} onChange={(b) => { setBoard(b); setRes(null); setErr(''); }} min={0} />
            {board.length > 0 && <button className="ghost" onClick={() => { setBoard([]); setRes(null); setErr(''); }}>Clear board</button>}
          </div>
          <div className="row">
            <button className="primary" onClick={run} disabled={busy || !!playerErr}>{busy ? 'Calculating…' : 'Calculate'}</button>
            {(playerErr || err) && <span className="err small">{playerErr || err}</span>}
          </div>
        </div>
        <div className="panel col">
          <h3>Player 1 equity by hand</h3>
          {res && res.samples > 0 && !players[0].exact ? (
            <RangeGrid cell={(i) => {
              const w = players[0].range[i];
              const e = res.classEquity[i];
              return { weight: w, segments: [], bg: w > 0 && isFinite(e) ? heat(e) : undefined, sub: w > 0 && isFinite(e) ? `${Math.round(e * 100)}` : undefined };
            }} />
          ) : <span className="muted">Calculate with a range for player 1 to see a heatmap.</span>}
        </div>
      </div>
      {edit !== null && (
        <RangeEditor title={`Player ${edit + 1} range`} value={players[edit].range} onClose={() => setEdit(null)} onSave={(r) => {
          const next = [...players];
          next[edit] = { text: formatRange(r), range: r };
          setPlayers(next);
          setRes(null);
          setErr('');
        }} />
      )}
    </div>
  );
}
