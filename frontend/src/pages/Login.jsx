import { useSearchParams } from 'react-router-dom';
import { discordLoginUrl, googleLoginUrl } from '../lib/api';

export default function Login() {
  const [params] = useSearchParams();
  const errorProvider = params.get('error'); // 'discord' | 'google' | null

  return (
    <div className="max-w-md mx-auto">
      <h1 className="font-display text-2xl tracking-widest text-white mb-1 text-center">SIGN IN</h1>
      <p className="text-slate-500 text-sm text-center mb-6">
        Sign in with Discord or Google to claim your player profile.
      </p>

      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-6 space-y-3">
        {/* Discord */}
        <a
          href={discordLoginUrl()}
          className="flex items-center justify-center gap-2 w-full bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <span>🎮</span> Continue with Discord
        </a>

        {/* Google */}
        <a
          href={googleLoginUrl()}
          className="flex items-center justify-center gap-2 w-full bg-white hover:bg-slate-100 text-slate-800 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <span>🔵</span> Continue with Google
        </a>

        {errorProvider && (
          <p className="text-red-400 text-xs text-center pt-1">
            {errorProvider === 'google' ? 'Google' : 'Discord'} login failed. Please try again.
          </p>
        )}

        <p className="text-slate-600 text-xs text-center pt-2">
          We only use your account to confirm your identity and link your player profile.
        </p>
      </div>
    </div>
  );
}
