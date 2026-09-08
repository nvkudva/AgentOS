import { useCallback, useState } from 'react';

export type WinKind = 'agent' | 'room' | 'floor' | 'list' | 'settings' | 'inbox'
  | 'music' | 'ride' | 'maps';
/** Everything that opens from the dock rather than from a room or an agent. */
export type AppKind = Exclude<WinKind, 'agent' | 'room'>;
/** A parked window is tucked against a side edge with only its rail showing. */
export type Park = 'left' | 'right';

export type Win = {
  id: string; kind: WinKind; title: string; icon: string; color: string; ref?: string;
  x: number; y: number; w: number; h: number;
  z: number; min: boolean; max: boolean;
  /** Rooms wear plain chrome: a title and a close button, no traffic lights. */
  plain: boolean;
  /** Parked against an edge — a place, not a minimise. */
  park: Park | null;
  /** The rect to restore on un-park. */
  home: Rect | null;
};
export type Rect = { left: number; top: number; width: number; height: number };

let seqZ = 10;

export function useWindows(initial: Win[] = []) {
  const [wins, setWins] = useState<Win[]>(initial);
  // Restored windows carry their old z values; new ones must open above them.
  seqZ = Math.max(seqZ, ...initial.map((w) => w.z), 10);

  const focus = useCallback((id: string) =>
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, z: ++seqZ, min: false } : w))), []);

  const open = useCallback((spec: Partial<Win> & Pick<Win, 'id' | 'kind' | 'title' | 'icon' | 'color'>) => {
    setWins((ws) => {
      if (ws.some((w) => w.id === spec.id))
        return ws.map((w) => (w.id === spec.id ? { ...w, z: ++seqZ, min: false } : w));
      const n = ws.length;
      return [...ws, {
        x: 90 + (n % 6) * 28, y: 60 + (n % 6) * 28, w: 680, h: 470,
        z: ++seqZ, min: false, max: false, plain: false, park: null, home: null, ...spec,
      } as Win];
    });
  }, []);

  const close = useCallback((id: string) => setWins((ws) => ws.filter((w) => w.id !== id)), []);
  const patch = useCallback((id: string, p: Partial<Win>) =>
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...p } : w))), []);
  // A no-op stays a no-op: an unchanged window keeps its identity, so nothing downstream
  // re-renders or re-persists because something was merely inspected.
  const patchAll = useCallback((fn: (w: Win) => Partial<Win> | null) =>
    setWins((ws) => {
      let hit = false;
      const next = ws.map((w) => { const p = fn(w); if (!p) return w; hit = true; return { ...w, ...p }; });
      return hit ? next : ws;
    }), []);

  return { wins, open, close, focus, patch, patchAll, setWins };
}

/** The desktop a window can occupy. */
export function stageArea(stage: { w: number; h: number }): Rect {
  return { left: 0, top: 0, width: stage.w, height: stage.h };
}

/** Where a newly opened app should sit: centred in the free desktop, gently cascaded. */
export function centreIn(area: Rect, w: number, h: number, nth = 0): Rect {
  const width = Math.min(w, area.width - 32);
  const height = Math.min(h, area.height - 32);
  const off = (nth % 5) * 22;
  return {
    left: Math.round(area.left + (area.width - width) / 2 + off - 44),
    top: Math.round(area.top + (area.height - height) / 2 + off - 44),
    width, height,
  };
}

export const SLIVER = 72;   // how much of a parked window stays on screen
const PARK_PAD = 8, PARK_GAP = 8;

/**
 * Where every window sits.
 *
 * A parked window is only as tall as its crew needs — it is a shelf of faces, not a
 * column filling the edge. They stack from the top and only start overlapping once
 * there are more of them than the edge can hold.
 */
export function layout(
  wins: Win[],
  stage: { w: number; h: number },
  railHeight: (w: Win) => number = () => 96,
): Map<string, Rect> {
  const out = new Map<string, Rect>();

  for (const side of ['left', 'right'] as Park[]) {
    const ps = wins.filter((w) => w.park === side && !w.min);
    if (!ps.length) continue;
    const hs = ps.map(railHeight);
    const span = hs.reduce((a, b) => a + b, 0) + PARK_GAP * (ps.length - 1);
    const room = stage.h - PARK_PAD * 2;
    // Fan rather than shrink: heights stay honest, the gaps go negative instead.
    const squeeze = span > room && ps.length > 1
      ? (room - hs[hs.length - 1]) / (span - hs[hs.length - 1])
      : 1;
    let top = PARK_PAD;
    ps.forEach((w, i) => {
      out.set(w.id, {
        left: side === 'left' ? PARK_PAD : stage.w - SLIVER - PARK_PAD,
        top: Math.round(top), width: SLIVER, height: hs[i],
      });
      top += (hs[i] + PARK_GAP) * squeeze;
    });
  }

  for (const w of wins) {
    if (out.has(w.id)) continue;
    if (w.max) { out.set(w.id, stageArea(stage)); continue; }
    out.set(w.id, { left: w.x, top: w.y, width: w.w, height: w.h });
  }
  return out;
}

/** The edge the pointer is asking for, or null. */
export function parkEdge(px: number, width: number, gutter = 28): Park | null {
  if (px <= gutter) return 'left';
  if (px >= width - gutter) return 'right';
  return null;
}
