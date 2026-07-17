import { useState } from 'react';
import { Routes, Route, NavLink, Link } from 'react-router-dom';
import Home from './pages/Home';
import Leaderboard from './pages/Leaderboard';
import Players from './pages/Players';
import PlayerProfile from './pages/PlayerProfile';
import Tournaments from './pages/Tournaments';
import TournamentDetail from './pages/TournamentDetail';
import LiveRoom from './pages/LiveRoom';
import Achievements from './pages/Achievements';
import Organizers from './pages/Organizers';
import Calendar from './pages/Calendar';
import Creators from './pages/Creators';
import Twitch from './pages/Twitch';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import ClaimPlayer from './pages/ClaimPlayer';
import Arena from './pages/Arena';
import ArenaTournament from './pages/ArenaTournament';
import { useAuth } from './contexts/AuthContext';
import { useFlag } from './hooks/useFlag';
import FlagPanel from './components/FlagPanel';

function NavItem({ to, children, onClick }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        `px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
          isActive
            ? 'bg-cyan-500/15 text-cyan-300 shadow-neon-sm border border-cyan-500/30'
            : 'text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/5 border border-transparent'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

// Nav destinations, shared between the desktop bar and the mobile menu so the
// two never drift. Flag-gated items are appended in the component.
const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/players', label: 'Players' },
  { to: '/tournaments', label: 'Tournaments' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/achievements', label: 'Achievements' },
];

// Right-hand auth controls: Login when signed out; identity + Logout when in.
function AuthNav() {
  const { user, loading, logout } = useAuth();
  if (loading) return null;

  if (!user) {
    return (
      <Link
        to="/login"
        className="px-4 py-2 rounded-lg text-sm font-medium text-cyan-300 border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors"
      >
        Sign in
      </Link>
    );
  }

  const name = user.display_name || user.discord_username || user.email || 'Account';
  const profileTo = user.player_id ? `/players/${user.player_id}` : '/link';
  return (
    <div className="flex items-center gap-3">
      <Link to={profileTo} className="flex items-center gap-2 text-sm text-slate-300 hover:text-cyan-300 transition-colors">
        {user.avatar_url
          ? <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
          : <span className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-xs">⚔️</span>}
        <span className="max-w-[10rem] truncate">{name}</span>
      </Link>
      <button
        onClick={logout}
        className="text-xs text-slate-500 hover:text-red-400 transition-colors"
      >
        Logout
      </button>
    </div>
  );
}

export default function App() {
  const showCreators = useFlag('creators');
  const showAuth = useFlag('auth');
  const showTwitch = useFlag('twitch');
  const showArena = useFlag('arena');
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    ...NAV_LINKS,
    ...(showArena ? [{ to: '/arena', label: 'Arena' }] : []),
    ...(showCreators ? [{ to: '/creators', label: 'YouTube' }] : []),
    ...(showTwitch ? [{ to: '/twitch', label: 'Twitch' }] : []),
  ];
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="min-h-screen neos-bg text-slate-100 font-body">
      {/* Nav */}
      <header className="border-b border-[#1a2744] sticky top-0 z-50 backdrop-blur-md bg-[#050a18]/80">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4 lg:gap-6">
          <NavLink to="/" onClick={closeMenu} className="flex items-center gap-2 mr-auto lg:mr-2 group shrink-0">
            <span className="font-display text-base sm:text-lg text-cyan-400 tracking-widest neon-text group-hover:animate-neon-flicker transition-all">
              NEOS CITY
            </span>
          </NavLink>

          {/* Desktop nav */}
          <nav className="hidden lg:flex gap-1">
            {links.map(l => (
              <NavItem key={l.to} to={l.to}>{l.label}</NavItem>
            ))}
          </nav>
          {showAuth && (
            <div className="hidden lg:block lg:ml-auto">
              <AuthNav />
            </div>
          )}

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            className="lg:hidden p-2 -mr-2 rounded-lg text-slate-300 hover:text-cyan-300 hover:bg-cyan-500/5 transition-colors"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>

        {/* Mobile menu panel */}
        {menuOpen && (
          <nav className="lg:hidden border-t border-[#1a2744] bg-[#050a18]/95 backdrop-blur-md px-4 py-3 flex flex-col gap-1">
            {links.map(l => (
              <NavItem key={l.to} to={l.to} onClick={closeMenu}>{l.label}</NavItem>
            ))}
            {showAuth && (
              <div className="pt-3 mt-2 border-t border-[#1a2744]" onClick={closeMenu}>
                <AuthNav />
              </div>
            )}
          </nav>
        )}

        {/* Neon line under nav */}
        <div className="neon-divider" />
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/players" element={<Players />} />
          <Route path="/players/:id" element={<PlayerProfile />} />
          <Route path="/tournaments" element={<Tournaments />} />
          <Route path="/tournaments/:id" element={<TournamentDetail />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/achievements" element={<Achievements />} />
          {showCreators && <Route path="/creators" element={<Creators />} />}
          {showTwitch && <Route path="/twitch" element={<Twitch />} />}
          {showArena && <Route path="/arena" element={<Arena />} />}
          {showArena && <Route path="/arena/:id" element={<ArenaTournament />} />}
          <Route path="/live" element={<LiveRoom />} />
          <Route path="/live/:code" element={<LiveRoom />} />
          <Route path="/organizers" element={<Organizers />} />
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/link" element={<ClaimPlayer />} />
        </Routes>
      </main>
      <FlagPanel />
    </div>
  );
}
