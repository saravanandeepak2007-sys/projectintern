import { useEffect, useState } from 'react';
import { useDictation } from '../lib/useDictation';
import { DICT_LANGS } from '../lib/dictation';
import { lsGet, lsSet } from '../lib/util';

const LANG_KEY = 'wh_dict_lang';
const defaultLang = () => {
  const saved = lsGet(LANG_KEY);
  if (saved && DICT_LANGS.some((l) => l.code === saved)) return saved;
  const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
  return DICT_LANGS.find((l) => l.code.slice(0, 2) === nav.slice(0, 2) && l.code !== 'en-US')?.code || 'en-IN';
};

/** WhatsApp-style "speak instead of typing" button. Put it next to any text field. */
export default function DictateButton({ value, onChange, maxLength = 1000, disabled = false, inline = false }) {
  const [lang, setLang] = useState(defaultLang);
  const d = useDictation({ value, onChange, lang, maxLength });
  useEffect(() => { if (disabled) d.stop(); }, [disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d.supported) {
    return inline ? null : <p className="hint">Voice typing isn't available in this browser. Try Chrome, Edge or Safari.</p>;
  }
  return (
    <div className={`dict ${inline ? 'inline' : ''}`}>
      <button type="button" className={`dictbtn ${d.listening ? 'live' : ''}`} onClick={d.toggle} disabled={disabled}
        aria-pressed={d.listening} aria-label={d.listening ? 'Stop voice typing' : 'Start voice typing'}
        title={d.listening ? 'Tap to stop' : 'Tap and speak'}>
        {d.listening ? '■' : '🎤'}
      </button>
      {!inline && <span className="dictmsg" role="status">{d.listening ? 'Listening… speak now, tap to stop' : 'Tap and speak instead of typing'}</span>}
      <select aria-label="Voice typing language" value={lang} disabled={d.listening}
        onChange={(e) => { setLang(e.target.value); lsSet(LANG_KEY, e.target.value); }}>
        {DICT_LANGS.map((l) => <option key={l.code} value={l.code}>{inline ? l.code : l.label}</option>)}
      </select>
      {d.error && <span className="err dicterr" role="alert">{d.error}</span>}
    </div>
  );
}
