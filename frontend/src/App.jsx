import { Routes, Route, NavLink } from 'react-router-dom';
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

export default function App() {
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
          </nav>
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
          <Route path="/live" element={<LiveRoom />} />
          <Route path="/live/:code" element={<LiveRoom />} />
          <Route path="/organizers" element={<Organizers />} />
        </Routes>
      </main>
    </div>
  );
}
