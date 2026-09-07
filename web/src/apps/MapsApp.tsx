import { useState } from 'react';

/** A map prop: hand-drawn streets, a few places, no tiles and no network. */
const PLACES = [
  { name: 'Atrium HQ',        kind: 'Office · open now',      x: 78,  y: 96,  glyph: '🏢' },
  { name: 'King’s Cross',     kind: 'Station · 24 hours',     x: 212, y: 44,  glyph: '🚉' },
  { name: 'Granary Square',   kind: 'Park · open now',        x: 150, y: 120, glyph: '🌳' },
  { name: 'Caravan Coffee',   kind: 'Café · closes 18:00',    x: 250, y: 100, glyph: '☕' },
  { name: 'Lighthouse Books', kind: 'Bookshop · closed',      x: 40,  y: 46,  glyph: '📚' },
];

export function MapsApp() {
  const [q, setQ] = useState('');
  const [at, setAt] = useState<string | null>('Atrium HQ');
  const [zoom, setZoom] = useState(1);
  const hits = PLACES.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  const sel = PLACES.find((p) => p.name === at);

  return (
    <div className="maps">
      <div className="mp-canvas">
        <svg viewBox="0 0 320 160" style={{ transform: `scale(${zoom})` }}>
          <rect width="320" height="160" fill="#e8efe6" />
          <path d="M120 96h96v56h-96z" fill="#cfe3c9" />
          <path d="M0 20h320M0 96h320M0 140h320M78 0v160M212 0v160M270 0v160"
                stroke="#fff" strokeWidth="9" fill="none" />
          <path d="M0 58h320" stroke="#ffd98a" strokeWidth="11" fill="none" />
          <path d="M0 58h320" stroke="#ffc857" strokeWidth="7" fill="none" />
          {hits.map((p) => (
            <g key={p.name} onClick={() => setAt(p.name)} style={{ cursor: 'pointer' }}>
              <circle cx={p.x} cy={p.y} r={p.name === at ? 11 : 8}
                      fill={p.name === at ? 'var(--working)' : '#fff'} stroke="#6b7a6a" strokeWidth="1" />
              <text x={p.x} y={p.y + 1} fontSize="9" textAnchor="middle" dominantBaseline="central">{p.glyph}</text>
            </g>
          ))}
        </svg>
        <span className="mp-zoom">
          <button onClick={() => setZoom((z) => Math.min(2.2, z + 0.2))}>+</button>
          <button onClick={() => setZoom((z) => Math.max(1, z - 0.2))}>−</button>
        </span>
      </div>

      <label className="mp-search">
        <span>🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Maps" />
      </label>

      {sel && (
        <div className="mp-card">
          <span className="mp-glyph">{sel.glyph}</span>
          <span className="mp-t"><b>{sel.name}</b><em>{sel.kind}</em></span>
          <button className="primary">Directions</button>
        </div>
      )}

      <ul className="mp-list">
        {hits.map((p) => (
          <li key={p.name} className={p.name === at ? 'on' : ''} onClick={() => setAt(p.name)}>
            <span>{p.glyph}</span><span className="mp-t"><b>{p.name}</b><em>{p.kind}</em></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
