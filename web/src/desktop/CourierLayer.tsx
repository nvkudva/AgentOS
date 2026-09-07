import { useEffect, useRef } from 'react';
import { mountCourier } from './courier';

/** The overlay every delegation and every result flies across. It renders nothing. */
export function CourierLayer() {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => { mountCourier(layer.current); return () => mountCourier(null); }, []);
  return <div className="courier-layer" ref={layer} />;
}
