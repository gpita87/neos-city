import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

// Landing page for the Discord OAuth redirect. The backend hands the session
// token back in the URL fragment (#token=…) so it never hits server logs or
// referrers. We read it, store it, then bounce home.
export default function AuthCallback() {
  const { setToken, refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke guard
    ran.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('token');
    if (!token) {
      setError(true);
      return;
    }
    setToken(token);
    // Clear the token from the address bar before continuing.
    window.history.replaceState(null, '', window.location.pathname);
    refresh().finally(() => navigate('/', { replace: true }));
  }, [setToken, refresh, navigate]);

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <p className="text-red-400 mb-4">Sign-in link was missing or invalid.</p>
        <Link to="/login" className="text-cyan-400 hover:text-cyan-300">Back to sign in</Link>
      </div>
    );
  }
  return <p className="text-slate-400 text-center py-16">Signing you in…</p>;
}
