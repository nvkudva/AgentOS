/**
 * Wake phrase detection over Whisper transcripts. No keyword model: while armed, every
 * short VAD segment is transcribed on-device and checked here. Whisper spells a name it
 * does not know several ways, so the match is deliberately loose about "Atrium".
 */

// "Hey Atrium" run together often comes back as "K-A-Trium", "KATRIAM" or "Katrium".
const WAKE = /^\W*(?:(?:um|uh|so)[\s,]+)?(?:(?:hey|hi|ok|okay)[\s,]+|k[\s-]?)?(?:a[\s-]?tri(?:um|ums|um's|am|on|an|em|eum)|agent[\s-]?o\.?\s?s\.?)(?![a-z])[\s,.!?:;-]*/i;

/** What Whisper prints for silence, breath and room noise. */
const NOISE = /^(?:you|thank you|thanks|thanks for watching.*|bye|okay|oh|hmm+|uh+|um+)$/i;

export type WakeMatch = { woke: boolean; rest: string };

export function matchWake(text: string): WakeMatch {
  const hit = text.match(WAKE);
  if (!hit) return { woke: false, rest: text.trim() };
  return { woke: true, rest: text.slice(hit[0].length).trim() };
}

/** Bracketed tags ("[BLANK_AUDIO]", "(music)") removed; empty or filler counts as noise. */
export function clean(text: string): string {
  return text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/**
 * True when what the mic heard is mostly the reply the orb is speaking: its own voice
 * coming back through the speakers. Anything else heard mid-reply is the operator
 * talking over it.
 */
export function isEcho(heard: string, speaking: string): boolean {
  const said = words(heard);
  if (!said.length) return true;
  const reply = new Set(words(speaking));
  const shared = said.filter((w) => reply.has(w)).length;
  return shared / said.length >= 0.5;
}

export function isNoise(text: string): boolean {
  const bare = clean(text).replace(/[.!?,]+/g, '').trim();
  return !bare || NOISE.test(bare);
}
