/**
 * The carry protocol: one set of pointer rules for every object on this desk that can
 * be picked up — a mandate, a task, an agent.
 *
 * The discipline is the one the window drag already proved: geometry is written to the
 * DOM node in a rAF loop from the last pointer sample, and React hears nothing until
 * the object lands. A render mid-carry cannot move the thing in your hand, because the
 * thing in your hand is not rendered by React at all.
 *
 * Legality is never discovered by hovering. The moment an object leaves its seat every
 * drop target on screen has already declared whether it will take it.
 */

export type CarryKind = 'mandate' | 'task' | 'agent' | 'approval';

export type Carried = {
  kind: CarryKind;
  id: string;
  label: string;
  colour: string;
  /** already in agent-hours: nothing downstream converts cents */
  cost?: string;
  /** what this work needs to touch — the whole of what decides where it may land */
  tools?: string[];
  /** where it sits now, so a drop back home is a no-op rather than a redirect */
  roomId?: string | null;
};

/** What one destination says about one payload, decided at pickup. */
export type Slab = { cost: string; queue: string; tools: string[]; approval: boolean };
export type Verdict = {
  ok: boolean;
  /** legal, but it will stop for you: the ring goes amber instead of the room colour */
  approval?: boolean;
  slab?: Slab;
};

type Wiring = {
  verdict: (c: Carried, target: HTMLElement) => Verdict;
  commit: (c: Carried, target: HTMLElement) => void;
};

const PICKUP = 4;          // a chit sits in a scrollable list; a title bar does not
const DWELL = 120;         // before the consequence slab appears

/** One easing family, one duration scale — read from the stylesheet, never restated. */
const cache: Record<string, string> = {};
export function tok(name: string) {
  return (cache[name] ??= getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}
export const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let layer: HTMLElement | null = null;
let slabEl: HTMLElement | null = null;
let wiring: Wiring = { verdict: () => ({ ok: false }), commit: () => {} };
let sink: (s: Slab | null) => void = () => {};

export const mountCarry = (el: HTMLElement | null) => { layer = el; };
export const mountSlab = (el: HTMLElement | null) => { slabEl = el; };
export const wireCarry = (w: Wiring) => { wiring = w; };
export const onSlab = (f: (s: Slab | null) => void) => { sink = f; };

/** Attach to a [data-carry] element's onPointerDown. Below 4px this does nothing at all. */
export function startCarry(e: React.PointerEvent, load: Carried) {
  if (e.button !== 0) return;
  const src = e.currentTarget as HTMLElement;
  const p0 = { x: e.clientX, y: e.clientY };
  const pid = e.pointerId;
  let px = p0.x, py = p0.y;
  let live = false, raf = 0, hotAt = 0, shown = false;
  let ghost: HTMLElement | null = null;
  let box = src.getBoundingClientRect();
  let hot: HTMLElement | null = null;      // the legal target under the pointer
  let refused: HTMLElement | null = null;  // the illegal one, for the shake
  const marked: HTMLElement[] = [];
  const verdicts = new Map<HTMLElement, Verdict>();

  const lift = () => {
    live = true;
    box = src.getBoundingClientRect();
    src.classList.add('carrying');
    document.body.classList.add('carrying');

    ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
    const inner = document.createElement('div');
    inner.className = 'ghost-in';
    const copy = src.cloneNode(true) as HTMLElement;
    copy.classList.remove('carrying');
    copy.style.width = `${box.width}px`;
    copy.style.height = `${box.height}px`;
    inner.appendChild(copy);
    ghost.appendChild(inner);
    (layer ?? document.body).appendChild(ghost);

    // Every target declares itself now, not when the pointer happens to cross it.
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-drop]'))) mark(el);
    raf = requestAnimationFrame(frame);
  };

  /** One target's answer. Also runs mid-carry for a rail that scrubbed itself open:
   *  its crew rows did not exist at pickup and must still be able to say yes. */
  const mark = (el: HTMLElement) => {
    if (verdicts.has(el)) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el === src || el.contains(src)) return;
    const accepts = (el.dataset.accepts ?? '').split(/\s+/);
    const v = accepts.includes(load.kind) ? wiring.verdict(load, el) : { ok: false };
    verdicts.set(el, v);
    el.classList.add(v.ok ? 'drop-ok' : 'drop-no');
    if (v.ok && v.approval) el.classList.add('drop-ask');
    marked.push(el);
  };

  /**
   * A parked rail is a destination too, but it is 28px wide and usually on the way to
   * somewhere else. So it opens on dwell, not on touch — 400ms rather than the 220ms a
   * plain hover gets, because a carry crosses both gutters on almost every trip — and
   * it re-collapses a quarter second after the pointer leaves, cancelled on re-entry.
   */
  let dwelt: HTMLElement | null = null, dwellIn = 0, dwellOut = 0;
  const railAt = (x: number, y: number) => {
    for (const n of document.elementsFromPoint(x, y)) {
      const w = (n as HTMLElement).closest?.('.win.parked') as HTMLElement | null;
      if (w) return w;
    }
    return null;
  };
  const scrub = () => {
    const w = railAt(px, py);
    if (w === dwelt) return;
    if (w) {
      clearTimeout(dwellOut);
      if (!w.classList.contains('dwell')) {
        clearTimeout(dwellIn);
        dwellIn = window.setTimeout(() => {
          w.classList.add('dwell');
          // Its rows only exist once it is open; ask them what they think then.
          setTimeout(() => w.querySelectorAll<HTMLElement>('[data-drop]').forEach(mark), 200);
        }, 400);
      }
    } else {
      clearTimeout(dwellIn);
      const was = dwelt;
      if (was?.classList.contains('dwell'))
        dwellOut = window.setTimeout(() => was.classList.remove('dwell'), 250);
    }
    dwelt = w;
  };
  const unscrub = () => {
    clearTimeout(dwellIn); clearTimeout(dwellOut);
    document.querySelectorAll('.win.parked.dwell').forEach((n) => n.classList.remove('dwell'));
  };

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const dx = px - p0.x, dy = py - p0.y;
    ghost!.style.transform = `translate3d(${dx}px,${dy}px,0)`;
    probe();
    scrub();
    if (slabEl && shown) {
      const s = slabEl.getBoundingClientRect();
      const right = px + 12 + s.width > innerWidth - 24;
      const below = py + 12 + s.height > innerHeight - 24;
      slabEl.style.transform =
        `translate3d(${right ? px - 12 - s.width : px + 12}px,${below ? py - 12 - s.height : py + 12}px,0)`;
    }
  };

  /** What is under the pointer, and what it thinks of what you are holding. Runs in the
   *  rAF loop and once more on release, so a flick shorter than one frame still lands. */
  const probe = () => {
    let t: HTMLElement | null = null;
    for (const n of document.elementsFromPoint(px, py)) {
      const d = (n as HTMLElement).closest?.('[data-drop]') as HTMLElement | null;
      if (!d) continue;
      if (!verdicts.has(d)) mark(d);
      if (verdicts.has(d)) { t = d; break; }
    }
    const v = t ? verdicts.get(t) : undefined;
    refused = t && !v?.ok ? t : null;
    const next = v?.ok ? t : null;
    if (next !== hot) {
      hot?.classList.remove('drop-hot');
      hot = next;
      hot?.classList.add('drop-hot');
      hotAt = performance.now();
      if (!hot) { shown = false; sink(null); }
      // Moving between two legal targets swaps the slab's contents; it never re-enters.
      else if (shown) { slabEl?.classList.add('swap'); sink(verdicts.get(hot)!.slab ?? null);
                        setTimeout(() => slabEl?.classList.remove('swap'), 60); }
    } else if (hot && !shown && performance.now() - hotAt >= DWELL) {
      shown = true; sink(verdicts.get(hot)!.slab ?? null);
    }
  };

  const move = (ev: PointerEvent) => {
    px = ev.clientX; py = ev.clientY;
    if (!live && Math.hypot(px - p0.x, py - p0.y) >= PICKUP) lift();
  };

  /** Whatever happens, the desk goes back to normal and the click that follows is eaten. */
  const clear = () => {
    cancelAnimationFrame(raf);
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    removeEventListener('pointercancel', abort); removeEventListener('keydown', key);
    if (!live) return;
    src.classList.remove('carrying');
    document.body.classList.remove('carrying');
    unscrub();
    for (const el of marked) el.classList.remove('drop-ok', 'drop-no', 'drop-ask', 'drop-hot');
    sink(null);
    addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); },
                     { capture: true, once: true });
  };

  const drop = (t: HTMLElement) => {
    const r = t.getBoundingClientRect();
    const dx = r.left + r.width / 2 - (box.left + box.width / 2);
    const dy = r.top + r.height / 2 - (box.top + box.height / 2);
    const g = ghost!;
    clear();
    let landed = false;
    // The commit rides the landing, but never depends on it: a tab that stopped painting
    // (backgrounded, occluded) must still put the work down where the hand let go.
    const land = () => {
      if (landed) return;
      landed = true;
      g.remove(); t.classList.remove('drop-hot'); wiring.commit(load, t);
    };
    if (calm()) { g.remove(); t.classList.add('arrived');
                  setTimeout(() => t.classList.remove('arrived'), 90); wiring.commit(load, t); return; }
    g.animate([
      { transform: g.style.transform || 'translate3d(0,0,0)', opacity: 1 },
      { opacity: 1, offset: (240 - 80) / 240 },
      { transform: `translate3d(${dx}px,${dy}px,0)`, opacity: 0 },
    ], { duration: 240, easing: tok('--ease-settle'), fill: 'forwards' }).onfinish = land;
    setTimeout(land, 360);
  };

  /** Nothing commits: the object goes home, and whatever refused it says so. */
  const back = () => {
    const g = ghost!, t = refused;
    clear();
    if (t) {
      t.classList.add('refuse');
      setTimeout(() => t.classList.remove('refuse'), 300);
    }
    if (calm()) return g.remove();
    g.animate([{ transform: g.style.transform || 'translate3d(0,0,0)' }, { transform: 'translate3d(0,0,0)' }],
              { duration: 180, easing: tok('--ease-out'), fill: 'forwards' }).onfinish = () => g.remove();
    setTimeout(() => g.remove(), 400);   // a tab that stopped painting must not keep it
  };

  function up() { if (!live) return clear(); probe(); if (hot) drop(hot); else back(); }
  function abort() { if (!live) return clear(); back(); }
  function key(ev: KeyboardEvent) { if (ev.key === 'Escape') abort(); }

  try { src.setPointerCapture(pid); } catch { /* a mouse that vanished mid-gesture */ }
  addEventListener('pointermove', move); addEventListener('pointerup', up);
  addEventListener('pointercancel', abort); addEventListener('keydown', key);
}
