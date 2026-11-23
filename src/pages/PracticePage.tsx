import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlayHand, GRADE_LABEL, GRADE_TAG, type Grade } from '../practice/play';
import { practiceClient } from '../solver/client';
import { POSITIONS, presetSpots } from '../engine/preflop';
import { updateData, useUserData, type PlayPrefs } from '../store/userData';
import { PlayingCard } from '../components/cards';
import { actionColors } from '../components/colors';
import { ActionList } from '../components/ActionList';
import { HandReplayer } from '../components/HandReplayer';

function Seat({ label, cards, hidden, active, chips }: { label: string; cards?: number[]; hidden?: boolean; active?: boolean; chips?: string }) {
  return (
    <div className={`tseat${active ? ' active' : ''}`}>
      <div className="row" style={{ gap: 4, justifyContent: 'center' }}>
        {cards ? (hidden ? <><span className="pcard back" /><span className="pcard back" /></> : cards.map((c) => <PlayingCard key={c} card={c} large />)) : null}
      </div>
      <div className="tname">{label}{chips ? <span className="muted"> · {chips}</span> : null}</div>
    </div>
  );
}

export function PracticePage() {
  const data = useUserData();
  const prefs = data.play.prefs;
  const [, force] = useState(0);
  const handRef = useRef<PlayHand | null>(null);
  const [session, setSession] = useState({ hands: 0, decisions: 0, evLoss: 0, best: 0, net: 0, skipped: 0 });
  const [replay, setReplay] = useState<number | null>(null);
  const presets = useMemo(() => presetSpots(), []);
  const hand = handRef.current;

  const setPref = (p: Partial<PlayPrefs>) => updateData((d) => { d.play.prefs = { ...d.play.prefs, ...p }; });

  const deal = useCallback(() => {
    const h = new PlayHand(data.play.prefs, practiceClient, () => force((x) => x + 1));
    handRef.current = h;
    force((x) => x + 1);
    h.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.play.prefs]);

  // record finished hands; quietly skip hands that were auto-folded preflop with no decisions
  const recorded = useRef<PlayHand | null>(null);
  useEffect(() => {
    if (!hand || hand.status !== 'done' || recorded.current === hand) return;
    recorded.current = hand;
    if (hand.decisions === 0 && hand.log.some((l) => /fold/i.test(l.text) && l.who === 'You') && prefs.autoObvious) {
      setSession((s) => ({ ...s, skipped: s.skipped + 1 }));
      const t = setTimeout(deal, 350);
      return () => clearTimeout(t);
    }
    const rec = hand.record();
    updateData((d) => {
      d.play.stats.hands++;
      d.play.stats.decisions += hand.decisions;
      d.play.stats.evLoss += hand.evLoss;
      d.play.stats.best += hand.bestCount;
      d.play.stats.net += rec.net;
      d.play.history = [...d.play.history, rec].slice(-200);
    });
    setSession((s) => ({ ...s, hands: s.hands + 1, decisions: s.decisions + hand.decisions, evLoss: s.evLoss + hand.evLoss, best: s.best + hand.bestCount, net: s.net + rec.net }));
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = handRef.current;
      if (!h || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (h.status === 'hero' && /^[1-6]$/.test(e.key)) { const a = +e.key - 1; if (h.pending && a < h.pending.labels.length) h.choose(a); }
      else if (e.key === ' ' || e.key === 'Enter') {
        if (h.status === 'feedback') { e.preventDefault(); h.proceed(); }
        else if (h.status === 'done' || h.status === 'error') { e.preventDefault(); deal(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deal]);

  const d = hand?.pending ?? hand?.feedback ?? null;
  const colors = d ? actionColors(d.labels) : [];
  const acc = session.decisions ? Math.round((session.best / session.decisions) * 100) : 0;
  const villainShown = hand && hand.status === 'done' && hand.result?.showdown;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Play hands</h1>
          <p>Play complete hands against the strategy. Preflop follows the 6-max model. On every postflop street the strategy is re-solved from both players' real ranges, and each of your decisions is scored by the EV it gives up.</p>
        </div>
        <div className="row">
          <button className="primary" onClick={deal}>{hand ? 'New hand' : 'Deal'} <span className="kbd">Space</span></button>
        </div>
      </div>
      <div className="study" style={{ gridTemplateColumns: 'minmax(380px, 760px) minmax(280px, 1fr)' }}>
        <div className="col" style={{ gap: 14 }}>
          <div className="felt">
            {!hand ? (
              <div className="muted" style={{ textAlign: 'center', padding: 60 }}>Choose a starting point on the right, then press Deal.</div>
            ) : (
              <>
                <Seat label={hand.villainPos ? `${hand.villainPos} (villain)` : 'Opponents'} cards={hand.villainCards} hidden={!villainShown} />
                <div className="tcenter">
                  <div className="row" style={{ gap: 6, justifyContent: 'center', minHeight: 60 }}>
                    {[0, 1, 2, 3, 4].map((i) => <PlayingCard key={i} card={i < hand.boardShown ? hand.runout[i] : undefined} large />)}
                  </div>
                  <div className="tpot">{hand.status === 'solving' ? hand.statusText : `Pot ${(hand.pending?.pot ?? hand.feedback?.pot ?? hand.pot).toFixed(1)}bb`}</div>
                </div>
                <Seat label={`${hand.heroPos} (you)`} cards={hand.heroCards} active={hand.status === 'hero'} />
              </>
            )}
          </div>

          {hand?.status === 'hero' && hand.pending && (
            <div className="panel col">
              <div className="row">
                {hand.pending.labels.map((l, k) => (
                  <button key={k} onClick={() => hand.choose(k)} style={{ borderColor: colors[k] }}><span className="kbd">{k + 1}</span>{l}</button>
                ))}
                <div className="spacer" />
                {prefs.rng && <span className="chip" title="Use this number to pick between mixed actions">RNG {hand.pending.rng}</span>}
              </div>
            </div>
          )}

          {hand?.status === 'feedback' && hand.feedback && (
            <div className="panel col">
              <div className="row">
                <span className={`tag ${GRADE_TAG[hand.feedback.grade]}`}>{GRADE_LABEL[hand.feedback.grade]}</span>
                <span>
                  You chose {hand.feedback.labels[hand.feedback.chosen]}.
                  {hand.feedback.evs ? (hand.feedback.evLoss < 0.01 ? ' That is the highest EV play.' : ` EV lost: ${hand.feedback.evLoss.toFixed(2)}bb.`) : ` The model plays it ${Math.round(hand.feedback.freqs[hand.feedback.chosen] * 100)}% of the time.`}
                </span>
              </div>
              <ActionList items={hand.feedback.labels.map((l, k) => ({ label: l, color: colors[k], freq: hand.feedback!.freqs[k], ev: hand.feedback!.evs?.[k] }))} highlight={hand.feedback.chosen} />
              {prefs.rng && <span className="small muted">RNG {hand.feedback.rng} points to {hand.feedback.labels[hand.feedback.rngPick]}.</span>}
              <div><button className="primary" onClick={() => hand.proceed()}>Continue <span className="kbd">Space</span></button></div>
            </div>
          )}

          {hand?.status === 'done' && hand.result && (
            <div className="panel col">
              <div className="row">
                <h2 style={{ margin: 0 }}>{hand.result.text}</h2>
                <div className="spacer" />
                <b style={{ color: hand.result.net >= 0 ? 'var(--good)' : 'var(--danger)' }}>{hand.result.net >= 0 ? '+' : ''}{hand.result.net.toFixed(1)}bb</b>
              </div>
              <span className="muted">{hand.decisions} decision{hand.decisions === 1 ? '' : 's'}, {hand.evLoss.toFixed(2)}bb EV lost.</span>
              <div><button className="primary" onClick={deal}>Next hand <span className="kbd">Space</span></button></div>
            </div>
          )}
          {hand?.status === 'error' && <div className="err">{hand.error}</div>}

          {hand && (
            <div className="panel">
              <h3>Hand log</h3>
              <table className="t">
                <tbody>
                  {hand.log.map((l, i) => (
                    <tr key={i}>
                      <td className="muted small" style={{ width: 60 }}>{l.street}</td>
                      <td style={{ width: 90 }}>{l.who}</td>
                      <td>{l.text}</td>
                      <td style={{ textAlign: 'right' }}>{l.grade && <span className={`tag ${GRADE_TAG[l.grade as Grade]}`}>{GRADE_LABEL[l.grade as Grade]}{l.evLoss ? ` −${l.evLoss.toFixed(2)}` : ''}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="panel row" style={{ gap: 22 }}>
            <div className="stat"><span className="muted small">Hands</span><b>{session.hands}</b></div>
            <div className="stat"><span className="muted small">Best-play rate</span><b>{acc}%</b></div>
            <div className="stat"><span className="muted small">EV lost / decision</span><b>{session.decisions ? (session.evLoss / session.decisions).toFixed(2) : '0.00'}</b></div>
            <div className="stat"><span className="muted small">Net</span><b style={{ color: session.net >= 0 ? 'var(--good)' : 'var(--danger)' }}>{session.net >= 0 ? '+' : ''}{session.net.toFixed(1)}</b></div>
          </div>
          <div className="panel col">
            <h3>Start from</h3>
            <select value={prefs.start} onChange={(e) => setPref({ start: e.target.value })}>
              <option value="preflop">Full hand from preflop (6-max)</option>
              {presets.map((p) => <option key={p.name} value={p.name}>Flop: {p.name}</option>)}
            </select>
            {prefs.start === 'preflop' ? (
              <>
                <h3 style={{ marginTop: 6 }}>Your seat</h3>
                <div className="row" style={{ gap: 6 }}>
                  {['random', ...POSITIONS].map((p) => <button key={p} className={prefs.heroPos === p ? 'sel' : ''} onClick={() => setPref({ heroPos: p })}>{p === 'random' ? 'Random' : p}</button>)}
                </div>
              </>
            ) : (
              <>
                <h3 style={{ marginTop: 6 }}>Play as</h3>
                <div className="seg">
                  {(['oop', 'ip', 'random'] as const).map((s) => <button key={s} className={prefs.heroSide === s ? 'on' : ''} onClick={() => setPref({ heroSide: s })}>{s === 'oop' ? 'Out of position' : s === 'ip' ? 'In position' : 'Random'}</button>)}
                </div>
              </>
            )}
            <h3 style={{ marginTop: 6 }}>Bet sizes</h3>
            <div className="seg">
              <button className={prefs.sizing === 'simple' ? 'on' : ''} onClick={() => setPref({ sizing: 'simple' })}>Simple (one size)</button>
              <button className={prefs.sizing === 'standard' ? 'on' : ''} onClick={() => setPref({ sizing: 'standard' })}>Standard (two sizes)</button>
            </div>
            <h3 style={{ marginTop: 6 }}>Solve accuracy</h3>
            <div className="seg">
              <button className={prefs.accuracy === 'fast' ? 'on' : ''} onClick={() => setPref({ accuracy: 'fast' })}>Fast</button>
              <button className={prefs.accuracy === 'standard' ? 'on' : ''} onClick={() => setPref({ accuracy: 'standard' })}>Precise</button>
            </div>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={prefs.autoObvious} onChange={(e) => setPref({ autoObvious: e.target.checked })} /> Auto-play obvious decisions (95%+) and skip pure folds</label>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={prefs.rng} onChange={(e) => setPref({ rng: e.target.checked })} /> Show randomizer for mixed strategies</label>
            <span className="muted small">Settings apply from the next hand and are saved with your data.</span>
          </div>
          <div className="panel col">
            <div className="row"><h3 style={{ margin: 0 }}>Recent hands</h3><div className="spacer" /><span className="muted small">All time: {data.play.stats.hands} hands, {data.play.stats.decisions ? Math.round((data.play.stats.best / data.play.stats.decisions) * 100) : 0}% best</span></div>
            {data.play.history.length === 0 ? <span className="muted small">Finished hands appear here. Click one to replay it.</span> : (
              <table className="t">
                <tbody>
                  {data.play.history.slice(-10).reverse().map((r, i) => {
                    const idx = data.play.history.length - 1 - i;
                    return (
                      <tr key={r.t} style={{ cursor: 'pointer' }} onClick={() => setReplay(idx)}>
                        <td>{r.hero}</td>
                        <td><span className="row" style={{ gap: 2 }}>{r.heroCards.map((c) => <PlayingCard key={c} card={c} />)}</span></td>
                        <td className="small muted">{r.decisions} dec · −{r.evLoss.toFixed(2)} EV</td>
                        <td style={{ color: r.net >= 0 ? 'var(--good)' : 'var(--danger)', textAlign: 'right' }}>{r.net >= 0 ? '+' : ''}{r.net.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      {replay !== null && data.play.history[replay] && <HandReplayer record={data.play.history[replay]} onClose={() => setReplay(null)} />}
    </div>
  );
}
