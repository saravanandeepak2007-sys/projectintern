import { Routes, Route, Link, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { isConfigured } from './config';
import { useAuth } from './lib/auth';
import Home from './pages/Home';
import AuthPage from './pages/AuthPage';
import Dashboard from './pages/Dashboard';
import SendPage from './pages/SendPage';
import Rooms from './pages/Rooms';
import Room from './pages/Room';
import Privacy from './pages/Privacy';

function SetupNeeded() {
  return (
    <main className="wrap narrow">
      <h1>Connect your database</h1>
      <p className="lead">Veyora needs a free Supabase project to store messages. It takes about five minutes.</p>
      <ol className="steps">
        <li>Create a project at supabase.com, then open the SQL Editor and run <code>supabase/schema.sql</code>.</li>
        <li>Copy the Project URL and anon key from Project Settings, API.</li>
        <li>Put them in a <code>.env</code> file (see <code>.env.example</code>) and restart <code>npm run dev</code>.</li>
      </ol>
      <p className="muted">The README has the full walkthrough, including GitHub Pages deployment.</p>
    </main>
  );
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <main className="wrap"><p className="muted">Loading…</p></main>;
  return user ? children : <Navigate to="/auth" replace />;
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  const { user, signOut } = useAuth();
  return (
    <>
      <button type="button" className="skip" onClick={() => document.getElementById('main')?.focus()}>Skip to content</button>
      <header className="nav">
        <Link to="/" className="logo" aria-label="Veyora home"><span className="dot" />VEYORA</Link>
        <nav>
          <NavLink to="/rooms">Rooms</NavLink>
          {user ? (
            <>
              <NavLink to="/dashboard">My inbox</NavLink>
              <button className="linkbtn" onClick={signOut}>Sign out</button>
            </>
          ) : (
            <NavLink to="/auth" className="pill">Get my inbox</NavLink>
          )}
        </nav>
      </header>
      <ScrollTop />
      <div id="main" tabIndex={-1} style={{ outline: 'none' }}>
        {!isConfigured ? <SetupNeeded /> : (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
            <Route path="/u/:slug" element={<SendPage />} />
            <Route path="/rooms" element={<Rooms />} />
            <Route path="/room/:code" element={<Room />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="*" element={<main className="wrap narrow"><h1>Page not found</h1><Link to="/">Back to home</Link></main>} />
          </Routes>
        )}
      </div>
      <footer className="foot">
        <span><strong>VEYORA</strong> · Your Voice. Your Secret. Your Space.</span>
        <Link to="/privacy">How anonymity works</Link>
      </footer>
    </>
  );
}
