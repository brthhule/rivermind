import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlayHand, GRADE_LABEL, GRADE_TAG, type Grade, type StrategyGrid } from '../practice/play';
import { practiceClient } from '../solver/client';
import { POSITIONS, presetSpots, type Pos } from '../engine/preflop';
import { HAND_CLASSES } from '../engine/cards';
import { updateData, useUserData, type PlayPrefs, type PlayRecord } from '../store/userData';
import { PlayingCard } from '../components/cards';
import { actionColors } from '../components/colors';
import { ActionList } from '../components/ActionList';
import { HandReplayer } from '../components/HandReplayer';
import { RangeGrid } from '../components/RangeGrid';
import { Modal } from '../components/Modal';
import { WhyPanel } from '../components/WhyPanel';
import { PreflopWhyBox } from '../components/PreflopWhyBox';

// seat slots around the oval, clockwise starting from the hero at the bottom (x%, y%)
const SLOTS: [number, number][] = [[50, 86], [11, 66], [11, 22], [50, 5], [89, 22], [89, 66]];
// where each slot's bet chip sits, nudged toward the middle
const CHIP: [number, number][] = [[50, 66], [27, 60], [27, 33], [50, 25], [73, 33], [73, 60]];

function Table({ hand }: { hand: PlayHand | null }) {
  if (!hand) {
    return <div className="ptable"><div className="pt-felt" /><div className="pt-empty">Press Deal to start a hand.</div></div>;
  }
  const heroIdx = POSITIONS.indexOf(hand.heroPos);
  const order = POSITIONS.map((_, k) => POSITIONS[(heroIdx + k) % 6]) as Pos[];
  const showdown = hand.status === 'done' && hand.result?.showdown;
  const potShown = hand.pending?.pot ?? hand.feedback?.pot ?? hand.pot;
  return (
    <div className="ptable">
      <div className="pt-felt" />
      <div className="pt-center">
        <div className="row" style={{ gap: 5, justifyContent: 'center' }}>
          {[0, 1, 2, 3, 4].map((i) => <PlayingCard key={i} card={i < hand.boardShown ? hand.runout[i] : undefined} large />)}
        </div>
        <div className="tpot">{hand.status === 'solving' ? <><span className="spin" /> {hand.statusText}</> : `Pot ${potShown.toFixed(1)}bb`}</div>
      </div>
      {order.map((pos, k) => {
        const st = hand.seats.get(pos)!;
        const isHero = pos === hand.heroPos;
        const isVillain = pos === hand.villainPos;
        const cards = hand.holes.get(pos);
        const [x, y] = SLOTS[k];
        const [cx, cy] = CHIP[k];
        const acting = isHero && hand.status === 'hero';
        return (
          <div key={pos}>
            <div className={`pt-seat${st.folded ? ' folded' : ''}${acting ? ' acting' : ''}${isHero ? ' hero' : ''}`} style={{ left: `${x}%`, top: `${y}%` }}>
              <div className="pt-cards">
                {st.folded && !isHero ? null : isHero || (isVillain && showdown)
                  ? cards!.map((c) => <PlayingCard key={c} card={c} />)
                  : <><span className="pcard back sm" /><span className="pcard back sm" /></>}
              </div>
              <div className="pt-plate">
                <span className="pt-pos">{pos}{isHero ? ' · You' : ''}</span>
                <span className="pt-stack">{st.stack.toFixed(1)}bb</span>
              </div>
              {st.action && <div className={`pt-act${/Fold/.test(st.action) ? ' fold' : /Call|Check/.test(st.action) ? ' pass' : ' agg'}`}>{st.action}</div>}
              {pos === 'BTN' && <span className="pt-dealer">D</span>}
            </div>
            {st.bet > 0 && !st.folded && <div className="pt-chip" style={{ left: `${cx}%`, top: `${cy}%` }}>{st.bet.toFixed(1)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function StrategyPanel({ grid, chosen }: { grid: StrategyGrid; chosen?: number }) {
  const colors = actionColors(grid.labels);
  return (
    <div className="col" style={{ gap: 8 }}>
      <RangeGrid hovered={grid.heroClass} cell={(i) => ({ weight: grid.reach[i], segments: grid.strat[i].map((f, a) => ({ f, color: colors[a] })) })} />
      <div className="row small" style={{ gap: 6 }}>
        {grid.labels.map((l, a) => <span key={a} className="chip" style={chosen === a ? { borderColor: 'var(--accent)' } : undefined}><span style={{ width: 8, height: 8, borderRadius: 2, background: colors[a], display: 'inline-block' }} /> {l}</span>)}
      </div>
      <span className="muted small">Your whole range at this decision. Your hand, {HAND_CLASSES[grid.heroClass]}, is outlined.</span>
    </div>
  );
}

function SettingsModal({ prefs, onClose }: { prefs: PlayPrefs; onClose: () => void }) {
  const presets = useMemo(() => presetSpots(), []);
  const setPref = (p: Partial<PlayPrefs>) => updateData((d) => { d.play.prefs = { ...d.play.prefs, ...p }; });
  return (
    <Modal title="Practice settings" onClose={onClose} width={620}>
      <div className="col">
        <label className="field">Start from
          <select value={prefs.start} onChange={(e) => setPref({ start: e.target.value })}>
            <option value="preflop">Full hand from preflop (6-max)</option>
            {presets.map((p) => <option key={p.name} value={p.name}>Flop: {p.name}</option>)}
          </select>
        </label>
        {prefs.start === 'preflop' ? (
          <div className="col" style={{ gap: 6 }}>
            <span className="small muted">Your seat</span>
            <div className="row" style={{ gap: 6 }}>
              {['random', ...POSITIONS].map((p) => <button key={p} className={prefs.heroPos === p ? 'sel' : ''} onClick={() => setPref({ heroPos: p })}>{p === 'random' ? 'Random' : p}</button>)}
            </div>
          </div>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            <span className="small muted">Play as</span>
            <div className="seg">
              {(['oop', 'ip', 'random'] as const).map((s) => <button key={s} className={prefs.heroSide === s ? 'on' : ''} onClick={() => setPref({ heroSide: s })}>{s === 'oop' ? 'Out of position' : s === 'ip' ? 'In position' : 'Random'}</button>)}
            </div>
          </div>
        )}
        <div className="grid2">
          <div className="col" style={{ gap: 6 }}>
            <span className="small muted">Bet sizes</span>
            <div className="seg">
              <button className={prefs.sizing === 'simple' ? 'on' : ''} onClick={() => setPref({ sizing: 'simple' })}>Simple</button>
              <button className={prefs.sizing === 'standard' ? 'on' : ''} onClick={() => setPref({ sizing: 'standard' })}>Standard</button>
            </div>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <span className="small muted">Solve accuracy</span>
            <div className="seg">
              <button className={prefs.accuracy === 'fast' ? 'on' : ''} onClick={() => setPref({ accuracy: 'fast' })}>Fast</button>
              <button className={prefs.accuracy === 'standard' ? 'on' : ''} onClick={() => setPref({ accuracy: 'standard' })}>Precise</button>
            </div>
          </div>
        </div>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={prefs.autoObvious} onChange={(e) => setPref({ autoObvious: e.target.checked })} /> Auto-play obvious continues (95%+ raise, call or check). Folds are always yours to make.</label>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={prefs.rng} onChange={(e) => setPref({ rng: e.target.checked })} /> Show randomizer for mixed strategies</label>
        <span className="muted small">Settings apply from the next new hand and are saved with your data. Redo keeps the settings the hand was dealt with.</span>
        <div className="row"><div className="spacer" /><button className="primary" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  );
}

export function PracticePage() {
  const data = useUserData();
  const prefs = data.play.prefs;
  const [, force] = useState(0);
  const handRef = useRef<PlayHand | null>(null);
  const [session, setSession] = useState({ hands: 0, decisions: 0, evLoss: 0, best: 0, net: 0, skipped: 0 });
  const [replay, setReplay] = useState<PlayRecord | null>(null);
  const [settings, setSettings] = useState(false);
  const [tab, setTab] = useState<'log' | 'recent'>('log');
  const hand = handRef.current;

  // Stats count each decision as soon as you make it, so the bar moves even if you start a
  // new hand before the current one finishes. Hands and net are added when a hand ends.
  const counted = useRef(new WeakMap<PlayHand, { decisions: number; evLoss: number; best: number; hand: boolean; ended: boolean }>());
  const countHand = useCallback((h: PlayHand) => {
    let c = counted.current.get(h);
    if (!c) { c = { decisions: 0, evLoss: 0, best: 0, hand: false, ended: false }; counted.current.set(h, c); }
    const dd = h.decisions - c.decisions, de = h.evLoss - c.evLoss, db = h.bestCount - c.best;
    const ended = h.status === 'done' && !c.ended;
    // a hand counts once you have made a decision in it, whether or not you play it to the end
    const newHand = h.decisions > 0 && !c.hand;
    if (!dd && !ended && !newHand) return;
    c.decisions = h.decisions; c.evLoss = h.evLoss; c.best = h.bestCount;
    if (newHand) c.hand = true;
    const rec = ended ? h.record() : null;
    if (ended) c.ended = true;
    updateData((d) => {
      if (newHand) d.play.stats.hands++;
      d.play.stats.decisions += dd;
      d.play.stats.evLoss += de;
      d.play.stats.best += db;
      if (rec) { d.play.stats.net += rec.net; d.play.history = [...d.play.history, rec].slice(-200); }
    });
    setSession((s) => ({ ...s, hands: s.hands + (newHand ? 1 : 0), decisions: s.decisions + dd, evLoss: s.evLoss + de, best: s.best + db, net: s.net + (rec ? rec.net : 0) }));
  }, []);

  /** Start a hand. With a seed and settings, the exact same deal is replayed. */
  const start = useCallback((seed?: number, withPrefs?: PlayPrefs) => {
    const old = handRef.current;
    if (old) { countHand(old); old.cancel(); }
    const h = new PlayHand(withPrefs ?? data.play.prefs, practiceClient, () => force((x) => x + 1), seed);
    handRef.current = h;
    force((x) => x + 1);
    h.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.play.prefs, countHand]);
  const deal = useCallback(() => start(), [start]);
  const redo = useCallback(() => { const h = handRef.current; if (h) start(h.seed, h.settings); }, [start]);

  // leaving the page abandons the hand in progress and frees the solver
  useEffect(() => () => { handRef.current?.cancel(); }, []);

  const skippedSeen = useRef<PlayHand | null>(null);
  useEffect(() => {
    if (!hand) return;
    countHand(hand);
    // A hand that ended without a single decision for you (an automatic fold, or a walk in the
    // big blind) is not practice: drop it and deal the next one straight away.
    if (hand.status === 'skipped' && skippedSeen.current !== hand) {
      skippedSeen.current = hand;
      setSession((s) => ({ ...s, skipped: s.skipped + 1 }));
      setTimeout(() => { if (handRef.current === hand) deal(); }, 0);
    }
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = handRef.current;
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) || document.querySelector('.modal')) return;
      if (h?.status === 'hero' && /^[1-6]$/.test(e.key)) { const a = +e.key - 1; if (h.pending && a < h.pending.labels.length) h.choose(a); }
      else if (e.key === ' ' || e.key === 'Enter') {
        if (h?.status === 'feedback') { e.preventDefault(); h.proceed(); }
        else if (!h || h.status === 'done' || h.status === 'error') { e.preventDefault(); deal(); }
      } else if ((e.key === 'r' || e.key === 'R') && h && (h.status === 'done' || h.status === 'error')) redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deal, redo]);

  const d = hand?.pending ?? hand?.feedback ?? null;
  const colors = d ? actionColors(d.labels) : [];
  const acc = session.decisions ? Math.round((session.best / session.decisions) * 100) : 0;
  const street = hand ? (hand.boardShown === 0 ? 'Preflop' : hand.boardShown === 3 ? 'Flop' : hand.boardShown === 4 ? 'Turn' : 'River') : '';
  const spotLabel = prefs.start === 'preflop' ? `6-max from preflop · ${prefs.heroPos === 'random' ? 'random seat' : prefs.heroPos}` : prefs.start;

  return (
    <div className="practice">
      <div className="pbar">
        <div className="col" style={{ gap: 0 }}>
          <b>Play hands</b>
          <span className="muted small">{hand ? hand.spotName : spotLabel}{hand ? ` · ${street}` : ''}</span>
        </div>
        <button className="ghost" onClick={() => setSettings(true)}>⚙ Settings</button>
        <div className="spacer" />
        <div className="pstat"><span>Hands</span><b>{session.hands}</b></div>
        <div className="pstat"><span>Best play</span><b>{acc}%</b></div>
        <div className="pstat"><span>EV lost / dec.</span><b>{session.decisions ? (session.evLoss / session.decisions).toFixed(2) : '0.00'}</b></div>
        <div className="pstat"><span>Net</span><b style={{ color: session.net >= 0 ? 'var(--good)' : 'var(--danger)' }}>{session.net >= 0 ? '+' : ''}{session.net.toFixed(1)}bb</b></div>
        <button onClick={redo} disabled={!hand} title="Play this exact hand again: same cards and board">↺ Redo hand <span className="kbd">R</span></button>
        <button className="primary" onClick={deal}>{hand ? 'New hand' : 'Deal'} <span className="kbd">Space</span></button>
      </div>

      <div className="pgrid">
        <div className="col" style={{ gap: 12, minWidth: 0 }}>
          <Table hand={hand} />
          <div className="pactions">
            {hand?.status === 'hero' && hand.pending ? (
              <>
                {hand.pending.labels.map((l, k) => (
                  <button key={k} className="pact" onClick={() => hand.choose(k)} style={{ background: colors[k] }}>
                    <span className="kbd">{k + 1}</span>{l}
                  </button>
                ))}
                {prefs.rng && <span className="prng" title="Random number 1 to 100 for picking between mixed actions">RNG <b>{hand.pending.rng}</b></span>}
              </>
            ) : hand?.status === 'feedback' ? (
              <button className="pact primary" onClick={() => hand.proceed()}>Continue <span className="kbd">Space</span></button>
            ) : hand?.status === 'done' ? (
              <>
                <span className="pres">{hand.result?.text}</span>
                <b style={{ color: (hand.result?.net ?? 0) >= 0 ? 'var(--good)' : 'var(--danger)' }}>{(hand.result?.net ?? 0) >= 0 ? '+' : ''}{hand.result?.net.toFixed(1)}bb</b>
                <div className="spacer" />
                <button onClick={redo}>↺ Redo hand</button>
                <button className="primary" onClick={deal}>Next hand <span className="kbd">Space</span></button>
              </>
            ) : hand?.status === 'error' ? (
              <span className="err">{hand.error}</span>
            ) : (
              <span className="muted">{hand ? (hand.status === 'solving' ? hand.statusText : 'Waiting…') : 'Press Deal to start.'}</span>
            )}
          </div>
        </div>

        <div className="col" style={{ gap: 12, minWidth: 0 }}>
          <div className="panel col">
            {hand?.feedback ? (
              <>
                <div className="row">
                  <span className={`tag ${GRADE_TAG[hand.feedback.grade]}`} style={{ fontSize: 13 }}>{GRADE_LABEL[hand.feedback.grade]}</span>
                  <span className="small">
                    {hand.feedback.evs ? (hand.feedback.evLoss < 0.01 ? 'Highest EV play.' : `EV lost ${hand.feedback.evLoss.toFixed(2)}bb.`) : `Played ${Math.round(hand.feedback.freqs[hand.feedback.chosen] * 100)}% by the model.`}
                    {prefs.rng && ` RNG ${hand.feedback.rng} → ${hand.feedback.labels[hand.feedback.rngPick]}.`}
                  </span>
                </div>
                <ActionList items={hand.feedback.labels.map((l, k) => ({ label: l, color: colors[k], freq: hand.feedback!.freqs[k], ev: hand.feedback!.evs?.[k] }))} highlight={hand.feedback.chosen} />
                {hand.feedback.explain && <WhyPanel load={hand.feedback.explain} chosen={hand.feedback.chosen} opp={hand.villainPos ?? 'Villain'} />}
                {hand.feedback.pre && <PreflopWhyBox sp={hand.feedback.pre.sp} cls={hand.feedback.pre.cls} chosen={hand.feedback.chosen} note="The chart below shows what every hand does here." />}
                {hand.feedback.grid && <StrategyPanel grid={hand.feedback.grid} chosen={hand.feedback.chosen} />}
              </>
            ) : hand?.status === 'hero' ? (
              <div className="col">
                <h2 style={{ margin: 0 }}>Your decision</h2>
                <span className="muted">Pick an action below. The strategy for your whole range appears here after you act.</span>
              </div>
            ) : hand?.status === 'done' ? (
              <div className="col">
                <h2 style={{ margin: 0 }}>{hand.result?.text}</h2>
                <span className="muted">{hand.decisions} decision{hand.decisions === 1 ? '' : 's'}, {hand.evLoss.toFixed(2)}bb EV lost. Press R to replay this exact hand and try different lines.</span>
              </div>
            ) : (
              <span className="muted">Each decision is scored after you make it. Use Redo to play the same cards and board again.</span>
            )}
          </div>
          <div className="panel col">
            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Hand log</button>
              <button className={tab === 'recent' ? 'on' : ''} onClick={() => setTab('recent')}>Recent hands</button>
            </div>
            {tab === 'log' ? (
              !hand ? <span className="muted small">No hand yet.</span> : (
                <table className="t">
                  <tbody>
                    {hand.log.map((l, i) => (
                      <tr key={i}>
                        <td className="muted small" style={{ width: 56 }}>{l.street}</td>
                        <td style={{ width: 70 }}>{l.who}</td>
                        <td>{l.text}</td>
                        <td style={{ textAlign: 'right' }}>{l.grade && <span className={`tag ${GRADE_TAG[l.grade as Grade]}`}>{GRADE_LABEL[l.grade as Grade]}{l.evLoss ? ` −${l.evLoss.toFixed(2)}` : ''}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : data.play.history.length === 0 ? <span className="muted small">Finished hands appear here.</span> : (
              <table className="t">
                <tbody>
                  {data.play.history.slice(-12).reverse().map((r) => (
                    <tr key={r.t}>
                      <td>{r.hero}</td>
                      <td><span className="row" style={{ gap: 2 }}>{r.heroCards.map((c) => <PlayingCard key={c} card={c} />)}</span></td>
                      <td className="small muted">−{r.evLoss.toFixed(2)} EV</td>
                      <td style={{ color: r.net >= 0 ? 'var(--good)' : 'var(--danger)' }}>{r.net >= 0 ? '+' : ''}{r.net.toFixed(1)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="ghost" onClick={() => setReplay(r)} title="Watch the hand">▶</button>
                        {r.seed !== undefined && r.prefs && <button className="ghost" onClick={() => start(r.seed, r.prefs)} title="Play this hand again">↺</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      {settings && <SettingsModal prefs={prefs} onClose={() => setSettings(false)} />}
      {replay && <HandReplayer record={replay} onClose={() => setReplay(null)} />}
    </div>
  );
}
