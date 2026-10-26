/**
 * Microphone capture with energy VAD (FR §6, architecture §3/§6).
 * Audio lives only in an in-memory buffer, is handed to the STT worker as
 * 16 kHz mono PCM, and is dropped after each segment. Never stored or sent.
 */

export const TARGET_SAMPLE_RATE = 16000;
export const VAD_RMS_THRESHOLD = 0.02;
export const ENDPOINT_SILENCE_MS = 400;
export const PARTIAL_INTERVAL_MS = 1500;
const MAX_UTTERANCE_MS = 30000;

export interface VadState {
  speaking: boolean;
  silenceMs: number;
  speechMs: number;
  /** internal clock for vadStep; callers only need the three fields above */
  lastAt?: number;
}

export type VadEvent = { kind: 'speech' | 'endpoint' | 'bargein'; at: number };

export const createVadState = (): VadState => ({ speaking: false, silenceMs: 0, speechMs: 0 });

/** Box-average downsample (mono already). Returns a copy when rates match. */
export function downsample(input: Float32Array, from: number, to: 16000 = TARGET_SAMPLE_RATE as 16000): Float32Array {
  if (!input.length || from <= 0) return new Float32Array(0);
  if (from === to) return new Float32Array(input);
  if (from < to) {
    // Upsample by linear interpolation; capture devices are >=16k in practice.
    const ratio = to / from;
    const out = new Float32Array(Math.max(1, Math.floor(input.length * ratio)));
    for (let i = 0; i < out.length; i++) {
      const pos = i / ratio;
      const lo = Math.floor(pos);
      const hi = Math.min(lo + 1, input.length - 1);
      out[i] = input[lo] + (input[hi] - input[lo]) * (pos - lo);
    }
    return out;
  }
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : input[start] ?? 0;
  }
  return out;
}

export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * One VAD step. Pure: returns a new state. `speech` fires once on the
 * silence->speech transition (capture maps it to `bargein` while TTS plays);
 * `endpoint` fires after ENDPOINT_SILENCE_MS of trailing silence, or when a
 * single utterance exceeds MAX_UTTERANCE_MS.
 */
export function vadStep(
  state: VadState,
  level: number,
  now: number,
): { state: VadState; event: VadEvent | null } {
  const dt = state.lastAt === undefined ? 0 : Math.max(0, now - state.lastAt);
  const next: VadState = { ...state, lastAt: now };
  const loud = level >= VAD_RMS_THRESHOLD;
  if (loud) {
    next.silenceMs = 0;
    next.speechMs = state.speechMs + dt;
    if (!state.speaking) {
      next.speaking = true;
      return { state: next, event: { kind: 'speech', at: now } };
    }
    if (next.speechMs >= MAX_UTTERANCE_MS) {
      next.speaking = false; next.speechMs = 0;
      return { state: next, event: { kind: 'endpoint', at: now } };
    }
    return { state: next, event: null };
  }
  if (!state.speaking) { next.speechMs = 0; return { state: next, event: null }; }
  next.silenceMs = state.silenceMs + dt;
  next.speechMs = state.speechMs + dt;
  if (next.silenceMs >= ENDPOINT_SILENCE_MS) {
    next.speaking = false; next.silenceMs = 0; next.speechMs = 0;
    return { state: next, event: { kind: 'endpoint', at: now } };
  }
  return { state: next, event: null };
}

export type CaptureHandlers = {
  onSegment(pcm: Float32Array): void;
  onPartialPcm?(pcm: Float32Array): void;
  onVad(e: VadEvent): void;
  onLevel?(level: number): void;
  /** true while TTS is playing; a speech onset then also emits `bargein` */
  isSpeaking?(): boolean;
};

export async function startCapture(handlers: CaptureHandlers): Promise<{ stop(): void }> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia
      || typeof AudioContext === 'undefined') {
    throw new Error('Microphone is not available in this browser.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  try { await ctx.resume(); } catch { /* suspended is fine; processing still runs */ }
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  let vad = createVadState();
  let buffer: Float32Array[] = [];
  let buffered = 0;
  let lastPartialAt = 0;
  let stopped = false;

  const flush = (partial: boolean) => {
    if (!buffered) return;
    const joined = new Float32Array(buffered);
    let off = 0;
    for (const chunk of buffer) { joined.set(chunk, off); off += chunk.length; }
    const pcm = downsample(joined, ctx.sampleRate, TARGET_SAMPLE_RATE as 16000);
    if (partial) handlers.onPartialPcm?.(pcm); else handlers.onSegment(pcm);
  };

  processor.onaudioprocess = (e) => {
    if (stopped) return;
    const raw = e.inputBuffer.getChannelData(0);
    const chunk = new Float32Array(raw);
    const level = rms(chunk);
    handlers.onLevel?.(level);
    const now = performance.now();
    const wasSpeaking = vad.speaking;
    const stepped = vadStep(vad, level, now);
    vad = stepped.state;
    if (vad.speaking || wasSpeaking) { buffer.push(chunk); buffered += chunk.length; }
    if (stepped.event?.kind === 'speech') {
      handlers.onVad(stepped.event);
      if (handlers.isSpeaking?.()) handlers.onVad({ kind: 'bargein', at: now });
      lastPartialAt = now;
    } else if (stepped.event?.kind === 'endpoint') {
      handlers.onVad(stepped.event);
      flush(false);
      buffer = []; buffered = 0;
    } else if (vad.speaking && handlers.onPartialPcm && now - lastPartialAt >= PARTIAL_INTERVAL_MS) {
      lastPartialAt = now;
      flush(true);
    }
  };
  source.connect(processor);
  processor.connect(ctx.destination);
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try { processor.disconnect(); source.disconnect(); } catch { /* already gone */ }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
      buffer = []; buffered = 0;
    },
  };
}
