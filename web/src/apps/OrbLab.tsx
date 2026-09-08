import { useEffect, useState } from 'react';
import { Orb } from '../desktop/Orb';
import { SKINS, type Skin } from '../desktop/Supervisor';

const NOTE: Record<Skin, string> = {
  glass: 'The same material as every window here. Grows like a window opening.',
  well:  'A graphite drawer the sphere is set into. The orb keeps its own light.',
  halo:  'Almost nothing — a line that unrolls, with the desk showing through.',
  bloom: 'The orb’s own glow thickens until it is a surface. Slowest of the four.',
};

/** A short canned exchange, so all four are judged on the same words. */
const TURNS: { who: 'you' | 'orb'; text: string }[] = [
  { who: 'you', text: 'run analytics on last quarter churn' },
  { who: 'orb', text: 'Analytics has it. Three tasks, about 1.8 hours.' },
  { who: 'you', text: 'anything waiting on me?' },
  { who: 'orb', text: 'Three. The biggest is Engineering wanting to open a pull request.' },
];

/**
 * Four treatments, live, side by side. Click any orb to grow it into its panel and
 * collapse it again — the point is to compare the material and the motion on the same
 * words, not to read four different scripts.
 */
export function OrbLab({ onPick, current }: { onPick?: (s: Skin) => void; current?: Skin }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);

  useEffect(() => {
    setOpen(Object.fromEntries(SKINS.map((s) => [s, all])));
  }, [all]);

  return (
    <div className="orblab">
      <header className="lab-head">
        <div>
          <b>Four supervisors</b>
          <p className="muted">Click an orb to open it. They all say the same thing.</p>
        </div>
        <span className="spacer" />
        <button onClick={() => setAll((v) => !v)}>{all ? 'Close all' : 'Open all'}</button>
      </header>

      <div className="lab-grid">
        {SKINS.map((skin) => (
          <section key={skin} className={`lab-cell${current === skin ? ' picked' : ''}`}>
            <div className={`sup skin-${skin}${open[skin] ? ' open' : ''}`}>
              <div className="sup-shell">
                <button className="orb-btn" onClick={() => setOpen((o) => ({ ...o, [skin]: !o[skin] }))}
                        title={`${skin} — click to open`}>
                  <Orb mode={open[skin] ? 'thinking' : 'idle'} />
                </button>
                <div className="sup-body">
                  <div className="sup-feed">
                    {TURNS.map((t, i) => (
                      <p key={i} className={`sup-turn ${t.who}`}>{t.text}</p>
                    ))}
                  </div>
                  <button className="sup-composer-hint">Say something, or type…</button>
                </div>
              </div>
            </div>

            <footer className="lab-foot">
              <b>{skin}</b>
              <p>{NOTE[skin]}</p>
              {onPick && (
                <button className={current === skin ? 'primary' : ''} onClick={() => onPick(skin)}>
                  {current === skin ? 'In use' : 'Use this one'}
                </button>
              )}
            </footer>
          </section>
        ))}
      </div>
    </div>
  );
}
