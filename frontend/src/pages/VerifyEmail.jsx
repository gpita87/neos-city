import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { verifyEmail } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export default function VerifyEmail() {
  const { refresh } = useAuth();
  const [status, setStatus] = useState('working'); // 'working' | 'ok' | 'error'
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      return;
    }
    verifyEmail(token)
      .then(() => { setStatus('ok'); refresh(); })
      .catch(() => setStatus('error'));
  }, [refresh]);

  return (
    <div className="max-w-md mx-auto text-center py-16">
      {status === 'working' && <p className="text-slate-400">Verifying your email…</p>}
      {status === 'ok' && (
        <>
          <p className="text-3xl mb-3">✅</p>
          <h1 className="font-display text-xl tracking-widest text-white mb-2">EMAIL VERIFIED</h1>
          <p className="text-slate-400 text-sm mb-5">Your account is ready. You can now claim your player profile.</p>
          <Link to="/link" className="text-cyan-400 hover:text-cyan-300">Claim your profile →</Link>
        </>
      )}
      {status === 'error' && (
        <>
          <p className="text-3xl mb-3">⚠️</p>
          <h1 className="font-display text-xl tracking-widest text-white mb-2">LINK EXPIRED</h1>
          <p className="text-slate-400 text-sm mb-5">
            This verification link is invalid or has expired. Sign in and request a new one.
          </p>
          <Link to="/login" className="text-cyan-400 hover:text-cyan-300">Go to sign in →</Link>
        </>
      )}
    </div>
  );
}
