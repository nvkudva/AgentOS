import { useEffect, useState } from 'react';
import { startCarry, type Carried } from './carry';

/** Everything a face can say without opening a window. */
export type PeekInfo = {
  name: string; role: string; avatar: string; colour: string;
  activity: string; state: string;
  /** the last two things it actually did, newest last */
  steps: string[];
  spend: string;
  chits: string[];
};

type Shown = { info: PeekInfo; at: DOMRect; sticky?: boolean };

let sink: ((s: Shown | null) => void) | null = null;

const HOLD = 350;   // long enough not to fire on a click, short enough to feel deliberate
const SLIP = 4;     // beyond this before the hold lands, the press was a carry all along
const DRIFT = 12;   // beyond this once it is open, you have moved on

/**
 * One press, two intents.
 *
 * Hold a face still and it tells you what it is doing. Move it and it comes off the
 * wall and becomes a thing in your hand. The operator never chooses between them in
 * advance — the same press resolves into whichever they meant, at 4px.
 */
export function peekPress(e: React.PointerEvent, info: PeekInfo, load?: Carried) {
  if (e.button !== 0) return;
  const el = e.currentTarget as HTMLElement;
  const p0 = { x: e.clientX, y: e.clientY };
  const pid = e.pointerId;
  const t0 = performance.now();
  const coarse = matchMedia('(pointer: coarse)').matches;
  let open = false, moved = false, sticky = false, carried = false;

  /** On a coarse pointer a tap is a sheet, not a press: it stays until dismissed. */
  const eatClick = () =>
    addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); },
                     { capture: true, once: true });

  el.classList.add('peeking');
  const timer = window.setTimeout(() => {
    open = true;
    el.classList.remove('peeking');
    // A held press on touch stays up as a sheet; on a fine pointer the release
    // still puts it away, as it always has.
    sticky = coarse;
    sink?.({ info, at: el.getBoundingClientRect(), sticky });
  }, HOLD);

  const end = () => {
    clearTimeout(timer);
    el.classList.remove('peeking');
    if (!open && coarse && !moved && performance.now() - t0 < HOLD) {
      sticky = true; eatClick();
      sink?.({ info, at: el.getBoundingClientRect(), sticky });
    // The press became a sheet and never became a carry: the release click
    // belongs to the sheet, not to whatever sits underneath it.
    } else if (open && sticky && !carried) eatClick();
    else if (open && !sticky) sink?.(null);
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', abort);
  };

  /** The browser took the gesture (a scroll won it): close, never sheet. */
  const abort = () => {
    clearTimeout(timer);
    el.classList.remove('peeking');
    if (open && !sticky) sink?.(null);
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', abort);
  };

  function move(ev: PointerEvent) {
    const d = Math.hypot(ev.clientX - p0.x, ev.clientY - p0.y);
    if (d >= SLIP) moved = true;
    if (open) { if (d > DRIFT) end(); return; }
    if (d < SLIP) return;
    // It was a carry. Hand the original press to the carry protocol so the ghost lifts
    // from where the finger actually went down, not from where it has drifted to.
    const wasSheet = open && sticky;
    carried = true;
    end();
    // A sheet that became a carry comes down; the carry owns the click from here.
    if (wasSheet) sink?.(null);
    // Nothing to carry — a room is where work lands, not a thing you pick up — so the
    // move just cancels the peek.
    if (!load) return;
    startCarry({ button: 0, currentTarget: el, clientX: p0.x, clientY: p0.y, pointerId: pid } as unknown as React.PointerEvent,
               load);
  }

  addEventListener('pointermove', move);
  addEventListener('pointerup', end);
  addEventListener('pointercancel', abort);
}

/**
 * The popover. It never takes the pointer — it is a thing you are told, not a thing you
 * use — and it opens on the inward side so it does not hang off the desk.
 */
export function PeekLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [gone, setGone] = useState(false);
  const close = () => {
    setGone(true);
    setTimeout(() => setShown(null), 100);
  };
  useEffect(() => {
    sink = (s) => {
      if (s) { setGone(false); setShown(s); return; }
      close();
    };
    return () => { sink = null; };
  }, []);
  // A stuck sheet answers to keys too; a transient popover answers to the pointer.
  useEffect(() => {
    if (!shown?.sticky) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [shown]);
  if (!shown) return null;

  const { info, at } = shown;
  const W = 240;
  const left = at.left + at.width / 2 < innerWidth / 2;
  let x = left ? at.right + 10 : at.left - W - 10;
  x = Math.max(8, Math.min(x, innerWidth - W - 8));
  const y = Math.max(52, Math.min(at.top - 8, innerHeight - 190));

  return (
    <>
    {shown.sticky && <div className="peek-scrim" onPointerDown={close} />}
    <div className={`peek${gone ? ' out' : ''}${left && !shown.sticky ? '' : ' mirror'}${shown.sticky ? ' sheet' : ''}`}
         style={{ left: x, top: y, width: W, ['--c' as any]: info.colour }}
         role={shown.sticky ? 'dialog' : undefined} aria-label={shown.sticky ? info.name : undefined}>
      {shown.sticky && <button className="peek-x" onClick={close} aria-label="Close">×</button>}
      <header>
        <span className="face" style={{ ['--c' as any]: info.colour }}>{info.avatar}<i className={`st ${info.state}`} /></span>
        <span><b>{info.name}</b><em>{info.role}</em></span>
      </header>
      <p className="peek-now">{info.activity}</p>
      {info.steps.length > 0 && (
        <ul className="peek-steps">{info.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
      )}
      <footer>
        <u>{info.spend}</u>
        {info.chits.length > 0 && <span>{info.chits.length} in hand</span>}
      </footer>
      {info.chits.length > 0 && <p className="peek-chits">{info.chits.join(' · ')}</p>}
    </div>
    </>
  );
}
