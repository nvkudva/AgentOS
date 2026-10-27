# Agent OS v3 — Voice-First Operating System: Requirements + Plan

Status: approved for build 2026-10-27. Supersedes the R2 "never approve by voice" rule
in VOICE-CONTROL-REQUIREMENTS.md §4.4 (operator decision: approvals by voice, with a
spoken confirm and the existing 8 s undo).

## 1. Product

Agent OS is a macOS-like desktop for an agentic company. Teams (rooms: Engineering,
Sales, Marketing, …) each have a **manager agent** that decomposes work for its workers.
All managers report to one **supervisor** — the orb, "Atrium". The human runs the whole
OS by voice through the supervisor; mouse and keyboard stay as full-parity fallbacks.

Every model runs in the browser. No cloud STT/TTS/LLM, no audio leaves the device.

## 2. Rewrite decision

No rewrite. The existing split is right: deterministic System-1 grammar over the live
snapshot (`intent-engine.ts`), on-device Whisper STT (`stt.worker.ts`), on-device Kokoro
TTS (`voice.worker.ts`), one window manager (`wm.ts`). It is tested (23 voice tests).
The gaps are features and bugs, not structure. A rewrite would discard working, tested
code for no user-visible gain.

## 3. Requirements

### 3.1 Wake word (new)
- R-W1 "Hey Atrium" / "Atrium" / "Hey Agent OS" wakes the orb hands-free.
- R-W2 Opt-in toggle (Settings + orb right-click menu + "turn on wake word"), persisted.
  Off by default: an always-open mic is a privacy choice the operator makes.
- R-W3 Armed state is visible: the orb shows a dim "armed" ring. Mic indicator honest.
- R-W4 Wake phrase + command in one breath works ("Atrium, open Sales").
  Wake phrase alone opens a listening session with an earcon.
- R-W5 Detection on-device: VAD-gated Whisper transcripts matched against the wake
  phrase set (fuzzy: "atrium", "a trium", "atrium's", "agent os"). No extra model.
  Segments >5 s while armed are ignored (conversation, not a command).

### 3.2 Conversation session
- R-S1 After a reply, the session stays open for follow-ups for 8 s of silence, then
  returns to armed (wake on) or idle (wake off).
- R-S2 "Stop" / "cancel" / "never mind" interrupts speech immediately and ends the turn.
  "Stop listening" / "that's all" ends the session.
- R-S3 Barge-in: speaking over TTS stops it (exists, keep).
- R-S4 Earcons: wake (rise), done (tick), error (thud), needs-confirm (double tick).

### 3.3 Commands (all must work typed or spoken)
| Ask | Behaviour |
|---|---|
| "What's going on with the engineering team?" / "Engineering update" / "How is Sales doing?" | Manager-voiced room status; opens that room. Never a work dispatch. |
| "What's the latest update?" / "Any updates?" / "Brief me" | Global brief: waiting-on-you, blocked, finished, working counts + newest result. |
| "Open sales team dashboard" / "Open Sales" | Opens the room console. "team", "dashboard", "room", "console" are filler. |
| "Open music/maps/ride/work/settings/overview/approvals" | Launches the app. |
| "Close music" / "Close Sales" / "Close this" / "Close all" | Closes that window / topmost / all. |
| "Approve this" / "Approve the first one" / "Approve Nia's post" | Focus card, ask "Approve <x>? Say yes." Yes → same decide path as the button, 8 s undo. |
| "Decline" / "Reject this" | Same, decision reject. |
| "Undo" | Undoes the last voice decision inside its 8 s window. |
| "Stop" | Shut up / cancel pending confirm. "Stop all" = panic stop (exists). "Stop Rex" = stop agent (exists, confirmed). |
| "Tell engineering to fix the pricing test" | Dispatch proposal (exists). Spoken "yes" commits. |

### 3.4 In-browser models
| Role | Model | Runtime | Size | Load |
|---|---|---|---|---|
| STT | whisper-tiny.en q8 | Transformers.js worker | ~40 MB | first mic use |
| TTS | Kokoro-82M q8 | kokoro-js worker | ~90 MB | first speech |
| LLM (System 2) | SmolLM2-360M-Instruct q4f16 (WebGPU) / q4 (WASM) | Transformers.js worker | 273 / 388 MB | opt-in "Smart understanding" |

LLM is only an NLU fallback: when the grammar returns unknown, the LLM picks one
canonical command from a closed list (or NONE); that string is re-run through the
grammar, so the model can never execute anything the grammar would not. 8 s timeout.

### 3.5 Safety
- Approve/reject by voice requires the explicit spoken "yes" (T3 confirm) and keeps
  the 8 s undo. No auto-commit on timeout.
- Destructive agent ops (stop/pause/recall/route) keep their T2 confirm.
- A standing proposal is committed only by "yes", Enter on an empty box, or the hand.
  Any other new sentence replaces it.

### 3.6 UI bugs to fix (found in probe 2026-10-27)
- B1 Typing a new command while a proposal stands commits the old proposal.
- B2 Room status questions phrased with "team"/"going on" become work dispatches.
- B3 Non-room apps cannot be opened or closed by voice; "close music" dispatched work.
- B4 "decline", "latest update" unrecognised.
- Further bugs from the end-to-end UI sweep are appended under Revisions.

## 4. Implementation plan

Owner key: **O** = Opus (lead, architecture-heavy), **S** = Sonnet subagent (bounded tasks).

1. (O) Contract: extend `IntentResult` with `decide?: {inboxId, decision}` and
   `VisualAction` with app launch/close for all `AppKind`s. Freeze before parallel work.
2. (S) Grammar: §3.3 phrases in `intent-engine.ts` + manager-voiced `sayRoom` +
   global brief in `respond.ts`/`query.ts`; fixtures in `server/test/voice-intent.test.ts`.
3. (S) Earcons module `web/src/lib/voice/earcons.ts` (WebAudio, no assets).
4. (S) Settings → Voice section: wake word toggle, smart-understanding toggle, model
   sizes, "delete downloaded models" (Cache Storage `transformers-cache`).
5. (O) Wake word + session state machine: `capture.ts` armed mode, `stt.ts` wake
   detection, `Supervisor.tsx` session lifecycle (armed → session → follow-up → armed).
6. (O) Voice decisions: `commands.ts`/`App.tsx` wiring to `useDecide` via one
   `atrium:decide` event, undo by voice, B1 fix in `Supervisor.tsx`.
7. (O) LLM worker `web/src/lib/voice/llm.worker.ts` + `llm.ts` client, wired as the
   unknown-intent fallback.
8. (O) End-to-end UI sweep in the browser; fix found bugs; typecheck, tests, build.

Gates: `cd server && npx tsx --test test/voice-*.test.ts`, `cd web && npx tsc --noEmit`,
`cd web && npm run build`, scripted browser walkthrough of every §3.3 row.

## Revisions
- 2026-10-27 Wake word runs on Whisper, not a keyword model. Whisper hears "Hey Atrium" as
  "K-A-Trium", "KATRIAM", "Katrium"; `wake.ts` matches those. Armed mode transcribes only
  endpointed segments ≤5 s, no partials.
- 2026-10-27 Echo rule: while the orb speaks, a transcript is dropped only if ≥50% of its
  words are in the reply being spoken. Anything else is barge-in: TTS stops and the
  command runs. A yes/no to a standing question is never echo ("Say yes to confirm" contains "yes").
- 2026-10-27 Whisper on WebGPU: `q8` decodes to gibberish. WebGPU uses fp32 encoder + q4
  decoder; WASM keeps q8.
- 2026-10-27 Voice decisions reuse the mounted queue's `useDecide` through one
  `atrium:decide` event (same pending card, courier, 8 s undo). App keeps a fallback
  `useDecide` for the phone, where the queue is only mounted on its tab.
- 2026-10-27 TTS system-voice fallback uses on-device voices only; Kokoro and system voice honour volume.
- 2026-10-27 Bugs fixed in the UI sweep: B1–B4; "close this" closed the focused room's
  parked rail instead of the front window; "minimise" closed windows; the armed state was
  hidden behind the alert orb; spoken "yes" was not shown as a turn; Settings checkboxes
  were 100 px wide; on phones the orb FAB was off-screen (menubar backdrop-filter made it
  the containing block of the fixed orb); the phone tab badge overlapped "Needs you";
  "Stop all" wrapped.
- 2026-10-27 Verification: `node scripts/voice-e2e.mjs` (21 typed commands through the real
  UI) and `node scripts/voice-e2e.mjs --audio <wav>` (spoken wake word through mic → Whisper).
