import { useCallback, useEffect, useRef, useState } from 'react';
import { joinSpeech, dictationError } from './dictation';

// Looked up when needed (not at import time) so it also works if the browser exposes it late.
export const getRecognition = () => (typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

/**
 * Voice typing: tap to start, speak, tap to stop. Words appear in the field while you talk.
 * `value` / `onChange` are the field's own state. Typing, pasting or clearing the field while listening stops dictation,
 * so it can never overwrite what the person just did.
 */
export function useDictation({ value, onChange, lang, maxLength = 1000 }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const recRef = useRef(null);
  const baseRef = useRef('');
  const lastRef = useRef(null);       // last text this hook wrote into the field
  const valueRef = useRef(value);     valueRef.current = value;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const supported = !!getRecognition();

  const stop = useCallback(() => {
    const r = recRef.current; recRef.current = null; lastRef.current = null;
    if (r) { r.onresult = null; r.onerror = null; r.onend = null; try { r.stop(); } catch { /* already stopped */ } }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const SR = getRecognition();
    if (!SR) return;
    setError('');
    const rec = new SR();
    rec.lang = lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    baseRef.current = valueRef.current || '';
    lastRef.current = null;
    rec.onresult = (ev) => {
      let fin = ''; let interim = '';
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) fin += `${r[0].transcript} `; else interim += r[0].transcript;
      }
      const text = joinSpeech(baseRef.current, fin + interim, { lang, maxLength });
      lastRef.current = text;
      onChangeRef.current(text);
    };
    rec.onerror = (e) => { const m = dictationError(e.error); if (m) setError(m); };
    rec.onend = () => { recRef.current = null; setListening(false); };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { recRef.current = null; setError('Could not start voice typing. Please try again.'); }
  }, [lang, maxLength]);

  const toggle = useCallback(() => (recRef.current ? stop() : start()), [start, stop]);

  // The field changed by someone other than us (typed, pasted, cleared after sending): stop listening.
  useEffect(() => {
    if (recRef.current && lastRef.current !== null && value !== lastRef.current) stop();
  }, [value, stop]);

  useEffect(() => () => { const r = recRef.current; recRef.current = null; if (r) { r.onresult = r.onerror = r.onend = null; try { r.abort ? r.abort() : r.stop(); } catch { /* */ } } }, []);

  return { supported, listening, error, toggle, stop };
}
