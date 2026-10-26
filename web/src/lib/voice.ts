import * as settings from './voice/settings';

type VoiceStatus = 'idle' | 'loading' | 'ready' | 'error';

let worker: Worker | null = null;
let status: VoiceStatus = 'idle';
let speakSequence = 0;
let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let playbackChain: Promise<void> = Promise.resolve();
const fallbackTexts = new Map<number, string>();

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./voice.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<any>) => {
      const message = event.data;
      if (message.type === 'status') {
        status = message.status as VoiceStatus;
        return;
      }
      if (message.type === 'done') {
        fallbackTexts.delete(message.id);
        return;
      }
      if (message.type === 'audio' && message.id === speakSequence) {
        const samples = new Float32Array(message.buffer as ArrayBuffer);
        playbackChain = playbackChain.then(() => playSamples(samples, message.samplingRate, message.id));
        return;
      }
      if (message.type === 'error') {
        console.warn('[voice] Kokoro failed, using system voice:', message.message);
        status = 'error';
        const text = fallbackTexts.get(message.id);
        if (text && message.id === speakSequence) speakNative(text);
      }
    };
    worker.onerror = () => { status = 'error'; };
    return worker;
  } catch {
    status = 'error';
    return null;
  }
}

function speakNative(text: string) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = settings.getVoiceSpeed() * 1.05;
  speechSynthesis.speak(utterance);
}

async function playSamples(samples: Float32Array, samplingRate: number, id: number) {
  if (id !== speakSequence) return;
  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();
  if (id !== speakSequence) return;
  const buffer = audioContext.createBuffer(1, samples.length, samplingRate);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  currentSource = source;
  await new Promise<void>((resolve) => {
    source.onended = () => { if (currentSource === source) currentSource = null; resolve(); };
    source.start();
  });
}

function speakKokoro(id: number, text: string) {
  ensureWorker()?.postMessage({ type: 'speak', id, text, voice: 'af_heart', speed: settings.getVoiceSpeed() });
}

export function preload() {
  if (status === 'ready' || status === 'loading') return;
  status = 'loading';
  ensureWorker()?.postMessage({ type: 'load' });
}

export function speak(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  stop();
  const id = ++speakSequence;
  fallbackTexts.set(id, trimmed);
  if (status === 'ready') {
    speakKokoro(id, trimmed);
    return;
  }
  preload();
  fallbackTexts.delete(id);
  speakNative(trimmed);
}

export function stop() {
  speakSequence++;
  fallbackTexts.clear();
  playbackChain = Promise.resolve();
  if (currentSource) {
    try { currentSource.stop(); } catch {}
    currentSource = null;
  }
  worker?.postMessage({ type: 'cancel', id: speakSequence });
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

export function getStatus(): VoiceStatus {
  return status;
}
