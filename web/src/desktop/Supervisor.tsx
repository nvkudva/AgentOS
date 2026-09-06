import { useEffect, useRef, useState } from 'react';
import { run, stripWake, hasWake, type CmdCtx } from './commands';

/**
 * The orb, and the small panel that grows out of it.
 *
 * The panel is deliberately tiny: the last thing you asked, the thing you are saying
 * now, and five bars that move while it is listening. Anything more and it stops being
 * an assistant and becomes another window.
 */
export function Supervisor({ ctx, alert, speak: speakOn }: { ctx: CmdCtx; alert: boolean; speak: boolean }) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [asked, setAsked] = useState('');
  const [reply, setReply] = useState('');
  const [supported, setSupported] = useState(true);
  const rec = useRef<any>(null);
  const box = useRef<HTMLInputElement>(null);
  const hide = useRef<any>(null);

  const show = (ms = 6000) => {
    setOpen(true);
    clearTimeout(hide.current);
    if (!listening) hide.current = setTimeout(() => { setOpen(false); setTyping(false); }, ms);
  };

  const submit = (text: string) => {
    if (!text.trim()) return;
    setAsked(text);
    const r = run(text, ctx);
    setReply(r.say);
    show(7000);
    if (speakOn && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(r.say); u.rate = 1.05;
      speechSynthesis.speak(u);
    }
  };

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
  }, [listening, open, ctx]);

  const toggleListen = () => {
    const r = rec.current;
    if (!r) { setTyping(true); show(12000); setTimeout(() => box.current?.focus(), 30); return; }
    if (listening) { try { r.stop(); } catch {}; setListening(false); setOpen(false); }
    else { try { r.start(); setListening(true); setOpen(true); } catch { setTyping(true); show(12000); } }
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setTyping(true); show(20000); setTimeout(() => box.current?.focus(), 30);
      }
      if (e.key === 'Escape') { setTyping(false); setOpen(false); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [listening]);

  const line = typing ? '' : listening ? (heard || 'Listening…') : (reply || 'Ask me anything.');

  return (
    <div className={`sup${open ? ' open' : ''}`}>
      <button className={`orb${listening ? ' listening' : ''}${alert ? ' alert' : ''}`}
              onClick={toggleListen}
              onContextMenu={(e) => { e.preventDefault(); setTyping(true); show(20000); setTimeout(() => box.current?.focus(), 30); }}
              title={supported ? 'Click to talk · ⌘K to type' : 'Click to type a command'}>
        <span className="orb-core" />
        <span className="orb-ring" />
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

        <div className={`wave${listening ? ' on' : ''}`} aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}
        </div>
      </div>
    </div>
  );
}
