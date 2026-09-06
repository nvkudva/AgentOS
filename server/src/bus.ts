import { EventEmitter } from 'node:events';
export type Wire = { type: string; [k: string]: any };
class Bus extends EventEmitter {
  publish(msg: Wire) { this.emit('wire', msg); }
  subscribe(fn: (m: Wire) => void) { this.on('wire', fn); return () => this.off('wire', fn); }
}
export const bus = new Bus();
bus.setMaxListeners(200);
