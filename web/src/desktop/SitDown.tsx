import { useEffect, useState } from 'react';
import type { Agent, Inbox } from '../lib/api';

const KEY = 'atrium.lastSeen';
const AWAY_MS = 2 * 60 * 1000;

/**
 * The first five seconds after sitting down. A chat list makes you read to find out
 * what happened; this is a count, delivered once, and gone at the first keystroke —
 * it must never become another thing to manage.
 */
export function SitDown({ inbox, agents }: { inbox: Inbox[]; agents: Agent[] }) {
  const [away, setAway] = useState(0);

  useEffect(() => {
    let last = 0;
    try { last = Number(localStorage.getItem(KEY) ?? 0); } catch { /* no storage, no strip */ }
    const gap = last ? Date.now() - last : 0;
    if (gap > AWAY_MS) setAway(gap);
    const beat = setInterval(() => {
      try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
    }, 5000);
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
    return () => clearInterval(beat);
  }, []);

  useEffect(() => {
    if (!away) return;
    const off = () => setAway(0);
    addEventListener('keydown', off); addEventListener('pointerdown', off);
    const t = setTimeout(off, 20000);
    return () => { removeEventListener('keydown', off); removeEventListener('pointerdown', off); clearTimeout(t); };
  }, [away]);

  if (!away) return null;

  const stopped = agents.filter((a) => ['failed', 'killed'].includes(a.state));
  const blocked = agents.filter((a) => ['blocked', 'awaiting_approval'].includes(a.state));
  const working = agents.filter((a) => a.state === 'working');
  const bits = [
    inbox.length && `${inbox.length} need you`,
    blocked.length && `${blocked.length} blocked`,
    stopped.length && `${stopped.length} stopped`,
    working.length && `${working.length} still working`,
  ].filter(Boolean) as string[];

  const hrs = Math.round(away / 3600000);
  const gap = hrs >= 1 ? `${hrs}h` : `${Math.round(away / 60000)}m`;

  return (
    <div className="sitdown" role="status">
      <b>While you were away · {gap}</b>
      <span>{bits.length ? bits.join(' · ') : 'nothing changed'}</span>
      <span className="muted">any key to dismiss</span>
    </div>
  );
}
