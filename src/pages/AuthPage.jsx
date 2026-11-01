import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../lib/auth';
import { slugify, errText } from '../lib/util';

export default function AuthPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => { if (user) nav('/dashboard', { replace: true }); }, [user, nav]);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'signup') {
        if (pw.length < 6) throw new Error('Use a password with at least 6 characters.');
        if (pw !== pw2) throw new Error('Passwords do not match.');
        const { data, error } = await supabase.auth.signUp({
          email, password: pw,
          options: { data: { display_name: name.trim() || email.split('@')[0], slug: slugify(name.trim() || email.split('@')[0]) } },
        });
        if (error) throw error;
        if (!data.session) setInfo('Check your email to confirm your account, then log in.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      }
    } catch (e2) { setErr(errText(e2)); }
    setBusy(false);
  }

  return (
    <main className="wrap narrow">
      <h1 style={{ fontSize: '2.4rem' }}>{mode === 'signup' ? 'Create your inbox' : 'Welcome back'}</h1>
      <p className="lead">Only receivers need an account. People who write to you never do.</p>
      <form className="card" onSubmit={submit}>
        {mode === 'signup' && (
          <>
            <label className="f" htmlFor="n">Display name</label>
            <input id="n" type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown above your inbox, e.g. Deepak" />
          </>
        )}
        <label className="f" htmlFor="e">Email</label>
        <input id="e" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="f" htmlFor="p">Password</label>
        <input id="p" type="password" required minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} />
        {mode === 'signup' && (
          <>
            <label className="f" htmlFor="p2">Confirm password</label>
            <input id="p2" type="password" required minLength={6} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </>
        )}
        {err && <p className="err" role="alert">{err}</p>}
        {info && <p className="ok" role="status">{info}</p>}
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create inbox' : 'Log in'}</button>
          <button type="button" className="linkbtn" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setErr(''); setInfo(''); setPw2(''); }}>
            {mode === 'signup' ? 'I already have an account' : 'Create a new inbox'}
          </button>
        </div>
      </form>
    </main>
  );
}
