import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { runVoice, applyVisual, type CmdCtx } from './commands';
import { createSttClient, isSttSupported, STT_UNAVAILABLE_MESSAGE, type SttClient } from '../lib/voice/stt';
import { emptyContext, type VoiceContext } from '../lib/voice/context';
import type { IntentResult } from './intent-engine';
import { parseVoiceSettingCommand } from '../lib/voice/settings';
import { Orb } from './Orb';
import { startCarry } from './carry';
import { wireOrb, type Pitch, type Result, type Clarify } from './intent';
import { hours } from '../lib/humanize';
import * as voice from '../lib/voice';

const YES = /^(yes|yep|yeah|do it|go ahead|confirm|please do|ok|okay)$/;

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
    if (res.intent === 'action.agent' && fc.focusAgent) {
      if (/^Stop/.test(res.confirm?.label ?? '')) ctx.killAgent(fc.focusAgent);
      else { ctx.startAgent(fc.focusAgent); ctx.openAgent(fc.focusAgent); }
    } else if (res.intent === 'action.roompause' && fc.focusRoom) {
      if (ctx.pauseRoom) ctx.pauseRoom(fc.focusRoom);
      else ctx.agents.filter((a) => a.room_id === fc.focusRoom!.id && a.state === 'working').forEach((a) => ctx.killAgent(a));
    } else if (res.intent === 'action.recall' && fc.focusMandate) ctx.recallMandate?.(fc.focusMandate);
    else if (res.intent === 'action.route' && fc.focusMandate && fc.focusRoom) ctx.routeMandate?.(fc.focusMandate, fc.focusRoom);
  };

  const handleVoiceResult = (res: IntentResult) => {
    voiceCtx.current = res.context;
    if (res.clarify) { pendingClarify.current = res.clarify; const id = say(res.say); aimed.current = 0; show(20000); return id; }
    if (res.confirm) { pendingConfirm.current = res; const id = say(res.say); show(20000); return id; }
    if (res.propose) { setProp({ room: res.propose.room, rooms: res.propose.rooms, text: res.propose.text }); setPick(0); }
    const id = say(res.intent === 'meta.repeat' && lastSay.current ? lastSay.current : res.say);
    if (res.intent === 'meta.stop') { voice.stop(); stt.current?.stop(); setListening(false); }
    if (res.intent === 'meta.clear') voiceCtx.current = emptyContext();
    aimed.current = res.propose ? id : 0;
    show(res.propose ? 20000 : 7000);
    return id;
  };

  const submit = (text: string) => {
    if (!text.trim()) return;
    if (live.current.prop && YES.test(text.trim().toLowerCase().replace(/[.!?]+$/, ''))) return commit();
    const cleaned = text.trim().toLowerCase().replace(/[.!?]+$/, '');
    if (pendingConfirm.current) {
      const pc = pendingConfirm.current; pendingConfirm.current = null;
      if (YES.test(cleaned)) { executeConfirm(pc); say(`${pc.confirm?.label ?? 'Done'}. Done.`); show(6000); return; }
      say('Left it.'); show(4000); return;
    }
    if (pendingClarify.current) {
      const opts = pendingClarify.current.options;
      const n = { '1': 0, one: 0, '2': 1, two: 1, '3': 2, three: 2 }[cleaned] as number | undefined;
      const hit = opts.find((o) => o.label.toLowerCase() === cleaned) ?? (n !== undefined ? opts[n] : undefined);
      pendingClarify.current = null;
      if (hit) { applyVisual(hit.result.visual, ctx); if (hit.result.propose) setProp({ room: hit.result.propose.room, rooms: hit.result.propose.rooms, text: hit.result.propose.text }); handleVoiceResult(hit.result); return; }
    }
    const c = clarifies[0];
    if (c) {
      const said = cleaned;
      const n = { '1': 0, one: 0, '2': 1, two: 1, '3': 2, three: 2 }[said];
      const hit = c.answers.find((a) => a.toLowerCase() === said)
        ?? (n !== undefined ? c.answers[n] : undefined);
      if (hit) { onClarify(c, hit); say('Told them.'); show(5000); return; }
    }
    setAsked(text);
    push('you', text);
    setText('');
    setThinking(true);
    setTimeout(() => setThinking(false), 700);
    if (/^(talk )?(faster|slower)$/.test(cleaned) || /^(quieter|louder)/.test(cleaned)) parseVoiceSettingCommand(text, { apply: true });
    const r = runVoice(text, ctx, voiceCtx.current);
    voiceCtx.current = r.context;
    if (r.intent && ctx.snap) {
      handleVoiceResult({ say: r.say, ok: r.ok, intent: r.intent, tier: 0, confidence: 1, visual: r.visual, context: r.context, propose: r.propose, confirm: r.confirm, clarify: r.clarify });
      return;
    }
    if (r.propose) { setProp({ room: r.propose.room, rooms: r.propose.rooms, text: r.propose.text }); setPick(0); }
    else setProp(null);
    const id = say(r.say);
    aimed.current = r.propose ? id : 0;
    show(r.propose ? 20000 : 7000);
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

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
      voice.speak(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results[0]?.id]);

  useEffect(() => { if (clarifies.length) { setOpen(true); show(30000); } }, [clarifies.length]);

  useEffect(() => () => { stt.current?.dispose(); stt.current = null; }, []);

  const fallbackToTyping = () => {
    setSupported(false); setListening(false); setStream(null);
    setReply(STT_UNAVAILABLE_MESSAGE); push('orb', STT_UNAVAILABLE_MESSAGE);
    setTyping(true); setOpen(true); show(12000); setTimeout(() => box.current?.focus(), 30);
  };

  const toggleListen = async () => {
    voice.preload();
    if (listening) {
      stt.current?.stop(); setStream(null); setListening(false); setOpen(false);
      voiceCtx.current = emptyContext(); pendingConfirm.current = null; pendingClarify.current = null;
      return;
    }
    voice.stop();
    if (!isSttSupported()) { fallbackToTyping(); return; }
    stt.current ??= createSttClient({ onBargeIn: () => voice.stop() });
    setListening(true); setOpen(true);
    await stt.current.start(
      (t) => {
        if (!t.final) { setHeard(t.text); setOpen(true); return; }
        setHeard('');
        submitRef.current(t.text);
      },
      (s) => { if (s === 'error' || s === 'unsupported') fallbackToTyping(); },
    );
    const st = stt.current.status();
    if (st === 'error' || st === 'unsupported') fallbackToTyping();
  };

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
        <button className="orb-btn" ref={orb} onClick={toggleListen}
                data-orb="" data-drop="" data-accepts="mandate task"
                onContextMenu={(e) => { e.preventDefault(); setTyping(true); show(20000); setTimeout(() => box.current?.focus(), 30); }}
                title={supported ? 'Click to talk · ⌘K to type' : 'Click to type a command'}>
          <Orb mode={listening ? 'listening' : thinking ? 'thinking' : alert ? 'alert' : 'idle'}
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
          <form className="sup-compose" onSubmit={(e) => { e.preventDefault(); if (live.current.prop) commit(); else submit(text); }}>
            <input ref={box} className="sup-input" placeholder="Type a command…" autoComplete="off"
                   value={text} onChange={(e) => setText(e.target.value)}
                   onKeyDown={(e) => {
                     if (e.key === 'Enter') {
                       e.preventDefault();
                       // A proposal is standing: Return sends it, exactly as the button says.
                       if (live.current.prop) commit(); else submit(text);
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
