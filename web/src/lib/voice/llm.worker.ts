/**
 * On-device language model for the System-2 fallback. Same shape as stt.worker.ts:
 * WebGPU probe, WASM fallback, pinned model, Cache Storage after the first download.
 * Text in, one short line out. It has no tools and no network beyond the model fetch.
 */

import { pipeline } from '@huggingface/transformers';

type InMessage =
  | { type: 'load' }
  | { type: 'complete'; id: number; messages: { role: 'system' | 'user' | 'assistant'; content: string }[] };

const MODEL_ID = 'HuggingFaceTB/SmolLM2-360M-Instruct';

let generatorPromise: Promise<any> | null = null;
let chain: Promise<void> = Promise.resolve();

async function pickDevice(): Promise<'wasm' | 'webgpu'> {
  if (!('gpu' in navigator)) return 'wasm';
  try {
    return (await (navigator as any).gpu.requestAdapter()) ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

function load() {
  if (generatorPromise) return generatorPromise;
  self.postMessage({ type: 'status', status: 'loading' });
  generatorPromise = (async () => {
    const device = await pickDevice();
    const make = (dev: 'wasm' | 'webgpu') => pipeline('text-generation', MODEL_ID, {
      dtype: dev === 'webgpu' ? 'q4f16' : 'q4',
      device: dev,
      progress_callback: (progress: any) => self.postMessage({ type: 'progress', progress }),
    } as any);
    let generator: any;
    try {
      generator = await make(device);
    } catch (err) {
      if (device === 'wasm') throw err;
      generator = await make('wasm');
    }
    self.postMessage({ type: 'status', status: 'ready' });
    return generator;
  })();
  generatorPromise.catch(() => {
    generatorPromise = null;
    self.postMessage({ type: 'status', status: 'error' });
  });
  return generatorPromise;
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  const message = event.data;
  if (message.type === 'load') {
    load().catch(() => undefined);
    return;
  }
  chain = chain.then(async () => {
    try {
      const generator = await load();
      const out: any = await generator(message.messages, { max_new_tokens: 24, do_sample: false });
      const last = out?.[0]?.generated_text;
      const text = Array.isArray(last) ? last.at(-1)?.content ?? '' : String(last ?? '');
      self.postMessage({ type: 'result', id: message.id, text: text.trim() });
    } catch (error) {
      self.postMessage({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
    }
  });
};
