import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { parkEdge, type Win, type Rect, type Park } from './wm';

type P = {
  win: Win; rect: Rect | null; children: ReactNode; stage: { w: number; h: number };
  /** what the 72px sliver shows while parked — outside the body, which parking hides */
  rail?: ReactNode;
  /** extra class on the frame, e.g. the attention ring */
  flag?: string;
  /** the rail this window would park on if released now — App draws the shelf */
  onHint: (p: Park | null) => void;
  /** the other windows on the desk, for edge alignment */
  peers?: Rect[];
  /** the hairlines this drag is currently snapped to — App draws them */
  onGuide?: (g: { x: number[]; y: number[] }) => void;
  onFocus: () => void; onClose: () => void; onPatch: (p: Partial<Win>) => void;
};

/**
 * The in-flight geometry lives outside the component and is written to whichever node
 * carries the id, so a render mid-gesture cannot paint the pre-drag rect back over it.
 */
const flight: { id: string | null; rect: Rect | null } = { id: null, rect: null };

export const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Mode = 'move' | (typeof EDGES)[number];
const MIN_W = 240, MIN_H = 150;
const SNAP = 6;

/**
 * Nudge a dragged rect onto its neighbours' edges and the desk's centre lines.
 *
 * Snapping is 6px and silent — it helps a hand that is already aiming at an edge
 * without ever moving a window somewhere it was not headed. That is the whole
 * difference between this and the zone docking it replaced.
 */
function align(r: Rect, peers: Rect[], stage: { w: number; h: number }) {
  const lines = { x: [] as number[], y: [] as number[] };
  const xs = [stage.w / 2, ...peers.flatMap((p) => [p.left, p.left + p.width, p.left + p.width / 2])];
  const ys = [stage.h / 2, ...peers.flatMap((p) => [p.top, p.top + p.height, p.top + p.height / 2])];

  const pull = (mine: number[], targets: number[]) => {
    let best: { d: number; at: number } | null = null;
    for (const m of mine) for (const t of targets) {
      const d = t - m;
      if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
    }
    return best;
  };

  const hx = pull([r.left, r.left + r.width, r.left + r.width / 2], xs);
  if (hx) { r = { ...r, left: r.left + hx.d }; lines.x.push(hx.at); }
  const hy = pull([r.top, r.top + r.height, r.top + r.height / 2], ys);
  if (hy) { r = { ...r, top: r.top + hy.d }; lines.y.push(hy.at); }
  return { rect: r, lines };
}

function paint(id: string, r: Rect | null) {
  const n = document.querySelector<HTMLElement>(`[data-win="${CSS.escape(id)}"]`);
  if (!n) return;
  n.classList.toggle('dragging', !!r);
  document.body.classList.toggle('dragging', !!r);
  if (!r) {
    // Hand the node back to React and to CSS. A parked window is sized by the stylesheet,
    // so leftover inline geometry from the drag would pin it at its full width.
    for (const k of ['left', 'top', 'width', 'height']) n.style.removeProperty(k);
    return;
  }
  n.style.left = `${r.left}px`; n.style.top = `${r.top}px`;
  n.style.width = `${r.width}px`; n.style.height = `${r.height}px`;
}

export function Window({ win, rect, children, stage, rail, flag, peers = [], onHint, onGuide, onFocus, onClose, onPatch }: P) {
  // Rooms are surfaces, not applications: no traffic lights, one close affordance.
  const plain = win.plain;
  const drag = useRef<any>(null);
  const dropped = useRef(0);          // a click always follows pointerup; ignore that one
  const el = useRef<HTMLElement | null>(null);

  // Geometry goes straight to the node during a gesture, so the whole window tracks the
  // pointer at refresh rate instead of one React render behind it. A render mid-drag —
  // a scheduler tick, say — would paint the old rect back, so the in-flight geometry is
  // re-applied after every render.
  useLayoutEffect(() => {
    if (flight.id === win.id) paint(win.id, flight.rect);
  });

  const down = (e: React.PointerEvent, mode: Mode) => {
    if ((e.target as HTMLElement).closest('.lights')) return;
    onFocus();
    // Measured, not taken from props: the drag starts from the box that is on screen.
    const box = el.current!.getBoundingClientRect();
    const host = el.current!.closest('.stage')!.getBoundingClientRect();
    const s = { mode, px: e.clientX, py: e.clientY, moved: false,
      x: box.left - host.left, y: box.top - host.top, w: box.width, h: box.height };
    drag.current = s;

    // The park gutter is armed by dwell, not by touch: brushing an edge on the way
    // somewhere else must not offer to swallow the window.
    let hint: Park | null = null, since = 0, armed: Park | null = null, last = e.clientX;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - s.px, dy = ev.clientY - s.py;
      if (!s.moved && Math.hypot(dx, dy) < 3) return;
      if (!s.moved && s.mode === 'move' && win.park) {
        // Un-parking restores the window it was, under the same grip on the bar.
        const home = win.home ?? { left: s.x, top: s.y, width: 320, height: 220 };
        s.x = s.px - ((s.px - s.x) / Math.max(1, s.w)) * home.width;
        s.y = s.py - Math.min(s.py - s.y, 19);
        s.w = home.width; s.h = home.height;
        onPatch({ park: null, x: s.x, y: s.y, w: s.w, h: s.h });
      }
      s.moved = true;

      let r: Rect;
      if (s.mode === 'move') {
        r = { left: s.x + dx, top: s.y + dy, width: s.w, height: s.h };
        const g = align(r, peers, stage);
        r = g.rect;
        onGuide?.(g.lines);
        r.left = Math.max(-s.w + 130, Math.min(stage.w - 130, r.left));
        r.top = Math.max(0, Math.min(stage.h - 36, r.top));
      } else {
        // Every edge pulls its own side and pins the opposite one, the way a window does.
        let { x: left, y: top, w: width, h: height } = s;
        if (s.mode.includes('e')) width = Math.max(MIN_W, s.w + dx);
        if (s.mode.includes('s')) height = Math.max(MIN_H, s.h + dy);
        if (s.mode.includes('w')) { width = Math.max(MIN_W, s.w - dx); left = s.x + (s.w - width); }
        if (s.mode.includes('n')) { height = Math.max(MIN_H, s.h - dy); top = s.y + (s.h - height); }
        // A window meets the walls of the desk rather than growing through them.
        if (left < 0) { width += left; left = 0; }
        if (top < 0) { height += top; top = 0; }
        width = Math.min(width, stage.w - left);
        height = Math.min(height, stage.h - top);
        r = { left, top, width, height };
      }
      flight.id = win.id; flight.rect = r;
      paint(win.id, r);

      if (s.mode !== 'move') return;
      last = ev.clientX;
      const near = parkEdge(ev.clientX - host.left, host.width);
      if (near !== hint) { hint = near; since = ev.timeStamp; if (armed) { armed = null; onHint(null); } }
      if (near && !armed && ev.timeStamp - since >= 80) { armed = near; onHint(near); }
    };

    // Released anywhere but an armed gutter, a window stays exactly where it was dropped.
    const onUp = () => {
      stop();
      const r = flight.rect;
      flight.id = null; flight.rect = null;
      paint(win.id, null);
      onHint(null);
      if (!s.moved || !r) return;
      dropped.current = Date.now();
      onGuide?.({ x: [], y: [] });
      if (s.mode !== 'move')
        return onPatch({ x: r.left, y: r.top, w: r.width, h: r.height });
      // The dwell only governs when the shelf appears. Letting go inside the gutter is
      // an unambiguous request to park, so it parks whether or not the shelf caught up.
      const drop = armed ?? parkEdge(last - host.left, host.width);
      // Home is where the window was before this drag, not the edge you flung it at —
      // un-parking should give you back the desk you had, not drop it half off-screen.
      if (drop) return onPatch({ park: drop, x: s.x, y: s.y,
        home: { left: s.x, top: s.y, width: s.w, height: s.h } });
      onPatch({ x: r.left, y: r.top });
    };

    // Escape abandons the gesture: no park, and the window falls back to its own rect.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      stop();
      flight.id = null; flight.rect = null;
      paint(win.id, null);
      onHint(null); onGuide?.({ x: [], y: [] });
    };

    function stop() {
      removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onUp); removeEventListener('keydown', onKey);
      drag.current = null;
    }

    addEventListener('pointermove', onMove); addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onUp); addEventListener('keydown', onKey);
  };

  // A parked window is anchored by CSS to its edge, so hovering widens it inwards
  // rather than pushing it off the screen; only its top and height are placed here.
  return (
    <section
      ref={el as any}
      data-win={win.id}
      className={`win${win.min ? ' hidden' : ''}${plain ? ' plain' : ''}${flag ? ` ${flag}` : ''}${
        win.park ? ` parked ${win.park}` : ''}`}
      style={win.park
        ? { top: rect?.top, zIndex: win.z, ['--c' as any]: win.color, ['--ph' as any]: `${rect?.height ?? 96}px` }
        : { ...(rect ?? {}), zIndex: win.z, ['--c' as any]: win.color }}
      onPointerDown={onFocus}
      onClick={() => {
        if (!win.park || Date.now() - dropped.current < 350) return;
        onPatch({ park: null, ...(win.home && { x: win.home.left, y: win.home.top, w: win.home.width, h: win.home.height }) });
      }}
    >
      <header className="win-bar" onPointerDown={(e) => down(e, 'move')} onDoubleClick={() => plain || onPatch({ max: !win.max })}>
        <span className="lights">
          <button className="l red" onClick={onClose} title="close" />
          {!plain && <button className="l yellow" onClick={() => onPatch({ min: true })} title="minimise" />}
          {!plain && <button className="l green" onClick={() => onPatch({ max: !win.max })} title="zoom" />}
        </span>
        <span className={`win-title${plain ? ' plain' : ''}`}>
          <span className="wt-icon">{win.icon}</span> {win.title}
        </span>
      </header>
      {win.park && <div className="pk-hold" onPointerDown={(e) => down(e, 'move')}>{rail}</div>}
      <div className="win-body">{children}</div>
      {!win.max && !win.park && EDGES.map((d) => (
        <span key={d} className={`edge ${d}`} onPointerDown={(e) => down(e, d)} />
      ))}
    </section>
  );
}
