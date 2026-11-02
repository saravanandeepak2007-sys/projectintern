import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../lib/auth';
import DictateButton from '../components/DictateButton';
import { deviceToken, roomAnonName, maskProfanity, cooldownLeft, markSent, timeAgo, errText, lsGet, lsSet, uid } from '../lib/util';

const EMOJIS = ['👍', '❤️', '😂', '🔥'];

export default function Room() {
  const { code: rawCode } = useParams();
  const code = String(rawCode ?? '').toUpperCase();
  const { user } = useAuth();
  const me = deviceToken('room');     // posts
  const voter = deviceToken('vote');  // votes, reactions, reports (kept apart from posts)
  const [mine, setMine] = useState(new Set());
  const [room, setRoom] = useState(undefined);
  const [msgs, setMsgs] = useState([]);
  const [polls, setPolls] = useState([]);
  const [counts, setCounts] = useState({});
  const [reports, setReports] = useState({});
  const [reacts, setReacts] = useState({});
  const [name, setName] = useState(() => roomAnonName(code));
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [pq, setPq] = useState(''); const [popts, setPopts] = useState(['', '']);
  const box = useRef(null);
  const isOwner = !!user && room && room.owner_id === user.id;

  const loadPolls = useCallback(async (roomId) => {
    const { data: p } = await supabase.rpc('room_polls', { p_room: roomId });
    setPolls(p || []);
    if (p?.length) {
      const { data: c } = await supabase.from('poll_counts').select('*').in('poll_id', p.map((x) => x.id));
      const map = {}; (c || []).forEach((r) => { (map[r.poll_id] ||= {})[r.option_idx] = r.votes; });
      setCounts(map);
    }
  }, []);
  const loadReports = useCallback(async (roomId) => {
    const { data } = await supabase.from('reports').select('room_message_id').eq('room_id', roomId); // only returns rows for the owner
    const m = {}; (data || []).forEach((r) => { m[r.room_message_id] = (m[r.room_message_id] || 0) + 1; }); setReports(m);
  }, []);

  const loadReacts = useCallback(async (ids) => {
    if (!ids.length) return;
    const { data } = await supabase.from('reaction_counts').select('*').in('room_message_id', ids);
    const m = {}; (data || []).forEach((r) => { (m[r.room_message_id] ||= {})[r.emoji] = r.n; }); setReacts(m);
  }, []);
  const idsRef = useRef([]);
  useEffect(() => { idsRef.current = msgs.map((m) => m.id); loadReacts(idsRef.current); }, [msgs, loadReacts]);

  useEffect(() => {
    let ch; let iv; let alive = true;
    (async () => {
      const { data: found } = await supabase.rpc('find_room', { p_code: code });
      const r = found?.[0] || null;
      if (!alive) return;
      setRoom(r);
      if (!r) return;
      try { setMine(new Set(JSON.parse(lsGet(`wh_mine_${r.id}`) || '[]'))); } catch { /* ignore */ }
      const refresh = async () => {
        const { data: m } = await supabase.rpc('room_feed', { p_room: r.id });
        if (alive && m) setMsgs(m);
      };
      await refresh();
      loadPolls(r.id); loadReports(r.id);
      if (r.is_public) { // instant updates for listed rooms; unlisted rooms use the 3-second refresh below
        ch = supabase.channel(`room-${r.id}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${r.id}` },
            (p) => setMsgs((cur) => (cur.some((x) => x.id === p.new.id) ? cur : [...cur, { id: p.new.id, anon_name: p.new.anon_name, body: p.new.body, created_at: p.new.created_at }])))
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'room_messages' }, (p) => setMsgs((cur) => cur.filter((x) => x.id !== p.old.id)))
          .subscribe();
      }
      iv = setInterval(() => { refresh(); loadPolls(r.id); loadReports(r.id); loadReacts(idsRef.current); }, 3000);
    })();
    return () => { alive = false; if (ch) supabase.removeChannel(ch); clearInterval(iv); };
  }, [code, loadPolls, loadReports, loadReacts]);

  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs.length]);
  const remember = (roomId, id) => setMine((cur) => { const n = new Set(cur).add(id); lsSet(`wh_mine_${roomId}`, JSON.stringify([...n].slice(-300))); return n; });

  async function send(e) {
    e.preventDefault(); setErr('');
    const body = maskProfanity(text.trim());
    if (!body) return;
    const wait = cooldownLeft(`room-${code}`, 1500);
    if (wait) return setErr('You are sending too fast. Wait a second.');
    // The id is made here (not read back from the database), so posting also works in unlisted rooms.
    const row = { id: uid(), room_id: room.id, anon_name: name, body, sender_token: me };
    const { error } = await supabase.from('room_messages').insert(row);
    if (error) return setErr(errText(error));
    markSent(`room-${code}`); setText(''); remember(room.id, row.id);
    setMsgs((cur) => (cur.some((x) => x.id === row.id) ? cur : [...cur, { id: row.id, anon_name: name, body, created_at: new Date().toISOString() }]));
  }
  async function report(m) {
    const { error } = await supabase.from('reports').insert({ room_id: room.id, room_message_id: m.id, reporter_token: voter, reason: 'Reported by a member' });
    setErr(error ? (error.code === '23505' ? 'You already reported this message.' : errText(error)) : 'Reported. The room owner will review it.');
  }
  async function react(m, emoji) {
    const key = `wh_re_${m.id}_${emoji}`;
    if (lsGet(key)) return;
    const { error } = await supabase.from('room_reactions').insert({ room_message_id: m.id, emoji, voter_token: voter });
    if (error && error.code !== '23505') return setErr(errText(error));
    lsSet(key, '1'); loadReacts(idsRef.current);
  }
  async function del(m) { const { error } = await supabase.from('room_messages').delete().eq('id', m.id); if (error) setErr(errText(error)); else setMsgs((c) => c.filter((x) => x.id !== m.id)); }
  async function dismiss(m) { await supabase.from('reports').delete().eq('room_message_id', m.id); loadReports(room.id); }
  async function createPoll(e) {
    e.preventDefault(); setErr('');
    const options = popts.map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) return setErr('A poll needs at least 2 options.');
    const { error } = await supabase.from('polls').insert({ room_id: room.id, question: pq.trim(), options });
    if (error) return setErr(errText(error));
    setPq(''); setPopts(['', '']); loadPolls(room.id);
  }
  async function vote(poll, idx) {
    if (lsGet(`wh_vote_${poll.id}`) !== null) return;
    const { error } = await supabase.from('poll_votes').insert({ poll_id: poll.id, option_idx: idx, voter_token: voter });
    if (error && error.code !== '23505') return setErr(errText(error));
    lsSet(`wh_vote_${poll.id}`, String(idx)); loadPolls(room.id);
  }
  async function delPoll(p) { await supabase.from('polls').delete().eq('id', p.id); loadPolls(room.id); }

  if (room === undefined) return <main className="wrap"><p className="muted">Loading…</p></main>;
  if (room === null) return <main className="wrap narrow"><h1>Room not found</h1><p className="lead">Check the code <code>{code}</code> and try again.</p><Link className="btn" to="/rooms">Back to rooms</Link></main>;

  return (
    <main className="wrap">
      <h1 style={{ fontSize: '2.2rem' }}>{room.name}</h1>
      <p className="muted"><span className="tag">{room.topic}</span> Room code <b>{room.code}</b>{!room.is_public && ' · unlisted: only people with the code can join'}{isOwner && ' · you own this room'}</p>
      <div className="side">
        <section>
          <div className="chat" ref={box} aria-live="polite">
            {msgs.length === 0 && <p className="muted">No messages yet. Say hello.</p>}
            {msgs.map((m) => {
              const isMine = mine.has(m.id);
              return (
                <div key={m.id} className={`bub ${isMine ? 'mine' : ''}`}>
                  <b>{isMine ? `${m.anon_name} (you)` : m.anon_name} · {timeAgo(m.created_at)}</b>
                  {m.body}
                  <div className="reacts">
                    {EMOJIS.map((e) => {
                      const n = reacts[m.id]?.[e] || 0; const mineR = !!lsGet(`wh_re_${m.id}_${e}`);
                      return <button key={e} aria-label={`React ${e}`} aria-pressed={mineR} onClick={() => react(m, e)}>{e}{n > 0 ? ` ${n}` : ''}</button>;
                    })}
                  </div>
                  <div className="acts">
                    {!isMine && <button onClick={() => report(m)}>Report</button>}
                    {isOwner && <button onClick={() => del(m)}>Remove</button>}
                    {isOwner && reports[m.id] > 0 && <><span>⚑ {reports[m.id]} report{reports[m.id] > 1 ? 's' : ''}</span><button onClick={() => dismiss(m)}>Dismiss</button></>}
                  </div>
                </div>
              );
            })}
          </div>
          <form onSubmit={send} className="row" style={{ marginTop: 10 }}>
            <input type="text" style={{ flex: 1, minWidth: 180 }} aria-label="Message" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message as ${name}`} />
            <DictateButton inline value={text} onChange={setText} maxLength={500} />
            <button className="btn">Send</button>
          </form>
          <p className="hint">You are <b>{name}</b>. <button className="linkbtn" onClick={() => setName(roomAnonName(code, true))}>Pick a new name</button></p>
          {err && <p className={err.startsWith('Reported') ? 'ok' : 'err'} role="alert">{err}</p>}
        </section>

        <aside>
          <h2 style={{ fontSize: '1.3rem' }}>Polls</h2>
          {polls.length === 0 && <p className="muted">No polls yet.</p>}
          {polls.map((p) => {
            const voted = lsGet(`wh_vote_${p.id}`);
            const c = counts[p.id] || {}; const total = Object.values(c).reduce((a, b) => a + b, 0);
            return (
              <div className="card poll" key={p.id} style={{ marginBottom: 12 }}>
                <b>{p.question}</b>
                {p.options.map((o, i) => (
                  <button key={i} className="opt" disabled={voted !== null} onClick={() => vote(p, i)}>
                    {voted !== null && <i className="fill" style={{ width: `${total ? ((c[i] || 0) / total) * 100 : 0}%` }} />}
                    <span>{o}{voted !== null && <b>{c[i] || 0}{String(i) === voted ? ' ✓' : ''}</b>}</span>
                  </button>
                ))}
                <span className="hint">{total} vote{total === 1 ? '' : 's'}{voted === null ? ' · vote to see results' : ''}</span>
                {isOwner && <div><button className="linkbtn" onClick={() => delPoll(p)}>Delete poll</button></div>}
              </div>
            );
          })}
          {isOwner && (
            <form className="card" onSubmit={createPoll}>
              <h3>New poll</h3>
              <input type="text" required minLength={3} maxLength={140} placeholder="Question" aria-label="Poll question" value={pq} onChange={(e) => setPq(e.target.value)} />
              {popts.map((o, i) => <input key={i} style={{ marginTop: 8 }} type="text" maxLength={60} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} value={o} onChange={(e) => setPopts(popts.map((x, j) => (j === i ? e.target.value : x)))} />)}
              <div className="row" style={{ marginTop: 10 }}>
                {popts.length < 4 && <button type="button" className="btn ghost sm" onClick={() => setPopts([...popts, ''])}>Add option</button>}
                <button className="btn sm">Post poll</button>
              </div>
            </form>
          )}
        </aside>
      </div>
    </main>
  );
}
