import type { ReactNode } from 'react';
export function Modal({ title, onClose, children, width }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={width ? { maxWidth: width } : undefined}>
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <div className="spacer" />
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
