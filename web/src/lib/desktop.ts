import type { Win } from '../desktop/wm';

const KEY = 'atrium.desktop';

/**
 * The arrangement is the operator's work, not the app's. Where a window sits, what is
 * parked, and what was open are theirs to keep across a refresh or a day away — the
 * agents live on the server, so this is the only state the browser owns.
 */
export function loadDesktop(): Win[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((w) => w && typeof w.id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveDesktop(wins: Win[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(wins));
  } catch {
    /* private window, or the quota is gone — the desktop still works, it just forgets */
  }
}

const SEEN = 'atrium.seenRooms';

/** Rooms already given a window once — closing one is a decision, not a glitch to undo. */
export function loadSeen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveSeen(ids: Iterable<string>) {
  try { localStorage.setItem(SEEN, JSON.stringify([...ids])); } catch { /* ignore */ }
}
