import { useState } from 'react';
import { observe } from '../lib/api';

/**
 * The measurement that decides the thesis. Blind the screen, reveal it, and time how long
 * the operator takes to answer "does anything need me?" — then score the answer against
 * the truth. Run it on the desktop and in Activity; compare the medians.
 */
export function GlanceTest({ view, truth }: { view: string; truth: boolean }) {
  const [phase, setPhase] = useState<'idle' | 'blind' | 'timing'>('idle');
  const [t0, setT0] = useState(0);

  const begin = () => {
    setPhase('blind');
    setTimeout(() => { setT0(performance.now()); setPhase('timing'); }, 900 + Math.random() * 1500);
  };
  const answer = async (said: boolean) => {
    const ms = Math.round(performance.now() - t0);
    setPhase('idle');
    await observe(view, 'glance', { ms, said, truth, correct: said === truth });
  };

  if (phase === 'idle')
    return <span className="menu" onClick={begin} title="time yourself answering: does anything need me?">Glance</span>;
  if (phase === 'blind') return <div className="blindfold">get ready…</div>;
  return (
    <div className="glance-ask">
      <span>Does anything need you?</span>
      <button className="primary" onClick={() => answer(true)}>Yes</button>
      <button onClick={() => answer(false)}>No</button>
    </div>
  );
}
