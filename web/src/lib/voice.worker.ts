import { KokoroTTS } from 'kokoro-js';

type InMessage =
  | { type: 'load' }
  | { type: 'speak'; id: number; text: string; voice: string; speed: number }
  | { type: 'cancel'; id: number };

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let ttsPromise: Promise<any> | null = null;
let cancelledId = 0;

function load() {
  if (!ttsPromise) {
    postStatus('loading');
    ttsPromise = (async () => {
      let device: 'wasm' | 'webgpu' = 'wasm';
      if ('gpu' in navigator) {
        try {
          const adapter = await (navigator as any).gpu.requestAdapter();
          if (adapter) device = 'webgpu';
        } catch {}
      }
      try {
        const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: 'q8',
          device,
          progress_callback: (progress: any) => {
            self.postMessage({ type: 'progress', progress });
          },
        });
        postStatus('ready');
        return tts;
      } catch {
        const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: (progress: any) => {
            self.postMessage({ type: 'progress', progress });
          },
        });
        postStatus('ready');
        return tts;
      }
    })();
    ttsPromise.catch(() => { ttsPromise = null; postStatus('error'); });
  }
  return ttsPromise;
}

function postStatus(status: string) {
  self.postMessage({ type: 'status', status });
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+["']?\s*|[^.!?]+$/g);
  const sentences = (parts ?? [text]).map((part) => part.trim()).filter(Boolean);
  return sentences.length ? sentences : [text];
}

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const message = event.data;
  if (message.type === 'load') {
    try { await load(); } catch {}
    return;
  }
  if (message.type === 'cancel') {
    cancelledId = message.id;
    return;
  }
  if (message.type === 'speak') {
    try {
      const tts = await load();
      const sentences = splitSentences(message.text);
      for (let seq = 0; seq < sentences.length; seq++) {
        if (cancelledId >= message.id) return;
        const rawAudio = await tts.generate(sentences[seq], {
          voice: message.voice as any,
          speed: message.speed,
        });
        if (cancelledId >= message.id) return;
        const audio = Float32Array.from(rawAudio.audio);
        self.postMessage(
          { type: 'audio', id: message.id, seq, buffer: audio.buffer, samplingRate: rawAudio.sampling_rate },
          { transfer: [audio.buffer] },
        );
      }
      self.postMessage({ type: 'done', id: message.id });
    } catch (error) {
      self.postMessage({
        type: 'error',
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
