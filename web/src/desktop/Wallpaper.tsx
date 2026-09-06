/**
 * The desktop background: a generated landscape, not a photograph.
 *
 * Every colour comes from a CSS variable, so the same geometry reads as dawn in light
 * mode and as a moonlit night in dark mode. No image files, no network, no resampling —
 * it stays sharp at any size and costs one paint.
 */
export function Wallpaper({ dark }: { dark: boolean }) {
  return (
    <div className="wallpaper" aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--sky-1)" />
            <stop offset="52%"  stopColor="var(--sky-2)" />
            <stop offset="100%" stopColor="var(--sky-3)" />
          </linearGradient>
          <radialGradient id="glow" cx="0.72" cy="0.28" r="0.42">
            <stop offset="0%"   stopColor="var(--sun)" stopOpacity="0.85" />
            <stop offset="55%"  stopColor="var(--sun)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--sun)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--ridge-1)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--water)" />
          </linearGradient>
          <linearGradient id="mistband" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--mist)" stopOpacity="0" />
            <stop offset="45%"  stopColor="var(--mist)" stopOpacity="0.42" />
            <stop offset="100%" stopColor="var(--mist)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect width="1600" height="900" fill="url(#sky)" />
        <circle cx="1152" cy="252" r="380" fill="url(#glow)" />
        <circle cx="1152" cy="252" r="34" fill="var(--sun)" opacity={dark ? 0.9 : 0.75} />

        {dark && (
          <g fill="#fff" opacity="0.5">
            {STARS.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} opacity={0.25 + (i % 5) / 8} />)}
          </g>
        )}

        {/* far ridge */}
        <path d="M0 470 L180 392 L320 445 L470 350 L640 452 L790 372 L960 460 L1130 356 L1300 448 L1450 396 L1600 466 L1600 900 L0 900 Z"
              fill="var(--ridge-3)" />
        {/* mist */}
        <rect x="0" y="440" width="1600" height="110" fill="url(#mistband)" />
        {/* mid ridge */}
        <path d="M0 566 L150 500 L300 560 L450 480 L620 570 L780 506 L940 578 L1110 498 L1280 568 L1440 512 L1600 574 L1600 900 L0 900 Z"
              fill="var(--ridge-2)" />
        <rect x="0" y="544" width="1600" height="86" fill="url(#mistband)" opacity="0.7" />
        {/* near ridge */}
        <path d="M0 672 L210 612 L400 676 L560 620 L760 690 L940 626 L1130 692 L1330 630 L1520 690 L1600 662 L1600 900 L0 900 Z"
              fill="var(--ridge-1)" />
        {/* water */}
        <rect x="0" y="690" width="1600" height="210" fill="url(#water)" />
        <g opacity="0.12" stroke="var(--mist)" strokeWidth="1.4">
          {[720, 748, 778, 812, 850].map((y, i) => (
            <line key={y} x1={120 + i * 40} y1={y} x2={620 - i * 30} y2={y} />
          ))}
          {[736, 766, 800, 842].map((y, i) => (
            <line key={y} x1={980 + i * 30} y1={y} x2={1460 - i * 40} y2={y} />
          ))}
        </g>
        {/* foreground trees, silhouetted */}
        <g fill="var(--fore)">
          {TREES.map(([x, h, w], i) => (
            <path key={i} d={`M${x} 900 L${x} ${900 - h} L${x - w} ${900 - h * 0.42} L${x - w * 0.42} ${900 - h * 0.5}
                              L${x - w * 0.8} ${900 - h * 0.12} L${x} ${900 - h * 0.2}
                              L${x + w * 0.8} ${900 - h * 0.12} L${x + w * 0.42} ${900 - h * 0.5}
                              L${x + w} ${900 - h * 0.42} L${x} ${900 - h} Z`} />
          ))}
        </g>
      </svg>
      <div className="vignette" />
    </div>
  );
}

const STARS: [number, number, number][] = Array.from({ length: 70 }, (_, i) => {
  const x = ((i * 197) % 1580) + 10;
  const y = ((i * 79) % 400) + 12;
  return [x, y, i % 7 === 0 ? 1.6 : 1];
});
const TREES: [number, number, number][] = [
  [70, 250, 46], [150, 180, 34], [1500, 268, 50], [1420, 190, 36], [1560, 150, 28], [20, 160, 30],
];
