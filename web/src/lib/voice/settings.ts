/**
 * Voice playback settings (FR-17): TTS speed / volume.
 * Persisted in localStorage; every read is guarded so private mode or a
 * missing Storage falls back to defaults instead of throwing.
 */

export const VOICE_SPEED_KEY = 'atrium.voiceSpeed';
export const VOICE_VOLUME_KEY = 'atrium.voiceVolume';
export const DEFAULT_VOICE_SPEED = 1;
export const DEFAULT_VOICE_VOLUME = 1;
export const MIN_VOICE_SPEED = 0.5;
export const MAX_VOICE_SPEED = 1.5;
export const SLOWER_ONCE_SPEED = 0.85;
export const SPEED_STEP = 0.1;
export const VOLUME_STEP = 0.15;

export type VoiceStorage = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

const defaultStorage = (): VoiceStorage => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

export const clampVoiceSpeed = (v: number): number =>
  Number.isFinite(v) ? Math.min(MAX_VOICE_SPEED, Math.max(MIN_VOICE_SPEED, v)) : DEFAULT_VOICE_SPEED;

export const clampVoiceVolume = (v: number): number =>
  Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOICE_VOLUME;

function read(key: string, fallback: number, clamp: (n: number) => number, storage: VoiceStorage): number {
  try {
    const raw = (storage === undefined ? defaultStorage() : storage)?.getItem(key);
    if (raw === null || raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n) : fallback;
  } catch { return fallback; }
}

function write(key: string, value: number, clamp: (n: number) => number, storage: VoiceStorage): number {
  const v = clamp(value);
  try { (storage === undefined ? defaultStorage() : storage)?.setItem(key, String(v)); } catch { /* keep in-memory value */ }
  return v;
}

export const getVoiceSpeed = (storage?: VoiceStorage): number =>
  read(VOICE_SPEED_KEY, DEFAULT_VOICE_SPEED, clampVoiceSpeed, storage);
export const setVoiceSpeed = (v: number, storage?: VoiceStorage): number =>
  write(VOICE_SPEED_KEY, v, clampVoiceSpeed, storage);
export const getVoiceVolume = (storage?: VoiceStorage): number =>
  read(VOICE_VOLUME_KEY, DEFAULT_VOICE_VOLUME, clampVoiceVolume, storage);
export const setVoiceVolume = (v: number, storage?: VoiceStorage): number =>
  write(VOICE_VOLUME_KEY, v, clampVoiceVolume, storage);

/** Rate for one utterance: "say that again slower" wins once, never persists. */
export const resolveSpeechRate = (opts?: { slowerOnce?: boolean; storage?: VoiceStorage }): number =>
  opts?.slowerOnce ? SLOWER_ONCE_SPEED : getVoiceSpeed(opts?.storage);

export type VoiceSettingCommand =
  | { kind: 'speed'; action: 'faster' | 'slower' | 'reset'; value: number }
  | { kind: 'volume'; action: 'louder' | 'quieter' | 'reset'; value: number };

/**
 * FR-17 phrases -> persisted setting change. Returns null for non-settings
 * text so the intent engine can fall through. Never mutates on its own
 * unless `apply` is set (tests stay pure by default).
 */
export function parseVoiceSettingCommand(
  raw: string,
  opts?: { storage?: VoiceStorage; apply?: boolean },
): VoiceSettingCommand | null {
  const t = raw.toLowerCase().trim().replace(/[.!?]+$/, '');
  const speed = getVoiceSpeed(opts?.storage);
  const volume = getVoiceVolume(opts?.storage);
  let out: VoiceSettingCommand | null = null;
  if (/^(talk|speak)?\s*faster$/.test(t) || t === 'faster' || t === 'speed up') {
    out = { kind: 'speed', action: 'faster', value: clampVoiceSpeed(speed + SPEED_STEP) };
  } else if (/^(talk|speak)?\s*slower$/.test(t) || t === 'slower' || t === 'slow down' || /say that again slower/.test(t)) {
    out = { kind: 'speed', action: 'slower', value: clampVoiceSpeed(speed - SPEED_STEP) };
  } else if (/normal (speed|pace)/.test(t)) {
    out = { kind: 'speed', action: 'reset', value: DEFAULT_VOICE_SPEED };
  } else if (/^(quieter|quieter please|lower( the)? volume|volume down|turn it down)$/.test(t)) {
    out = { kind: 'volume', action: 'quieter', value: clampVoiceVolume(volume - VOLUME_STEP) };
  } else if (/^(louder|louder please|raise( the)? volume|volume up|turn it up)$/.test(t)) {
    out = { kind: 'volume', action: 'louder', value: clampVoiceVolume(volume + VOLUME_STEP) };
  } else if (/normal volume/.test(t)) {
    out = { kind: 'volume', action: 'reset', value: DEFAULT_VOICE_VOLUME };
  }
  if (out && opts?.apply) {
    if (out.kind === 'speed') setVoiceSpeed(out.value, opts.storage);
    else setVoiceVolume(out.value, opts.storage);
  }
  return out;
}

export const WAKE_WORD_KEY = 'atrium.wakeWord';
export const SMART_NLU_KEY = 'atrium.smartNlu';
export const VOICE_SETTINGS_EVENT = 'atrium:voice-settings';

function readFlag(key: string, storage: VoiceStorage, fallback = false): boolean {
  try {
    const raw = (storage === undefined ? defaultStorage() : storage)?.getItem(key);
    return raw === null || raw === undefined ? fallback : raw === '1';
  } catch { return fallback; }
}

function writeFlag(key: string, on: boolean, storage: VoiceStorage): void {
  try { (storage === undefined ? defaultStorage() : storage)?.setItem(key, on ? '1' : '0'); } catch { /* keep in-memory value */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VOICE_SETTINGS_EVENT));
}

export const getWakeWord = (storage?: VoiceStorage): boolean => readFlag(WAKE_WORD_KEY, storage);
export const setWakeWord = (on: boolean, storage?: VoiceStorage): void => writeFlag(WAKE_WORD_KEY, on, storage);
export const getSmartNlu = (storage?: VoiceStorage): boolean => readFlag(SMART_NLU_KEY, storage, true);
export const setSmartNlu = (on: boolean, storage?: VoiceStorage): void => writeFlag(SMART_NLU_KEY, on, storage);
