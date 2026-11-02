import { useEffect, useState } from 'react';
import { canSpeak, speak, stopSpeaking } from '../lib/speech';

// "Listen" button: reads the given text aloud through the device speaker.
export default function SpeakButton({ text, lang, label = 'Listen' }) {
  const [on, setOn] = useState(false);
  useEffect(() => () => { if (on) stopSpeaking(); }, [on]);
  if (!canSpeak || !String(text || '').trim()) return null;
  function toggle() {
    if (on) { stopSpeaking(); setOn(false); return; }
    setOn(speak(text, { lang, onEnd: () => setOn(false) }));
  }
  return (
    <button type="button" className="btn ghost sm" aria-pressed={on} aria-label={on ? 'Stop reading aloud' : `${label} (read aloud)`} onClick={toggle}>
      {on ? '⏹ Stop' : `🔊 ${label}`}
    </button>
  );
}
