import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { discordLoginUrl } from '../lib/api';

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const discordError = params.get('error') === 'discord';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await register({ email, password, display_name: displayName.trim() || undefined });
      } else {
        await login(email, password);
      }
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <h1 className="font-display text-2xl tracking-widest text-white mb-1 text-center">
        {mode === 'register' ? 'CREATE ACCOUNT' : 'SIGN IN'}
      </h1>
      <p className="text-slate-500 text-sm text-center mb-6">
        Log in to claim your player profile.
      </p>

      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-6 space-y-5">
        {/* Discord */}
        <a
          href={discordLoginUrl()}
          className="flex items-center justify-center gap-2 w-full bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <span>🎮</span> Continue with Discord
        </a>
        {discordError && (
          <p className="text-red-400 text-xs text-center">Discord login failed. Please try again.</p>
        )}

        <div className="flex items-center gap-3 text-xs text-slate-600">
          <div className="flex-1 h-px bg-[#1a2744]" /> or <div className="flex-1 h-px bg-[#1a2744]" />
        </div>

        {/* Email / password */}
        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Display name (optional)"
              className="w-full bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
          )}
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
          />
          <input
            type="password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={mode === 'register' ? 'Password (min 8 characters)' : 'Password'}
            className="w-full bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
          />

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="flex items-center justify-between text-xs">
          <button
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
            className="text-cyan-400 hover:text-cyan-300"
          >
            {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
          </button>
          {mode === 'login' && (
            <Link to="/forgot-password" className="text-slate-500 hover:text-slate-300">
              Forgot password?
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
