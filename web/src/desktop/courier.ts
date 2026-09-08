import { tok, calm } from './carry';

/**
 * The courier: every handoff the operator did not perform with their own hand.
 *
 * One node per hop, animated with element.animate() and removed on finish — no React
 * render is involved in a flight, so a busy desk costs nothing but compositor time.
 *
 * Size and label are the entire grammar. An instruction going down the hierarchy is an
 * 18px labelled capsule; a result coming back up is a 5px unlabelled dot. Direction is
 * never the signal, because a room parked on the left inverts the arc.
 */
export type Box = { left: number; top: number; width: number; height: number };
export type Hop = {
  from: Box;
  /** an explicit destination, for a hop inside one window */
  to?: Box;
  /** or a room id, which the courier resolves — and retargets if the room is not on screen */
  room?: string;
  colour: string;
  label?: string;
  kind: 'instruction' | 'result';
  /** inside one window travel is quicker than across the desk */
  near?: boolean;
};

const MAX = 3;
let layer: HTMLElement | null = null;
let flying = 0;
const waiting: Hop[] = [];

export const mountCourier = (el: HTMLElement | null) => { layer = el; };

export const centre = (b: Box) => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 });

/**
 * Where the hop actually lands. A closed or offscreen room is not a dead letter: the
 * instruction goes to the rail it is parked on, and failing that to its dock tile,
 * which bounces once so the operator can see where the work went.
 */
function land(h: Hop): { box: Box; el: HTMLElement | null; how: 'room' | 'rail' | 'dock' | 'rect' } {
  if (h.to) return { box: h.to, el: null, how: 'rect' };
  const id = h.room ? CSS.escape(h.room) : '';
  const body = document.querySelector<HTMLElement>(`[data-drop][data-room="${id}"]`);
  const seen = (el: HTMLElement | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width && r.height && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight
      ? r : null;
  };
  const b = seen(body);
  if (b && body) return { box: b, el: body, how: 'room' };
  const rail = document.querySelector<HTMLElement>(`.win.parked[data-win="roomwin:${id}"] .pk-rail`);
  const r = seen(rail);
  if (r && rail) return { box: r, el: rail, how: 'rail' };
  const tile = document.querySelector<HTMLElement>(`[data-dock-room="${id}"]`);
  const t = seen(tile);
  if (t && tile) return { box: t, el: tile, how: 'dock' };
  return { box: { left: innerWidth / 2, top: innerHeight - 60, width: 1, height: 1 }, el: null, how: 'rect' };
}

/** The destination acknowledges the arrival in its own vocabulary. */
function arrive(el: HTMLElement | null, how: string, colour: string) {
  if (!el) return;
  if (how === 'dock') { el.classList.add('dock-bounce'); setTimeout(() => el.classList.remove('dock-bounce'), 420); return; }
  if (how === 'rail') { el.classList.add('pk-arrive'); setTimeout(() => el.classList.remove('pk-arrive'), 400); return; }
  const win = el.closest<HTMLElement>('.win') ?? el;
  win.style.setProperty('--arrive', colour);
  win.classList.add('arrive');
  setTimeout(() => win.classList.remove('arrive'), 400);
}

export function send(h: Hop) {
  if (flying >= MAX) { waiting.push(h); setTimeout(pump, 80); return; }
  fly(h);
}

function pump() {
  while (flying < MAX && waiting.length) fly(waiting.shift()!);
}

function fly(h: Hop) {
  const host = layer ?? document.body;
  const dest = land(h);
  const a = centre(h.from), b = centre(dest.box);
  const done = () => { flying--; arrive(dest.el, dest.how, h.colour); pump(); };
  flying++;

  const node = document.createElement('div');
  node.className = `courier ${h.kind === 'instruction' ? 'cap' : 'dot'}`;
  node.style.setProperty('--c', h.colour);
  node.style.left = `${a.x}px`;
  node.style.top = `${a.y}px`;
  if (h.kind === 'instruction' && h.label) node.textContent = h.label;
  host.appendChild(node);

  // Reduced motion branches here, at send time — never into a zero-duration arc.
  if (calm()) {
    node.style.transform = `translate3d(${b.x - a.x}px,${b.y - a.y}px,0) translate(-50%,-50%)`;
    node.classList.add('arrived');
    setTimeout(() => { node.remove(); done(); }, 90);
    return;
  }

  // The control point is pushed off the chord so the arc bows away from the middle of
  // the desk: two hops between the same pair of windows never overlay each other.
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const desk = { x: innerWidth / 2, y: innerHeight / 2 };
  const away = (mid.x - desk.x) * nx + (mid.y - desk.y) * ny >= 0 ? 1 : -1;
  const push = len * 0.18 * away;
  const cx = mid.x + nx * push, cy = mid.y + ny * push;

  const dur = h.near ? parseFloat(tok('--t-near')) : parseFloat(tok('--t-far'));
  const frames: Keyframe[] = [];
  for (let i = 0; i < 24; i++) {
    const t = i / 23, u = 1 - t;
    const x = u * u * a.x + 2 * u * t * cx + t * t * b.x - a.x;
    const y = u * u * a.y + 2 * u * t * cy + t * t * b.y - a.y;
    const at = t * dur;
    // .6 → 1 over the first 90ms, hold, then 1 → .85 with opacity gone over the last 100ms.
    const grow = Math.min(1, at / 90);
    const leave = Math.max(0, (at - (dur - 100)) / 100);
    const s = h.kind === 'instruction' ? 0.6 + 0.4 * grow - 0.15 * leave : 1 - 0.15 * leave;
    frames.push({
      offset: t,
      transform: `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${s.toFixed(3)})`,
      opacity: String(1 - leave),
    });
  }
  node.animate(frames, { duration: dur, easing: 'linear', fill: 'forwards' })
      .onfinish = () => { node.remove(); done(); };
}

/* ============================================================
   Escalation: the one flight that is not absorbed
   ============================================================ */

type Raise = {
  from: Box;
  /** the manager's face — the tier boundary, held for 90ms so the chain is visible */
  via?: Box | null;
  to: Box;
  colour: string;
  label?: string;
  /** fires on impact, never before: the badge is a consequence of the landing */
  onLand?: () => void;
};

const RMAX = 3;
let raising = 0;
const rwait: Raise[] = [];

/**
 * A worker's chit going up: worker → manager → the bell, as one arc rather than two
 * hops, because it is one event. It decelerates over its last 120ms — the tell that
 * this capsule will not be absorbed by the thing it hits — and then stops being motion
 * and becomes a count. It is the only object on this desk allowed to arrest and persist.
 */
export function raise(h: Raise) {
  if (raising >= RMAX) { rwait.push(h); setTimeout(rpump, 90); return; }
  rfly(h);
}
function rpump() { while (raising < RMAX && rwait.length) rfly(rwait.shift()!); }

/** Impact. The badge increments here and nowhere earlier. */
function thud(el: HTMLElement | null, cb?: () => void) {
  if (el) { el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 140); }
  cb?.();
}

function rfly(h: Raise) {
  const host = layer ?? document.body;
  const bell = document.querySelector<HTMLElement>('[data-bell]');
  const a = centre(h.from), b = centre(h.to), v = h.via ? centre(h.via) : null;
  raising++;
  const done = () => { raising--; rpump(); };

  const node = document.createElement('div');
  node.className = 'courier cap escalating';
  node.style.setProperty('--c', h.colour);
  node.style.left = `${a.x}px`;
  node.style.top = `${a.y}px`;
  if (h.label) node.textContent = h.label;
  host.appendChild(node);

  if (calm()) {
    node.remove();
    thud(bell, h.onLand);
    if (bell) { bell.classList.add('arrived'); setTimeout(() => bell.classList.remove('arrived'), 90); }
    done();
    return;
  }

  const DUR = 520, HOLD = 90;
  const legA = v ? Math.round((DUR - HOLD) * 0.4) : 0;
  const legB = v ? DUR - HOLD - legA : DUR;
  // Apex is measured off the straight line the operator would draw between the two
  // ends, so a room low on the desk still throws the capsule over the menu bar.
  const apex = 80;
  const qp = (p0: { x: number; y: number }, p1: { x: number; y: number }, t: number, lift: number) => {
    const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2 - lift;
    const u = 1 - t;
    return { x: u * u * p0.x + 2 * u * t * cx + t * t * p1.x,
             y: u * u * p0.y + 2 * u * t * cy + t * t * p1.y };
  };

  const frames: Keyframe[] = [];
  const N = 30;
  for (let i = 0; i < N; i++) {
    const at = (i / (N - 1)) * DUR;
    let p: { x: number; y: number }, s: number;
    if (v && at < legA) {
      const t = at / legA;
      p = qp(a, v, t, apex * 0.35);
      s = 1 - 0.25 * t;
    } else if (v && at < legA + HOLD) {
      p = v; s = 0.75;
    } else {
      const t0 = v ? (at - legA - HOLD) / legB : at / DUR;
      // decelerating, so the last 120ms visibly slow into the bell
      const t = 1 - (1 - t0) ** 2.2;
      p = qp(v ?? a, b, t, apex);
      s = 0.75 - 0.35 * t;
    }
    frames.push({
      offset: i / (N - 1),
      transform: `translate3d(${(p.x - a.x).toFixed(1)}px,${(p.y - a.y).toFixed(1)}px,0) `
                 + `translate(-50%,-50%) scale(${s.toFixed(3)})`,
    });
  }
  const anim = node.animate(frames, { duration: DUR, easing: 'linear', fill: 'forwards' });
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    node.remove();
    thud(bell, h.onLand);
    done();
  };
  anim.onfinish = finish;
  setTimeout(finish, DUR + 120);
}

/**
 * The decision going back down. Green and unhurried for a yes; blunter and faster for
 * a no, because a refusal should not look like a gift.
 */
export function decided(from: Box, to: Box, ok: boolean, el?: HTMLElement | null) {
  const host = layer ?? document.body;
  const a = centre(from), b = centre(to);
  const flash = () => {
    if (!el) return;
    el.classList.add(ok ? 'decided-yes' : 'decided-no');
    setTimeout(() => el.classList.remove('decided-yes', 'decided-no'), 400);
  };
  if (calm()) return flash();
  const node = document.createElement('div');
  node.className = 'courier dot';
  node.style.setProperty('--c', ok ? 'var(--ok)' : 'var(--failed)');
  node.style.left = `${a.x}px`;
  node.style.top = `${a.y}px`;
  host.appendChild(node);
  node.animate(
    [{ transform: 'translate(-50%,-50%)' },
     { transform: `translate3d(${b.x - a.x}px,${b.y - a.y}px,0) translate(-50%,-50%)` }],
    { duration: ok ? 300 : 180, easing: ok ? tok('--ease') : tok('--ease-out'), fill: 'forwards' },
  ).onfinish = () => { node.remove(); flash(); };
  setTimeout(() => node.remove(), (ok ? 300 : 180) + 120);
}
