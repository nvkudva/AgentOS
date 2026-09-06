import { useCallback, useState } from 'react';

export type WinKind = 'agent' | 'room' | 'floor' | 'list' | 'settings' | 'inbox';
export type Win = {
  id: string; kind: WinKind; title: string; icon: string; color: string;
  ref?: string;                       // agent id / room id
  x: number; y: number; w: number; h: number;
  z: number; min: boolean; max: boolean;
};

let seqZ = 10;
const CASCADE = 26;

/** A small window manager. Enough to feel like a desktop, not enough to become one. */
export function useWindows() {
  const [wins, setWins] = useState<Win[]>([]);

  const focus = useCallback((id: string) => {
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, z: ++seqZ, min: false } : w)));
  }, []);

  const open = useCallback((spec: Omit<Win, 'x' | 'y' | 'w' | 'h' | 'z' | 'min' | 'max'> & Partial<Win>) => {
    setWins((ws) => {
      const found = ws.find((w) => w.id === spec.id);
      if (found) return ws.map((w) => (w.id === spec.id ? { ...w, z: ++seqZ, min: false } : w));
      const n = ws.length;
      return [...ws, {
        x: spec.x ?? 40 + (n % 6) * CASCADE, y: spec.y ?? 30 + (n % 6) * CASCADE,
        w: spec.w ?? 660, h: spec.h ?? 460, z: ++seqZ, min: false, max: false, ...spec,
      } as Win];
    });
  }, []);

  const close = useCallback((id: string) => setWins((ws) => ws.filter((w) => w.id !== id)), []);
  const patch = useCallback((id: string, p: Partial<Win>) =>
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...p } : w))), []);

  return { wins, open, close, focus, patch };
}
