# Voice Control — Requirements for Architecture

Status: requirements handoff. No implementation yet.
Constraint: **no runtime APIs**. No cloud STT, TTS, LLM, embeddings, or analytics.
In-browser models allowed. First-run model download must be explicit, cached, and work offline after.

## 1. Ground truth — what exists today

Read before designing. Do not rebuild these.

- Orb + Supervisor panel: [Supervisor.tsx](/Users/vijay/dev/projects/AgentOS/web/src/desktop/Supervisor.tsx:1). Push-to-talk, transcript, proposal chit, clarify cards, result cards.
- Deterministic command parser: [commands.ts](/Users/vijay/dev/projects/AgentOS/web/src/desktop/commands.ts:79) `run(raw, CmdCtx)`. Keyword room routing `routeRooms()`. Covers: status summary, stop/resume all, stop/start/open agent, open room/app, approvals surface-only, theme/sidebar. Fallback: unmatched sentence becomes mandate proposal.
- TTS: Kokoro-82M ONNX in browser, WebGPU→WASM fallback: [voice.worker.ts](/Users/vijay/dev/projects/AgentOS/web/src/lib/voice.worker.ts:1), [voice.ts](/Users/vijay/dev/projects/AgentOS/web/src/lib/voice.ts:1). Keep. Already no-API.
- STT today: `webkitSpeechRecognition` in [Supervisor.tsx](/Users/vijay/dev/projects/AgentOS/web/src/desktop/Supervisor.tsx:200). **Violates no-API rule.** Chrome sends audio to Google servers. No Safari/Firefox. Must replace.
- Live data: single `Snapshot { rooms, agents, inbox, mandates, tasks }` over SSE: [api.ts](/Users/vijay/dev/projects/AgentOS/web/src/lib/api.ts:35). All voice answers must derive from this snapshot plus room detail reads. No second data path.
- Rooms (7): Engineering, Analytics, Marketing, Sales, Support, Finance, Research. Agents 1–2 per room. Mandate states: `heard|routed|planned|working|blocked|done|recalled`. Task states: `queued|working|done|failed|killed`. Agent states: `idle|working|blocked|awaiting_approval|failed|killed`.
- Room progress helper already canonical: [progress.ts](/Users/vijay/dev/projects/AgentOS/web/src/lib/progress.ts:1) `roomProgress()`, `roomDetail()`. Voice summaries must reuse, never re-derive wording.
- Safety rule R2, non-negotiable: voice may commit a mandate, never an approval. Parser already refuses: [commands.ts](/Users/vijay/dev/projects/AgentOS/web/src/desktop/commands.ts:142). Preserve verbatim in spirit.

Gap: today voice cannot answer per-room progress, blocked lists, ordinal refs (“Marketing task 1”), scoped summaries (“how are we doing in Sales?”), follow-ups (“what about Engineering?”), list/read/detail queries, window control beyond open, or multi-turn context. That is this project.

## 2. Product thesis

Operator supervises 7 rooms × agents × mandates while away from keyboard. Voice is fastest System-1 surface: glanceable state, navigation, triage in <10s per query. Not a chatbot. Not dictation into a chat box.

Design like a PM system, not a demo:

- **System 1 (fast, deterministic, 95% of traffic):** grammar + entity linking over snapshot. Instant, predictable, testable, safe. No LLM in path.
- **System 2 (slow, in-browser LLM, 5%):** open-ended synthesis only (“summarise Sales this week”, “why is Engineering stuck?”). Reads a pre-filtered snapshot slice. Never executes actions directly. Output passes validator before speech.
- Default to System 1. Escalate to System 2 only when System 1 confidence low AND query is read-only.

North star: operator eyes-free for 60s learns: what needs me, what is blocked, what finished, where to look — and can act on top item without touching mouse.

## 3. Users and jobs

Single operator (current product assumption). Jobs:

1. Morning triage: “What needs me? What’s blocked? What finished overnight?”
2. Room check: “How are we doing in Sales?” “Latest progress in Engineering?”
3. Drill-down: “Open Marketing.” “Open Marketing task 1.” “Who’s working on that?”
4. Direct work: “Tell Engineering to fix the failing pricing test.” “Stop Rex.” “Run everyone.”
5. Triage approvals by voice navigation, decide by hand: “Show approvals.” “Read the first one.”
6. Hands-busy monitoring: periodic spoken digest, interrupt with “stop”, “repeat”, “slower”.

Out of scope v1: multi-speaker, voice biometrics, free-form chat, voice approvals, voice text editing, non-English (design for it, ship en-US first).

## 4. Interaction requirements (Interaction Design owns)

### 4.1 Session model

- Push-to-talk default: click orb or hold `Space` (when not typing). No always-listening default. Privacy + false-trigger cost too high.
- Wake word “Hey Atrium” opt-in only, off by default, on-device keyword spotter, visual indicator when armed, auto-disarm after 8h. Setting persists.
- One voice session = one continuous context. Session ends: explicit “that’s all / stop listening”, 30s silence, or orb click. Context (focus stack §6) survives within session, resets between sessions.
- Barge-in: operator speech during TTS stops playback within 150ms (existing `voice.stop()`). Mandatory. Speaking over the orb must never queue.
- Earcons, not words, for state: listening start (short rise), recognised (tick), error (low thud), confirmation needed (double tick). Orb ring already shows mic levels — keep.

### 4.2 States (map to existing Orb modes)

`idle → listening (VAD active) → thinking (STT final, parsing) → speaking (TTS) → confirming (proposal standing) → idle`. Error overlays any state, returns to listening. Orb colours already defined in [Orb.tsx](/Users/vijay/dev/projects/AgentOS/web/src/desktop/Orb.tsx:133). No new visual element. Panel shows live partial transcript + final + spoken reply (already does).

### 4.3 Spoken output rules

- Answer first. First sentence carries the fact. Detail after, only if asked. (“Sales: 2 blocked, 1 waiting on you. Sam has been idle 3 days.”)
- Length caps: status answer ≤3 sentences / ≤25s speech. List answer ≤5 items spoken; rest shown visually with “and 4 more on screen”.
- Numbers spoken as words for counts ≤10, digits above. Costs as agent-hours via existing `hours()` in [humanize.ts](/Users/vijay/dev/projects/AgentOS/web/src/lib/humanize.ts:1). Never cents, never tool names, never IDs.
- Every spoken answer mirrors visually: panel text + highlight/open/scroll target (§7). Voice never the only channel — noisy room, deaf operator, muted tab.
- Repeat / slower / spell commands: “repeat”, “say that again slower” (TTS speed 0.85 once), “stop talking”.
- No LLM free-prose for counts/states. Templates render facts; LLM may only rephrase a template output when System 2 invoked, and numbers are locked tokens it cannot alter (Architect: enforce by construction, not prompt).

### 4.4 Confirmation tiers (Safety owns)

- T0 Read (status, summary, list): execute, speak. No confirm.
- T1 Navigate/UI (open, focus, scroll, theme, park/unpark): execute, speak short ack. No confirm. Reversible by definition.
- T2 Commit work (dispatch mandate, start/stop/kill agent, recall mandate): show proposal chit (existing pattern), require spoken “yes” or Enter within 20s. “No”/Escape discards. Never auto-commit on timeout except existing hand-dropped chit 3s rule.
- T3 Decide (approve, reject, publish, send): **never by voice**. Surface card, focus it, say “Here’s the card — decision needs your hand.” Preserve R2.
- Ambiguous entity (“open Sam” matches agent + room?): ask one clarifying question with ≤3 numbered options. Operator answers “one / two” or name. Reuse clarify UI in Supervisor.

### 4.5 Error and repair

- No-match: say what was heard + closest capability. “I heard ‘open sails’. Did you mean Sales?” Never silent, never guess-execute below confidence threshold (Architect sets; PM floor 0.75 entity confidence).
- Partial understanding: execute understood half, name missing half. (“Opening Marketing. Which task — I see 3 active.”)
- STT low confidence / noisy: ask repeat once, then offer typing (⌘K). Never loop >2 retries.
- Offline/model-loading: orb says/shows “Voice loading, typing works” — keyboard path always live.
- Every error leaves UI unchanged. Voice failure must never strand operator.

## 5. Functional requirements

Format: `FR-n` | utterance examples | intent | required behaviour. All intents resolve entities against live Snapshot. Ordinals bind to the last-spoken or currently visible sorted list (§6).

### Navigation (T1)

- FR-1 Open room/app/agent: “Open Sales”, “Show Engineering”, “Go to approvals / Work / Overview / Settings”, “Open Ada”. Existing parser covers subset; extend to parked rooms (unpark+focus), agent windows, mandate windows.
- FR-2 Ordinal open: “Open Marketing task 1”, “Open the second blocked item”, “Open that”. Ordinal = position in last list spoken/shown for that room, sorted: blocked first, then working, then queued, by `ord`. Must open Task→AgentApp/Mandate view and highlight row.
- FR-3 Window control: “Close this”, “Minimise Marketing”, “Bring Engineering to front”, “Park Sales”, “Show everything / clear desk”. Map to `wm.ts` ops only.
- FR-4 Scroll/read screen: “Scroll down”, “Read this page”, “Next / previous room” (existing ←/→ room travel, voice parity).

### Status and query (T0) — core ask

- FR-5 Global status: “What needs me?”, “Status”, “Anything blocked?” (exists, keep wording), plus “What finished?” “What’s running?”
- FR-6 Per-room progress: “What’s the latest progress in Engineering?”, “How are we doing in Sales?”, “Update on Marketing”. Answer = `roomProgress()` sentence + blocked count + waiting-on-you count + last report first sentence. Opens/highlights room while speaking.
- FR-7 Blocked list: “What is blocked?”, “What’s blocked in Support?”, “Who is stuck and why?” List agent/mandate, room, reason via `friendlyActivity()` (never raw state strings). Cap 5 spoken.
- FR-8 Needs-me queue: “What needs me?”, “Read my approvals”, “How many approvals waiting?” Count + top item by cost (`hours()`), surface Sidebar, focus first card. Decide stays manual (T3).
- FR-9 Entity detail: “What is Sam doing?”, “Tell me about Marketing task 2”, “Who runs Finance?”, “How much budget left in Analytics?” Answer from agent/room fields + tasks. Budget as remaining agent-hours.
- FR-10 Search/filter: “Find mandates about pricing”, “Show failed tasks”, “Anything from last week?” Filter Work view, speak count + first 3 titles.
- FR-11 Summary (System 2): “Summarise Sales”, “How are we doing overall?”, “Why is Engineering stuck?” Grounded synthesis over filtered slice only (§8). Must end with offer: “Want detail on any of these?”
- FR-12 Comparison/follow-up: “What about Engineering?” (re-run last intent, swap room), “And who owns that?”, “Open it”. Requires context stack §6.

### Action (T2/T3)

- FR-13 Dispatch mandate: any unmatched work sentence → proposal chit → spoken yes commits (exists; extend routing synonyms, keep confirm).
- FR-14 Agent control: “Run Kit”, “Stop Rex”, “Stop all”, “Resume all” (exists). Add “Pause Marketing” = halt room agents, confirm T2.
- FR-15 Recall/redirect: “Recall that”, “Move that to Analytics”, “Cancel the last mandate”. T2 confirm, reuse `/api/mandates/:id/recall|route`.
- FR-16 Approvals navigation only: “Show approvals”, “Read the first one”, “Next approval”. Never approve/reject (T3).

### Session/meta (T0/T1)

- FR-17 “Repeat”, “Stop”, “Quieter / louder” (TTS volume), “Talk faster/slower” (persist speed), “Type instead”, “Help / what can I say?” (speak 5 examples + show HELP list).

Acceptance: each FR ships with ≥5 utterance fixtures (happy, synonym, ordinal, follow-up, failure) in a committed test file. Parser tests deterministic, no model in test path.

## 6. Conversation context (Architect owns design, PM owns behaviour)

Maintain explicit context stack, inspectable in panel (show current focus as chip):

- `focusRoom`, `focusAgent`, `focusMandate`, `focusTask`, `lastList { items[], intent, sortedAt }`, `lastIntent`.
- Every spoken answer that names entities pushes them. “Open task 1” resolves against `lastList` if room matches, else queries room fresh and announces list size.
- Follow-up lifetime: within session only. New unrelated intent overwrites. “That” = top focus. Pronoun resolution deterministic (stack lookup), never LLM guess.
- Context visible and clearable: “Forget that / start over” clears stack. Panel chip click clears too (mouse parity).

## 7. Visual accompaniment (every voice action has one)

Architect: single `VisualConductor` — voice never mutates React ad hoc.

- Open/focus target window, raise z, flash room-colour rim once (existing arrival motion).
- Highlight spoken-about rows (task/agent/inbox) 2s outline in room colour; scroll into view.
- Lists spoken = lists shown (Work/Inbox/room task strip filtered to match). Screen and speech must not diverge.
- Proposal/clarify/result cards reuse Supervisor panel. No new surfaces, no modal dialogs by voice.

## 8. In-browser AI stack — options Architect must evaluate

No runtime network calls for inference. Weights: bundle or first-run download with progress + consent, cached in Cache Storage/OPFS, version-pinned, deletable from Settings. Total voice payload budget: ≤250MB, lazy-loaded after first orb click, never on first paint. Must run WASM-only fallback; WebGPU accelerates.

- STT (replace `webkitSpeechRecognition`): evaluate Moonshine Tiny/Base ONNX (streaming, voice-command tuned, small) as System-1 primary vs Whisper tiny.en/base.en via Transformers.js (better free dictation, heavier, non-streaming chunks). Requirement: partial transcripts <300ms, final <800ms after end-of-speech, en-US WER target <12% quiet / <20% office noise on eval set. Silero VAD (ONNX, ~2MB) for endpointing + barge-in, 400ms silence = end of turn (tunable).
- NLU: deterministic grammar + entity linker first. Semantic fallback: small embeddings (e.g. MiniLM/e5-small ONNX) matching utterance → room/agent/task names for synonyms (“sails”→Sales repair). Embeddings may rank, never execute below threshold.
- LLM (System 2 only): evaluate WebLLM (Qwen2.5-1.5B / Llama-3.2-1B q4) vs Transformers.js SmolLM2. Input = intent + retrieved snapshot slice (≤2k tokens, IDs replaced with names). Output = short summary text only; any extracted action re-enters System-1 validator as proposal. Hard rules: no numbers invented (validate numerals against slice, reject+fallback to template on mismatch), no tool calls, timeout 8s → template fallback.
- TTS: keep Kokoro. Add speed/volume controls, sentence-chunk streaming (already per-sentence), stop-on-barge-in.
- Wake word (if shipped): openWakeWord/Porcupine-class on-device spotter or Moonshine KWS. Gate: false-accept <1/day office audio eval, else cut feature.

Browser matrix: Chrome/Edge WebGPU best path; Safari/Firefox WASM fallback must pass same FR tests slower. No SpeechRecognition fallback to cloud — if on-device STT unavailable, voice input disabled with honest message, typing offered. Never silently use cloud STT.

## 9. Architecture handoff — module boundaries (Architect refines)

Suggested seams, existing code first:

- `web/src/lib/voice/` — `capture.ts` (getUserMedia, VAD, barge-in), `stt.worker.ts` (ONNX STT), keep `voice.ts`/`voice.worker.ts` (TTS) as-is.
- `web/src/desktop/intent-engine.ts` — System 1: grammar intents, entity linker over Snapshot, context stack, confidence + tier assignment. Pure functions, unit-tested without audio/models. Extend, don’t replace, `commands.ts: run()` contract (`CmdResult { say, ok, propose }`).
- `web/src/lib/voice/query.ts` — deterministic queries over Snapshot (+ room detail fetch) returning facts; `respond.ts` — template composer using `roomProgress`/`friendlyActivity`/`hours`.
- `web/src/lib/voice/llm.worker.ts` — System 2 summariser, sandboxed, slice-in/text-out.
- `Supervisor.tsx` — session state machine, VisualConductor calls via existing `CmdCtx` + `App.tsx` window ops. No new global state store without justification.
- Privacy: audio never leaves device, never stored; transcript stored session-only (localStorage opt-in for history, default off); Settings shows model sizes, mic state, delete-models button. Mic indicator OS + orb whenever capturing.

## 10. Non-functional requirements

- Latency: end-of-speech → first spoken word <1s System 1 (STT final 800ms + parse <50ms + TTS first chunk). System 2 <8s with “thinking” earcon + on-screen progress.
- Reliability: intent accuracy ≥90% on 200-utterance eval set (all FRs, accents/noise variants via recorded fixtures); false T2 execution = 0; false wake <1/day.
- Perf: voice workers off main thread; desk stays 60fps while listening (Orb analyser already does); STT worker idle CPU <2%.
- Accessibility: full keyboard/mouse parity for every voice action; captions = panel transcript always on; respects `prefers-reduced-motion` for highlights.
- Privacy/security: no audio/transcript network egress (Architect: prove with CSP + test that blocks `fetch` from voice workers); mic permission denial path tested.

## 11. Phasing (PM recommendation)

- P0: Replace cloud STT with on-device STT+VAD behind existing orb; FR-5–9, FR-1–2 templates only. No LLM. Ship when eval passes.
- P1: Context stack, ordinals, window control, search, recall/redirect (FR-3,10,12,15). 
- P2: System-2 summaries (FR-11) behind setting, default on only if numeral-validation passes eval.
- P3: Opt-in wake word, digests (“brief me every morning” — scheduling needs product decision, not assumed).

## 12. Open decisions for Architect + PM

1. STT pick after bake-off (Moonshine vs Whisper) on WER/latency/size — needs recorded eval corpus; synthetic TTS fixtures insufficient alone.
2. Model delivery: bundled in PWA vs first-run download (hosted demo has no backend — download source/CSP decision).
3. Sales/business numbers: Snapshot lacks bizdata aggregates. “How are we doing in Sales?” v1 = work-state summary (mandates/tasks/pipeline tasks). True revenue/pipeline numbers need new read endpoint or room-detail reuse — Architect to propose, PM approves scope.
4. Safari WASM STT viability — if fails perf gate, Safari gets push-to-talk typing + TTS only, stated honestly in UI.

## 13. Example scripts (acceptance walkthroughs)

- “Hey Atrium — what’s the latest progress in Engineering?” → “Engineering: 3 of 5 done, Kit on the rest. One blocked — Rex stopped, it was going in circles.” Room highlights.
- “What is blocked?” → list ≤5 with room+reason; “Open the first one” → opens that agent/task.
- “Open Marketing task 1.” → Marketing opens, task 1 (blocked-first sort) highlighted, spoken title+state.
- “How are we doing in Sales?” → work summary + waiting count; follow-up “What about Finance?” reuses intent.
- “Approve the first one.” → card surfaces, “I never approve by voice. Here’s the card.” No state change. Test asserts zero decide calls.

