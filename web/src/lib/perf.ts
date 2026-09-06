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

  useEffect(() => {
    if (mode !== 'auto') { document.documentElement.dataset.perf = mode; return; }
    document.documentElement.dataset.perf = 'glass';
    let frames = 0, raf = 0;
    const t0 = performance.now();
    const loop = () => { frames++; raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const done = setTimeout(() => {
      cancelAnimationFrame(raf);
      const fps = (frames * 1000) / (performance.now() - t0);
      setMeasured(Math.round(fps));
      document.documentElement.dataset.perf = fps < 45 ? 'lite' : 'glass';
    }, 2200);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, [mode]);

  return { mode, setMode, measured };
}
