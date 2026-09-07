import { useEffect, useRef, useState } from 'react';
import { run, stripWake, hasWake, type CmdCtx } from './commands';
import { Orb } from './Orb';
import { startCarry } from './carry';
import { wireOrb, type Pitch, type Result, type Clarify } from './intent';
import { hours } from '../lib/humanize';

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
export function Supervisor({ ctx, alert, speak: speakOn, results, clarifies, onResult, onClarify }: {
  ctx: CmdCtx; alert: boolean; speak: boolean;
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
  const rec = useRef<any>(null);
  const box = useRef<HTMLInputElement>(null);
  const hide = useRef<any>(null);
  const chit = useRef<HTMLSpanElement>(null);
  const orb = useRef<HTMLButtonElement>(null);
  const auto = useRef<any>(null);
  const live = useRef({ prop, pick });
  live.current = { prop, pick };

  const show = (ms = 6000) => {
    setOpen(true);
    clearTimeout(hide.current);
    if (!listening) hide.current = setTimeout(() => { setOpen(false); setTyping(false); }, ms);
  };

  const say = (text: string) => {
    setReply(text);
    if (speakOn && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text); u.rate = 1.05;
      speechSynthesis.speak(u);
    }
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
    setProp(null); setPick(0);
    ctx.dispatch(p.text, room, rect);
    say(`${room.name} has it.`);
    show(6000);
  };

  const discard = () => {
    clearTimeout(auto.current);
    setLeaving(true);
    setTimeout(() => { setLeaving(false); setProp(null); setPick(0); }, 140);
  };

  const submit = (text: string) => {
    if (!text.trim()) return;
    // A spoken "yes" while a proposal is standing is an answer to the proposal, not a
    // new sentence. Voice may commit a mandate; it may still never approve.
    if (live.current.prop && YES.test(text.trim().toLowerCase().replace(/[.!?]+$/, ''))) return commit();
    const c = clarifies[0];
    if (c) {
      const hit = c.answers.find((a) => a.toLowerCase() === text.trim().toLowerCase().replace(/[.!?]+$/, ''));
      if (hit) { onClarify(c, hit); say('Told them.'); show(5000); return; }
    }
    setAsked(text);
    setThinking(true);
    setTimeout(() => setThinking(false), 700);
    const r = run(text, ctx);
    if (r.propose) { setProp({ room: r.propose.room, rooms: r.propose.rooms, text: r.propose.text }); setPick(0); }
    else setProp(null);
    say(r.say);
    show(r.propose ? 20000 : 7000);
  };

  /** A chit dropped on the orb arrives here: the router already chose, and the panel
   *  holds it for three seconds so the hand can take it straight back out. */
  useEffect(() => {
    wireOrb({
      pitch: (p) => {
        clearTimeout(auto.current);
        setProp(p); setPick(0); setOpen(true); show(20000);
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
    if (speakOn && 'speechSynthesis' in window) {
      const first = r.text.split(/(?<=[.!?])\s/)[0] ?? r.text;
      const u = new SpeechSynthesisUtterance(first); u.rate = 1.05;
      speechSynthesis.speak(u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results[0]?.id]);

  useEffect(() => { if (clarifies.length) { setOpen(true); show(30000); } }, [clarifies.length]);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    r.onresult = (e: any) => {
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tx = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += tx; else { setHeard(tx); setOpen(true); }
      }
      if (!final) return;
      setHeard('');
      if (hasWake(final) || open) submit(stripWake(final));
    };
    r.onend = () => { if (listening) try { r.start(); } catch {} };
    r.onerror = () => {};
    rec.current = r;
    return () => { try { r.stop(); } catch {} };
  }, [listening, open, ctx, clarifies]);

  const toggleListen = async () => {
    const r = rec.current;
    if (!r) { setTyping(true); show(12000); setTimeout(() => box.current?.focus(), 30); return; }
    if (listening) {
      try { r.stop(); } catch {}
      stream?.getTracks().forEach((t) => t.stop());
      setStream(null); setListening(false); setOpen(false);
      return;
    }
    try { r.start(); setListening(true); setOpen(true); } catch { setTyping(true); show(12000); return; }
    // A second, visual-only tap on the mic so the ring shows the real voice, not a fake one.
    try { setStream(await navigator.mediaDevices.getUserMedia({ audio: true })); } catch { setStream(null); }
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

  return (
    <div className={`sup${open ? ' open' : ''}`}>
      <button className="orb-btn" ref={orb} onClick={toggleListen}
              data-orb="" data-drop="" data-accepts="mandate task"
              onContextMenu={(e) => { e.preventDefault(); setTyping(true); show(20000); setTimeout(() => box.current?.focus(), 30); }}
              title={supported ? 'Click to talk · ⌘K to type' : 'Click to type a command'}>
        <Orb mode={listening ? 'listening' : thinking ? 'thinking' : alert ? 'alert' : 'idle'} stream={stream} />
      </button>

      <div className="sup-panel" role="status" aria-live="polite">
        <div className="sup-last">
          <span className="sup-label">Last instruction</span>
          <span className="sup-asked">{asked || '—'}</span>
        </div>

        {typing ? (
          <form onSubmit={(e) => { e.preventDefault(); const v = box.current!.value; box.current!.value = ''; setTyping(false); submit(v); }}>
            <input ref={box} className="sup-input" placeholder="Type a command…" autoComplete="off"
                   onBlur={() => setTyping(false)} />
          </form>
        ) : (
          <p className={`sup-line${listening && !heard ? ' waiting' : ''}`}>{line}</p>
        )}

        {/* A manager's question. It never joins the approvals queue: it is cheap,
            reversible and answerable in one keystroke — and if it is left for a minute
            it escalates itself rather than going quiet. */}
        {clar && (
          <div className="sup-clarify" style={{ ['--c' as any]: clar.colour }}>
            <b>{clar.question}</b>
            <div className="sup-answers">
              {clar.answers.slice(0, 3).map((a, i) => (
                <button key={a} onClick={() => onClarify(clar, a)}><i>{i + 1}</i>{a}</button>
              ))}
            </div>
            <em>esc to leave it — it will ask you properly in a minute</em>
          </div>
        )}

        {/* Uncommitted. It grows out of the orb, it can be cycled, thrown away, or
            simply picked up and put somewhere else — and until then nothing has started. */}
        {prop && room && (
          <div className={`sup-prop${leaving ? ' out' : ''}`}>
            <span ref={chit} className="chit prop" style={{ ['--c' as any]: room.color }}
                  data-carry="mandate"
                  onPointerDown={(e) => startCarry(e, { kind: 'mandate', id: 'pitch', label: prop.text,
                                                        colour: room.color, cost: quote, roomId: null })}>
              <b>{prop.text}</b>
            </span>
            <div className="sup-aim">
              <button className="room-chip" style={{ ['--c' as any]: room.color }}
                      onClick={() => setPick((i) => (i + 1) % prop.rooms.length)}>
                {room.icon} {room.name}
              </button>
              <u>~{quote}</u>
              <span className="spacer" />
              <button className="primary" onClick={commit}>Send ⏎</button>
            </div>
            <em>← → another room · esc to forget it</em>
          </div>
        )}

        {res && (
          <div className="sup-result" style={{ ['--c' as any]: res.colour }}>
            <b>{res.mandate}</b>
            <p>{res.text}</p>
            <div className="sup-aim">
              <button onClick={() => onResult(res, 'open')}>Open</button>
              <button className="primary" onClick={() => onResult(res, 'done')}>Done</button>
              {results.length > 1 && <u>+{results.length - 1} more</u>}
            </div>
          </div>
        )}

        <div className={`wave${listening ? ' on' : ''}`} aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}
        </div>
      </div>
    </div>
  );
}
