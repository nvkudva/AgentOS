import { useEffect, useRef, useState } from 'react';
import { run, stripWake, hasWake, HELP, type CmdCtx } from './commands';

type Line = { me: boolean; text: string };

/**
 * The orb. It sits in the menu bar, watches the floor, and takes instructions —
 * spoken when the browser will listen, typed when it will not.
 *
 * Its ring colour is the state of the company, so it is glanceable on its own:
 * calm when nothing needs you, violet when something does.
 */
export function Supervisor({ ctx, alert, speak: speakOn }: { ctx: CmdCtx; alert: boolean; speak: boolean }) {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [log, setLog] = useState<Line[]>([]);
  const [supported, setSupported] = useState(true);
  const rec = useRef<any>(null);
  const box = useRef<HTMLInputElement>(null);

  const say = (text: string) => {
    setLog((l) => [...l.slice(-30), { me: false, text }]);
    if (speakOn && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 1;
      speechSynthesis.speak(u);
    }
  };
  const submit = (text: string) => {
    if (!text.trim()) return;
    setLog((l) => [...l.slice(-30), { me: true, text }]);
    say(run(text, ctx).say);
  };

  // --- always listening (when the browser allows it) ------------------------
  useEffect(() => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    r.onresult = (e: any) => {
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else setHeard(t);
      }
      if (!finalText) return;
      setHeard('');
      // Off the wake word it only listens; with it, it acts.
      if (hasWake(finalText) || open) submit(stripWake(finalText));
    };
    r.onend = () => { if (listening) try { r.start(); } catch {} };
    r.onerror = () => {};
    rec.current = r;
    return () => { try { r.stop(); } catch {} };
  }, [listening, open, ctx]);

  const toggleListen = () => {
    const r = rec.current; if (!r) return;
    if (listening) { try { r.stop(); } catch {}; setListening(false); }
    else { try { r.start(); setListening(true); } catch {} }
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  useEffect(() => { if (open) box.current?.focus(); }, [open]);

  return (
    <div className="sup">
      <button className={`orb${listening ? ' listening' : ''}${alert ? ' alert' : ''}`}
              onClick={() => setOpen((o) => !o)}
              onDoubleClick={toggleListen}
              title="supervisor — click to command, double-click to listen (⌘K)">
        <span className="orb-core" />
        <span className="orb-ring" />
      </button>
      {heard && <span className="heard">“{heard}”</span>}

      {open && (
        <div className="sup-panel" onMouseDown={(e) => e.stopPropagation()}>
          <div className="sup-head">
            <b>Supervisor</b>
            <span className="spacer" />
            {supported
              ? <button className={listening ? 'primary' : ''} onClick={toggleListen}>
                  {listening ? '● listening' : 'Listen'}
                </button>
              : <span className="muted">voice unavailable here — type instead</span>}
          </div>
          <div className="sup-log">
            {!log.length && (
              <div className="muted">
                <p>Say “Atrium, run Kit”, or type below.</p>
                <ul className="hints">{HELP.map((h) => <li key={h} onClick={() => submit(h.split(' · ')[0])}>{h}</li>)}</ul>
                <p className="tiny">It will not approve anything by voice. It brings you the card.</p>
              </div>
            )}
            {log.map((l, i) => <p key={i} className={l.me ? 'me' : 'it'}>{l.text}</p>)}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); const v = box.current!.value; box.current!.value = ''; submit(v); }}>
            <input ref={box} placeholder="tell the supervisor…" autoComplete="off" />
          </form>
        </div>
      )}
    </div>
  );
}
