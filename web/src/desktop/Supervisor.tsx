import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { runVoice, applyVisual, type CmdCtx } from './commands';
import { createSttClient, isSttSupported, STT_UNAVAILABLE_MESSAGE, type SttClient, type Transcript } from '../lib/voice/stt';
import { emptyContext, type VoiceContext } from '../lib/voice/context';
import type { IntentResult } from './intent-engine';
import { parseVoiceSettingCommand } from '../lib/voice/settings';
import * as voiceSettings from '../lib/voice/settings';
import * as earcons from '../lib/voice/earcons';
import * as wake from '../lib/voice/wake';
import * as llm from '../lib/voice/llm';
import { Orb } from './Orb';
import { startCarry } from './carry';
import { wireOrb, type Pitch, type Result, type Clarify } from './intent';
import { hours } from '../lib/humanize';
import * as voice from '../lib/voice';

const YES = /^(yes|yep|yeah|yup|sure|do it|go ahead|confirm|please do|ok|okay)( please| do it| go ahead| confirm( it)?| approve it| decline it| reject it)?$/;
const NO = /^(no|nope|cancel|never mind|nevermind|don't|do not|leave it|stop)$/;
const STOP_WORDS = /^(stop|cancel|never mind|nevermind|shut up|quiet|be quiet|stop talking)$/;
const PICK: Record<string, number> = { '1': 0, one: 0, first: 0, '2': 1, two: 1, second: 1, '3': 2, three: 2, third: 2 };
/** Silence that ends a conversation, and the longer wait while a yes/no question stands. */
const FOLLOW_UP_MS = 8000;
const CONFIRM_MS = 20000;

/**
 * The orb, and the small panel that grows out of it.
 *
 * The panel is deliberately tiny: the last thing you asked, the thing you are saying
 * now, and five bars that move while it is listening. Anything more and it stops being
 * an assistant and becomes another window.
 *
 * It holds exactly three kinds of object, in this order of claim: a question a manager
 * asked (a clarify), a proposal it has not committed, and the results nobody has read.
 * Nothing here can approve, and nothing here starts work without the operator's hand
 * or their word.
 */
export type Skin = 'glass' | 'well' | 'halo' | 'bloom';
export const SKINS: Skin[] = ['glass', 'well', 'halo', 'bloom'];

/** One exchange in the conversation. The panel is a chat, not a tray of notices. */
export type Turn = { id: number; who: 'you' | 'orb'; text: string };

export function Supervisor({ ctx, alert, speak: speakOn, results, clarifies, onResult, onClarify,
                             skin = 'glass' }: {
  ctx: CmdCtx; alert: boolean; speak: boolean; skin?: Skin;
  results: Result[];
  clarifies: Clarify[];
  onResult: (r: Result, what: 'open' | 'done') => void;
  onClarify: (c: Clarify, answer: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const [armed, setArmed] = useState(false);
  const [wakeOn, setWakeOn] = useState(() => voiceSettings.getWakeWord());
  const listeningRef = useRef(false);
  listeningRef.current = listening;
  const wakeRef = useRef(wakeOn);
  const micOn = useRef(false);
  const followUp = useRef<any>(null);
  const [heard, setHeard] = useState('');
  const [asked, setAsked] = useState('');
  const [reply, setReply] = useState('');
  const [supported, setSupported] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [prop, setProp] = useState<Pitch | null>(null);
  const [pick, setPick] = useState(0);
  const [leaving, setLeaving] = useState(false);
  /** The sentence being typed. Owned here so closing the box actually discards it. */
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const seq = useRef(0);
  const feed = useRef<HTMLDivElement>(null);
  const push = (who: 'you' | 'orb', t: string) => {
    const id = ++seq.current;
    setTurns((ts) => [...ts, { id, who, text: t }].slice(-8));
    return id;
  };
  const stt = useRef<SttClient | null>(null);
  const voiceCtx = useRef<VoiceContext>(emptyContext());
  const pendingConfirm = useRef<IntentResult | null>(null);
  const pendingClarify = useRef<IntentResult['clarify'] | null>(null);
  const lastSay = useRef('');
  const box = useRef<HTMLInputElement>(null);
  const hide = useRef<any>(null);
  const chit = useRef<HTMLSpanElement>(null);
  const orb = useRef<HTMLButtonElement>(null);
  const auto = useRef<any>(null);
  const live = useRef({ prop, pick });
  live.current = { prop, pick };
  /** the turn that asked "<room>?" — it follows the aim until the proposal is gone */
  const aimed = useRef(0);

  useLayoutEffect(() => { if (typing) box.current?.focus(); }, [typing]);
  useLayoutEffect(() => {
    const f = feed.current;
    if (f && open) f.scrollTop = f.scrollHeight;
  }, [turns, open, prop, clarifies.length, results.length]);

  /**
   * A press anywhere else puts it away. The panel is a thing you opened, so the desk
   * behind it is the dismiss target — the same way clicking off a menu closes it.
   *
   * On pointerdown rather than click, so it is gone before whatever you actually
   * reached for gets it. A drag that begins on the desk closes it too, which is right:
   * you have moved on. Listening is left alone — the voice session ends by speaking or
   * by clicking the orb, not by looking away.
   */
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || listening) return;
    const away = (e: PointerEvent) => {
      if (shell.current?.contains(e.target as Node)) return;
      clearTimeout(hide.current);
      setOpen(false); setTyping(false);
    };
    // capture, so it still fires when something below stops the event on its way up
    addEventListener('pointerdown', away, true);
    return () => removeEventListener('pointerdown', away, true);
  }, [open, listening]);

  const show = (ms = 6000) => {
    setOpen(true);
    clearTimeout(hide.current);
    if (!listening) hide.current = setTimeout(() => { setOpen(false); setTyping(false); }, ms);
  };

  const say = (text: string) => {
    if (text && !/^Repeating/.test(text)) lastSay.current = text;
    setReply(text);
    const id = push('orb', text);
    if (speakOn) voice.speak(text);
    return id;
  };

  /**
   * Commit. The chit's rect is read and the DOM node hidden in the same frame, before
   * React is told the proposal is gone — the capsule that leaves the orb starts exactly
   * where the chit was standing, so the handoff is continuous and nothing pops.
   */
  const commit = () => {
    const p = live.current.prop;
    if (!p) return;
    const room = p.rooms[live.current.pick] ?? p.room;
    const el = chit.current;
    const rect = (el ?? orb.current)!.getBoundingClientRect();
    if (el) el.style.visibility = 'hidden';
    clearTimeout(auto.current);
    setProp(null); setPick(0); setTyping(false); setText('');
    ctx.dispatch(p.text, room, rect, p.mandate);
    say(`${room.name} has it.`);
    show(6000);
  };

  const discard = () => {
    clearTimeout(auto.current);
    setLeaving(true);
    setTimeout(() => { setLeaving(false); setProp(null); setPick(0); }, 140);
  };

  const executeConfirm = (res: IntentResult) => {
    const fc = res.context;
    if (res.intent === 'action.decide' && res.decide) ctx.decide?.(res.decide.inboxId, res.decide.decision);
    else if (res.intent === 'action.agent' && fc.focusAgent) {
      if (/^Stop/.test(res.confirm?.label ?? '')) ctx.killAgent(fc.focusAgent);
      else { ctx.startAgent(fc.focusAgent); ctx.openAgent(fc.focusAgent); }
    } else if (res.intent === 'action.roompause' && fc.focusRoom) {
      if (ctx.pauseRoom) ctx.pauseRoom(fc.focusRoom);
      else ctx.agents.filter((a) => a.room_id === fc.focusRoom!.id && a.state === 'working').forEach((a) => ctx.killAgent(a));
    } else if (res.intent === 'action.recall' && fc.focusMandate) ctx.recallMandate?.(fc.focusMandate);
    else if (res.intent === 'action.route' && fc.focusMandate && fc.focusRoom) ctx.routeMandate?.(fc.focusMandate, fc.focusRoom);
  };

  const confirmedSay = (res: IntentResult) => {
    if (res.decide) return `${res.decide.decision === 'approve' ? 'Approved' : 'Declined'}. Say undo within eight seconds to take it back.`;
    return `${res.confirm?.label ?? 'Done'}. Done.`;
  };

  const handleMeta = (res: IntentResult): boolean => {
    if (res.intent === 'meta.stop') {
      voice.stop(); pendingConfirm.current = null; pendingClarify.current = null;
      setReply(res.say); push('orb', res.say); earcons.play('done');
      if (res.say !== 'Stopped.') endSession();
      return true;
    }
    if (res.intent === 'meta.undo') {
      const undone = ctx.undoDecide?.() ?? false;
      say(undone ? 'Undone.' : 'Nothing to undo.');
      earcons.play(undone ? 'done' : 'error');
      return true;
    }
    if (res.intent === 'meta.wake' && res.wake !== undefined) voiceSettings.setWakeWord(res.wake);
    return false;
  };

  const handleVoiceResult = (res: IntentResult) => {
    voiceCtx.current = res.context;
    if (handleMeta(res)) { show(5000); return 0; }
    if (res.clarify) { pendingClarify.current = res.clarify; const id = say(res.say); aimed.current = 0; earcons.play('confirm'); show(20000); return id; }
    if (res.confirm) { pendingConfirm.current = res; const id = say(res.say); earcons.play('confirm'); show(20000); return id; }
    if (res.propose) { setProp({ room: res.propose.room, rooms: res.propose.rooms, text: res.propose.text }); setPick(0); }
    const id = say(res.intent === 'meta.repeat' && lastSay.current ? lastSay.current : res.say);
    earcons.play(res.ok ? 'done' : 'error');
    aimed.current = res.propose ? id : 0;
    show(res.propose ? 20000 : 7000);
    return id;
  };

  /** Answers to a question the orb is holding open. True when the sentence was that answer. */
  const answerStanding = (cleaned: string): boolean => {
    if (live.current.prop) {
      if (YES.test(cleaned)) { commit(); return true; }
      if (NO.test(cleaned)) { discard(); say('Dropped it.'); show(4000); return true; }
      // Anything else is a new request, and the old proposal gives way to it.
      clearTimeout(auto.current); setProp(null); setPick(0);
    }
    if (pendingConfirm.current) {
      const standing = pendingConfirm.current;
      pendingConfirm.current = null;
      if (YES.test(cleaned)) { executeConfirm(standing); say(confirmedSay(standing)); earcons.play('done'); show(9000); return true; }
      if (NO.test(cleaned)) { say('Left it.'); show(4000); return true; }
    }
    if (pendingClarify.current) {
      const opts = pendingClarify.current.options;
      const n = PICK[cleaned];
      const hit = opts.find((o) => o.label.toLowerCase() === cleaned) ?? (n !== undefined ? opts[n] : undefined);
      pendingClarify.current = null;
      if (hit) { applyVisual(hit.result.visual, ctx); handleVoiceResult(hit.result); return true; }
    }
    const c = clarifies[0];
    if (c) {
      const n = PICK[cleaned];
      const hit = c.answers.find((a) => a.toLowerCase() === cleaned) ?? (n !== undefined ? c.answers[n] : undefined);
      if (hit) { onClarify(c, hit); say('Told them.'); show(5000); return true; }
    }
    return false;
  };

  const submit = (text: string, viaModel = false) => {
    if (!text.trim()) return;
    const cleaned = text.trim().toLowerCase().replace(/[,]/g, '').replace(/[.!?]+$/, '');
    setText('');
    if (!viaModel) { setAsked(text); push('you', text); }
    if (answerStanding(cleaned)) return;
    setThinking(true);
    setTimeout(() => setThinking(false), 700);
    if (/^(talk )?(faster|slower)$/.test(cleaned) || /^(quieter|louder)/.test(cleaned)) parseVoiceSettingCommand(text, { apply: true });
    const r = runVoice(text, ctx, voiceCtx.current);
    voiceCtx.current = r.context;
    const understood = !!r.propose || (r.intent !== undefined && r.intent !== 'unknown') || r.ok;
    if (!understood && !viaModel && ctx.snap && voiceSettings.getSmartNlu()) { askModel(text, r.say); return; }
    if (r.intent && ctx.snap) {
      handleVoiceResult({ ...r, intent: r.intent, tier: 0, confidence: 1 });
      return;
    }
    if (r.propose) { setProp({ room: r.propose.room, rooms: r.propose.rooms, text: r.propose.text }); setPick(0); }
    else setProp(null);
    const id = say(r.say);
    earcons.play(r.ok ? 'done' : 'error');
    aimed.current = r.propose ? id : 0;
    show(r.propose ? 20000 : 7000);
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  /** System 2: the model may only rewrite the sentence as a command the grammar accepts. */
  const askModel = async (text: string, fallbackSay: string) => {
    if (llm.status() !== 'ready') {
      llm.preload();
      say(`${fallbackSay} Smart understanding is still loading.`); earcons.play('error'); show(7000);
      return;
    }
    setThinking(true);
    const command = await llm.toCommand(text, ctx.snap!);
    setThinking(false);
    if (!command) { say(fallbackSay); earcons.play('error'); show(7000); return; }
    push('orb', `→ ${command}`);
    submitRef.current(command, true);
  };

  /** A chit dropped on the orb arrives here: the router already chose, and the panel
   *  holds it for three seconds so the hand can take it straight back out. */
  useEffect(() => {
    wireOrb({
      pitch: (p) => {
        clearTimeout(auto.current);
        setProp(p); setPick(0); setOpen(true); show(20000);
        aimed.current = 0;
        setReply(`${p.room.name}. Three seconds to take it back.`);
        if (p.auto) auto.current = setTimeout(commit, p.auto);
      },
      clear: () => { clearTimeout(auto.current); setProp(null); setPick(0); },
    });
    return () => wireOrb(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  /** A result speaks its first sentence only; the rest is on the card. */
  const spoken = useRef<string | null>(null);
  useEffect(() => {
    const r = results[0];
    if (!r || spoken.current === r.id) return;
    spoken.current = r.id;
    setOpen(true); show(9000);
    if (speakOn) {
      const first = r.text.split(/(?<=[.!?])\s/)[0] ?? r.text;
      lastSay.current = first;
      voice.speak(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results[0]?.id]);

  useEffect(() => { if (clarifies.length) { setOpen(true); show(30000); } }, [clarifies.length]);

  useEffect(() => () => { clearTimeout(followUp.current); stt.current?.dispose(); stt.current = null; }, []);

  const fallbackToTyping = () => {
    releaseMic(); setSupported(false); setListening(false); setArmed(false);
    setReply(STT_UNAVAILABLE_MESSAGE); push('orb', STT_UNAVAILABLE_MESSAGE);
    setTyping(true); setOpen(true); show(12000); setTimeout(() => box.current?.focus(), 30);
  };

  /** One mic for both the armed wait and the conversation; false when voice cannot run here. */
  const ensureMic = async (): Promise<boolean> => {
    if (!isSttSupported()) { fallbackToTyping(); return false; }
    stt.current ??= createSttClient({ isSpeaking: voice.isSpeaking });
    if (micOn.current) return true;
    micOn.current = true;
    await stt.current.start((t) => onTranscriptRef.current(t),
      (s) => { if (s === 'error' || s === 'unsupported') fallbackToTyping(); });
    const st = stt.current.status();
    if (st === 'error' || st === 'unsupported') { fallbackToTyping(); return false; }
    setStream(stt.current.stream());
    return true;
  };

  const releaseMic = () => { stt.current?.stop(); micOn.current = false; setStream(null); };

  /** Silence after a reply ends the conversation; a reply still being spoken does not count. */
  const armFollowUp = () => {
    clearTimeout(followUp.current);
    const wait = pendingConfirm.current || pendingClarify.current || live.current.prop ? CONFIRM_MS : FOLLOW_UP_MS;
    followUp.current = setTimeout(() => {
      if (voice.isSpeaking()) { armFollowUp(); return; }
      endSession();
    }, wait);
  };

  const beginSession = async () => {
    voice.preload();
    if (voiceSettings.getSmartNlu()) llm.preload();
    if (!(await ensureMic())) return;
    stt.current?.setMode('session');
    voice.stop();
    setArmed(false); setListening(true); setOpen(true); clearTimeout(hide.current);
    earcons.play('wake');
    armFollowUp();
  };

  const endSession = () => {
    clearTimeout(followUp.current);
    voiceCtx.current = emptyContext(); pendingConfirm.current = null; pendingClarify.current = null;
    setListening(false); setHeard('');
    if (wakeRef.current) { stt.current?.setMode('armed'); setArmed(micOn.current); }
    else { releaseMic(); setArmed(false); }
    hide.current = setTimeout(() => { setOpen(false); setTyping(false); }, 2500);
  };

  const onTranscript = (t: Transcript) => {
    if (wake.isNoise(t.text)) return;
    const spoken = wake.clean(t.text);
    const woke = wake.matchWake(spoken);
    const bare = woke.rest.toLowerCase().replace(/[.!?,]+/g, '').trim();
    const halt = STOP_WORDS.test(bare);
    // "Say yes to confirm" contains the answer, so a yes or no to a standing question is never echo.
    const answering = !!(pendingConfirm.current || live.current.prop) && (YES.test(bare) || NO.test(bare));
    // While the orb talks the mic may be hearing the orb itself. Its own words are dropped;
    // anything else is the operator talking over it, and the reply gives way.
    if (t.overlapped && !woke.woke && !halt && !answering && wake.isEcho(spoken, lastSay.current)) return;
    if (t.overlapped || halt) voice.stop();
    if (!listeningRef.current) {
      if (!t.final || !woke.woke) return;
      void beginSession().then(() => { if (woke.rest) submitRef.current(woke.rest); });
      return;
    }
    armFollowUp();
    if (!t.final) { setHeard(spoken); return; }
    setHeard('');
    if (woke.woke && !woke.rest) { earcons.play('wake'); return; }
    submitRef.current(woke.rest);
  };
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const toggleListen = async () => {
    voice.preload();
    if (listening) { endSession(); return; }
    await beginSession();
  };

  /** The wake word arms the mic once the page may use audio, and disarms with the setting. */
  useEffect(() => {
    wakeRef.current = wakeOn;
    if (!wakeOn) { if (!listeningRef.current) { releaseMic(); setArmed(false); } return; }
    let cancelled = false;
    const arm = async () => {
      if (cancelled || listeningRef.current) return;
      if (!(await ensureMic())) {
        voiceSettings.setWakeWord(false);
        say('The wake word needs the microphone, so it is off.');
        return;
      }
      stt.current?.setMode('armed'); setArmed(true); earcons.play('armed');
    };
    if ((navigator as any).userActivation?.hasBeenActive ?? true) { void arm(); return () => { cancelled = true; }; }
    const once = () => { removeEventListener('pointerdown', once, true); removeEventListener('keydown', once, true); void arm(); };
    addEventListener('pointerdown', once, true); addEventListener('keydown', once, true);
    return () => { cancelled = true; removeEventListener('pointerdown', once, true); removeEventListener('keydown', once, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeOn]);

  useEffect(() => {
    const sync = () => setWakeOn(voiceSettings.getWakeWord());
    addEventListener(voiceSettings.VOICE_SETTINGS_EVENT, sync);
    return () => removeEventListener(voiceSettings.VOICE_SETTINGS_EVENT, sync);
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const inField = el && (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setTyping(true); show(20000); setTimeout(() => box.current?.focus(), 30);
        return;
      }
      // A standing clarify owns 1/2/3 and Escape; a standing proposal owns Return and
      // the arrows. Neither ever reaches the window layer underneath.
      const c = clarifies[0];
      if (c && !inField && !e.metaKey && !e.ctrlKey) {
        const n = /^[123]$/.test(e.key) ? Number(e.key) : 0;
        if (n && c.answers[n - 1]) { e.preventDefault(); onClarify(c, c.answers[n - 1]); return; }
        if (e.key === 'Escape') { e.preventDefault(); onClarify(c, null); return; }
      }
      if (live.current.prop && !inField) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); return; }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const n = live.current.prop.rooms.length;
          setPick((i) => (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n);
          clearTimeout(auto.current);
          return;
        }
        if (e.key === 'Escape') { e.preventDefault(); discard(); return; }
      }
      if (e.key === 'Escape' && !inField) { setTyping(false); setOpen(false); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, clarifies, onClarify]);

  const room = prop ? (prop.rooms[pick] ?? prop.room) : null;
  const quote = room ? hours(Math.round(Math.max(0, room.budget_cents - room.spent_cents) * 0.18)) : '';
  const clar = clarifies[0];
  const res = !prop && !clar ? results[0] : undefined;
  const line = typing ? '' : listening ? (heard || 'Listening…') : (reply || 'Ask me anything.');

  // ← / → re-aim the proposal, and the sentence that named a room is part of the aim.
  useEffect(() => {
    const id = aimed.current;
    if (!prop || !room || !id) return;
    const t = `${room.name}?`;
    setReply(t);
    setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, text: t } : x)));
  }, [prop, room]);

  return (
    <div className={`sup skin-${skin}${open ? ' open' : ''}`} ref={shell}>
      {/* One box. Collapsed it is exactly the orb; opening grows that same box downward
          into the panel, so the panel is the orb expanding rather than a second surface
          arriving underneath it. The orb sits at the top of the shell and never moves. */}
      <div className="sup-shell">
        <button className={`orb-btn${armed && !listening ? ' armed' : ''}`} ref={orb} onClick={toggleListen}
                data-orb="" data-drop="" data-accepts="mandate task"
                onContextMenu={(e) => { e.preventDefault(); setTyping(true); show(20000); setTimeout(() => box.current?.focus(), 30); }}
                title={!supported ? 'Click to type a command' : armed ? 'Listening for “Atrium” · click to talk · ⌘K to type' : 'Click to talk · ⌘K to type'}>
          <Orb mode={listening ? 'listening' : thinking ? 'thinking' : alert ? 'alert' : armed ? 'armed' : 'idle'}
               stream={stream} ring={skin !== 'well'} />
        </button>

        <div className="sup-body" role="status" aria-live="polite">
        <div className="sup-feed" ref={feed}>
          {!turns.length && !clar && !prop && !res && (
            <p className="sup-empty">{alert ? 'Something needs you.' : 'Ask me anything.'}</p>
          )}
          {turns.map((t) => (
            <p key={t.id} className={`sup-turn ${t.who}`}>{t.text}</p>
          ))}
          {listening && <p className="sup-turn you live">{heard || 'Listening…'}</p>}
        {/* A manager's question. It never joins the approvals queue: it is cheap,
            reversible and answerable in one keystroke — and if it is left for a minute
            it escalates itself rather than going quiet. */}
        {clar && (
          <div className="sup-clarify" style={{ ['--c' as any]: clar.colour }}>
            <b>{clar.question}</b>
            <ol className="sup-answers">
              {clar.answers.slice(0, 3).map((a) => <li key={a}>{a}</li>)}
            </ol>
            <em>say or type the number — esc leaves it, and it will ask you properly in a minute</em>
          </div>
        )}

        {/* Uncommitted. It grows out of the orb, it can be cycled, thrown away, or
            simply picked up and put somewhere else — and until then nothing has started. */}
        {prop && room && (
          <div className={`sup-prop${leaving ? ' out' : ''}`}>
            <span ref={chit} className="chit prop" style={{ ['--c' as any]: room.color }}
                  data-carry="mandate" data-mandate={prop.mandate}
                  onPointerDown={(e) => startCarry(e, { kind: 'mandate', id: prop.mandate ?? 'pitch', label: prop.text,
                                                        colour: room.color, cost: quote, roomId: null })}>
              <b>{prop.text}</b>
            </span>
            <div className="sup-aim">
              <span className="room-chip" style={{ ['--c' as any]: room.color }}>
                {room.icon} {room.name}
              </span>
              <u>~{quote}</u>
            </div>
            <em>⏎ sends it · ← → another room · esc to forget it</em>
          </div>
        )}

        {res && (
          <div className="sup-result" style={{ ['--c' as any]: res.colour }} role="button" tabIndex={0}
               onClick={() => onResult(res, 'open')}
               onKeyDown={(e) => { if (e.key === 'Enter') onResult(res, 'open'); }}>
            <b>{res.mandate}</b>
            <p>{res.text}</p>
            <em>click to open it{results.length > 1 ? ` · ${results.length - 1} more behind it` : ''}</em>
          </div>
        )}

        </div>

        {typing ? (
          <form className="sup-compose" onSubmit={(e) => { e.preventDefault(); if (live.current.prop && !text.trim()) commit(); else submit(text); }}>
            <input ref={box} className="sup-input" placeholder="Type a command…" autoComplete="off"
                   value={text} onChange={(e) => setText(e.target.value)}
                   onKeyDown={(e) => {
                     if (e.key === 'Enter') {
                       e.preventDefault();
                       // A proposal is standing: Return on an empty box sends it; a new sentence replaces it.
                       if (live.current.prop && !text.trim()) commit(); else submit(text);
                       return;
                     }
                     if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && live.current.prop) {
                       e.preventDefault();
                       const n = live.current.prop.rooms.length;
                       setPick((i) => (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n);
                       return;
                     }
                     if (e.key === 'Escape') {
                       e.preventDefault(); e.stopPropagation();
                       if (live.current.prop) { discard(); return; }
                       setText(''); setTyping(false); setOpen(false);
                     }
                   }} />
          </form>
        ) : (
          <button className="sup-composer-hint" onClick={() => { setTyping(true); show(20000); }}>
            Say something, or type…
          </button>
        )}


      </div>
      </div>
    </div>
  );
}
