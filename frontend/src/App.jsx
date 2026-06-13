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
import { useAuth } from './contexts/AuthContext';
import { useFlag } from './hooks/useFlag';
import FlagPanel from './components/FlagPanel';

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
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
  return (
    <div className="min-h-screen neos-bg text-slate-100 font-body">
      {/* Nav */}
      <header className="border-b border-[#1a2744] sticky top-0 z-50 backdrop-blur-md bg-[#050a18]/80">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
          <NavLink to="/" className="flex items-center gap-2 mr-2 group">
            <span className="font-display text-lg text-cyan-400 tracking-widest neon-text group-hover:animate-neon-flicker transition-all">
              NEOS CITY
            </span>
          </NavLink>
          <nav className="flex gap-1 flex-wrap">
            <NavItem to="/">Home</NavItem>
            <NavItem to="/players">Players</NavItem>
            <NavItem to="/tournaments">Tournaments</NavItem>
            <NavItem to="/calendar">Calendar</NavItem>
            <NavItem to="/achievements">Achievements</NavItem>
            {showCreators && <NavItem to="/creators">YouTube</NavItem>}
            {showTwitch && <NavItem to="/twitch">Twitch</NavItem>}
          </nav>
          {showAuth && (
            <div className="ml-auto">
              <AuthNav />
            </div>
          )}
        </div>
        {/* Neon line under nav */}
        <div className="neon-divider" />
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
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
