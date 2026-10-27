/**
 * System 2, used only as a fallback: when the grammar does not understand a sentence,
 * the on-device model rewrites it as one command from a closed list. The caller then
 * runs that command back through the grammar, so the model can never make the OS do
 * anything a typed command could not.
 */
import type * as Api from '../api';

export type LlmStatus = 'idle' | 'loading' | 'ready' | 'error';

const TIMEOUT_MS = 8000;
const COMMANDS = [
  'brief me', 'what needs me', 'what is blocked', 'what finished', "what's running",
  "what's going on with {room}", 'open {room}', 'close {room}', 'open {app}', 'close {app}',
  'close this', 'close all', 'approve this', 'decline this', 'undo', 'stop', 'stop listening',
  'stop all', 'resume all', 'what is {agent} doing', 'run {agent}', 'stop {agent}',
  'dark mode', 'light mode', 'next room', 'previous room', 'help',
];
const APPS = ['music', 'maps', 'ride', 'overview', 'work', 'settings', 'approvals'];

let worker: Worker | null = null;
let current: LlmStatus = 'idle';
let seq = 0;
const waiting = new Map<number, (text: string | null) => void>();

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    current = 'error';
    return null;
  }
  worker.onmessage = (event: MessageEvent<any>) => {
    const m = event.data;
    if (m.type === 'status') current = m.status;
    else if (m.type === 'progress' && current !== 'ready') current = 'loading';
    else if (m.type === 'result' || m.type === 'error') {
      waiting.get(m.id)?.(m.type === 'result' ? m.text : null);
      waiting.delete(m.id);
    }
  };
  worker.onerror = () => { current = 'error'; };
  return worker;
}

export function preload(): void {
  if (current === 'idle') ensureWorker()?.postMessage({ type: 'load' });
}

export function status(): LlmStatus {
  return current;
}

export function buildMessages(utterance: string, snap: Api.Snapshot) {
  const system = [
    'You turn what the user said into exactly one command for a desktop voice assistant.',
    'Reply with the command only, copied from the list with the slot filled, or NONE.',
    `Commands: ${COMMANDS.join(' | ')}`,
    `{room}: ${snap.rooms.map((r) => r.name).join(', ')}`,
    `{app}: ${APPS.join(', ')}`,
    `{agent}: ${snap.agents.map((a) => a.name).join(', ')}`,
  ].join('\n');
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: 'how are the sales folks getting on' },
    { role: 'assistant' as const, content: "what's going on with Sales" },
    { role: 'user' as const, content: 'put some tunes on' },
    { role: 'assistant' as const, content: 'open music' },
    { role: 'user' as const, content: 'what is the weather in paris' },
    { role: 'assistant' as const, content: 'NONE' },
    { role: 'user' as const, content: utterance },
  ];
}

/** First line, without quotes or a trailing full stop; NONE and empty mean no command. */
export function parseReply(reply: string): string | null {
  const line = reply.split('\n')[0].trim().replace(/^["'`]+|["'`.]+$/g, '').trim();
  if (!line || /^none$/i.test(line) || line.length > 60) return null;
  return line;
}

/** Resolves null on timeout, load failure or NONE — the caller keeps its own reply. */
export function toCommand(utterance: string, snap: Api.Snapshot): Promise<string | null> {
  const w = ensureWorker();
  if (!w || current !== 'ready') { preload(); return Promise.resolve(null); }
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { waiting.delete(id); resolve(null); }, TIMEOUT_MS);
    waiting.set(id, (text) => { clearTimeout(timer); resolve(text === null ? null : parseReply(text)); });
    w.postMessage({ type: 'complete', id, messages: buildMessages(utterance, snap) });
  });
}
