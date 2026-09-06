import { useEffect, useState } from 'react';

export type PerfMode = 'auto' | 'glass' | 'lite';

/**
 * Glass costs frames. On a GPU it is free; in software rendering a full-width
 * backdrop-filter halves the frame rate, so Atrium measures itself for a couple of
 * seconds and drops transparency if it cannot hold 60fps — the way a game lowers
 * quality rather than stuttering. macOS calls this "Reduce transparency"; so do we.
 */
export function usePerf() {
  const [mode, setMode] = useState<PerfMode>(() => (localStorage.getItem('atrium.perf') as PerfMode) ?? 'auto');
  const [measured, setMeasured] = useState<number | null>(null);

  useEffect(() => { localStorage.setItem('atrium.perf', mode); }, [mode]);

  /**
   * Adaptive quality, not a one-off boot check: the app watches its own frame rate for
   * as long as it runs and trades effects for frames whenever it starts to struggle —
   * a window opening, the orb spinning, twenty rooms on screen. Hysteresis keeps it from
   * flickering between the two looks.
   */
  useEffect(() => {
    if (mode !== 'auto') { document.documentElement.dataset.perf = mode; return; }
    let frames = 0, raf = 0, last = performance.now(), goodFor = 0;
    let level: 'glass' | 'lite' = (document.documentElement.dataset.perf as any) ?? 'glass';
    document.documentElement.dataset.perf = level;

    const loop = () => { frames++; raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);

    const tick = setInterval(() => {
      const now = performance.now();
      const fps = (frames * 1000) / (now - last);
      frames = 0; last = now;
      setMeasured(Math.round(fps));
      if (level === 'glass' && fps < 45) { level = 'lite'; goodFor = 0; }
      else if (level === 'lite' && fps > 55) { goodFor += 1; if (goodFor >= 3) { level = 'glass'; goodFor = 0; } }
      else if (level === 'lite') goodFor = 0;
      document.documentElement.dataset.perf = level;
    }, 2000);

    return () => { cancelAnimationFrame(raf); clearInterval(tick); };
  }, [mode]);

  return { mode, setMode, measured };
}
