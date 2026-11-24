import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HAND_CLASSES, classCombos, comboCount, comboStr } from '../engine/cards';
import { POSITIONS, spot, type PreflopSpot } from '../engine/preflop';
import { recordDrill, updateData, useUserData } from '../store/userData';
import { isAbort, solverClient } from '../solver/client';
import type { NodeInfo } from '../solver/solver';
import { useSolverStatus } from './SolverPage';
import { useSetup } from '../store/session';
import { Board, PlayingCard } from '../components/cards';
import { ActionList } from '../components/ActionList';
import { actionColors } from '../components/colors';
import { RangeGrid } from '../components/RangeGrid';

const KINDS = [
  { k: 'rfi', label: 'First in (open or fold)' },
  { k: 'vsopen', label: 'Facing an open' },
  { k: 'vs3bet', label: 'Facing a 3-bet' },
  { k: 'vs4bet', label: 'Facing a 4-bet' },
  { k: 'vs5bet', label: 'Facing an all-in' },
];

function spotKeys(kinds: string[], positions: string[]): string[] {
  const out: string[] = [];
  const P = POSITIONS;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const o = P[i], d = P[j];
    if (i === 5) continue; // BB never opens
    if (j === i && kinds.includes('rfi') && positions.includes(o)) out.push(`rfi:${o}`);
    if (j > i) {
      if (kinds.includes('vsopen') && positions.includes(d)) out.push(`vsopen:${d}:${o}`);
      if (kinds.includes('vs3bet') && positions.includes(o)) out.push(`vs3bet:${o}:${d}`);
      if (kinds.includes('vs4bet') && positions.includes(d)) out.push(`vs4bet:${d}:${o}`);
      if (kinds.includes('vs5bet') && positions.includes(o)) out.push(`vs5bet:${o}:${d}`);
    }
  }
  return [...new Set(out)];
}

const gradeLabel: Record<string, string> = { good: 'Best', ok: 'Fine', inaccuracy: 'Inaccuracy', mistake: 'Mistake' };

function PreflopDrill() {
  const data = useUserData();
  const prefs = data.drills;
  const keys = useMemo(() => spotKeys(prefs.preflopKinds, prefs.positions), [prefs.preflopKinds, prefs.positions]);
  const [q, setQ] = useState<{ sp: PreflopSpot; cls: number; cards: [number, number] } | null>(null);
  const [answer, setAnswer] = useState<number | null>(null);
  const [session, setSession] = useState({ n: 0, score: 0 });

  const next = useCallback(() => {
    if (!keys.length) { setQ(null); return; }
    for (let tries = 0; tries < 50; tries++) {
      const sp = spot(keys[(Math.random() * keys.length) | 0]);
      const w = sp.reach.map((r, i) => r * comboCount(HAND_CLASSES[i]));
      const tot = w.reduce((s, x) => s + x, 0);
      if (tot <= 0) continue;
      let x = Math.random() * tot, cls = 0;
      while (cls < 168 && x > w[cls]) { x -= w[cls]; cls++; }
      // favour interesting decisions: skip most trivial folds of junk in first-in spots
      const row = sp.strat[cls];
      if (Math.max(...row) > 0.99 && sp.actions[row.indexOf(Math.max(...row))].kind === 'fold' && Math.random() < 0.6) continue;
      const combos = classCombos(HAND_CLASSES[cls]);
      const c = combos[(Math.random() * combos.length) | 0];
      setQ({ sp, cls, cards: c });
      setAnswer(null);
      return;
    }
  }, [keys]);

  useEffect(() => { next(); }, [next]);

  const choose = (a: number) => {
    if (!q || answer !== null) return;
    setAnswer(a);
    const row = q.sp.strat[q.cls];
    const f = row[a], best = Math.max(...row);
    const score = best > 0 ? Math.min(1, f / best) : 0;
    const grade = f >= best - 1e-6 || f >= 0.5 ? 'good' : f >= 0.15 ? 'ok' : f >= 0.04 ? 'inaccuracy' : 'mistake';
    recordDrill('preflop', { t: Date.now(), spot: q.sp.key, hand: HAND_CLASSES[q.cls], chosen: q.sp.actions[a].label, grade }, score);
    setSession((s) => ({ n: s.n + 1, score: s.score + score }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q) return;
      if (answer === null && /^[1-4]$/.test(e.key)) { const a = +e.key - 1; if (a < q.sp.actions.length) choose(a); }
      else if (answer !== null && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); next(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggle = (field: 'preflopKinds' | 'positions', v: string) => updateData((d) => {
    const arr = d.drills[field];
    d.drills[field] = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  });

  const colors = q ? actionColors(q.sp.actions.map((a) => a.label)) : [];
  const row = q ? q.sp.strat[q.cls] : [];
  const grade = q && answer !== null ? (row[answer] >= Math.max(...row) - 1e-6 || row[answer] >= 0.5 ? 'good' : row[answer] >= 0.15 ? 'ok' : row[answer] >= 0.04 ? 'inaccuracy' : 'mistake') : null;
  return (
    <div className="study">
      <div className="col" style={{ gap: 14 }}>
        {!q ? <div className="panel muted">Pick at least one spot type and position on the right.</div> : (
          <div className="panel col" style={{ gap: 14 }}>
            <div className="row">
              <h2 style={{ margin: 0 }}>{q.sp.title}</h2>
              <div className="spacer" />
              <span className="chip">Pot {q.sp.pot.toFixed(1)}bb</span>
              {q.sp.toCall > 0 && <span className="chip">To call {q.sp.toCall.toFixed(1)}bb</span>}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <PlayingCard card={q.cards[0]} large /><PlayingCard card={q.cards[1]} large />
              <span className="muted" style={{ marginLeft: 8 }}>You are {q.sp.hero} with {HAND_CLASSES[q.cls]}</span>
            </div>
            <div className="row">
              {q.sp.actions.map((a, k) => (
                <button key={k} onClick={() => choose(k)} disabled={answer !== null} className={answer === k ? 'sel' : ''} style={{ borderColor: colors[k] }}>
                  <span className="kbd">{k + 1}</span>{a.label}
                </button>
              ))}
            </div>
            {answer !== null && grade && (
              <div className="feedback col">
                <div className="row"><span className={`tag ${grade}`}>{gradeLabel[grade]}</span><span>You chose {q.sp.actions[answer].label}.</span></div>
                <ActionList items={q.sp.actions.map((a, k) => ({ label: a.label, color: colors[k], freq: row[k] }))} highlight={answer} />
                <div className="row"><button className="primary" onClick={next}>Next hand <span className="kbd">Space</span></button></div>
              </div>
            )}
          </div>
        )}
        {q && answer !== null && (
          <div className="panel">
            <h3>Full range for this spot</h3>
            <div style={{ maxWidth: 460 }}>
              <RangeGrid hovered={q.cls} cell={(i) => ({ weight: q.sp.reach[i], segments: q.sp.strat[i].map((f, k) => ({ f, color: colors[k] })) })} />
            </div>
          </div>
        )}
      </div>
      <div className="col" style={{ gap: 14 }}>
        <div className="panel row" style={{ gap: 24 }}>
          <div className="stat"><span className="muted small">This session</span><b>{session.n ? Math.round((session.score / session.n) * 100) : 0}%</b></div>
          <div className="stat"><span className="muted small">Hands</span><b>{session.n}</b></div>
          <div className="stat"><span className="muted small">All time</span><b>{data.stats.preflop.attempts ? Math.round((data.stats.preflop.score / data.stats.preflop.attempts) * 100) : 0}%</b></div>
        </div>
        <div className="panel col">
          <h3>Spot types</h3>
          {KINDS.map((k) => (
            <label key={k.k} className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={prefs.preflopKinds.includes(k.k)} onChange={() => toggle('preflopKinds', k.k)} />{k.label}
            </label>
          ))}
          <h3 style={{ marginTop: 8 }}>Your position</h3>
          <div className="row" style={{ gap: 6 }}>
            {POSITIONS.map((p) => (
              <button key={p} className={prefs.positions.includes(p) ? 'sel' : ''} onClick={() => toggle('positions', p)}>{p}</button>
            ))}
          </div>
          <span className="muted small">{keys.length} spots in rotation. Your choices are saved with your data.</span>
        </div>
        <RecentHistory kind="preflop" />
      </div>
    </div>
  );
}

function RecentHistory({ kind }: { kind: 'preflop' | 'postflop' }) {
  const data = useUserData();
  const h = data.stats[kind].history.slice(-8).reverse();
  if (!h.length) return null;
  return (
    <div className="panel">
      <h3>Recent</h3>
      <table className="t">
        <tbody>
          {h.map((r, i) => (
            <tr key={i}><td>{r.hand}</td><td className="muted small">{r.spot}</td><td>{r.chosen}</td><td><span className={`tag ${r.grade}`}>{gradeLabel[r.grade] ?? r.grade}</span></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PostHand {
  hero: 0 | 1;
  hands: [number, number]; // index into solver hands for OOP, IP
  path: number[];
  log: string[];
  info: NodeInfo | null;
  feedback: null | { chosen: number; labels: string[]; freqs: number[]; evs: number[]; grade: string; loss: number };
  done: boolean;
}

function PostflopDrill() {
  const status = useSolverStatus();
  const data = useUserData();
  const setup = useSetup();
  const [hand, setHand] = useState<PostHand | null>(null);
  const [session, setSession] = useState({ n: 0, score: 0 });
  const [err, setErr] = useState('');
  const ready = status.state === 'done' && !!solverClient.hands;
  const cfg = solverClient.config;
  const names = [setup.oopName || 'OOP', setup.ipName || 'IP'];

  const deal = useCallback(() => {
    const H = solverClient.hands!;
    const side = data.drills.postflopSide;
    const hero: 0 | 1 = side === 'oop' ? 0 : side === 'ip' ? 1 : Math.random() < 0.5 ? 0 : 1;
    const pick = (arr: { w: number; c1: number; c2: number }[], avoid: number[]) => {
      const ok = arr.map((h, i) => ({ h, i })).filter(({ h }) => h.w > 0 && !avoid.includes(h.c1) && !avoid.includes(h.c2));
      const tot = ok.reduce((s, x) => s + x.h.w, 0);
      let x = Math.random() * tot;
      for (const o of ok) { x -= o.h.w; if (x <= 0) return o.i; }
      return ok[ok.length - 1]?.i ?? 0;
    };
    const a = pick(H[0], []);
    const b = pick(H[1], [H[0][a].c1, H[0][a].c2]);
    setErr('');
    setHand({ hero, hands: [a, b], path: [], log: [], info: null, feedback: null, done: false });
  }, [data.drills.postflopSide]);

  useEffect(() => { if (ready) deal(); }, [ready, deal, solverClient.version]);

  // Advance through villain decisions and dealt cards until the hero must act.
  useEffect(() => {
    if (!hand || hand.done || hand.info || !ready) return;
    let live = true;
    solverClient.query(hand.path).then((info) => {
      if (!live) return;
      const H = solverClient.hands!;
      const held = [H[0][hand.hands[0]].c1, H[0][hand.hands[0]].c2, H[1][hand.hands[1]].c1, H[1][hand.hands[1]].c2];
      if (info.kind === 'terminal') { setHand({ ...hand, info, done: true }); return; }
      if (info.kind === 'chance') {
        const cards = info.cards!.filter((c) => !held.includes(c));
        const c = cards[(Math.random() * cards.length) | 0];
        setHand({ ...hand, path: [...hand.path, c], log: [...hand.log, `${info.board.length === 3 ? 'Turn' : 'River'} dealt`] });
        return;
      }
      if (info.player !== hand.hero) {
        const n = H[info.player!].length, idx = hand.hands[info.player!];
        let x = Math.random(), a = 0;
        for (; a < info.labels!.length - 1; a++) { x -= info.strategy![a * n + idx]; if (x <= 0) break; }
        setHand({ ...hand, path: [...hand.path, a], log: [...hand.log, `${names[info.player!]}: ${info.labels![a]}`] });
        return;
      }
      setHand({ ...hand, info });
    }).catch((e) => { if (live && !isAbort(e)) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand, ready]);

  // keys: 1-6 pick an action, Space/Enter continues or deals the next hand
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (!ready || !cfg) {
    keyRef.current = () => {};
    return (
      <div className="panel col">
        <h2>No solved spot yet</h2>
        <p className="muted">Postflop drills play hands from the spot you solved most recently. Solve a spot first, then come back.</p>
        <div><Link to="/solver"><button className="primary">Go to the solver</button></Link></div>
      </div>
    );
  }
  if (!hand) { keyRef.current = () => {}; return <div className="panel muted">Dealing…</div>; }
  const H = solverClient.hands!;
  const me = H[hand.hero][hand.hands[hand.hero]];
  const opp = H[1 - hand.hero][hand.hands[1 - hand.hero]];
  const info = hand.info;
  const board = info?.board ?? cfg.board;
  const myTurn = info?.kind === 'action' && info.player === hand.hero && !hand.feedback;
  const colors = info?.labels ? actionColors(info.labels) : [];

  const choose = (a: number) => {
    if (!info || !info.labels) return;
    const n = H[hand.hero].length, idx = hand.hands[hand.hero];
    const freqs = info.labels.map((_, k) => info.strategy![k * n + idx]);
    const evs = info.labels.map((_, k) => info.actionEv![k * n + idx]);
    const best = Math.max(...evs.filter(isFinite));
    const loss = isFinite(evs[a]) && isFinite(best) ? Math.max(0, best - evs[a]) : 0;
    const rel = loss / Math.max(0.5, info.pot);
    const grade = freqs[a] >= 0.5 || rel < 0.01 ? 'good' : freqs[a] >= 0.1 || rel < 0.04 ? 'ok' : rel < 0.12 ? 'inaccuracy' : 'mistake';
    const score = Math.max(0, 1 - rel / 0.12);
    recordDrill('postflop', { t: Date.now(), spot: `${names[hand.hero]} ${board.length === 3 ? 'flop' : board.length === 4 ? 'turn' : 'river'}`, hand: comboStr(me.c1, me.c2), chosen: info.labels[a], grade, evLoss: loss }, score);
    setSession((s) => ({ n: s.n + 1, score: s.score + score }));
    setHand({ ...hand, feedback: { chosen: a, labels: info.labels, freqs, evs, grade, loss } });
  };
  const proceed = () => {
    if (!hand.feedback) return;
    setHand({ ...hand, path: [...hand.path, hand.feedback.chosen], log: [...hand.log, `You: ${hand.feedback.labels[hand.feedback.chosen]}`], info: null, feedback: null });
  };

  keyRef.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (myTurn && /^[1-6]$/.test(e.key)) { const a = +e.key - 1; if (a < info!.labels!.length) choose(a); }
    else if (e.key === ' ' || e.key === 'Enter') {
      if (hand.feedback) { e.preventDefault(); proceed(); }
      else if (hand.done) { e.preventDefault(); deal(); }
    }
  };

  return (
    <div className="study">
      <div className="panel col" style={{ gap: 14 }}>
        {err && <div className="err">{err} <button className="ghost" onClick={deal}>Deal a new hand</button></div>}
        <div className="row">
          <h2 style={{ margin: 0 }}>You are {hand.hero === 0 ? 'OOP' : 'IP'} ({names[hand.hero]})</h2>
          <div className="spacer" />
          {info && <span className="chip">Pot {info.pot.toFixed(1)}bb</span>}
        </div>
        <Board cards={board} slots={5} large />
        <div className="row" style={{ gap: 6 }}>
          <PlayingCard card={me.c1} large /><PlayingCard card={me.c2} large />
          {hand.done && <><span className="muted" style={{ margin: '0 8px' }}>vs</span><PlayingCard card={opp.c1} large /><PlayingCard card={opp.c2} large /></>}
        </div>
        <div className="small muted">{hand.log.length ? hand.log.join(' · ') : 'New hand.'}</div>
        {myTurn && (
          <div className="row">
            {info!.labels!.map((l, k) => <button key={k} onClick={() => choose(k)} style={{ borderColor: colors[k] }}><span className="kbd">{k + 1}</span>{l}</button>)}
          </div>
        )}
        {hand.feedback && (
          <div className="feedback col">
            <div className="row">
              <span className={`tag ${hand.feedback.grade}`}>{gradeLabel[hand.feedback.grade]}</span>
              <span>{hand.feedback.loss < 0.005 ? 'Highest EV choice.' : `You gave up ${hand.feedback.loss.toFixed(2)}bb of EV.`}</span>
            </div>
            <ActionList items={hand.feedback.labels.map((l, k) => ({ label: l, color: colors[k], freq: hand.feedback!.freqs[k], ev: hand.feedback!.evs[k] }))} highlight={hand.feedback.chosen} />
            <div><button className="primary" onClick={proceed}>Continue <span className="kbd">Space</span></button></div>
          </div>
        )}
        {hand.done && (
          <div className="feedback col">
            <b>{info?.folder !== undefined && info.folder >= 0 ? `${info.folder === hand.hero ? 'You fold' : 'Opponent folds'}.` : 'Showdown.'}</b>
            <div><button className="primary" onClick={deal}>Next hand <span className="kbd">Space</span></button></div>
          </div>
        )}
      </div>
      <div className="col" style={{ gap: 14 }}>
        <div className="panel row" style={{ gap: 24 }}>
          <div className="stat"><span className="muted small">This session</span><b>{session.n ? Math.round((session.score / session.n) * 100) : 0}%</b></div>
          <div className="stat"><span className="muted small">Decisions</span><b>{session.n}</b></div>
          <div className="stat"><span className="muted small">All time</span><b>{data.stats.postflop.attempts}</b></div>
        </div>
        <div className="panel col">
          <h3>Play as</h3>
          <div className="seg">
            {(['oop', 'ip', 'random'] as const).map((s) => (
              <button key={s} className={data.drills.postflopSide === s ? 'on' : ''} onClick={() => updateData((d) => { d.drills.postflopSide = s; })}>{s === 'oop' ? 'OOP' : s === 'ip' ? 'IP' : 'Random'}</button>
            ))}
          </div>
          <span className="muted small">Your opponent plays the solver's strategy. Every decision is graded by the EV you give up compared with the best action for your exact hand.</span>
        </div>
      </div>
    </div>
  );
}

export function TrainerPage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') === 'postflop' ? 'postflop' : 'preflop';
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Spot drills</h1>
          <p>Practice decisions and get instant feedback. Keys 1 to 4 pick an action, Space moves to the next hand.</p>
        </div>
        <div className="seg">
          <button className={mode === 'preflop' ? 'on' : ''} onClick={() => setParams({})}>Preflop</button>
          <button className={mode === 'postflop' ? 'on' : ''} onClick={() => setParams({ mode: 'postflop' })}>Postflop</button>
        </div>
      </div>
      {mode === 'preflop' ? <PreflopDrill /> : <PostflopDrill />}
    </div>
  );
}
