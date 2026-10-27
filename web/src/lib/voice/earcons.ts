import { getVoiceVolume } from './settings';

export type Earcon = 'wake' | 'done' | 'error' | 'confirm' | 'armed';
type Note = { at: number; hz: number; len: number; gain: number; type?: OscillatorType };

const SCORES: Record<Earcon, Note[]> = {
  wake: [{ at: 0, hz: 523, len: 0.09, gain: 0.18 }, { at: 0.09, hz: 784, len: 0.14, gain: 0.18 }],
  done: [{ at: 0, hz: 880, len: 0.05, gain: 0.1 }],
  error: [{ at: 0, hz: 110, len: 0.2, gain: 0.25, type: 'triangle' }],
  confirm: [{ at: 0, hz: 740, len: 0.045, gain: 0.12 }, { at: 0.09, hz: 740, len: 0.045, gain: 0.12 }],
  armed: [{ at: 0, hz: 196, len: 0.06, gain: 0.04 }],
};

let audio: AudioContext | null = null;

function context(): AudioContext {
  audio ??= new AudioContext();
  return audio;
}

function schedule(ac: AudioContext, note: Note, volume: number): void {
  const start = ac.currentTime + note.at;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = note.type ?? 'sine';
  osc.frequency.value = note.hz;
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, note.gain * volume), start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + note.len);
  osc.connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + note.len + 0.02);
}

export function play(kind: Earcon): void {
  try {
    const ac = context();
    if (ac.state === 'suspended') void ac.resume().catch(() => {});
    const volume = getVoiceVolume();
    for (const note of SCORES[kind]) schedule(ac, note, volume);
  } catch { /* audio is optional */ }
}
