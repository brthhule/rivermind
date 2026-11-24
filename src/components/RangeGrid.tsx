import { useRef, useState } from 'react';
import { HAND_CLASSES } from '../engine/cards';

export interface CellData {
  /** 0..1 how much of the class is in range; drives the bar height */
  weight: number;
  /** colored segments, fractions summing to <= 1 */
  segments: { f: number; color: string }[];
  sub?: string;
  /** solid background color (heatmap mode) */
  bg?: string;
}

interface Props {
  cell: (i: number) => CellData;
  onHover?: (i: number | null) => void;
  onClick?: (i: number) => void;
  /** paint mode: called for every cell dragged over while the mouse or finger is down */
  onPaint?: (i: number, first: boolean) => void;
  hovered?: number | null;
}

export function RangeGrid({ cell, onHover, onClick, onPaint, hovered }: Props) {
  const down = useRef(false);
  const [, force] = useState(0);
  const end = () => { if (down.current) { down.current = false; force((x) => x + 1); } };
  return (
    <div
      className={`rgrid${onPaint ? ' paint' : ''}`}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') { onHover?.(null); end(); } }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {HAND_CLASSES.map((label, i) => {
        const c = cell(i);
        const dim = c.weight <= 0.001;
        return (
          <div
            key={label}
            className={`rcell${hovered === i ? ' hover' : ''}${dim ? ' dim' : ''}`}
            style={c.bg ? { background: c.bg } : undefined}
            onPointerEnter={() => { onHover?.(i); if (down.current) onPaint?.(i, false); }}
            onPointerDown={(e) => {
              // A touch selects the hand (there is no hover on phones).
              if (e.pointerType !== 'mouse') onHover?.(i);
              if (!onPaint) return;
              e.preventDefault();
              // Touch pointers are captured by the first cell; release so dragging paints the cells under the finger.
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
              down.current = true;
              onPaint(i, true);
            }}
            onClick={() => onClick?.(i)}
          >
            {!c.bg && (
              <div className="fill" style={{ height: `${Math.min(1, c.weight) * 100}%` }}>
                {c.segments.map((s, k) => <div key={k} style={{ width: `${s.f * 100}%`, background: s.color }} />)}
              </div>
            )}
            <span className="lbl">{label}</span>
            {c.sub && <span className="sub">{c.sub}</span>}
          </div>
        );
      })}
    </div>
  );
}
