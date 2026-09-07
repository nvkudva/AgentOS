import { useEffect, useRef, useState } from 'react';
import { mountCarry, mountSlab, onSlab, type Slab } from './carry';

/**
 * The fixed layer the carried object flies in, and the slab that says what dropping it
 * here would cost. Both nodes are handed to carry.ts, which positions them; React only
 * ever supplies the slab's words.
 */
export function CarryLayer() {
  const [slab, setSlab] = useState<Slab | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountCarry(layer.current); mountSlab(box.current); onSlab(setSlab);
    return () => { mountCarry(null); mountSlab(null); onSlab(() => {}); };
  }, []);

  return (
    <>
      <div className="carry-layer" ref={layer} />
      <div className={`slab${slab ? ' on' : ''}`} ref={box} aria-hidden="true">
        {slab && (
          <>
            <b>{slab.cost} <span>of agent time</span></b>
            <i>{slab.queue}</i>
            {slab.tools.length > 0 && <u>{slab.tools.join(' · ')}</u>}
            {slab.approval && <em>needs you</em>}
          </>
        )}
      </div>
    </>
  );
}
