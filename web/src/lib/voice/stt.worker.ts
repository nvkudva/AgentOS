/**
 * On-device Whisper STT worker (architecture §1/§3/§6).
 * Mirrors voice.worker.ts: WebGPU probe, WASM fallback, progress + status
 * posts. The only network use is Transformers.js loading the pinned model
 * on explicit first download (Cache Storage, offline after). No cloud
 * recogniser, no fetch of audio anywhere, audio is never stored.
 */

import { pipeline } from '@huggingface/transformers';

type SttStatus = 'idle' | 'loading' | 'ready' | 'listening' | 'error' | 'unsupported';
type InMessage =
  | { type: 'load' }
  | { type: 'transcribe'; id: number; audio: Float32Array; sampleRate: 16000; final?: boolean };

const MODEL_ID = 'onnx-community/whisper-tiny.en';

let asrPromise: Promise<any> | null = null;
// Serialize inference: Whisper pipelines are not re-entrant.
let chain: Promise<void> = Promise.resolve();
let highestSeenId = 0;

function postStatus(status: SttStatus) {
  self.postMessage({ type: 'status', status });
}

function load() {
  if (!asrPromise) {
    postStatus('loading');
    asrPromise = (async () => {
      let device: 'wasm' | 'webgpu' = 'wasm';
      if ('gpu' in navigator) {
        try {
          const adapter = await (navigator as any).gpu.requestAdapter();
          if (adapter) device = 'webgpu';
        } catch { /* fall through to wasm */ }
      }
      // q8 decodes to gibberish on WebGPU; its supported mix is an fp32 encoder + q4 decoder.
      const make = (dev: 'wasm' | 'webgpu') => pipeline('automatic-speech-recognition', MODEL_ID, {
        dtype: dev === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
        device: dev,
        progress_callback: (progress: any) => self.postMessage({ type: 'progress', progress }),
      } as any);
      try {
        const asr = await make(device);
        postStatus('ready');
        return asr;
      } catch (err) {
        if (device === 'wasm') throw err;
        const asr = await make('wasm');
        postStatus('ready');
        return asr;
      }
    })();
    asrPromise.catch(() => { asrPromise = null; postStatus('error'); });
  }
  return asrPromise;
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  const message = event.data;
  if (message.type === 'load') {
    load().catch(() => undefined);
    return;
  }
  if (message.type === 'transcribe') {
    highestSeenId = Math.max(highestSeenId, message.id);
    chain = chain.then(async () => {
      if (!message.final && message.id < highestSeenId) {
        self.postMessage({ type: 'result', id: message.id, text: '' });
        return;
      }
      try {
        const asr = await load();
        const audio = message.audio instanceof Float32Array
          ? message.audio
          : new Float32Array(message.audio as unknown as ArrayBuffer);
        if (!audio.length) {
          self.postMessage({ type: 'result', id: message.id, text: '' });
          return;
        }
        const out: any = await asr(audio);
        const text = (Array.isArray(out) ? out[0]?.text : out?.text) ?? '';
        self.postMessage({ type: 'result', id: message.id, text: String(text).trim() });
      } catch (error) {
        self.postMessage({
          type: 'error',
          id: message.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
};
