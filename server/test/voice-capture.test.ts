import { test } from 'node:test';
import assert from 'node:assert';
import {
  createVadState, downsample, rms, vadStep,
  ENDPOINT_SILENCE_MS, VAD_RMS_THRESHOLD,
} from '../../web/src/lib/voice/capture.ts';
import {
  clampVoiceSpeed, clampVoiceVolume, getVoiceSpeed, setVoiceSpeed,
  getVoiceVolume, parseVoiceSettingCommand, resolveSpeechRate, SLOWER_ONCE_SPEED,
} from '../../web/src/lib/voice/settings.ts';

const LOUD = VAD_RMS_THRESHOLD * 4;
const QUIET = 0;

/** Feed `vadStep` at 50ms ticks; returns events as [kind, at]. */
function feed(levels: number[], stepMs = 50) {
  let state = createVadState();
  const events: [string, number][] = [];
  levels.forEach((level, i) => {
    const r = vadStep(state, level, i * stepMs);
    state = r.state;
    if (r.event) events.push([r.event.kind, r.event.at]);
  });
  return { state, events };
}

test('downsample halves length at 32k->16k and averages pairs', () => {
  const input = new Float32Array([0, 1, 0, 1, 0.5, 0.5, -1, 1]);
  const out = downsample(input, 32000, 16000);
  assert.equal(out.length, 4);
  assert.deepEqual([...out], [0.5, 0.5, 0.5, 0]);
});

test('downsample 48k->16k keeps mono values, same-rate returns a copy', () => {
  const input = new Float32Array([1, 1, 1, 0, 0, 0, -1, -1, -1]);
  assert.deepEqual([...downsample(input, 48000, 16000)], [1, 0, -1]);
  const same = downsample(input, 16000, 16000);
  assert.deepEqual([...same], [...input]);
  assert.notEqual(same, input);
  assert.equal(downsample(new Float32Array(0), 48000, 16000).length, 0);
});

test('rms is zero for silence and 1 for full-scale DC', () => {
  assert.equal(rms(new Float32Array(8)), 0);
  assert.ok(Math.abs(rms(new Float32Array(8).fill(1)) - 1) < 1e-6);
});

test('vad: speech onset fires once, endpoint after 400ms trailing silence', () => {
  const ticks = (ms: number) => Math.round(ms / 50);
  const { events } = feed([
    ...Array(ticks(200)).fill(LOUD),
    ...Array(ticks(ENDPOINT_SILENCE_MS + 100)).fill(QUIET),
  ]);
  assert.deepEqual(events.map((e) => e[0]), ['speech', 'endpoint']);
  // Last loud tick is at 150ms; endpoint must be >=400ms of silence after it.
  assert.ok(events[1][1] - 150 >= ENDPOINT_SILENCE_MS);
});

test('vad: short mid-word pause does not endpoint', () => {
  const { events, state } = feed([
    ...Array(4).fill(LOUD), ...Array(4).fill(QUIET), // 200ms pause
    ...Array(4).fill(LOUD), ...Array(2).fill(QUIET),
  ]);
  assert.deepEqual(events.map((e) => e[0]), ['speech']);
  assert.equal(state.speaking, true);
});

test('vad: silence alone never speaks or endpoints', () => {
  const { events, state } = feed(Array(20).fill(QUIET));
  assert.deepEqual(events, []);
  assert.equal(state.speaking, false);
});

test('voice settings clamp, persist via injected storage, and parse FR-17 phrases', () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
  };
  assert.equal(getVoiceSpeed(storage), 1);
  assert.equal(setVoiceSpeed(99, storage), 1.5);
  assert.equal(getVoiceSpeed(storage), 1.5);
  assert.equal(clampVoiceSpeed(Number.NaN), 1);
  assert.equal(clampVoiceVolume(-1), 0);
  assert.equal(resolveSpeechRate({ slowerOnce: true, storage }), SLOWER_ONCE_SPEED);
  assert.equal(getVoiceVolume(storage), 1);
  const slower = parseVoiceSettingCommand('talk slower', { storage, apply: true });
  assert.equal(slower?.kind, 'speed');
  assert.ok(getVoiceSpeed(storage) < 1.5);
  assert.equal(parseVoiceSettingCommand('quieter', { storage })?.kind, 'volume');
  assert.equal(parseVoiceSettingCommand('open sales', { storage }), null);
});

test('stale partials are skipped so finals are not starved behind them', async () => {
  const { readFile } = await import('node:fs/promises');
  const stt = await readFile(new URL('../../web/src/lib/voice/stt.ts', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../../web/src/lib/voice/stt.worker.ts', import.meta.url), 'utf8');
  assert.ok(stt.includes('sampleRate: 16000, final'), 'client must tell worker which jobs are final');
  assert.ok(/!message\.final && message\.id < highestSeenId/.test(worker), 'worker must skip superseded non-final jobs');
  assert.ok(!/asr\(audio,\s*\{[^}]*language/.test(worker), 'English-only model must not receive language/task options');
});

test('stt sources contain no cloud SpeechRecognition path', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const f of ['capture.ts', 'stt.ts', 'stt.worker.ts', 'settings.ts']) {
    const src = await readFile(new URL(`../../web/src/lib/voice/${f}`, import.meta.url), 'utf8');
    assert.ok(!/SpeechRecognition/.test(src), `${f} must not reference SpeechRecognition`);
    assert.ok(!/audio.*(?:localStorage|indexedDB)|localStorage.*audio/i.test(src), `${f} must not store audio`);
  }
});
