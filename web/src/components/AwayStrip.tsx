/**
 * The while-you-were-away strip: one line that says what changed while the
 * operator was gone — "2 need you · 1 blocked · 3 still working" — and leaves
 * on the first keystroke. Nothing here is clickable-through: the × is for
 * the mouse, the keyboard never needs it.
 */
export function AwayStrip({ need, blocked, working, onDone }: {
  need: number; blocked: number; working: number; onDone: () => void;
}) {
  const parts: string[] = [];
  if (need) parts.push(`${need} need you`);
  if (blocked) parts.push(`${blocked} blocked`);
  if (working) parts.push(`${working} still working`);
  if (!parts.length) return null;
  return (
    <div className="away-strip" role="status">
      <span>While you were away — {parts.join(' · ')}</span>
      <button onClick={onDone} aria-label="Dismiss">×</button>
    </div>
  );
}
