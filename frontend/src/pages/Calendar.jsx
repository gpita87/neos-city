import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getTournaments } from '../lib/api';

/* ── Series colour map ─────────────────────────────────────────────── */
const SERIES_META = {
  ffc:             { label: 'FFC',          color: 'bg-purple-500',  text: 'text-purple-300',  border: 'border-purple-600', dot: '#a855f7' },
  rtg_na:          { label: 'RTG NA',       color: 'bg-blue-500',    text: 'text-blue-300',    border: 'border-blue-600',   dot: '#3b82f6' },
  rtg_eu:          { label: 'RTG EU',       color: 'bg-green-500',   text: 'text-green-300',   border: 'border-green-600',  dot: '#22c55e' },
  dcm:             { label: 'DCM',          color: 'bg-orange-500',  text: 'text-orange-300',  border: 'border-orange-600', dot: '#f97316' },
  tcc:             { label: 'TCC',          color: 'bg-pink-500',    text: 'text-pink-300',    border: 'border-pink-600',   dot: '#ec4899' },
  eotr:            { label: 'EOTR',         color: 'bg-yellow-500',  text: 'text-yellow-300',  border: 'border-yellow-600', dot: '#eab308' },
  nezumi:          { label: 'Nezumi',       color: 'bg-rose-500',    text: 'text-rose-300',    border: 'border-rose-600',   dot: '#f43f5e' },
  nezumi_rookies:  { label: 'Rookies',      color: 'bg-amber-500',   text: 'text-amber-300',   border: 'border-amber-600',  dot: '#f59e0b' },
  ha:              { label: "Heaven's Arena",color: 'bg-cyan-500',   text: 'text-cyan-300',    border: 'border-cyan-600',   dot: '#06b6d4' },
  // Offline tiers
  worlds:          { label: 'Worlds',       color: 'bg-yellow-500',  text: 'text-yellow-300',  border: 'border-yellow-600', dot: '#eab308' },
  major:           { label: 'Major',        color: 'bg-cyan-500',   text: 'text-cyan-300',    border: 'border-cyan-600',   dot: '#00e5ff' },
  regional:        { label: 'Regional',     color: 'bg-teal-500',    text: 'text-teal-300',    border: 'border-teal-600',   dot: '#14b8a6' },
  other:           { label: 'Other',        color: 'bg-slate-500',   text: 'text-slate-400',   border: 'border-slate-600',  dot: '#64748b' },
};

const meta = (series) => SERIES_META[series] || SERIES_META.other;

/* ── Per-series landing pages (organizer tournament listings) ──────── *
 * Used for upcoming/scheduled placeholder events. Clicking a placeholder
 * pill opens the organizer's tournaments page in a new tab, where players
 * can find the registration link for the next event. */
const SERIES_LANDING_URL = {
  ffc:            'https://challonge.com/lv-LV/communities/PokkenFFC/tournaments',
  rtg_na:         'https://challonge.com/users/rigz_/tournaments',
  dcm:            'https://challonge.com/users/devlinhartfgc/tournaments',
  tcc:            'https://challonge.com/lv-LV/users/auradiance/tournaments',
  eotr:           'https://challonge.com/users/rigz_/tournaments',
  nezumi:         'https://tonamel.com/organization/OhUc2?game=pokken',
  nezumi_rookies: 'https://tonamel.com/organization/OhUc2?game=pokken',
  // Heaven's Arena lives in Discord — invite link works for everyone,
  // including players not yet in the server.
  ha:             'https://discord.gg/2vKGgyWh',
};

/* ── User timezone (computed once on load) ───────────────────────────── */
const USER_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
})();
const TZ_ABBR = (() => {
  try {
    const parts = new Intl.DateTimeFormat([], { timeZone: USER_TZ, timeZoneName: 'short' })
      .formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value || 'local';
  } catch { return 'local'; }
})();

/* ── Recurring schedule patterns ───────────────────────────────────── *
 * dayOfWeek: 0=Sun … 6=Sat (informational; the anchorDate's UTC weekday
 *   is what actually drives the cadence)
 * weekInterval: 1=weekly, 2=biweekly, 4=monthly-ish
 * hour/minute: start time in UTC. anchorDate + (hour, minute) defines
 *   the actual UTC moment of one occurrence.
 * anchorDate: a known past occurrence to align cadence
 *
 * TODO (DST honesty): hour/minute is stored as a raw UTC value, which is
 * only correct when the organizer fixes their event in UTC (e.g. TCC fires
 * at 15:00 UTC year-round → 7am PST winter, 8am PDT summer). For series
 * where the organizer keeps a constant local wall-clock time, the UTC hour
 * shifts twice a year and these schedules will drift across DST transitions.
 * To handle correctly: store { time: 'HH:mm', tz: 'America/Los_Angeles' }
 * per series and compute the UTC moment per occurrence with Intl APIs.
 */
const SERIES_SCHEDULES = [
  // FFC: Sundays at 11am PDT (18:00 UTC during DST)
  { series: 'ffc',        dayOfWeek: 0, weekInterval: 1, hour: 18, minute: 0,  anchorDate: '2026-04-26' },
  { series: 'rtg_na',     dayOfWeek: 6, weekInterval: 1, hour: 20, minute: 0,  anchorDate: '2026-03-07' },
  { series: 'dcm',        dayOfWeek: 6, weekInterval: 4, hour: 20, minute: 0,  anchorDate: '2026-03-07' },
  // TCC: biweekly Saturday at 8am PDT / 7am PST (15:00 UTC year-round). Confirmed dates: 2-14 (7am PST), 2-28 (7am PST), 3-14 (8am PDT), 3-28 (8am PDT)
  { series: 'tcc',        dayOfWeek: 6, weekInterval: 2, hour: 15, minute: 0,  anchorDate: '2026-03-28' },
  // Nezumi (Mouse Cup): 3rd Saturday of each month at 8pm JST (= 11:00 UTC year-round, since JP doesn't observe DST). That's 4am PDT / 3am PST. Confirmed dates: 2/21, 3/21, 4/18.
  { series: 'nezumi',     kind: 'monthlyNth', nth: 3, dayOfWeek: 6, hour: 11, minute: 0,  anchorDate: '2026-04-18' },
  // Heaven's Arena: Tuesdays at 4pm PDT (23:00 UTC during DST). Per the DST TODO above, the UTC hour will need a -1 shift in standard time if HA stays at 4pm wall-clock PT year-round.
  { series: 'ha',         dayOfWeek: 2, weekInterval: 1, hour: 23, minute: 0,  anchorDate: '2026-05-05' },
];

/* ── Helpers ────────────────────────────────────────────────────────── */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfWeek(d) {
  const day = d.getDay();
  const diff = d.getDate() - day;
  return new Date(d.getFullYear(), d.getMonth(), diff);
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isToday(d) {
  return sameDay(d, new Date());
}
function isPast(d) {
  const today = new Date();
  today.setHours(0,0,0,0);
  return d < today;
}

/** Pull the iteration number out of a tournament title (e.g. "Ferrum Fist
 *  Challenge 15" → "15", "RTG NA #23 (Apr 2024)" → "23"). Returns the first
 *  numeric token that isn't a four-digit calendar year, or null if none. */
function extractEventNumber(name) {
  if (!name) return null;
  const matches = String(name).match(/\d+/g);
  if (!matches) return null;
  for (const n of matches) {
    if (n.length === 4) {
      const num = parseInt(n, 10);
      if (num >= 1900 && num <= 2099) continue;
    }
    return n;
  }
  return null;
}

/** Day-of-month (1-31) of the Nth occurrence of dayOfWeek in a given UTC
 *  year/month. Returns null if the month doesn't have N occurrences. */
function nthWeekdayOfMonthUtc(year, month, n, dayOfWeek) {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const offset = (dayOfWeek - firstDow + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return day > lastOfMonth ? null : day;
}

/** Generate future placeholder dates for a recurring series within a range.
 *  Anchors on the actual UTC moment so each occurrence is placed on the
 *  user's *local* date with the user's *local* hour/minute.
 *  Supports two cadences: weekly-interval (default) and { kind: 'monthlyNth' }
 *  which fires on the Nth dayOfWeek (UTC) of each month. */
function generateRecurring(schedule, rangeStart, rangeEnd, existingDates) {
  const results = [];
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime() + 24 * 60 * 60 * 1000; // include last day fully

  const pushOccurrence = (ms) => {
    if (ms < startMs || ms > endMs) return;
    const d = new Date(ms);
    const key = dateKey(d);
    if (isPast(d)) return;
    if (existingDates.has(key)) return;
    results.push({
      id: `placeholder_${schedule.series}_${key}`,
      name: `${meta(schedule.series).label} (Scheduled)`,
      series: schedule.series,
      date: d,
      hour: d.getHours(),       // local hour for this user
      minute: d.getMinutes(),   // local minute
      isPlaceholder: true,
    });
  };

  if (schedule.kind === 'monthlyNth') {
    // Walk months overlapping the range (in UTC) and emit the Nth weekday.
    const startD = new Date(startMs);
    const endD = new Date(endMs);
    let y = startD.getUTCFullYear();
    let m = startD.getUTCMonth();
    const endY = endD.getUTCFullYear();
    const endM = endD.getUTCMonth();
    while (y < endY || (y === endY && m <= endM)) {
      const day = nthWeekdayOfMonthUtc(y, m, schedule.nth, schedule.dayOfWeek);
      if (day != null) {
        pushOccurrence(Date.UTC(y, m, day, schedule.hour, schedule.minute));
      }
      m++;
      if (m > 11) { m = 0; y++; }
    }
    return results;
  }

  // Default: weekly-interval cadence
  const [ay, am, ad] = schedule.anchorDate.split('-').map(Number);
  const anchorUtcMs = Date.UTC(ay, am - 1, ad, schedule.hour, schedule.minute);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const intervalMs = schedule.weekInterval * msPerWeek;
  const stepsFromAnchor = Math.floor((startMs - anchorUtcMs) / intervalMs);
  const firstCandidateMs = anchorUtcMs + stepsFromAnchor * intervalMs;
  for (let i = 0; i < 30; i++) {
    const ms = firstCandidateMs + i * intervalMs;
    if (ms > endMs) break;
    pushOccurrence(ms);
  }
  return results;
}

/* ── Event pill component ──────────────────────────────────────────── */
function EventPill({ event, compact = false }) {
  const m = meta(event.series);
  const landingUrl = SERIES_LANDING_URL[event.series];
  const isClickable = !event.isPlaceholder || !!landingUrl;
  const baseTitle = `${event.name}${event.hour != null ? ` — ${String(event.hour).padStart(2,'0')}:${String(event.minute ?? 0).padStart(2,'0')} ${TZ_ABBR}` : ''}`;
  const pillTitle = event.isPlaceholder && landingUrl
    ? `${baseTitle} — opens organizer page`
    : baseTitle;
  const inner = (
    <div
      className={`
        flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium truncate
        ${event.isPlaceholder
          ? `border border-dashed ${m.border} ${m.text} bg-transparent opacity-70`
          : `${m.color}/20 ${m.text} border ${m.border}/40`
        }
        ${isClickable ? 'hover:brightness-125 cursor-pointer' : 'cursor-default'}
        transition-all
      `}
      title={pillTitle}
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${m.color}`} />
      {compact
        ? <span className="truncate">{m.label}{event.number ? ` ${event.number}` : ''}</span>
        : <span className="truncate">{event.name}</span>
      }
      {event.hour != null && !compact && (
        <span className="text-[10px] text-slate-500 ml-auto flex-shrink-0">
          {String(event.hour).padStart(2,'0')}:{String(event.minute ?? 0).padStart(2,'0')}
        </span>
      )}
    </div>
  );

  if (!event.isPlaceholder && event.id && !String(event.id).startsWith('placeholder')) {
    return (
      <Link
        to={`/tournaments/${event.id}`}
        className="block"
        onClick={(e) => e.stopPropagation()}
      >
        {inner}
      </Link>
    );
  }
  if (event.isPlaceholder && landingUrl) {
    return (
      <a
        href={landingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
        onClick={(e) => e.stopPropagation()}
      >
        {inner}
      </a>
    );
  }
  return inner;
}

/* ── Month grid view ───────────────────────────────────────────────── */
function MonthView({ events, currentDate, onDateClick }) {
  const first = startOfMonth(currentDate);
  const last = endOfMonth(currentDate);
  const gridStart = startOfWeek(first);
  const weeks = [];
  let day = new Date(gridStart);

  while (day <= last || day.getDay() !== 0) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(day));
      day = addDays(day, 1);
    }
    weeks.push(week);
    if (day > last && day.getDay() === 0) break;
  }

  // Index events by date key
  const byDate = {};
  for (const e of events) {
    const k = dateKey(e.date);
    if (!byDate[k]) byDate[k] = [];
    byDate[k].push(e);
  }

  return (
    <div className="border border-[#1a2744] rounded-xl overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 bg-[#0c1425]">
        {DAYS.map(d => (
          <div key={d} className="text-center text-xs font-display tracking-wider text-slate-500 py-2 border-b border-[#1a2744]">
            {d}
          </div>
        ))}
      </div>
      {/* Weeks */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((d) => {
            const inMonth = d.getMonth() === currentDate.getMonth();
            const today = isToday(d);
            const dayEvents = byDate[dateKey(d)] || [];
            const maxShow = 3;
            return (
              <div
                key={dateKey(d)}
                onClick={() => dayEvents.length > 0 && onDateClick(d)}
                className={`
                  min-h-[100px] border-b border-r border-[#1a2744] p-1.5
                  ${inMonth ? 'bg-[#050a18]' : 'bg-[#030712]'}
                  ${dayEvents.length > 0 ? 'cursor-pointer hover:bg-white/[0.02]' : ''}
                  transition-colors
                `}
              >
                <div className={`
                  text-xs font-medium mb-1
                  ${today ? 'bg-cyan-500 text-white w-6 h-6 rounded-full flex items-center justify-center' : ''}
                  ${!today && inMonth ? 'text-slate-400' : ''}
                  ${!today && !inMonth ? 'text-slate-600' : ''}
                `}>
                  {d.getDate()}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, maxShow).map(e => (
                    <EventPill key={e.id} event={e} compact />
                  ))}
                  {dayEvents.length > maxShow && (
                    <div className="text-[10px] text-slate-500 pl-1">+{dayEvents.length - maxShow} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── Week view (time slots) ────────────────────────────────────────── */
function WeekView({ events, currentDate }) {
  const weekStart = startOfWeek(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Index events by date key
  const byDate = {};
  for (const e of events) {
    const k = dateKey(e.date);
    if (!byDate[k]) byDate[k] = [];
    byDate[k].push(e);
  }

  // Time slots: cover all event hours visible this week, plus a default
  // 8am–10pm window so the grid never collapses to an empty rail.
  const eventHours = events.filter(e => e.hour != null).map(e => e.hour);
  const minHour = Math.max(0, Math.min(8, ...eventHours));
  const maxHour = Math.min(23, Math.max(22, ...eventHours));
  const hours = [];
  for (let h = minHour; h <= maxHour; h++) hours.push(h);

  return (
    <div className="border border-[#1a2744] rounded-xl overflow-hidden overflow-x-auto">
      <div className="min-w-[700px]">
        {/* Day headers */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] bg-[#0c1425]">
          <div className="border-b border-r border-[#1a2744] p-2" />
          {days.map(d => (
            <div
              key={dateKey(d)}
              className={`
                text-center py-2 border-b border-r border-[#1a2744]
                ${isToday(d) ? 'bg-cyan-500/10' : ''}
              `}
            >
              <div className="text-xs text-slate-500 font-display tracking-wider">{DAYS[d.getDay()]}</div>
              <div className={`text-lg font-medium ${isToday(d) ? 'text-cyan-400' : 'text-slate-300'}`}>
                {d.getDate()}
              </div>
              <div className="text-[10px] text-slate-600">{MONTHS[d.getMonth()].slice(0, 3)}</div>
            </div>
          ))}
        </div>

        {/* All-day / no-time events row */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] bg-[#081020]">
          <div className="border-b border-r border-[#1a2744] p-1 text-[10px] text-slate-600 text-right pr-2 pt-2">
            ALL DAY
          </div>
          {days.map(d => {
            const dayEvents = (byDate[dateKey(d)] || []).filter(e => e.hour == null);
            return (
              <div key={dateKey(d)} className="border-b border-r border-[#1a2744] p-1 space-y-0.5 min-h-[40px]">
                {dayEvents.map(e => <EventPill key={e.id} event={e} compact />)}
              </div>
            );
          })}
        </div>

        {/* Hourly slots */}
        {hours.map(h => (
          <div key={h} className="grid grid-cols-[60px_repeat(7,1fr)]">
            <div className="border-b border-r border-[#1a2744] p-1 text-[10px] text-slate-600 text-right pr-2 pt-1">
              {String(h).padStart(2, '0')}:00
            </div>
            {days.map(d => {
              const dayEvents = (byDate[dateKey(d)] || []).filter(e => e.hour === h);
              return (
                <div key={dateKey(d)} className={`
                  border-b border-r border-[#1a2744] p-1 space-y-0.5 min-h-[44px]
                  ${isToday(d) ? 'bg-cyan-500/[0.03]' : ''}
                `}>
                  {dayEvents.map(e => <EventPill key={e.id} event={e} />)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Series legend / filter ────────────────────────────────────────── */
function SeriesLegend({ seriesFilter, onToggle, visibleSeries }) {
  return (
    <div className="flex flex-wrap gap-2">
      {visibleSeries.map(s => {
        const m = meta(s);
        const active = seriesFilter.size === 0 || seriesFilter.has(s);
        return (
          <button
            key={s}
            onClick={() => onToggle(s)}
            className={`
              flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all
              ${active
                ? `${m.color}/20 ${m.text} ${m.border}/60`
                : 'bg-transparent text-slate-600 border-slate-700/40 opacity-50'
              }
            `}
          >
            <span className={`w-2 h-2 rounded-full ${active ? m.color : 'bg-slate-600'}`} />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Main Calendar page ────────────────────────────────────────────── */
export default function Calendar() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('month'); // 'month' | 'week'
  const [currentDate, setCurrentDate] = useState(new Date());
  const [seriesFilter, setSeriesFilter] = useState(new Set());

  // Fetch all tournaments (online + offline)
  useEffect(() => {
    setLoading(true);
    Promise.all([getTournaments(false), getTournaments(true)])
      .then(([online, offline]) => {
        setTournaments([...online, ...offline]);
      })
      .finally(() => setLoading(false));
  }, []);

  // Determine visible range
  const range = useMemo(() => {
    if (view === 'month') {
      const first = startOfMonth(currentDate);
      const last = endOfMonth(currentDate);
      const gridStart = startOfWeek(first);
      // Grid end: walk to fill last week
      let gridEnd = new Date(last);
      while (gridEnd.getDay() !== 6) gridEnd = addDays(gridEnd, 1);
      return { start: gridStart, end: gridEnd };
    } else {
      const ws = startOfWeek(currentDate);
      return { start: ws, end: addDays(ws, 6) };
    }
  }, [view, currentDate]);

  // Convert tournaments to calendar events + generate recurring placeholders
  const calendarEvents = useMemo(() => {
    // Real events from DB. Detect "all-day" events (rows imported with date
    // only, defaulting to 00:00 UTC) by checking the underlying UTC moment.
    // Otherwise emit hour/minute in the user's local timezone — Date methods
    // (getHours / getDate) already respect the browser TZ.
    const realEvents = tournaments
      .filter(t => t.completed_at || t.started_at)
      .map(t => {
        const d = new Date(t.completed_at || t.started_at);
        const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;
        return {
          id: t.id,
          name: t.name,
          number: extractEventNumber(t.name),
          series: t.series || 'other',
          date: d,
          hour: hasTime ? d.getHours() : null,
          minute: hasTime ? d.getMinutes() : null,
          isPlaceholder: false,
          isOffline: t.is_offline,
          participantsCount: t.participants_count,
        };
      });

    // Build a set of (series, dateKey) for existing events so we don't double-up
    const existingDatesBySeries = {};
    for (const e of realEvents) {
      if (!existingDatesBySeries[e.series]) existingDatesBySeries[e.series] = new Set();
      existingDatesBySeries[e.series].add(dateKey(e.date));
    }

    // Generate recurring placeholders
    const placeholders = SERIES_SCHEDULES.flatMap(schedule =>
      generateRecurring(schedule, range.start, range.end, existingDatesBySeries[schedule.series] || new Set())
    );

    return [...realEvents, ...placeholders];
  }, [tournaments, range]);

  // Filter by series
  const filteredEvents = useMemo(() => {
    if (seriesFilter.size === 0) return calendarEvents;
    return calendarEvents.filter(e => seriesFilter.has(e.series));
  }, [calendarEvents, seriesFilter]);

  // All series that actually appear
  const visibleSeries = useMemo(() => {
    const s = new Set(calendarEvents.map(e => e.series));
    // Maintain a consistent order
    const order = ['ffc','rtg_na','rtg_eu','dcm','tcc','eotr','nezumi','nezumi_rookies','ha','worlds','major','regional','other'];
    return order.filter(k => s.has(k));
  }, [calendarEvents]);

  const toggleSeries = useCallback((s) => {
    setSeriesFilter(prev => {
      const next = new Set(prev);
      if (next.has(s)) {
        next.delete(s);
      } else {
        next.add(s);
      }
      return next;
    });
  }, []);

  // Navigation
  const goToday = () => setCurrentDate(new Date());
  const goPrev = () => {
    if (view === 'month') {
      setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    } else {
      setCurrentDate(d => addDays(d, -7));
    }
  };
  const goNext = () => {
    if (view === 'month') {
      setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    } else {
      setCurrentDate(d => addDays(d, 7));
    }
  };

  // Click on a day in month view → switch to week view for that day
  const handleDayClick = (d) => {
    setCurrentDate(d);
    setView('week');
  };

  // Header text
  const headerText = view === 'month'
    ? `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : (() => {
        const ws = startOfWeek(currentDate);
        const we = addDays(ws, 6);
        const sameMonth = ws.getMonth() === we.getMonth();
        if (sameMonth) {
          return `${MONTHS[ws.getMonth()].slice(0,3)} ${ws.getDate()} – ${we.getDate()}, ${ws.getFullYear()}`;
        }
        return `${MONTHS[ws.getMonth()].slice(0,3)} ${ws.getDate()} – ${MONTHS[we.getMonth()].slice(0,3)} ${we.getDate()}, ${we.getFullYear()}`;
      })();

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="font-display text-2xl tracking-widest text-cyan-400 mb-1">CALENDAR</h1>
        <p className="text-sm text-slate-500">Past events link to results. Dashed outlines are upcoming scheduled events — click to open the organizer's tournament page.</p>
      </div>

      {/* Controls bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Nav arrows + title */}
        <div className="flex items-center gap-3">
          <button onClick={goPrev} className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
          </button>
          <h2 className="font-display text-lg tracking-wide text-slate-200 min-w-[200px] text-center">
            {headerText}
          </h2>
          <button onClick={goNext} className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
          </button>
          <button onClick={goToday} className="ml-2 px-3 py-1 text-xs rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 transition-colors">
            Today
          </button>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1 bg-[#0c1425] rounded-lg p-1 border border-[#1a2744]">
          <button
            onClick={() => setView('month')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'month' ? 'bg-cyan-500 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Month
          </button>
          <button
            onClick={() => setView('week')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'week' ? 'bg-cyan-500 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Week
          </button>
        </div>
      </div>

      {/* Series filter */}
      <SeriesLegend seriesFilter={seriesFilter} onToggle={toggleSeries} visibleSeries={visibleSeries} />

      {/* Calendar body */}
      {loading ? (
        <div className="text-center py-20 text-slate-500">Loading events…</div>
      ) : view === 'month' ? (
        <MonthView events={filteredEvents} currentDate={currentDate} onDateClick={handleDayClick} />
      ) : (
        <WeekView events={filteredEvents} currentDate={currentDate} />
      )}

      {/* Timezone note */}
      <p className="text-xs text-slate-600 text-center">
        Times shown in {TZ_ABBR} ({USER_TZ}).
      </p>
    </div>
  );
}
