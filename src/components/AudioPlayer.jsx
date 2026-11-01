import { useState } from 'react';
import { supabase } from '../supabase';

export default function AudioPlayer({ path }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setErr('');
    const { data, error } = await supabase.storage.from('voice').createSignedUrl(path, 300);
    setBusy(false);
    if (error) return setErr('Could not load this voice note.');
    setUrl(data.signedUrl);
  }
  if (url) return <audio className="audio" src={url} controls autoPlay />;
  return (
    <div>
      <button className="btn ghost sm" onClick={load} disabled={busy}>{busy ? 'Loading…' : '▶ Play voice note'}</button>
      {err && <span className="err inline">{err}</span>}
    </div>
  );
}
