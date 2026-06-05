import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { resetPassword } from '../lib/api';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [token, setToken] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    setToken(params.get('token'));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 1800);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <h1 className="font-display text-2xl tracking-widest text-white mb-6 text-center">CHOOSE A NEW PASSWORD</h1>
      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-6">
        {!token ? (
          <div className="text-center text-sm text-slate-400">
            <p className="mb-4">This reset link is missing its token or has expired.</p>
            <Link to="/forgot-password" className="text-cyan-400 hover:text-cyan-300">Request a new link</Link>
          </div>
        ) : done ? (
          <p className="text-center text-slate-300 text-sm">
            ✅ Password updated. Redirecting to sign in…
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="New password (min 8 characters)"
              className="w-full bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
            <input
              type="password"
              required
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              className="w-full bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
