import type { Room } from '../lib/api';

/**
 * The orb's mouth, as a module-level bus.
 *
 * Three things reach the panel from outside the Supervisor: a proposal the operator
 * made with their hand rather than their voice (a chit dropped on the orb), a result
 * a manager reported, and a clarify a manager asked. None of them is worth a React
 * context — they are messages, and they arrive at one listener.
 */
export type Pitch = {
  room: Room;
  rooms: Room[];
  text: string;
  /** ms left to take it back before it dispatches on its own; absent = waits forever */
  auto?: number;
};

export type Result = {
  id: string; mandate: string; text: string; colour: string;
  roomId: string | null; artifact: string | null; at: number;
};

export type Clarify = {
  id: string; question: string; answers: string[]; colour: string; at: number;
};

type Sink = {
  /** a proposal made with the hand rather than the voice */
  pitch: (p: Pitch) => void;
  /** the hand carried it away itself: the panel lets go without dispatching twice */
  clear: () => void;
};

let sink: Sink | null = null;
export const wireOrb = (s: Sink | null) => { sink = s; };
export const pitch = (p: Pitch) => sink?.pitch(p);
export const clearPitch = () => sink?.clear();

/**
 * Unread results outlive a refresh. They are not approvals and never become them —
 * they sit on the orb and on a second, quieter badge, and the operator clears them
 * when they feel like it.
 */
const KEY = 'atrium.results';
export function loadResults(): Result[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? (raw as Result[]).slice(0, 12) : [];
  } catch { return []; }
}
export function saveResults(rs: Result[]) {
  try { localStorage.setItem(KEY, JSON.stringify(rs.slice(0, 12))); } catch { /* private mode */ }
}

/** Which results this browser has already shown, so a refresh does not re-fly them. */
const SEEN = 'atrium.reported';
export function seenMandates(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN) ?? '[]')); } catch { return new Set(); }
}
export function markSeen(ids: Iterable<string>) {
  try { localStorage.setItem(SEEN, JSON.stringify([...ids].slice(-60))); } catch { /* private mode */ }
}
