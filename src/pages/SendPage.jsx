import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { MOODS, CATEGORIES, deviceToken, maskProfanity, classifySentiment, cooldownLeft, markSent, toLocalInput, errText, uid } from '../lib/util';

const MAX_SECONDS = 60;
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export default function SendPage() {
  const { slug } = useParams();
  const [owner, setOwner] = useState(undefined); // undefined = loading, null = not found
  const [tab, setTab] = useState('text');
  const [text, setText] = useState('');
  const [mood, setMood] = useState(null);
  const [category, setCategory] = useState('general');
  const [unlock, setUnlock] = useState('');
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  // voice state
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [blob, setBlob] = useState(null);
  const [preview, setPreview] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [lang, setLang] = useState('en-IN');
  const recRef = useRef(null); const srRef = useRef(null); const timer = useRef(null); const finalRef = useRef('');

  useEffect(() => {
    supabase.from('profiles').select('id, display_name').eq('slug', slug).maybeSingle().then(({ data }) => setOwner(data || null));
  }, [slug]);
  useEffect(() => () => { clearInterval(timer.current); try { srRef.current?.stop(); } catch { /* */ } }, []);

  async function startRec() {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return setErr('Voice recording is not supported in this browser. Please send a text message instead.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
        const b = new Blob(chunks, { type });
        setBlob(b); setPreview(URL.createObjectURL(b));
      };
      rec.start();
      recRef.current = rec; setRecording(true); setSecs(0); setBlob(null); setPreview(null);
      finalRef.current = ''; setTranscript('');
      timer.current = setInterval(() => setSecs((s) => { if (s + 1 >= MAX_SECONDS) stopRec(); return s + 1; }), 1000);
      if (SR) { // live voice-to-text (browser feature; Chrome/Edge/Safari)
        const sr = new SR(); sr.lang = lang; sr.continuous = true; sr.interimResults = true;
        sr.onresult = (ev) => {
          let interim = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finalRef.current += r[0].transcript + ' '; else interim += r[0].transcript;
          }
          setTranscript((finalRef.current + interim).trim());
        };
        sr.onerror = () => {};
        sr.start(); srRef.current = sr;
      }
    } catch { setErr('Microphone access was blocked. Allow it in your browser settings, or send a text message.'); }
  }
  function stopRec() {
    clearInterval(timer.current);
    try { srRef.current?.stop(); } catch { /* */ }
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    setRecording(false);
  }

  async function send(e) {
    e.preventDefault(); setErr('');
    if (hp) return setSent(true); // honeypot: bots fill hidden fields, pretend success
    const wait = cooldownLeft('inbox', 8000);
    if (wait) return setErr(`Please wait ${Math.ceil(wait / 1000)} seconds before sending another message.`);
    const clean = maskProfanity(text.trim());
    if (tab === 'text' && !clean) return setErr('Write something first.');
    if (tab === 'voice' && !blob) return setErr('Record a voice note first.');
    setBusy(true);
    try {
      const token = deviceToken('inbox');
      const row = {
        recipient_id: owner.id, mood, sender_token: token,
        category: unlock ? 'capsule' : category,   // a sealed message is always a time capsule
        unlock_at: unlock ? new Date(unlock).toISOString() : null,
      };
      // Blocked senders are told "Sent" like everyone else, but we skip the audio upload so no file is left behind.
      const { data: ok } = await supabase.rpc('can_deliver', { p_recipient: owner.id, p_token: token });
      if (ok === false) { markSent('inbox'); setSent(true); setBusy(false); return; }
      if (tab === 'text') {
        Object.assign(row, { kind: 'text', body: clean, sentiment: classifySentiment(clean) });
      } else {
        const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        const path = `${owner.id}/${uid()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('voice').upload(path, blob, { contentType: blob.type, upsert: false });
        if (upErr) throw upErr;
        const tr = maskProfanity(transcript).slice(0, 2000);
        Object.assign(row, { kind: 'voice', audio_path: path, transcript: tr || null, sentiment: classifySentiment(tr) });
      }
      const { error } = await supabase.from('messages').insert(row);
      if (error) throw error;
      markSent('inbox'); setSent(true);
    } catch (e2) { setErr(errText(e2)); }
    setBusy(false);
  }

  function reset() { setSent(false); setText(''); setBlob(null); setPreview(null); setTranscript(''); setMood(null); setUnlock(''); }

  if (owner === undefined) return <main className="wrap narrow"><p className="muted">Loading…</p></main>;
  if (owner === null) return <main className="wrap narrow"><h1>Inbox not found</h1><p className="lead">Check the link, or create your own inbox.</p><Link className="btn" to="/auth">Create my inbox</Link></main>;
  if (sent) return (
    <main className="wrap narrow">
      <h1>Sent.</h1>
      <p className="lead">{owner.display_name} will see your message{unlock ? ' on the date you chose' : ''}. They won't see who wrote it.</p>
      <div className="row"><button className="btn" onClick={reset}>Send another</button><Link className="btn ghost" to="/auth">Get my own inbox</Link></div>
    </main>
  );

  const minDate = toLocalInput(new Date(Date.now() + 60000));
  return (
    <main className="wrap narrow">
      <h1 style={{ fontSize: '2.4rem' }}>Write to {owner.display_name}</h1>
      <p className="lead">Anonymous. No name, email or sign-up. {owner.display_name} only sees your message.</p>
      <form className="card" onSubmit={send}>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'text'} className={`chip ${tab === 'text' ? 'on' : ''}`} onClick={() => setTab('text')}>Text</button>
          <button type="button" role="tab" aria-selected={tab === 'voice'} className={`chip ${tab === 'voice' ? 'on' : ''}`} onClick={() => setTab('voice')}>Voice note</button>
        </div>

        {tab === 'text' ? (
          <>
            <label className="f" htmlFor="m">Your message</label>
            <textarea id="m" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Say what you really think. Be kind, be honest." />
            <p className="hint">{text.length} / 1000</p>
          </>
        ) : (
          <>
            <div className="rec" style={{ marginTop: 12 }}>
              <button type="button" className={`micbtn ${recording ? 'live' : ''}`} onClick={recording ? stopRec : startRec} aria-label={recording ? 'Stop recording' : 'Start recording'}>{recording ? '■' : '🎙'}</button>
              <div>
                <b>{String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}</b> <span className="muted">/ 01:00</span>
                {recording && <div className="wave" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} />)}</div>}
              </div>
              <select aria-label="Transcription language" value={lang} onChange={(e) => setLang(e.target.value)} style={{ width: 'auto' }} disabled={recording}>
                <option value="en-IN">English</option><option value="ta-IN">Tamil</option><option value="hi-IN">Hindi</option><option value="en-US">English (US)</option>
              </select>
            </div>
            {preview && <audio className="audio" src={preview} controls />}
            {(transcript || recording) && <div className="transcript"><b>Transcript</b><p style={{ margin: '4px 0 0' }}>{transcript || 'Listening…'}</p></div>}
            {!SR && <p className="hint">Voice-to-text isn't available in this browser, so only the audio will be sent.</p>}
          </>
        )}

        <label className="f">Mood <span className="muted">(optional)</span></label>
        <div className="moods">
          {MOODS.map((m) => (
            <button type="button" key={m.id} className="mood" style={{ '--c': m.color }} aria-pressed={mood === m.id} onClick={() => setMood(mood === m.id ? null : m.id)}>
              <span>{m.emoji}</span>{m.label}
            </button>
          ))}
        </div>

        <label className="f" htmlFor="c">Type</label>
        <select id="c" value={category} disabled={!!unlock} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>

        <label className="f" htmlFor="u">Open on a future date <span className="muted">(optional time capsule)</span></label>
        <input id="u" type="datetime-local" min={minDate} value={unlock} onChange={(e) => setUnlock(e.target.value)} />
        <p className="hint">Until then, {owner.display_name} can see that something is waiting, but not what it says.{unlock && ' It will be filed as a time capsule.'}</p>

        <div className="hp" aria-hidden="true"><label>Leave empty<input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label></div>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn" disabled={busy || recording}>{busy ? 'Sending…' : 'Send anonymously'}</button>
          <Link to="/privacy" className="muted">How is this anonymous?</Link>
        </div>
      </form>
    </main>
  );
}
