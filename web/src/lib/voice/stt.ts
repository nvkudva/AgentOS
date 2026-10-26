/**
 * Main-thread SttClient (architecture §3/§6): owns the Whisper worker and
 * mic capture, emits final/partial transcripts, and reports an honest
 * status. On any failure the status is `error`/`unsupported` — callers open
 * the typing path. There is deliberately no cloud-STT fallback.
 */
import { startCapture } from './capture';

export type SttStatus = 'idle' | 'loading' | 'ready' | 'listening' | 'error' | 'unsupported';
export type Transcript = { text: string; final: boolean; confidence: number | null; at: number };

export interface SttClient {
  start(onTx: (t: Transcript) => void, onStatus: (s: SttStatus) => void): Promise<void>;
  stop(): void;
  status(): SttStatus;
  dispose(): void;
}

export const STT_UNAVAILABLE_MESSAGE = 'Voice unavailable here — typing works';

export function isSttSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined'
    && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

type Pending = { final: boolean; onTx: (t: Transcript) => void };

export type SttClientOptions = {
  /** true while TTS plays; speech onset then fires onBargeIn (<150ms, sync) */
  isSpeaking?: () => boolean;
  onBargeIn?: () => void;
};

class WorkerSttClient implements SttClient {
  constructor(private opts: SttClientOptions = {}) {}
  private worker: Worker | null = null;
  private capture: { stop(): void } | null = null;
  private current: SttStatus = 'idle';
  private seq = 0;
  private pending = new Map<number, Pending>();
  private onStatus: ((s: SttStatus) => void) | null = null;
  private disposed = false;

  private setStatus(s: SttStatus) {
    this.current = s;
    this.onStatus?.(s);
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL('./stt.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<any>) => {
        const m = event.data;
        if (m.type === 'status') {
          if (this.current !== 'listening') this.setStatus(m.status as SttStatus);
          return;
        }
        if (m.type === 'progress') { if (this.current !== 'listening') this.setStatus('loading'); return; }
        if (m.type === 'result') {
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (p && m.text) p.onTx({ text: m.text, final: p.final, confidence: null, at: Date.now() });
          return;
        }
        if (m.type === 'error') {
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (!p) this.setStatus('error');
        }
      };
      this.worker.onerror = () => this.setStatus('error');
      return this.worker;
    } catch {
      this.setStatus('unsupported');
      return null;
    }
  }

  private transcribe(pcm: Float32Array, final: boolean, onTx: (t: Transcript) => void) {
    const w = this.ensureWorker();
    if (!w) return;
    const id = ++this.seq;
    this.pending.set(id, { final, onTx });
    // Copy: the capture buffer is reused/dropped after handoff.
    const audio = new Float32Array(pcm);
    w.postMessage({ type: 'transcribe', id, audio, sampleRate: 16000, final }, { transfer: [audio.buffer] });
  }

  async start(onTx: (t: Transcript) => void, onStatus: (s: SttStatus) => void): Promise<void> {
    this.onStatus = onStatus;
    if (this.disposed || this.capture) return;
    if (!isSttSupported()) { this.setStatus('unsupported'); return; }
    const w = this.ensureWorker();
    if (!w) { this.setStatus('unsupported'); return; }
    this.setStatus(this.current === 'ready' ? 'ready' : 'loading');
    w.postMessage({ type: 'load' });
    try {
      this.capture = await startCapture({
        onSegment: (pcm) => this.transcribe(pcm, true, onTx),
        onPartialPcm: (pcm) => this.transcribe(pcm, false, onTx),
        onVad: (e) => { if (e.kind === 'bargein') this.opts.onBargeIn?.(); },
        isSpeaking: () => this.opts.isSpeaking?.() ?? false,
      });
    } catch {
      // Mic denied / no mic: honest status, Supervisor opens typing.
      this.setStatus('error');
      this.capture = null;
      return;
    }
    if (this.disposed) { this.capture.stop(); this.capture = null; return; }
    this.setStatus('listening');
  }

  stop(): void {
    this.capture?.stop();
    this.capture = null;
    this.pending.clear();
    if (this.current === 'listening') this.setStatus(this.worker ? 'ready' : 'idle');
  }

  status(): SttStatus { return this.current; }

  dispose(): void {
    this.disposed = true;
    this.stop();
    try { this.worker?.terminate(); } catch { /* already gone */ }
    this.worker = null;
    this.current = 'idle';
  }
}

export function createSttClient(opts?: SttClientOptions): SttClient {
  return new WorkerSttClient(opts);
}
