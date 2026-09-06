import { useRef, type ReactNode } from 'react';
import type { Win } from './wm';

type P = {
  win: Win; children: ReactNode; stage: { w: number; h: number };
  onFocus: () => void; onClose: () => void; onPatch: (p: Partial<Win>) => void;
};

export function Window({ win, children, stage, onFocus, onClose, onPatch }: P) {
  const start = useRef<any>(null);

  const drag = (e: React.PointerEvent, mode: 'move' | 'size') => {
    if ((e.target as HTMLElement).closest('.lights')) return;
    onFocus();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { mode, px: e.clientX, py: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current; if (!s) return;
    const dx = e.clientX - s.px, dy = e.clientY - s.py;
    if (s.mode === 'move') {
      onPatch({ x: Math.max(-win.w + 120, Math.min(stage.w - 120, s.x + dx)), y: Math.max(0, Math.min(stage.h - 34, s.y + dy)) });
    } else {
      onPatch({ w: Math.max(340, s.w + dx), h: Math.max(200, s.h + dy) });
    }
  };
  const end = () => { start.current = null; };

  const geom = win.max
    ? { left: 0, top: 0, width: stage.w, height: stage.h }
    : { left: win.x, top: win.y, width: win.w, height: win.h };

  return (
    <section className={`win${win.min ? ' hidden' : ''}`} style={{ ...geom, zIndex: win.z }} onPointerDown={onFocus}>
      <header className="win-bar" onPointerDown={(e) => drag(e, 'move')} onPointerMove={move}
              onPointerUp={end} onDoubleClick={() => onPatch({ max: !win.max })}>
        <span className="lights">
          <button className="l red"    onClick={onClose} title="close" />
          <button className="l yellow" onClick={() => onPatch({ min: true })} title="minimise" />
          <button className="l green"  onClick={() => onPatch({ max: !win.max })} title="zoom" />
        </span>
        <span className="win-title"><span style={{ color: win.color }}>{win.icon}</span> {win.title}</span>
      </header>
      <div className="win-body">{children}</div>
      {!win.max && <span className="grip" onPointerDown={(e) => drag(e, 'size')} onPointerMove={move} onPointerUp={end} />}
    </section>
  );
}
