/**
 * AchievementIcon — renders an achievement's emoji/glyph with a small
 * Roman numeral badge in the corner indicating the region tier.
 *
 *   Kanto = I, Johto = II, Hoenn = III, Sinnoh = IV, Unova = V,
 *   Kalos = VI, Alola = VII, Galar = VIII, Paldea = IX
 *
 * The numeral lets the eye distinguish achievement tiers at a glance
 * even when the icon is shared (e.g. all Champion tiers use 👑).
 *
 * Usage:
 *   <AchievementIcon icon={a.icon} region={a.region} />
 *   <AchievementIcon icon={a.icon} regionFromId={a.achievement_id} size="lg" />
 */

const REGION_NUMERALS = {
  kanto: 'I',
  johto: 'II',
  hoenn: 'III',
  sinnoh: 'IV',
  unova: 'V',
  kalos: 'VI',
  alola: 'VII',
  galar: 'VIII',
  paldea: 'IX',
};

const REGION_BADGE_COLORS = {
  kanto:  'bg-red-950/90 text-red-300 border-red-700/60',
  johto:  'bg-purple-950/90 text-purple-300 border-purple-700/60',
  hoenn:  'bg-emerald-950/90 text-emerald-300 border-emerald-700/60',
  sinnoh: 'bg-blue-950/90 text-blue-300 border-blue-700/60',
  unova:  'bg-slate-900/95 text-slate-200 border-slate-500/70',
  kalos:  'bg-sky-950/90 text-sky-300 border-sky-700/60',
  alola:  'bg-orange-950/90 text-orange-300 border-orange-700/60',
  galar:  'bg-pink-950/90 text-pink-300 border-pink-700/60',
  paldea: 'bg-fuchsia-950/90 text-fuchsia-300 border-fuchsia-700/60',
};

/** Pull the region slug out of an achievement_id like "global_champion_kalos". */
export function regionFromAchievementId(id) {
  if (!id) return null;
  const last = String(id).split('_').pop();
  return REGION_NUMERALS[last] ? last : null;
}

const SIZE_CLASSES = {
  sm: { icon: 'text-base', badge: 'text-[8px] min-w-[12px] h-[12px] leading-[10px] px-[2px] -top-1 -right-1' },
  md: { icon: 'text-xl',   badge: 'text-[9px] min-w-[14px] h-[14px] leading-[12px] px-[3px] -top-1 -right-1.5' },
  lg: { icon: 'text-3xl',  badge: 'text-[10px] min-w-[16px] h-[16px] leading-[14px] px-[3px] -top-1.5 -right-2' },
};

export default function AchievementIcon({
  icon,
  region,
  regionFromId,
  size = 'md',
  className = '',
}) {
  const r = region || regionFromAchievementId(regionFromId);
  const sz = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const badgeColor = (r && REGION_BADGE_COLORS[r]) || 'bg-slate-900 text-cyan-300 border-slate-600';

  return (
    <span className={`relative inline-flex items-center justify-center ${className}`}>
      <span className={sz.icon}>{icon}</span>
      {r && (
        <span
          className={`absolute font-bold border rounded text-center font-mono tracking-tighter ${sz.badge} ${badgeColor}`}
        >
          {REGION_NUMERALS[r]}
        </span>
      )}
    </span>
  );
}

export { REGION_NUMERALS, REGION_BADGE_COLORS };
