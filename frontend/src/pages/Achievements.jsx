import { useEffect, useState } from 'react';
import { getAchievements } from '../lib/api';
import AchievementTournamentsModal from '../components/AchievementTournamentsModal';
import AchievementIcon, { REGION_NUMERALS } from '../components/AchievementIcon';

const REGION_ORDER = ['kanto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'paldea'];

const REGION_LABELS = {
  kanto: 'Kanto', johto: 'Johto', hoenn: 'Hoenn', sinnoh: 'Sinnoh',
  unova: 'Unova', kalos: 'Kalos', alola: 'Alola', galar: 'Galar', paldea: 'Paldea',
};

const REGION_THRESHOLDS = {
  kanto: 1, johto: 3, hoenn: 5, sinnoh: 10, unova: 20, kalos: 40, alola: 80, galar: 150, paldea: 250,
};

const REGION_COLORS = {
  kanto: 'border-red-800/40 bg-red-900/10',
  johto: 'border-purple-800/40 bg-purple-900/10',
  hoenn: 'border-emerald-800/40 bg-emerald-900/10',
  sinnoh: 'border-blue-800/40 bg-blue-900/10',
  unova: 'border-slate-600/40 bg-slate-800/10',
  kalos: 'border-sky-800/40 bg-sky-900/10',
  alola: 'border-orange-800/40 bg-orange-900/10',
  galar: 'border-pink-800/40 bg-pink-900/10',
  paldea: 'border-fuchsia-800/40 bg-fuchsia-900/10',
};

// What each placement tier means — explained on the page so players don't have to guess
const TIER_GLOSSARY = [
  { icon: '🏟️', name: 'Gym Leader', desc: 'Finished in the top 8 of a tournament.' },
  { icon: '⭐', name: 'Elite Four', desc: 'Finished in the top 4 of a tournament.' },
  { icon: '🔥', name: 'Rival',      desc: 'Finished as the runner-up (2nd place) of a tournament.' },
  { icon: '👑', name: 'Champion',   desc: 'Won a tournament outright (1st place).' },
];

const META_GLOSSARY = [
  { icon: '⚔️', name: 'Rival Battle!',  desc: 'Took at least one game from a Rival in any match.' },
  { icon: '👋', name: 'Smell Ya Later!', desc: 'Won an entire match against a Rival.' },
  { icon: '🔮', name: 'Foreshadowing',  desc: 'Took at least one game from a Champion in any match.' },
  { icon: '🐴', name: 'Dark Horse',     desc: 'Won an entire match against a Champion.' },
  { icon: '🎖️', name: '8 Badges!',     desc: 'Defeated 8 unique Gym Leaders (or higher).' },
  { icon: '🏆', name: 'Elite Trainer',  desc: 'Defeated 4 unique Elite Four members (or higher).' },
];

const CATEGORY_SECTIONS = [
  { key: 'placement',     label: '🏟️ Placement',     desc: 'Top 8 · Top 4 · Runner-up · Champion' },
  { key: 'participation', label: '🎮 Participation',  desc: 'Tournament entries' },
  { key: 'match',         label: '⚔️ Match',          desc: 'Feats against Rivals and Champions' },
  { key: 'meta',          label: '🎖️ Meta',           desc: 'Defeat players with achievements' },
  { key: 'special',       label: '🌐 Special',        desc: 'Unique accomplishments' },
  { key: 'series_ffc',    label: '✊ Ferrum Fist Challenge' },
  { key: 'series_rtg_na', label: '🛣️ Road to Greatness NA' },
  { key: 'series_rtg_eu', label: '🌍 Road to Greatness EU' },
  { key: 'series_dcm',    label: '📆 DCM Monthly' },
  { key: 'series_tcc',    label: '🥐 The Croissant Cup' },
  { key: 'series_eotr',   label: '🛤️ End of the Road' },
  { key: 'series_nezumi', label: '🐭 ねずみ杯 (Mouse Cup)' },
  { key: 'series_ha',     label: "⚡ Heaven's Arena" },
];

const TIER_LABELS = {
  gym_leader: 'Gym Leader',
  elite_four: 'Elite Four',
  rival: 'Rival',
  champion: 'Champion',
  participation: 'Trainer',
  rival_battle: 'Rival Battle!',
  smell_ya_later: 'Smell Ya Later!',
  foreshadowing: 'Foreshadowing',
  dark_horse: 'Dark Horse',
  eight_badges: '8 Badges!',
  elite_trainer: 'Elite Trainer',
};

export default function Achievements() {
  const [achievements, setAchievements] = useState([]);
  const [expandedCategory, setExpandedCategory] = useState('placement');
  const [openAchievement, setOpenAchievement] = useState(null);

  useEffect(() => {
    getAchievements().then(setAchievements).catch(() => {});
  }, []);

  // Group by category
  const grouped = {};
  for (const a of achievements) {
    if (!grouped[a.category]) grouped[a.category] = [];
    grouped[a.category].push(a);
  }

  // For a given category, group by tier, then show regions as columns
  function renderTierRegionGrid(achList) {
    // Group by tier
    const byTier = {};
    for (const a of achList) {
      if (!byTier[a.tier]) byTier[a.tier] = {};
      if (a.region) byTier[a.tier][a.region] = a;
    }

    const tiers = Object.keys(byTier);

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-slate-500 font-normal pb-2 pr-4 min-w-[120px]">Tier</th>
              {REGION_ORDER.map(r => (
                <th key={r} className="text-center text-slate-500 font-normal pb-2 px-1 min-w-[60px]">
                  <div>{REGION_LABELS[r]}</div>
                  <div className="text-[9px] text-slate-600">{REGION_THRESHOLDS[r]}×</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map(tier => (
              <tr key={tier} className="border-t border-[#1a2744]">
                <td className="py-2 pr-4">
                  <span className="text-slate-300 font-medium">
                    {byTier[tier][REGION_ORDER[0]]?.icon}{' '}
                    {TIER_LABELS[tier] || tier}
                  </span>
                </td>
                {REGION_ORDER.map(r => {
                  const ach = byTier[tier]?.[r];
                  if (!ach) return <td key={r} className="text-center py-2 px-1 text-slate-700">—</td>;
                  return (
                    <td key={r} className="text-center py-2 px-1">
                      <button
                        type="button"
                        onClick={() => setOpenAchievement(ach)}
                        className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border cursor-pointer hover:scale-110 transition-transform ${REGION_COLORS[r]}`}
                        title={`${ach.name} (${REGION_NUMERALS[r]})\n${ach.description}\n\nClick to see contributing tournaments`}
                      >
                        <AchievementIcon icon={ach.icon} region={r} size="sm" />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Non-region achievements (like multi_series)
  function renderSpecial(achList) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {achList.map(a => (
          <button
            type="button"
            key={a.id}
            onClick={() => setOpenAchievement(a)}
            className="bg-white/5 border border-[#1a2744] rounded-xl p-4 flex gap-4 items-start hover:bg-white/10 transition-colors text-left"
            title="Click to see contributing tournaments"
          >
            <span className="text-3xl mt-0.5">{a.icon}</span>
            <div>
              <p className="font-medium text-white text-sm">{a.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">{a.description}</p>
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl tracking-widest text-white">ACHIEVEMENTS</h1>
      <p className="text-slate-400 -mt-4">
        {achievements.length} achievements to unlock across {REGION_ORDER.length} Pokémon regions.
        Hover over any achievement for details.
      </p>

      {/* How achievements work — quick glossary so the tier names mean something */}
      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-1">HOW THIS WORKS</h2>
          <p className="text-xs text-slate-400">
            Each achievement has a <span className="text-slate-200">placement tier</span> (how well you finished)
            and a <span className="text-slate-200">region tier</span> (how many times you've done it).
            Region tiers progress through the Pokémon regions and are marked with a Roman numeral
            ({Object.entries(REGION_NUMERALS).map(([r, n], i) => (
              <span key={r}>
                {i > 0 ? ', ' : ''}
                <span className="text-slate-300">{n}</span> = {REGION_LABELS[r]} ({REGION_THRESHOLDS[r]}×)
              </span>
            ))}).
          </p>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Placement tiers</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TIER_GLOSSARY.map(t => (
              <div key={t.name} className="flex items-start gap-3 p-2 rounded-lg bg-white/5">
                <span className="text-xl mt-0.5">{t.icon}</span>
                <div>
                  <p className="text-sm text-white font-medium">{t.name}</p>
                  <p className="text-xs text-slate-400">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Match &amp; meta achievements</h3>
          <p className="text-[11px] text-slate-500 mb-2">
            These are earned by playing <em>against</em> Rivals and Champions — meaning players who already
            hold the corresponding placement achievement.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {META_GLOSSARY.map(t => (
              <div key={t.name} className="flex items-start gap-3 p-2 rounded-lg bg-white/5">
                <span className="text-xl mt-0.5">{t.icon}</span>
                <div>
                  <p className="text-sm text-white font-medium">{t.name}</p>
                  <p className="text-xs text-slate-400">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Category nav */}
      <div className="flex flex-wrap gap-2">
        {CATEGORY_SECTIONS.filter(s => grouped[s.key]?.length > 0).map(s => (
          <button
            key={s.key}
            onClick={() => setExpandedCategory(expandedCategory === s.key ? null : s.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              expandedCategory === s.key
                ? 'bg-cyan-500 text-white'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Expanded category */}
      {expandedCategory && grouped[expandedCategory] && (
        <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
          <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-1">
            {CATEGORY_SECTIONS.find(s => s.key === expandedCategory)?.label || expandedCategory}
          </h2>
          {CATEGORY_SECTIONS.find(s => s.key === expandedCategory)?.desc && (
            <p className="text-xs text-slate-500 mb-4">
              {CATEGORY_SECTIONS.find(s => s.key === expandedCategory).desc}
            </p>
          )}
          {expandedCategory === 'special'
            ? renderSpecial(grouped[expandedCategory])
            : renderTierRegionGrid(grouped[expandedCategory])
          }
        </div>
      )}

      {/* Achievement -> Tournaments modal */}
      {openAchievement && (
        <AchievementTournamentsModal
          achievement={openAchievement}
          onClose={() => setOpenAchievement(null)}
        />
      )}
    </div>
  );
}
