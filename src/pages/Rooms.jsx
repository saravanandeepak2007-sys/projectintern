import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../lib/auth';
import { TOPICS, roomCode, errText } from '../lib/util';

// Room codes are 6 letters/digits. Accepts anything (typed, pasted, spoken, undefined) and always returns a safe string.
const normCode = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

export default function Rooms() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [topic, setTopic] = useState('All');
  const [code, setCode] = useState('');
  const [name, setName] = useState(''); const [newTopic, setNewTopic] = useState(TOPICS[0]); const [pub, setPub] = useState(true);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [own, setOwn] = useState([]);

  useEffect(() => {
    supabase.from('rooms').select('code,name,topic,created_at').eq('is_public', true).order('created_at', { ascending: false }).limit(60)
      .then(({ data }) => setRooms(data || []));
  }, []);

  useEffect(() => {
    if (!user) { setOwn([]); return; }
    supabase.from('rooms').select('code,name,topic,is_public,created_at').eq('owner_id', user.id).order('created_at', { ascending: false })
      .then(({ data }) => setOwn(data || []));
  }, [user]);

  function join(e) {
    e.preventDefault();
    const c = normCode(code);
    if (c.length === 6) nav(`/room/${c}`); else setErr('Room codes have 6 letters or numbers.');
  }
  async function create(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    const c = roomCode();
    const { error } = await supabase.from('rooms').insert({ code: c, name: name.trim(), topic: newTopic, is_public: pub });
    setBusy(false);
    if (error) return setErr(errText(error));
    nav(`/room/${c}`);
  }
  const list = (topic === 'All' ? rooms : rooms.filter((r) => r.topic === topic)).filter((r) => r && r.code);

  return (
    <main className="wrap">
      <h1 style={{ fontSize: '2.6rem' }}>Anonymous rooms</h1>
      <p className="lead">Chat live under a random name. Rooms are for hackathon teams, classes, clubs and campus suggestions.</p>
      <div className="cols">
        <form className="card" onSubmit={join}>
          <h3>Join with a code</h3>
          <label className="f" htmlFor="rc">Room code</label>
          <input id="rc" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => { setCode(normCode(e?.target?.value)); setErr(''); }} placeholder="e.g. K7M2QX" />
          <button className="btn" style={{ marginTop: 14 }}>Join room</button>
        </form>
        {user ? (
          <form className="card" onSubmit={create}>
            <h3>Create a room</h3>
            <label className="f" htmlFor="rn">Room name</label>
            <input id="rn" type="text" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hackathon team finder" />
            <label className="f" htmlFor="rt">Topic</label>
            <select id="rt" value={newTopic} onChange={(e) => setNewTopic(e.target.value)}>{TOPICS.map((t) => <option key={t}>{t}</option>)}</select>
            <label className="f"><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} /> Show in the public list <span className="muted">(unlisted rooms can only be opened with the code)</span></label>
            <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create room'}</button>
          </form>
        ) : (
          <div className="card"><h3>Create a room</h3><p className="muted">Room owners can run polls and remove posts, so you need an account to create one.</p><Link className="btn" to="/auth">Create an account</Link></div>
        )}
      </div>
      {err && <p className="err" role="alert">{err}</p>}

      {own.length > 0 && (
        <>
          <h2>Your rooms</h2>
          <div className="roomgrid">
            {own.map((r) => <Link key={r.code} to={`/room/${r.code}`} className="card"><h3>{r.name}</h3><span className="tag">{r.topic}</span> <span className="tag">{r.is_public ? 'Listed' : 'Unlisted'} · {r.code}</span></Link>)}
          </div>
        </>
      )}

      <h2>Public rooms</h2>
      <div className="chips">{['All', ...TOPICS].map((t) => <button key={t} className="chip" aria-pressed={topic === t} onClick={() => setTopic(t)}>{t}</button>)}</div>
      {list.length === 0 ? <p className="muted">No public rooms here yet. Create the first one.</p> : (
        <div className="roomgrid">
          {list.map((r) => <Link key={r.code} to={`/room/${r.code}`} className="card"><h3>{r.name}</h3><span className="tag">{r.topic}</span></Link>)}
        </div>
      )}
    </main>
  );
}
