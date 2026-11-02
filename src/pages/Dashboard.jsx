import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../lib/auth';
import { Bars, WeekChart } from '../components/Bars';
import AudioPlayer from '../components/AudioPlayer';
import DictateButton from '../components/DictateButton';
import { MOODS, moodOf, catLabel, timeAgo, countdown, shareUrl, toLocalInput, errText, maskProfanity, classifySentiment, uid } from '../lib/util';

// Explicit column list: the device code (sender_token) is never sent to the browser.
const COLS = 'id,kind,body,transcript,audio_path,mood,category,sentiment,unlock_at,is_read,created_at';
const TITLE = 'VEYORA — Your Voice. Your Secret. Your Space.';
const canNotify = typeof Notification !== 'undefined';

const FILTERS = [
  { id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'voice', label: 'Voice' },
  { id: 'feedback', label: 'Feedback' }, { id: 'praise', label: 'Praise' }, { id: 'question', label: 'Questions' }, { id: 'capsule', label: 'Capsules' },
  ...MOODS.map((m) => ({ id: m.id, label: `${m.emoji} ${m.label}` })),
];

const HUB = [
  { t: 'Inbox', c: '#5a3bf0', filter: 'all', anchor: 'messages', d: (st) => `${st.unread} unread` },
  { t: 'SecretVoice', c: '#EC4E8C', filter: 'voice', anchor: 'messages', d: (st) => `${st.voice} voice notes` },
  { t: 'TruthBox', c: '#0fa57e', anchor: 'truthbox', d: () => 'Praise and suggestions' },
  { t: 'TimeCapsule', c: '#F2B100', anchor: 'capsules', d: (st) => `${st.locked} sealed` },
  { t: 'MoodPing', c: '#4C7DFF', anchor: 'insights', d: (st, m) => `${m.filter((x) => x.mood).length} mood messages` },
  { t: 'Campus Rooms', c: '#FF7A2F', to: '/rooms', d: () => 'Rooms and polls' },
];

export default function Dashboard() {
  const nav = useNavigate();
  const { user, profile } = useAuth();
  const [msgs, setMsgs] = useState([]);
  const [locked, setLocked] = useState([]);
  const [filter, setFilter] = useState('all');
  const [range, setRange] = useState('all');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);
  const [blocked, setBlocked] = useState(0);
  const [perm, setPerm] = useState(canNotify ? Notification.permission : 'denied');
  const seen = useRef(null);
  // future self
  const [fText, setFText] = useState(''); const [fDate, setFDate] = useState(''); const [fMsg, setFMsg] = useState('');

  const load = useCallback(async () => {
    const [m, l, b] = await Promise.all([
      supabase.from('messages').select(COLS).order('created_at', { ascending: false }),
      supabase.rpc('get_locked_messages'),
      supabase.from('blocked_senders').select('sender_token', { count: 'exact', head: true }),
    ]);
    if (!b.error) setBlocked(b.count || 0);
    if (m.error) setErr(errText(m.error)); else { setErr(''); setMsgs(m.data); }
    if (!l.error) setLocked(l.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel(`inbox-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `recipient_id=eq.${user.id}` }, load)
      .subscribe();
    const iv = setInterval(() => { load(); tick((n) => n + 1); }, 60000); // picks up capsules that just unlocked
    return () => { supabase.removeChannel(ch); clearInterval(iv); };
  }, [load, user.id]);

  // Unread count in the tab title, plus an optional desktop alert when a message arrives or a capsule opens.
  useEffect(() => {
    const unread = msgs.filter((m) => !m.is_read).length;
    document.title = unread ? `(${unread}) VEYORA` : TITLE;
    const ids = new Set(msgs.map((m) => m.id));
    if (seen.current && canNotify && Notification.permission === 'granted' && document.hidden) {
      const fresh = msgs.filter((m) => !seen.current.has(m.id));
      if (fresh.length) { try { new Notification('VEYORA', { body: fresh.length === 1 ? 'You have a new anonymous message.' : `You have ${fresh.length} new anonymous messages.` }); } catch { /* some mobile browsers block this */ } }
    }
    seen.current = ids;
  }, [msgs]);
  useEffect(() => () => { document.title = TITLE; }, []);
  async function enableAlerts() { if (canNotify) setPerm(await Notification.requestPermission()); }

  const inRange = useMemo(() => (range === 'week' ? msgs.filter((m) => Date.now() - new Date(m.created_at) < 7 * 864e5) : msgs), [msgs, range]);
  const shown = useMemo(() => msgs.filter((m) => {
    if (filter === 'all') return true;
    if (filter === 'unread') return !m.is_read;
    if (filter === 'voice') return m.kind === 'voice';
    return m.mood === filter || m.category === filter;
  }), [msgs, filter]);

  const textFb = msgs.filter((m) => m.kind === 'text' && (m.category === 'feedback' || m.category === 'praise'));
  const positive = textFb.filter((m) => m.sentiment === 'positive' || m.category === 'praise').slice(0, 4);
  const improve = textFb.filter((m) => m.sentiment === 'constructive' && m.category !== 'praise').slice(0, 4);
  const scrollTo = (id) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 50);
  const goto = (h) => { if (h.to) return nav(h.to); if (h.filter) setFilter(h.filter); scrollTo(h.anchor); };

  const stats = {
    total: msgs.length, unread: msgs.filter((m) => !m.is_read).length, voice: msgs.filter((m) => m.kind === 'voice').length,
    locked: locked.length,
  };
  const sentiment = ['positive', 'constructive', 'neutral'].map((s) => ({
    label: s === 'positive' ? 'Positive' : s === 'constructive' ? 'To improve' : 'Neutral',
    value: inRange.filter((m) => m.sentiment === s).length, color: s === 'positive' ? '#0fa57e' : s === 'constructive' ? '#FF7A2F' : '#9a97b8',
  }));
  const moodBars = MOODS.map((m) => ({ label: `${m.emoji} ${m.label}`, value: inRange.filter((x) => x.mood === m.id).length, color: m.color }));

  async function markRead(m) { await supabase.from('messages').update({ is_read: true }).eq('id', m.id); load(); }
  async function remove(m) {
    if (!m.__skipConfirm && !window.confirm('Delete this message for good?')) return;
    if (m.audio_path) await supabase.storage.from('voice').remove([m.audio_path]);
    const { error } = await supabase.from('messages').delete().eq('id', m.id);
    if (error) setErr(errText(error)); else load();
  }
  async function blockSender(m) {
    if (!window.confirm('Block this sender? Their future messages will be dropped silently, and this message will be deleted.')) return;
    const { error } = await supabase.rpc('block_sender', { p_message_id: m.id });
    if (error) return setErr(errText(error));
    await remove({ ...m, __skipConfirm: true });
  }
  async function unblockAll() {
    if (!window.confirm('Unblock everyone you blocked?')) return;
    const { error } = await supabase.from('blocked_senders').delete().eq('recipient_id', user.id);
    if (error) setErr(errText(error)); else load();
  }
  async function removeLocked(l) {
    if (!window.confirm('Delete this sealed capsule? You will never see what it said.')) return;
    if (l.audio_path) await supabase.storage.from('voice').remove([l.audio_path]);
    const { error } = await supabase.from('messages').delete().eq('id', l.id);
    if (error) setErr(errText(error)); else load();
  }
  async function copy() {
    try { await navigator.clipboard.writeText(shareUrl(profile.slug)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setErr('Copy failed. Select the link and copy it manually.'); }
  }
  async function futureSelf(e) {
    e.preventDefault(); setFMsg('');
    const body = maskProfanity(fText.trim());
    if (!body || !fDate) return setFMsg('Write a note and choose a date.');
    const { error } = await supabase.from('messages').insert({
      recipient_id: user.id, kind: 'text', body, category: 'capsule', sentiment: classifySentiment(body),
      unlock_at: new Date(fDate).toISOString(), sender_token: `self-${uid()}`,
    });
    if (error) return setFMsg(errText(error));
    setFText(''); setFDate(''); setFMsg('Sealed. It will appear here on that date.'); load();
  }

  if (!profile) return <main className="wrap narrow"><h1>Setting up your inbox…</h1><p className="lead">If this doesn't finish, run <code>supabase/schema.sql</code> again and sign up with a new account.</p></main>;
  const link = shareUrl(profile.slug);

  return (
    <main className="wrap">
      <h1 style={{ fontSize: '2.4rem' }}>{profile.display_name}'s inbox</h1>
      <div className="sharebox">
        <input readOnly aria-label="Your share link" value={link} onFocus={(e) => e.target.select()} />
        <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        <a className="btn ghost" href={`https://wa.me/?text=${encodeURIComponent('Send me an anonymous message: ' + link)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
      </div>
      {canNotify && perm === 'default' && <p className="muted">Want a pop-up when a message arrives or a capsule opens? <button className="linkbtn" onClick={enableAlerts}>Turn on alerts</button> (works while this tab stays open).</p>}
      {err && <p className="err" role="alert">{err}</p>}

      <section className="modgrid hub" aria-label="Modules">
        {HUB.map((h) => (
          <button key={h.t} className="card mod hubbtn" style={{ '--c': h.c, borderTopColor: h.c }} onClick={() => goto(h)}>
            <h3>{h.t}</h3><span className="muted">{h.d(stats, msgs)}</span>
          </button>
        ))}
      </section>

      <section className="stats">
        <div className="card stat"><b>{stats.total}</b><span>Messages</span></div>
        <div className="card stat"><b>{stats.unread}</b><span>Unread</span></div>
        <div className="card stat"><b>{stats.voice}</b><span>Voice notes</span></div>
        <div className="card stat"><b>{stats.locked}</b><span>Sealed capsules</span></div>
      </section>

      <div className="row" id="insights" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Insights</h2>
        <div className="chips">
          <button className="chip" aria-pressed={range === 'all'} onClick={() => setRange('all')}>All time</button>
          <button className="chip" aria-pressed={range === 'week'} onClick={() => setRange('week')}>Last 7 days</button>
        </div>
      </div>
      <section className="cols">
        <div className="card"><h3>Feedback tone</h3><Bars items={sentiment} /></div>
        <div className="card"><h3>Moods</h3><Bars items={moodBars} /></div>
        <div className="card"><h3>Mood messages this week</h3><WeekChart messages={msgs} moods={MOODS} /></div>
      </section>

      <h2 id="truthbox" style={{ marginTop: 40 }}>TruthBox</h2>
      <section className="cols">
        <div className="card">
          <h3>Positive feedback</h3>
          {positive.length === 0 ? <p className="muted">Nothing here yet.</p> : positive.map((m) => <p className="quote" key={m.id}>{m.body}</p>)}
        </div>
        <div className="card">
          <h3>Suggestions to improve</h3>
          {improve.length === 0 ? <p className="muted">Nothing here yet.</p> : improve.map((m) => <p className="quote" key={m.id}>{m.body}</p>)}
        </div>
      </section>

      <h2 id="messages">Messages</h2>
      <div className="chips" role="group" aria-label="Filter messages">
        {FILTERS.map((f) => <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>
      {blocked > 0 && <p className="muted">{blocked} blocked sender{blocked > 1 ? 's' : ''}. <button className="linkbtn" onClick={unblockAll}>Unblock all</button></p>}
      {loading ? <p className="muted">Loading…</p> : shown.length === 0 ? (
        <div className="card"><p style={{ margin: 0 }}>{msgs.length === 0 ? 'Nothing yet. Copy your link above and share it to get your first message.' : 'No messages match this filter.'}</p></div>
      ) : (
        <div className="list">
          {shown.map((m) => {
            const mo = moodOf(m.mood);
            return (
              <article key={m.id} className={`card msg ${m.is_read ? '' : 'unread'}`} style={{ '--c': mo?.color }}>
                <div className="meta">
                  {mo && <span className="tag">{mo.emoji} {mo.label}</span>}
                  <span className="tag">{m.kind === 'voice' ? '🎙 Voice' : catLabel(m.category)}</span>
                  {m.kind === 'text' && m.category === 'feedback' && <span className="tag">{m.sentiment === 'constructive' ? 'To improve' : m.sentiment}</span>}
                  <span>{timeAgo(m.created_at)}</span>
                  {m.unlock_at && <span>· unlocked</span>}
                </div>
                {m.kind === 'voice' ? (
                  <>
                    <AudioPlayer path={m.audio_path} />
                    {m.transcript && <div className="transcript"><b>Transcript</b><p style={{ margin: '4px 0 0' }}>{m.transcript}</p></div>}
                  </>
                ) : <p className="body">{m.body}</p>}
                <div className="row" style={{ marginTop: 10 }}>
                  {!m.is_read && <button className="btn ghost sm" onClick={() => markRead(m)}>Mark read</button>}
                  <button className="btn ghost sm danger" onClick={() => remove(m)}>Delete</button>
                  <button className="btn ghost sm danger" onClick={() => blockSender(m)}>Block sender</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <h2 id="capsules" style={{ marginTop: 40 }}>Time capsules</h2>
      <section className="cols">
        <div className="card">
          <h3>Sealed for later</h3>
          {locked.length === 0 ? <p className="muted">No sealed messages. Anyone can seal one for you by picking a future date when they write.</p> : (
            <div className="list">
              {locked.map((l) => (
                <div className="sealed" key={l.id}>
                  <span>🔒 {l.kind === 'voice' ? 'Voice note' : 'Message'} opens {new Date(l.unlock_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} <span className="muted">(in {countdown(l.unlock_at)})</span></span>
                  <button className="btn ghost sm danger" onClick={() => removeLocked(l)}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <form className="card" onSubmit={futureSelf}>
          <h3>Message to my future self</h3>
          <label className="f" htmlFor="fs">Note</label>
          <textarea id="fs" style={{ minHeight: 90 }} maxLength={1000} value={fText} onChange={(e) => setFText(e.target.value)} placeholder="Where do you hope to be by then?" />
          <DictateButton value={fText} onChange={setFText} maxLength={1000} />
          <label className="f" htmlFor="fd">Open on</label>
          <input id="fd" type="datetime-local" min={toLocalInput(new Date(Date.now() + 60000))} value={fDate} onChange={(e) => setFDate(e.target.value)} />
          {fMsg && <p className={fMsg.startsWith('Sealed') ? 'ok' : 'err'} role="status">{fMsg}</p>}
          <button className="btn" style={{ marginTop: 14 }}>Seal it</button>
        </form>
      </section>
    </main>
  );
}

