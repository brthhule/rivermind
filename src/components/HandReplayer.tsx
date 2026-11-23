import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { PlayingCard } from './cards';

export interface ReplayStep { street: string; who: string; text: string; grade?: string; evLoss?: number }
export interface ReplayData {
  title?: string;
  hero: string;
  heroCards: number[];
  villainCards?: number[];
  board: number[];
  log: ReplayStep[];
  net: number;
}

const boardCount = (street: string) => (/flop/i.test(street) ? 3 : /turn/i.test(street) ? 4 : /river|result|showdown/i.test(street) ? 5 : 0);
const TAG: Record<string, string> = { best: 'good', good: 'ok', inaccuracy: 'inaccuracy', mistake: 'mistake', blunder: 'mistake', ok: 'ok', info: 'info' };

/** Step-by-step replay of a hand (from practice or from an imported hand history). */
export function HandReplayer({ record, onClose }: { record: ReplayData; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = record.log.length - 1;
  useEffect(() => {
    if (!playing) return;
    if (i >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setI((x) => Math.min(last, x + 1)), 900);
    return () => clearTimeout(t);
  }, [playing, i, last]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((x) => Math.min(last, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [last]);
  let shown = 0;
  for (let k = 0; k <= i; k++) shown = Math.max(shown, Math.min(record.board.length, boardCount(record.log[k]?.street ?? '')));
  const atEnd = i === last;
  const cur = record.log[i];
  return (
    <Modal title={record.title ?? 'Hand replay'} onClose={onClose} width={820}>
      <div className="col" style={{ gap: 12 }}>
        <div className="felt" style={{ minHeight: 300 }}>
          <div className="tseat">
            <div className="row" style={{ gap: 4, justifyContent: 'center' }}>
              {record.villainCards && record.villainCards.length === 2 && atEnd
                ? record.villainCards.map((c) => <PlayingCard key={c} card={c} large />)
                : <><span className="pcard back" /><span className="pcard back" /></>}
            </div>
            <div className="tname">Villain</div>
          </div>
          <div className="tcenter">
            <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
              {[0, 1, 2, 3, 4].map((k) => <PlayingCard key={k} card={k < shown ? record.board[k] : undefined} large />)}
            </div>
            {cur && (
              <div className="tpot">
                <b>{cur.who}</b>: {cur.text} {cur.grade && <span className={`tag ${TAG[cur.grade] ?? 'info'}`}>{cur.grade}{cur.evLoss ? ` −${cur.evLoss.toFixed(2)}bb` : ''}</span>}
              </div>
            )}
          </div>
          <div className="tseat active">
            <div className="row" style={{ gap: 4, justifyContent: 'center' }}>{record.heroCards.map((c) => <PlayingCard key={c} card={c} large />)}</div>
            <div className="tname">{record.hero} (you)</div>
          </div>
        </div>
        <div className="row">
          <button onClick={() => setI(0)} disabled={i === 0}>⏮</button>
          <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>◀ Back</button>
          <button className="primary" onClick={() => { if (atEnd) setI(0); setPlaying(!playing); }}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
          <button onClick={() => setI(Math.min(last, i + 1))} disabled={atEnd}>Next ▶</button>
          <button onClick={() => setI(last)} disabled={atEnd}>⏭</button>
          <span className="muted small">Step {i + 1} of {record.log.length} · arrow keys work too</span>
          <div className="spacer" />
          {atEnd && <b style={{ color: record.net >= 0 ? 'var(--good)' : 'var(--danger)' }}>{record.net >= 0 ? '+' : ''}{record.net.toFixed(1)}bb</b>}
        </div>
        <div style={{ maxHeight: 220, overflow: 'auto' }}>
          <table className="t">
            <tbody>
              {record.log.map((l, k) => (
                <tr key={k} onClick={() => setI(k)} style={{ cursor: 'pointer', background: k === i ? '#243049' : undefined, opacity: k > i ? 0.45 : 1 }}>
                  <td className="muted small" style={{ width: 70 }}>{l.street}</td>
                  <td style={{ width: 110 }}>{l.who}</td>
                  <td>{l.text}</td>
                  <td style={{ textAlign: 'right' }}>{l.grade && <span className={`tag ${TAG[l.grade] ?? 'info'}`}>{l.grade}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
