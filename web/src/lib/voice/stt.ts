/**
 * Main-thread SttClient (architecture §3/§6): owns the Whisper worker and
 * mic capture, emits final/partial transcripts, and reports an honest
 * status. On any failure the status is `error`/`unsupported` — callers open
 * the typing path. There is deliberately no cloud-STT fallback.
 */
import { startCapture } from './capture';

export type SttStatus = 'idle' | 'loading' | 'ready' | 'listening' | 'error' | 'unsupported';
export type Transcript = {
  text: string; final: boolean; confidence: number | null; at: number;
  /** heard while the orb itself was talking — possibly its own voice coming back */
  overlapped: boolean;
};
/** armed: waiting for the wake phrase, short segments only, no partials. session: a conversation. */
export type SttMode = 'armed' | 'session';
const ARMED_MAX_SAMPLES = 5 * 16000;

/** localStorage atrium.voiceDebug = 1 traces segments and transcripts to the console. */
export function trace(...parts: unknown[]): void {
  try { if (localStorage.getItem('atrium.voiceDebug')) console.debug('[voice]', ...parts); } catch { /* no storage */ }
}

export interface SttClient {
  start(onTx: (t: Transcript) => void, onStatus: (s: SttStatus) => void): Promise<void>;
  stop(): void;
  setMode(mode: SttMode): void;
  /** the live mic, for the orb's level ring; null when not capturing */
  stream(): MediaStream | null;
  status(): SttStatus;
  dispose(): void;
}

export const STT_UNAVAILABLE_MESSAGE = 'Voice unavailable here — typing works';

export function isSttSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined'
    && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

type Pending = { final: boolean; overlapped: boolean; onTx: (t: Transcript) => void };

export type SttClientOptions = {
  /** true while TTS plays; speech onset then fires onBargeIn (<150ms, sync) */
  isSpeaking?: () => boolean;
  onBargeIn?: () => void;
};

class WorkerSttClient implements SttClient {
  constructor(private opts: SttClientOptions = {}) {}
  private worker: Worker | null = null;
  private capture: { stop(): void; stream: MediaStream } | null = null;
  private modelReady = false;
  private current: SttStatus = 'idle';
  private seq = 0;
  private pending = new Map<number, Pending>();
  private onStatus: ((s: SttStatus) => void) | null = null;
  private disposed = false;
  private mode: SttMode = 'session';
  private overlapped = false;

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
          if (m.status === 'ready') {
            this.modelReady = true;
            this.setStatus(this.capture ? 'listening' : 'ready');
            return;
          }
          if (m.status === 'error') { this.setStatus('error'); return; }
          if (!this.capture) this.setStatus(m.status as SttStatus);
          return;
        }
        if (m.type === 'progress') { if (!this.modelReady) this.setStatus('loading'); return; }
        if (m.type === 'result') {
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          trace('heard', JSON.stringify(m.text), p?.final ? 'final' : 'partial');
          if (p && m.text) p.onTx({ text: m.text, final: p.final, confidence: null, at: Date.now(), overlapped: p.overlapped });
          return;
        }
        if (m.type === 'error') {
          this.pending.delete(m.id);
          // A segment error means the model failed to load or run. Swallowing it
          // left the UI saying "Listening…" over a dead worker — surface it so the
          // caller falls back to typing with an honest message.
          trace('stt error', m.message ?? '');
          this.setStatus('error');
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
    if (final) trace('segment', this.mode, `${Math.round(pcm.length / 16)}ms`);
    if (this.mode === 'armed' && (!final || pcm.length > ARMED_MAX_SAMPLES)) return;
    const overlapped = this.overlapped || (this.opts.isSpeaking?.() ?? false);
    if (final) this.overlapped = false;
    const id = ++this.seq;
    this.pending.set(id, { final, overlapped, onTx });
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
        onVad: (e) => {
          if (e.kind === 'speech') this.overlapped = this.opts.isSpeaking?.() ?? false;
          if (e.kind === 'bargein') this.opts.onBargeIn?.();
        },
        isSpeaking: () => this.opts.isSpeaking?.() ?? false,
      });
    } catch {
      // Mic denied / no mic: honest status, Supervisor opens typing.
      this.setStatus('error');
      this.capture = null;
      return;
    }
    if (this.disposed) { this.capture.stop(); this.capture = null; return; }
    // Mic open is not "listening" until Whisper is actually running: the first
    // load downloads the model, and claiming otherwise reads as broken voice.
    this.setStatus(this.modelReady ? 'listening' : 'loading');
  }

  stop(): void {
    this.capture?.stop();
    this.capture = null;
    this.pending.clear();
    if (this.current === 'listening' || this.current === 'loading')
      this.setStatus(this.modelReady ? 'ready' : 'idle');
  }

  setMode(mode: SttMode): void { this.mode = mode; }

  stream(): MediaStream | null { return this.capture?.stream ?? null; }

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
