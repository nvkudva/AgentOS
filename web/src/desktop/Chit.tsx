import { useRef, useState } from 'react';
import { startCarry, type CarryKind } from './carry';

type P = {
  kind: CarryKind;
  id: string;
  /** verb first: "Pull churn by cohort", never "Churn analysis task" */
  label: string;
  colour: string;
  cost?: string;
  tools?: string[];
  roomId?: string | null;
  /** collapsed beside a worker's activity line: a 4px tick until you aim at it */
  tick?: boolean;
  /** queued but nobody has it yet */
  waiting?: boolean;
  /** a task chit will take an agent dropped onto it */
  accepts?: string;
  taskId?: string;
  /** the mandate this chit belongs to, for the chain trace */
  mandateId?: string;
  className?: string;
  onOpen?: () => void;
  onRecall?: () => void;
};

/**
 * The one object that represents work at every tier: in the orb's mouth, in a room's
 * task strip, collapsed against a worker's line, and inside an open parked rail. Same
 * component, same shape, same colour — the mandate's, frozen server-side.
 */
export function Chit({ kind, id, label, colour, cost, tools, roomId, tick, waiting,
                       accepts, taskId, mandateId, className, onOpen, onRecall }: P) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [draining, setDraining] = useState(false);
  const press = useRef(0);
  const lapse = useRef(0);

  /**
   * Recall stands work down; it does not kill it. For eight seconds the chit is grey
   * and nothing at all has happened on the server — the hairline drains, and only when
   * it runs out do the tasks stop and the mandate come home still holding your words.
   */
  const recall = () => {
    setDraining(true);
    lapse.current = window.setTimeout(() => { setDraining(false); onRecall?.(); }, 8000);
  };
  const keep = () => { clearTimeout(lapse.current); setDraining(false); };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || draining) return;
    startCarry(e, { kind, id, label, colour, cost, tools, roomId });
    // A stationary press is the touch equivalent of the right-click menu.
    const at = { x: e.clientX, y: e.clientY };
    clearTimeout(press.current);
    press.current = window.setTimeout(() => setMenu(at), 500);
    const off = (ev: PointerEvent) => {
      if (ev.type === 'pointermove' && Math.hypot(ev.clientX - at.x, ev.clientY - at.y) < 4) return;
      clearTimeout(press.current);
      removeEventListener('pointermove', off); removeEventListener('pointerup', off);
    };
    addEventListener('pointermove', off); addEventListener('pointerup', off);
  };

  return (
    <>
      <span
        className={`chit${tick ? ' tick' : ''}${waiting ? ' waiting' : ''}${draining ? ' recalling' : ''}${className ? ` ${className}` : ''}`}
        data-carry={draining ? undefined : kind}
        data-mandate={kind === 'mandate' ? id : mandateId}
        data-task={taskId}
        data-drop={accepts ? '' : undefined}
        data-accepts={accepts}
        style={{ ['--c' as any]: colour }}
        title={label}
        onPointerDown={down}
        onClick={() => onOpen?.()}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      >
        <b>{label}</b>
        {draining
          ? <button className="chit-undo" onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); keep(); }}>Undo</button>
          : cost && <u>{cost}</u>}
        {draining && <i className="chit-drain" />}
      </span>

      {menu && (
        <div className="chit-menu" style={{ left: menu.x, top: menu.y }}
             onPointerDown={(e) => e.stopPropagation()}
             onMouseLeave={() => setMenu(null)}>
          <button onClick={() => { setMenu(null); recall(); }}>Recall</button>
          <button onClick={() => { setMenu(null); onOpen?.(); }}>Open run</button>
        </div>
      )}
    </>
  );
}
