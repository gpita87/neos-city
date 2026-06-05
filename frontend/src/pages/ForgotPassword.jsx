import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await requestPasswordReset(email);
    } catch { /* always show the same message — no account enumeration */ }
    setSent(true);
    setBusy(false);
  };

  return (
    <div className="max-w-md mx-auto">
      <h1 className="font-display text-2xl tracking-widest text-white mb-6 text-center">RESET PASSWORD</h1>
      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-6">
        {sent ? (
          <div className="text-center space-y-4">
            <p className="text-slate-300 text-sm">
              If an account exists for <span className="text-white">{email}</span>, a password-reset
              link is on its way. Check your inbox.
            </p>
            <Link to="/login" className="inline-block text-cyan-400 hover:text-cyan-300 text-sm">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-slate-500 text-sm">Enter your email and we'll send a reset link.</p>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
