import { useCallback, useState } from 'react';

export type WinKind = 'agent' | 'room' | 'floor' | 'list' | 'settings' | 'inbox';
export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type Zone = Edge | Corner | null;

export type Win = {
  id: string; kind: WinKind; title: string; icon: string; color: string; ref?: string;
  x: number; y: number; w: number; h: number;
  z: number; min: boolean; max: boolean;
  /** Only rooms snap and peek. Apps float. */
  snappable: boolean;
  snap: Edge | null;
  peek: Corner | null;
};
export type Rect = { left: number; top: number; width: number; height: number };

export const LANE = 264;      // width of a docked side lane
export const STRIP = 132;     // height of a docked top/bottom strip
export const PEEK = 0.1;      // how much of a corner-tucked room stays on screen

let seqZ = 10;

export function useWindows() {
  const [wins, setWins] = useState<Win[]>([]);

  const focus = useCallback((id: string) =>
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, z: ++seqZ, min: false } : w))), []);

  const open = useCallback((spec: Partial<Win> & Pick<Win, 'id' | 'kind' | 'title' | 'icon' | 'color'>) => {
    setWins((ws) => {
      if (ws.some((w) => w.id === spec.id))
        return ws.map((w) => (w.id === spec.id ? { ...w, z: ++seqZ, min: false, peek: null } : w));
      const n = ws.length;
      return [...ws, {
        x: 90 + (n % 6) * 28, y: 60 + (n % 6) * 28, w: 680, h: 470,
        z: ++seqZ, min: false, max: false, snappable: false, snap: null, peek: null, ...spec,
      } as Win];
    });
  }, []);

  const close = useCallback((id: string) => setWins((ws) => ws.filter((w) => w.id !== id)), []);
  const patch = useCallback((id: string, p: Partial<Win>) =>
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...p } : w))), []);
  const patchAll = useCallback((fn: (w: Win) => Partial<Win> | null) =>
    setWins((ws) => ws.map((w) => ({ ...w, ...(fn(w) ?? {}) }))), []);

  return { wins, open, close, focus, patch, patchAll, setWins };
}

/**
 * Where every window actually sits.
 *
 * Docked rooms share a lane: three rooms on the left edge split that lane's height
 * between them, which is what makes "snap to the side" feel like a rail rather than
 * one window covering the others. Corner-tucked rooms keep a 10% handle on screen.
 */
export function layout(wins: Win[], stage: { w: number; h: number }): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const lane = (e: Edge) => wins.filter((w) => w.snap === e && !w.peek && !w.min);

  const L = lane('left'), R = lane('right'), T = lane('top'), B = lane('bottom');
  const lw = L.length ? LANE : 0, rw = R.length ? LANE : 0;
  const th = T.length ? STRIP : 0, bh = B.length ? STRIP : 0;
  const midW = Math.max(120, stage.w - lw - rw);

  L.forEach((w, i) => out.set(w.id, { left: 0, top: (stage.h / L.length) * i, width: lw, height: stage.h / L.length }));
  R.forEach((w, i) => out.set(w.id, { left: stage.w - rw, top: (stage.h / R.length) * i, width: rw, height: stage.h / R.length }));
  T.forEach((w, i) => out.set(w.id, { left: lw + (midW / T.length) * i, top: 0, width: midW / T.length, height: th }));
  B.forEach((w, i) => out.set(w.id, { left: lw + (midW / B.length) * i, top: stage.h - bh, width: midW / B.length, height: bh }));

  for (const w of wins) {
    if (out.has(w.id)) continue;
    if (w.peek) {
      // 90% off the edge, 10% left to grab — and that 10% is kept fully on screen,
      // clear of the dock, so the handle is always clickable.
      const cw = 260, ch = 170, show = cw * PEEK;
      const left = w.peek === 'tl' || w.peek === 'bl' ? -(cw - show) : stage.w - show;
      const top = w.peek === 'tl' || w.peek === 'tr' ? 10 : Math.max(10, stage.h - ch - 10);
      out.set(w.id, { left, top, width: cw, height: ch });
      continue;
    }
    if (w.max) { out.set(w.id, { left: lw, top: th, width: midW, height: stage.h - th - bh }); continue; }
    out.set(w.id, { left: w.x, top: w.y, width: w.w, height: w.h });
  }
  return out;
}

/** The zone the pointer is currently over, or null for "leave it floating". */
export function zoneAt(px: number, py: number, stage: { w: number; h: number }): Zone {
  const EDGE = 56, CORNER = 130;
  const nearL = px < CORNER, nearR = px > stage.w - CORNER;
  const nearT = py < CORNER, nearB = py > stage.h - CORNER;
  if (nearL && nearT) return 'tl';
  if (nearR && nearT) return 'tr';
  if (nearL && nearB) return 'bl';
  if (nearR && nearB) return 'br';
  if (px < EDGE) return 'left';
  if (px > stage.w - EDGE) return 'right';
  if (py < EDGE) return 'top';
  if (py > stage.h - EDGE) return 'bottom';
  return null;
}

export const isCorner = (z: Zone): z is Corner => z === 'tl' || z === 'tr' || z === 'bl' || z === 'br';

export function zonePreview(z: Zone, stage: { w: number; h: number }): Rect | null {
  if (!z) return null;
  if (isCorner(z)) {
    const cw = 240, ch = 150;
    return {
      left: z === 'tl' || z === 'bl' ? 8 : stage.w - cw - 8,
      top: z === 'tl' || z === 'tr' ? 8 : stage.h - ch - 8,
      width: cw, height: ch,
    };
  }
  if (z === 'left')  return { left: 0, top: 0, width: LANE, height: stage.h };
  if (z === 'right') return { left: stage.w - LANE, top: 0, width: LANE, height: stage.h };
  if (z === 'top')   return { left: 0, top: 0, width: stage.w, height: STRIP };
  return { left: 0, top: stage.h - STRIP, width: stage.w, height: STRIP };
}
