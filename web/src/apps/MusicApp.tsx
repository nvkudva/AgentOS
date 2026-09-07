import { useEffect, useState } from 'react';

/** Nothing here plays audio. It is a prop: a familiar surface to put on the desktop. */
const TRACKS = [
  { title: 'Slow Circuit',      artist: 'Halogen Choir',  len: 214, art: ['#ff8a65', '#c2185b'] },
  { title: 'Night Shift',       artist: 'Ada & the Loop', len: 187, art: ['#7c4dff', '#1a237e'] },
  { title: 'Paper Machines',    artist: 'Kit Vermillion', len: 241, art: ['#4dd0e1', '#00695c'] },
  { title: 'Quiet Compute',     artist: 'Ren Ito',        len: 168, art: ['#ffd54f', '#e65100'] },
  { title: 'Everything, Later', artist: 'Halogen Choir',  len: 226, art: ['#90a4ae', '#263238'] },
];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function MusicApp() {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const track = TRACKS[i];

  const skip = (d: number) => { setI((n) => (n + d + TRACKS.length) % TRACKS.length); setAt(0); };

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setAt((s) => (s + 1 >= track.len ? (skip(1), 0) : s + 1)), 1000);
    return () => clearInterval(t);
  }, [playing, track.len]);

  return (
    <div className="music">
      <div className="mu-now">
        <span className="mu-art" style={{ background: `linear-gradient(150deg, ${track.art[0]}, ${track.art[1]})` }}>
          <i className={playing ? 'spin' : ''} />
        </span>
        <div className="mu-meta">
          <b>{track.title}</b>
          <em>{track.artist}</em>
          <span className="mu-bar" onClick={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            setAt(Math.round(((e.clientX - b.left) / b.width) * track.len));
          }}>
            <i style={{ width: `${(at / track.len) * 100}%` }} />
          </span>
          <span className="mu-time"><span>{clock(at)}</span><span>-{clock(track.len - at)}</span></span>
          <span className="mu-ctl">
            <button onClick={() => skip(-1)} title="previous">⏮</button>
            <button className="big" onClick={() => setPlaying((p) => !p)} title={playing ? 'pause' : 'play'}>
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => skip(1)} title="next">⏭</button>
          </span>
        </div>
      </div>
      <ul className="mu-list">
        {TRACKS.map((t, n) => (
          <li key={t.title} className={n === i ? 'on' : ''} onClick={() => { setI(n); setAt(0); setPlaying(true); }}>
            <span className="mu-dot" style={{ background: t.art[0] }} />
            <span className="mu-t"><b>{t.title}</b><em>{t.artist}</em></span>
            <span className="muted">{clock(t.len)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
