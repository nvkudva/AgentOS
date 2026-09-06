import { useRef, type ReactNode } from 'react';
import { zoneAt, isCorner, type Win, type Rect, type Zone } from './wm';

type P = {
  win: Win; rect: Rect; children: ReactNode; stage: { w: number; h: number };
  onFocus: () => void; onClose: () => void; onPatch: (p: Partial<Win>) => void;
  onZone: (z: Zone) => void;
};

export function Window({ win, rect, children, stage, onFocus, onClose, onPatch, onZone }: P) {
  const drag = useRef<any>(null);
  const dropped = useRef(0);          // a click always follows pointerup; ignore that one
  const docked = !!win.snap;

  const down = (e: React.PointerEvent, mode: 'move' | 'size') => {
    if ((e.target as HTMLElement).closest('.lights')) return;
    onFocus();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Undocking keeps the window where you grabbed it, rather than teleporting it home.
    drag.current = { mode, px: e.clientX, py: e.clientY,
      x: rect.left, y: rect.top, w: rect.width, h: rect.height, moved: false };
  };

  const move = (e: React.PointerEvent) => {
    const s = drag.current; if (!s) return;
    const dx = e.clientX - s.px, dy = e.clientY - s.py;
    if (!s.moved && Math.hypot(dx, dy) < 3) return;
    s.moved = true;
    const host = (e.currentTarget as HTMLElement).closest('.stage')!.getBoundingClientRect();

    if (s.mode === 'move') {
      if (win.snap || win.peek) onPatch({ snap: null, peek: null, w: Math.min(360, s.w), h: Math.min(230, s.h) });
      onPatch({
        x: Math.max(-rect.width + 130, Math.min(stage.w - 130, s.x + dx)),
        y: Math.max(0, Math.min(stage.h - 36, s.y + dy)),
      });
      if (win.snappable) onZone(zoneAt(e.clientX - host.left, e.clientY - host.top, stage));
    } else {
      onPatch({ w: Math.max(300, s.w + dx), h: Math.max(170, s.h + dy) });
    }
  };

  const up = (e: React.PointerEvent) => {
    const s = drag.current; drag.current = null;
    if (s?.moved) dropped.current = Date.now();
    if (!s || s.mode !== 'move' || !win.snappable) { onZone(null); return; }
    const host = (e.currentTarget as HTMLElement).closest('.stage')!.getBoundingClientRect();
    const z = zoneAt(e.clientX - host.left, e.clientY - host.top, stage);
    onZone(null);
    if (!z) return;
    if (isCorner(z)) onPatch({ peek: z, snap: null });
    else onPatch({ snap: z, peek: null });
  };

  return (
    <section
      className={`win${win.min ? ' hidden' : ''}${docked ? ' docked' : ''}${win.peek ? ` peeking ${win.peek}` : ''}`}
      style={{ ...rect, zIndex: win.peek ? 60 : win.z, ['--c' as any]: win.color }}
      onPointerDown={onFocus}
      onClick={() => {
        if (Date.now() - dropped.current < 350) return;   // this click is the end of a drag
        if (win.peek) onPatch({ peek: null, x: 140, y: 110, w: 320, h: 220 });
      }}
    >
      <header className="win-bar" onPointerDown={(e) => down(e, 'move')} onPointerMove={move}
              onPointerUp={up} onDoubleClick={() => win.snappable ? onPatch({ snap: null, peek: null }) : onPatch({ max: !win.max })}>
        <span className="lights">
          <button className="l red" onClick={onClose} title="close" />
          <button className="l yellow" onClick={() => onPatch({ min: true })} title="minimise" />
          <button className="l green" onClick={() => onPatch(win.snappable ? { snap: null, peek: null } : { max: !win.max })}
                  title={win.snappable ? 'undock' : 'zoom'} />
        </span>
        {!docked && <span className="win-title"><span className="wt-icon">{win.icon}</span> {win.title}</span>}
        {docked && <span className="dockedge" title={`docked ${win.snap}`} />}
      </header>
      {win.peek && <span className="peek-tab" title={`${win.title} — click to bring back`}>{win.icon}</span>}
      <div className="win-body">{children}</div>
      {!docked && !win.peek && !win.max &&
        <span className="grip" onPointerDown={(e) => down(e, 'size')} onPointerMove={move} onPointerUp={up} />}
    </section>
  );
}
