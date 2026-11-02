import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const MODULES = [
  { c: '#5a3bf0', t: 'Anonymous inbox', d: 'One personal link. Anyone can write to you without an account. Only you can read it.' },
  { c: '#EC4E8C', t: 'SecretVoice', d: 'Record a voice note right in the browser. It is transcribed to text while you speak.' },
  { c: '#0fa57e', t: 'TruthBox', d: 'Honest feedback sorted into praise and things to improve, with a simple sentiment chart.' },
  { c: '#F2B100', t: 'TimeCapsule', d: 'Pick an unlock date. The message stays sealed, even from you, until that moment.' },
  { c: '#4C7DFF', t: 'MoodPing', d: 'Attach a mood to every message and see your week at a glance.' },
  { c: '#FF7A2F', t: 'Campus Rooms', d: 'Anonymous live rooms with random names, polls, reports and owner moderation.' },
];

export default function Home() {
  const { user } = useAuth();
  return (
    <main className="wrap">
      <section className="hero">
        <div>
          <h1>Your Voice. Your Secret. Your Space.</h1>
          <p className="lead">Veyora gives you a private link for honest messages, voice notes, feedback and messages that open in the future. Nobody has to sign up to write to you.</p>
          <div className="row">
            <Link className="btn" to={user ? '/dashboard' : '/auth'}>{user ? 'Open my inbox' : 'Create my inbox'}</Link>
            <Link className="btn ghost" to="/rooms">Join an anonymous room</Link>
          </div>
        </div>
        <div className="slips" aria-hidden="true">
          <div className="slip" style={{ '--c': '#EC4E8C' }}>Your talk on Friday was the clearest I have heard all year.<small>Appreciation · just now</small></div>
          <div className="slip" style={{ '--c': '#4C7DFF' }}>Could you slow down in the demo part? I got lost there.<small>Honest feedback · 2 h ago</small></div>
          <div className="slip" style={{ '--c': '#F2B100' }}>🔒 Sealed until 1 Jan<small>Time capsule · opens in 61 days</small></div>
        </div>
      </section>

      <h2>Six ways to connect</h2>
      <section className="modgrid">
        {MODULES.map((m) => (
          <article key={m.t} className="card mod" style={{ '--c': m.c, borderTopColor: m.c }}>
            <h3>{m.t}</h3>
            <p>{m.d}</p>
          </article>
        ))}
      </section>

      <h2>How it works</h2>
      <ol className="steps">
        <li>Create an inbox. You get a link like <code>/u/deepak-a82x</code>.</li>
        <li>Share the link in your bio, class group or story.</li>
        <li>Friends open it and send text or a voice note. No name, email or phone is asked.</li>
        <li>You read, filter by mood or category, and delete anything you don't want.</li>
      </ol>
      <p className="muted">Anonymous here means the app never shows or stores who wrote a message. Read <Link to="/privacy">how anonymity works</Link> for the honest limits.</p>
    </main>
  );
}
