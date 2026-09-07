import { useEffect, useState } from 'react';

/** A ride-hailing prop. No car is coming; the countdown is the whole illusion. */
const TIERS = [
  { key: 'x',     name: 'RideX',   seats: 4, eta: 3, price: '£11.40', glyph: '🚗' },
  { key: 'comf',  name: 'Comfort', seats: 4, eta: 5, price: '£15.80', glyph: '🚙' },
  { key: 'xl',    name: 'RideXL',  seats: 6, eta: 8, price: '£21.20', glyph: '🚐' },
  { key: 'green', name: 'Green',   seats: 4, eta: 4, price: '£12.90', glyph: '⚡' },
];

export function RideApp() {
  const [from, setFrom] = useState('Atrium HQ, Floor 4');
  const [to, setTo] = useState('King’s Cross');
  const [tier, setTier] = useState('x');
  const [away, setAway] = useState<number | null>(null);
  const picked = TIERS.find((t) => t.key === tier)!;

  useEffect(() => {
    if (away === null) return;
    const t = setInterval(() => setAway((s) => (s === null || s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [away === null]);

  return (
    <div className="ride">
      <div className="rd-map">
        <svg viewBox="0 0 320 150" preserveAspectRatio="none">
          <rect width="320" height="150" fill="var(--tint)" />
          <path d="M0 96h320M0 44h320M78 0v150M212 0v150" stroke="var(--line)" strokeWidth="8" fill="none" />
          <path d="M0 96h320M0 44h320M78 0v150M212 0v150" stroke="var(--tint-2)" strokeWidth="5" fill="none" />
          <path d="M78 96 L78 44 L212 44" stroke="var(--working)" strokeWidth="4" fill="none" strokeLinecap="round" />
          <circle cx="78" cy="96" r="6" fill="var(--working)" />
          <rect x="205" y="37" width="14" height="14" rx="3" fill="var(--text)" />
          <text x={away === null ? 100 : 150} y="40" fontSize="15">{picked.glyph}</text>
        </svg>
      </div>

      <label className="rd-field"><span className="rd-pip from" />
        <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="pickup" /></label>
      <label className="rd-field"><span className="rd-pip to" />
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="destination" /></label>

      {away === null ? (
        <>
          <ul className="rd-tiers">
            {TIERS.map((t) => (
              <li key={t.key} className={t.key === tier ? 'on' : ''} onClick={() => setTier(t.key)}>
                <span className="rd-glyph">{t.glyph}</span>
                <span className="rd-t"><b>{t.name}</b><em>{t.seats} seats · {t.eta} min away</em></span>
                <b>{t.price}</b>
              </li>
            ))}
          </ul>
          <button className="primary wide" onClick={() => setAway(picked.eta * 60)}>
            Request {picked.name} · {picked.price}
          </button>
        </>
      ) : (
        <div className="rd-live">
          <b>{away > 0 ? `${picked.name} arriving in ${Math.ceil(away / 60)} min` : `${picked.name} is here`}</b>
          <em>Sam K · {picked.glyph} silver Nissan · LB21 KRT</em>
          <button className="wide" onClick={() => setAway(null)}>Cancel ride</button>
        </div>
      )}
    </div>
  );
}
