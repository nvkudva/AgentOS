# Voice Control — Architecture (P0+P1)

Scope: P0+P1 only. No System-2 LLM (FR-11), no wake word, no voice approvals.
Ground truth reused, not rebuilt: `commands.ts:run(raw,CmdCtx)`,
`progress.ts:roomProgress/roomDetail`, `humanize.ts:hours/friendlyActivity`,
`api.ts:Snapshot` (only data path), Kokoro TTS (`voice.ts`/`voice.worker.ts`),
Supervisor proposal/clarify/result cards, `wm.ts:useWindows`.

## 1. Decisions

| Question | Decision |
|---|---|
| STT engine | Whisper via Transformers.js in a Web Worker. Same runtime Kokoro already ships — no second inference stack. |
| Model | `onnx-community/distil-small.en`, `q8` on WASM, fp32 encoder + `q4` decoder on WebGPU, en-US. ~170–350 MB. |
| Dependency | Promote `@huggingface/transformers` to a direct `web` dep at `^3.8.1`. It is already installed transitively via `kokoro-js@1.2.1` (`^3.5.1`); pinning direct makes the import legal and version-stable. No other new runtime dep. |
| Endpointing | Energy VAD in `capture.ts` (RMS threshold, 400 ms trailing silence = end of turn). No Silero dep in P0+P1; interface allows swapping it in later. |
| Moonshine | Deferred. Re-evaluate only if Whisper misses §8 gates on a recorded corpus; the `SttClient` interface is engine-shaped, not Whisper-shaped, so a swap touches `stt.worker.ts` only. |
| Embeddings repair | Not in P0+P1. Entity linker is exact/prefix/edit-distance (§5). "sails→Sales" repair comes from linker suggestions + clarify, never execution. |
| Sales numbers (req §12.3) | Work-state only (mandates/tasks/agents). No new endpoint in this increment. |
| Model delivery | First orb click → explicit download with progress (Transformers.js default Cache Storage), version-pinned by model id+dtype, works offline after. Lazy: never on first paint. Total voice payload (Kokoro q8 + Whisper q8) well under 250 MB. |

## 2. New files (exact)

| File | Owner | Contents |
|---|---|---|
| `web/src/lib/voice/types.ts` | Integrator (frozen first) | All shared contracts in §3. Only file both implementers import from each other. |
| `web/src/lib/voice/capture.ts` | A (audio) | Mic, energy VAD, barge-in hook, 16 kHz PCM segments. |
| `web/src/lib/voice/stt.worker.ts` | A | Transformers.js ASR worker (protocol §3). |
| `web/src/lib/voice/stt.ts` | A | Main-thread `SttClient`: worker lifecycle, status, callbacks. |
| `web/src/lib/voice/context.ts` | B (NLU) | `VoiceContext` state + pure transitions. |
| `web/src/lib/voice/query.ts` | B | Deterministic fact queries over `Snapshot`. |
| `web/src/lib/voice/respond.ts` | B | Template composer; only place spoken strings are built. |
| `web/src/desktop/intent-engine.ts` | B | Grammar + entity linker + tier/confidence; pure. |
| `web/src/desktop/visual.ts` | Integrator | `VisualConductor`: applies `VisualAction[]` to window/highlight hooks. |
| `server/test/voice-capture.test.ts` | A | Endpointing/downsample unit tests (§7). |
| `server/test/voice-intent.test.ts` | B | FR utterance fixtures (§7). |
| `server/test/fixtures/voice-fixtures.ts` | B | Shared fixture snapshots + utterance table. |

Modified (Integrator only): `web/src/desktop/commands.ts` (delegate + `CmdCtx` extension),
`web/src/desktop/Supervisor.tsx` (STT swap, session machine, confirm handling),
`web/src/App.tsx` (new `CmdCtx` ops), `web/package.json` (dep + `check` script).
Nobody else edits these four. `voice.ts`/`voice.worker.ts` untouched except
Integrator adds optional `speed`/`volume` params for FR-17 (defaults preserve behaviour).

## 3. Shared interfaces (`types.ts`, frozen before parallel work)

```ts
import type { Agent, Inbox, Mandate, Room, Snapshot, Task } from '../api';
import type { Proposal } from '../../desktop/commands';

// ---- STT (A implements, Supervisor consumes) ----
export type SttStatus = 'idle'|'loading'|'ready'|'listening'|'error'|'unsupported';
export type Transcript = { text: string; final: boolean; confidence: number|null; at: number };
export interface SttClient {
  start(onTx: (t: Transcript) => void, onStatus: (s: SttStatus) => void): Promise<void>;
  stop(): void;
  status(): SttStatus;
  dispose(): void;
}
export function createSttClient(): SttClient;
// stt.worker.ts protocol (mirrors voice.worker.ts conventions)
//   in : {type:'load'} | {type:'transcribe', id:number, audio:Float32Array, sampleRate:16000}
//   out: {type:'status', status:SttStatus} | {type:'progress', progress:unknown}
//      | {type:'result', id:number, text:string} | {type:'error', id:number, message:string}

// capture.ts pure helpers (unit-tested without mic)
export function downsample(input: Float32Array, from: number, to: 16000): Float32Array;
export type VadEvent = { kind:'speech'|'endpoint'|'bargein', at: number };
export function vadStep(state: VadState, rms: number, now: number): { state: VadState, event: VadEvent|null };
export interface VadState { speaking: boolean; silenceMs: number; speechMs: number }
export function startCapture(handlers: {
  onSegment(pcm: Float32Array): void;        // one endpointed utterance, 16kHz mono
  onPartialPcm?(pcm: Float32Array): void;    // rolling buffer every 1.5s while speaking
  onVad(e: VadEvent): void; onLevel?(rms: number): void;
}): Promise<{ stop(): void }>;

// ---- Context (B) ----
export type ListItem = { kind:'task'|'mandate'|'agent'|'inbox'|'room';
  id: string; label: string; roomId: string|null; state: string };
export type VoiceContext = {
  focusRoom: Room|null; focusAgent: Agent|null;
  focusMandate: Mandate|null; focusTask: Task|null;
  lastList: { items: ListItem[]; intent: IntentKind; at: number } | null;
  lastIntent: IntentKind|null; pendingRoom: Room|null; // room of lastIntent, for FR-12 swap
};
export const emptyContext = (): VoiceContext => ({ focusRoom:null, focusAgent:null,
  focusMandate:null, focusTask:null, lastList:null, lastIntent:null, pendingRoom:null });

// ---- Intent (B produces, Supervisor/Integrator executes) ----
export type IntentKind = 'status.global'|'status.room'|'status.blocked'|'status.needsme'
  |'status.finished'|'status.running'|'entity.detail'|'nav.open'|'nav.ordinal'|'nav.window'
  |'nav.scroll'|'search'|'followup.room'|'action.dispatch'|'action.agent'|'action.roompause'
  |'action.recall'|'action.route'|'approval.nav'|'meta.repeat'|'meta.stop'|'meta.help'
  |'meta.speed'|'meta.volume'|'meta.clear'|'unknown';
export type Tier = 0|1|2|3;
export type VisualAction =
  | { kind:'openRoom', roomId:string } | { kind:'openAgent', agentId:string }
  | { kind:'openTask', taskId:string, roomId:string }
  | { kind:'launch', app:'floor'|'work'|'inbox'|'settings' }
  | { kind:'highlight', ids:string[], roomId:string|null }
  | { kind:'focusApproval', inboxId:string } | { kind:'scroll', dir:1|-1 }
  | { kind:'window', op:'close'|'minimise'|'front'|'park'|'clear', winRef:string|null };
export type IntentResult = {
  say: string; ok: boolean; intent: IntentKind; tier: Tier; confidence: number; // 0..1
  visual: VisualAction[]; context: VoiceContext;                 // next context, already applied
  propose?: Proposal;                                            // FR-13, existing chit flow
  confirm?: { label: string };                                   // T2: Supervisor arms YES/Enter
  clarify?: { question: string; options: { label:string; result: IntentResult }[] }; // ≤3, §4.4
};
export function interpret(raw: string, snap: Snapshot, ctx: VoiceContext): IntentResult;
// query.ts — facts only, no strings
export type RoomFacts = { room: Room; progress: ReturnType<typeof import('../progress').roomProgress>;
  blocked: ListItem[]; waiting: Inbox[]; crew: Agent[] };
export function roomFacts(snap: Snapshot, room: Room): RoomFacts;
export function blockedList(snap: Snapshot, room?: Room): ListItem[];
export function needsMe(snap: Snapshot): { count: number; top: Inbox|null; items: ListItem[] };
export function sortForSpeech(tasks: Task[], snap: Snapshot): ListItem[]; // §5 ordering
// respond.ts — templates only; numbers come from facts, never recomputed ad hoc
export function sayRoom(f: RoomFacts): string;
export function sayList(kind: IntentKind, items: ListItem[], total: number): string;
```

`CmdCtx` extension (Integrator, additive — existing fields untouched):
`mandates: Mandate[]; tasks: Task[];` plus ops `closeWin(id)`, `focusWin(id)`,
`parkRoom(r, side|null)`, `clearDesk()`, `recallMandate(m)`, `routeMandate(m, room)`,
`pauseRoom(r)`, `highlight(ids)` — all wired in `App.tsx` from existing
`useWindows` (`close/focus/patch`), `post('/api/mandates/:id/recall'|'/route')`,
and `post('/api/panic')`-style room halt via existing agent kill/start endpoints.

## 4. Intent → FR map

| Intent | FR | Tier | Phase | Notes |
|---|---|---|---|---|
| status.global / .finished / .running | FR-5 | T0 | P0 | Extends existing status branch; wording kept. |
| status.room | FR-6 | T0 | P0 | `roomFacts`→`sayRoom` = `roomProgress().where` + blocked/waiting counts + first sentence of `report`. Opens room (visual). |
| status.blocked | FR-7 | T0 | P0 | `blockedList`, reasons via `friendlyActivity`, cap 5 spoken. |
| status.needsme, approval.nav | FR-8, FR-16 | T0/T3-surface | P0 | Count + top by `hours(est_cost_cents)`; focus card; never decide. |
| entity.detail | FR-9 | T0 | P0 | Agent doing / room crew / mandate-task detail / budget = `hours(budget_cents-spent_cents)`. |
| nav.open | FR-1 | T1 | P0 | Existing open coverage + parked room (unpark via `focusWin`), agent & mandate windows. |
| nav.ordinal | FR-2 | T1 | P0 basic, P1 full | P0: "‹room› task N". P1: ordinals into any `lastList`, "open that". |
| nav.window, nav.scroll | FR-3, FR-4 | T1 | P1 | `wm.ts` ops only; next/previous room = room order in `snap.rooms`. |
| search | FR-10 | T0 | P1 | Keyword filter over mandates/tasks (reuse `routeRooms` STOP list); Work view via `launch('work')` + highlight. |
| followup.room | FR-12 | T0/T1 | P1 | Re-run `lastIntent` with swapped room (§5). |
| action.dispatch | FR-13 | T2 | exists+P0 | Unmatched work sentence → existing `Proposal` chit. No change to confirm flow. |
| action.agent / .roompause | FR-14 | T2 | exists+P1 | run/stop exist; "pause ‹room›" = kill its working agents, T2 confirm. |
| action.recall / .route | FR-15 | T2 | P1 | Existing `/recall` + `/route` endpoints; "that" = focus mandate. |
| approval decide attempts | FR-16/R2 | T3 | exists | Verbatim refusal string from `commands.ts:143-148`. Zero decide calls — asserted in tests. |
| meta.* | FR-17 | T0/T1 | P0 (repeat/stop), P1 (speed/volume/help/clear) | Repeat = re-speak last `say`; speed persists `localStorage atrium.voiceSpeed`. |

## 5. Context & ordinal rules (B, deterministic — no LLM)

1. Every `IntentResult` that names entities pushes focus: room→`focusRoom`, agent→`focusAgent`, task/mandate likewise; spoken lists set `lastList` (already sorted).
2. List sort (single canonical order, `sortForSpeech`): state rank blocked/failed first, then working, then queued, then done; ties by `Task.ord` ascending, then `created_at`. Blocked-agent lists: `blocked,failed,killed,awaiting_approval`, then name.
3. Ordinals: `first|1|one … fifth|5|five` index `lastList.items[n-1]`. Out of range → say list size, execute nothing. "‹room› task N" ignores `lastList` if its room differs: builds the room's task list fresh and announces its size when N resolves.
4. "that/it/this" = highest focus set, priority task > mandate > agent > room. "Open it" with no focus → clarify with ≤3 recent options or honest no-match.
5. FR-12 "what about ‹room›?" re-runs `lastIntent` with `pendingRoom` swapped; any non-room follow-up ("and who owns that?") resolves via rule 4. New unrelated intent overwrites focus (except `lastList` survives one turn for ordinal use).
6. Confidence: exact name/key match 1.0, prefix 0.9, edit-distance-1 0.8, else no match. Execute only ≥0.75 (req §4.5 floor). 0.5–0.75 → clarify (≤3 options, existing clarify UI). <0.5 → no-match reply naming what was heard + closest capability. T2 additionally requires ≥0.9 or clarify first.
7. Session boundary: Supervisor owns one `VoiceContext` ref per listening session; orb stop / 30 s silence / "that's all" resets to `emptyContext()`. "forget that/start over" (meta.clear) resets mid-session. Focus shown as panel chip; chip click clears (Integrator, mouse parity).

## 6. STT pipeline & fallback (A)

Push-to-talk only (existing orb click / Space). Flow: orb click →
`startCapture` (getUserMedia; the existing visual-only stream in Supervisor is
replaced by this one stream) → VAD segments PCM → `SttClient` posts
`{type:'transcribe'}` → worker runs `pipeline('automatic-speech-recognition',
'onnx-community/distil-small.en', {dtype, device})` (device: WebGPU probe
like `voice.worker.ts:18-23`, else WASM) → final `Transcript` → Supervisor's
existing `submit(text)` path, unchanged downstream. Partials: capture sends the
rolling buffer every 1.5 s; worker transcribes it as non-final. Barge-in: any
VAD `speech` event while TTS plays calls existing `voice.stop()` (<150 ms —
it is synchronous sample-stop today).

Fallback ladder, in order, never silent:
1. WebGPU load/inference throws → retry WASM q8 (same pattern as Kokoro worker).
2. WASM fails, model download fails, or no Web Worker/WASM → `SttStatus:'error'|'unsupported'`: orb click opens the typing box (⌘K path), panel shows "Voice unavailable here — typing works". 
3. Mic permission denied → same typing path + one spoken/shown explanation.
`webkitSpeechRecognition` is **deleted**, not kept as a fallback (req §8: never
silently use cloud STT). TTS failure behaviour is unchanged (system voice).

Privacy proof: STT worker contains no `fetch` except Transformers.js model
loading from its pinned CDN/cache on first explicit download; a test (§7)
greps worker sources for `SpeechRecognition` and asserts its absence app-wide.

## 7. Test strategy (repo runners only — no new framework)

Web has no test runner today; server does: `tsx --test test/*.test.ts`
(`server/package.json`). All new pure modules are React-free and import
`api.ts` types type-only, so the server runner imports them directly.

- B: `server/test/voice-intent.test.ts` — for every FR in §4, ≥5 fixtures
  (happy, synonym, ordinal, follow-up, failure) as `(utterance, ctxIn) →
  {intent, tier, say-substring, visual}` rows in `voice-fixtures.ts` against a
  hand-built `Snapshot`. Includes R2 test: approval utterances produce zero
  effect ops and the refusal string. Deterministic; no model, no audio.
- A: `server/test/voice-capture.test.ts` — `downsample` (rate/length/mono) and
  `vadStep` (synthetic RMS envelopes: endpoint at 400 ms, no endpoint mid-word,
  barge-in event) only. Worker/model itself is not unit-tested.
- Gates: `cd server && npm test`; `cd web && npx tsc --noEmit` (Integrator adds
  `"check"` script mirroring server's); `cd web && npm run build`.
- Manual eval gate (P0 exit, req §10): 200-utterance recorded set read aloud by
  ≥2 speakers, quiet + office noise; intent accuracy ≥90%, final-transcript
  latency <800 ms after endpoint, zero false T2 executions. Fixtures are text;
  this spoken pass is a checklist item, not CI.

## 8. Ownership & integration order

| Who | Owns (disjoint) | Must not touch |
|---|---|---|
| Integrator (day 0) | `types.ts` frozen + `CmdCtx` extension stubs so both compile against contracts | — |
| A — audio/STT | `capture.ts`, `stt.ts`, `stt.worker.ts`, `voice-capture.test.ts` | `Supervisor.tsx`, intent files |
| B — NLU | `context.ts`, `query.ts`, `respond.ts`, `intent-engine.ts`, both intent test files | `Supervisor.tsx`, `commands.ts`, audio files |
| Integrator (last) | `commands.ts` (delegate unmatched/new intents to `interpret`, keep legacy branches until fixtures pass, then remove duplicates), `Supervisor.tsx` (delete SpeechRecognition block lines ~199-218, wire `SttClient`, session/context ref, T2 confirm via existing YES handling, VisualConductor calls), `App.tsx` ctx ops, `visual.ts`, `web/package.json` | A's/B's internals |

Rules: contracts change only via Integrator editing `types.ts` + a note in this
doc. `run()` keeps its signature; `interpret` is called by Supervisor first and
falls back to `run()` for legacy utterances during P0, removed when fixtures
cover them. T2 execution: `IntentResult.confirm` arms Supervisor's existing
proposal-YES path (spoken "yes"/Enter commits, "no"/Escape/20 s timeout
discards) — the effect closure is built by Integrator from `CmdCtx`, never by B.

## 9. Acceptance checklist

- [ ] `webkitSpeechRecognition` gone (grep clean); no network STT path exists.
- [ ] Orb push-to-talk yields final transcript <800 ms after end-of-speech (manual timing, Chrome WebGPU + Firefox WASM).
- [ ] Every FR in §4 passes its ≥5 fixtures; R2 test asserts zero decide calls.
- [ ] Ordinal/context rules §5 each have a fixture, incl. cross-room "‹room› task N" and out-of-range.
- [ ] Spoken lists ≤5 items, counts as words ≤10, costs via `hours()`; screen list == spoken list.
- [ ] STT failure (airplane mode before first download; mic denied) → typing path + honest message, UI never stranded.
- [ ] Barge-in stops TTS; repeat/slower work; session reset clears context chip.
- [ ] `server npm test`, `web tsc --noEmit`, `web npm run build` all green.
- [ ] 200-utterance spoken eval ≥90% intent accuracy, 0 false T2 (else Moonshine bake-off reopens §1).

## 10. Unresolved (needs PM/owner, does not block P0)

- Recorded eval corpus does not exist yet; synthetic text fixtures cannot certify WER (req §12.1). Owner: PM to record before P0 exit gate.
- Model-download hosting/CSP for the hosted demo (Transformers.js default hub CDN vs self-host) — Integrator confirms CSP at integration; offline-after-first-download holds either way.
- Safari WASM latency unmeasured; if it misses <800 ms, Safari gets typing+TTS with the §6 honest message (req §12.4).
