import { useEffect, useRef } from 'react';

type Mode = 'idle' | 'listening' | 'thinking' | 'alert';

/**
 * The supervisor.
 *
 * A layered sphere — two counter-rotating plasma fields under spherical shading and a
 * glass dome — wrapped in a ring of bars that reacts to the actual microphone while it
 * listens. When nothing is happening it is completely still: motion here means the
 * assistant is doing something, never decoration.
 */
export function Orb({ mode, size = 38, stream }: { mode: Mode; size?: number; stream?: MediaStream | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);

  // Real levels when the browser gives us the mic; a gentle synthetic swell when it does not.
  useEffect(() => {
    if (!stream) { analyser.current = null; return; }
    try {
      const ctx = new (window.AudioContext ?? (window as any).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 64; an.smoothingTimeConstant = 0.75;
      src.connect(an);
      audioCtx.current = ctx; analyser.current = an;
      return () => { an.disconnect(); src.disconnect(); ctx.close().catch(() => {}); analyser.current = null; };
    } catch { analyser.current = null; }
  }, [stream]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const R = size + 22;                       // ring canvas is larger than the sphere
    const dpr = Math.min(2, devicePixelRatio || 1);
    el.width = R * dpr; el.height = R * dpr;
    el.style.width = el.style.height = `${R}px`;
    const g = el.getContext('2d')!;
    g.scale(dpr, dpr);

    const BARS = 36;
    const bins = new Uint8Array(32);
    let raf = 0, t = 0;

    const paint = () => {
      g.clearRect(0, 0, R, R);
      const cx = R / 2, cy = R / 2, r0 = size / 2 + 4;
      const live = mode === 'listening' || mode === 'thinking' || mode === 'alert';
      if (analyser.current) analyser.current.getByteFrequencyData(bins);

      // At rest it is a single hairline ring — teeth would be motion where there is none.
      if (!live) {
        g.strokeStyle = COLORS.idle; g.globalAlpha = 0.75; g.lineWidth = 1.2;
        g.beginPath(); g.arc(cx, cy, r0 + 1.5, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
        return;
      }

      // Two strokes fake the glow: canvas shadowBlur costs about a third of the frame.
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        let amp: number;
        if (analyser.current && mode === 'listening') {
          amp = bins[i % bins.length] / 255;
        } else {
          // three offset sines: reads as breathing rather than a loop
          amp = 0.18 + 0.22 * Math.abs(Math.sin(t * 0.9 + i * 0.42))
                     + 0.14 * Math.abs(Math.sin(t * 1.7 - i * 0.21));
        }
        const len = 2 + amp * (mode === 'listening' ? 15 : 9);
        const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
        const x1 = cx + Math.cos(a) * (r0 + len), y1 = cy + Math.sin(a) * (r0 + len);
        g.strokeStyle = COLORS[mode];
        g.lineCap = 'round';
        g.globalAlpha = (0.4 + amp * 0.6) * 0.28; g.lineWidth = 4.5;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.globalAlpha = 0.45 + amp * 0.55; g.lineWidth = 1.7;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
      g.globalAlpha = 1;
      t += 0.09;
      // ~30fps is plenty for a 60px ornament, and leaves the frame to the app.
      raf = requestAnimationFrame(() => setTimeout(() => { raf = requestAnimationFrame(paint); }, 24));
    };

    paint();                                   // idle draws exactly one frame, then stops
    return () => cancelAnimationFrame(raf);
  }, [mode, size]);

  return (
    <span className={`orb ${mode}`} style={{ ['--size' as any]: `${size}px` }}>
      <canvas className="orb-ring" ref={canvas} />
      <span className="orb-sphere">
        <span className="plasma a" />
        <span className="plasma b" />
        <span className="orb-shade" />
        <span className="orb-dome" />
      </span>
      <span className="orb-halo" />
    </span>
  );
}

const COLORS: Record<Mode, string> = {
  idle: 'rgba(150,170,210,.5)',
  listening: 'rgb(64,232,196)',
  thinking: 'rgb(124,156,255)',
  alert: 'rgb(186,132,246)',
};
