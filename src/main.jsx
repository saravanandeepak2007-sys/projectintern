import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import './styles.css';

// Shows the real error on screen instead of a blank page if a component crashes.
class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('[WhisperHub] crash:', err, info?.componentStack); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <main className="wrap narrow">
        <h1>Something went wrong</h1>
        <p className="err" role="alert">{String(this.state.err?.message || this.state.err)}</p>
        <a className="btn" href="#/">Back to home</a>
      </main>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Boundary>
      <HashRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </Boundary>
  </React.StrictMode>
);
