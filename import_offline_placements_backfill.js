/**
 * import_offline_placements_backfill.js
 *
 * Backfills Liquipedia Prize Pool placements (top 8+, with ties) onto the
 * 25 offline tournaments that previously had only rank-1 + rank-2 in the DB.
 * Also sets each tournament's `liquipedia_url` so the "View on Liquipedia"
 * link appears in the UI.
 *
 * Source for every record: the event's Liquipedia page (Prize Pool section).
 * Texas Showdown 2016 (id 632) is intentionally absent — Liquipedia has no
 * Pokkén page for that event (redlink on the Pokkén Tournament index).
 *
 * Run from the neos-city directory with the backend running:
 *   node import_offline_placements_backfill.js
 *
 * Safe to re-run — the endpoint wipes + replaces placements for each event,
 * so the result is idempotent.
 */

const axios = require('axios');
const path  = require('path');

require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

const BACKEND_URL = 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  console.error('ADMIN_TOKEN is not set. Add it to backend/.env (see .env.example).');
  process.exit(1);
}

const LP = 'https://liquipedia.net/fighters';

// Each entry: full payload for POST /api/tournaments/import-liquipedia-placements.
// Metadata fields (date/location/prize_pool/participants_count) match what's
// already in offline_import.js — the endpoint COALESCEs so passing them is a
// no-op when the row already has them, and a backfill if it doesn't.
const EVENTS = [
  {
    eventUrl:           `${LP}/Community_Effort_Orlando/2025/PokkenDX`,
    name:               'CEO 2025',
    date:               '2025-06-14',
    location:           'Orlando, FL',
    prize_pool:         '$110',
    participants_count: 11,
    placements: [
      { rank: 1, players: ['YungBlastoiseMain42'] },
      { rank: 2, players: ['Kino'] },
      { rank: 3, players: ['RoaraG'] },
      { rank: 4, players: ['Jin'] },
      { rank: 5, players: ['99dash', 'Combo'] },
      { rank: 7, players: ['ranko', 'Son_Dula'] },
    ],
  },
  {
    eventUrl:           `${LP}/Community_Effort_Orlando/2024/PokkenDX`,
    name:               'CEO 2024',
    date:               '2024-06-29',
    location:           'Daytona Beach, FL',
    prize_pool:         '$105',
    participants_count: 21,
    placements: [
      { rank: 1, players: ['Stephmicky'] },
      { rank: 2, players: ['Jin'] },
      { rank: 3, players: ['KTK'] },
      { rank: 4, players: ['SunnyDayluxe'] },
      { rank: 5, players: ['Son_Dula', '99dash'] },
      { rank: 7, players: ['Gyl', 'Combo'] },
      { rank: 9, players: ['Unga Bunga Inc.', 'RoaraG', 'Uncle Moton', 'NG-Obscure'] },
    ],
  },
  {
    eventUrl:           `${LP}/Curtain_Call/2023`,
    name:               'Curtain Call',
    date:               '2023-10-12',
    location:           'New York, NY',
    prize_pool:         '$1,850',
    participants_count: 33,
    placements: [
      { rank: 1, players: ['TEC'] },
      { rank: 2, players: ['Mewtater'] },
      { rank: 3, players: ['Euclase'] },
      { rank: 4, players: ['KTK'] },
      { rank: 5, players: ['Marx', 'Kamaal'] },
      { rank: 7, players: ['Jin', 'NeonBlakk'] },
      { rank: 9, players: ['Jukem', 'Aldrake', 'ipodtouch0218', 'Empurror'] },
      { rank: 13, players: ['SorcererTwyx', 'Oreo', 'Tru2', 'KandiSAI'] },
    ],
  },
  {
    eventUrl:           `${LP}/Community_Effort_Orlando/2023/PokkenDX`,
    name:               'CEO 2023',
    date:               '2023-06-25',
    location:           'Orlando, FL',
    prize_pool:         null,
    participants_count: 24,
    placements: [
      { rank: 1, players: ['Jin'] },
      { rank: 2, players: ['99dash'] },
      { rank: 3, players: ['SorcererTwyx'] },
      { rank: 4, players: ['Unga Bunga Inc.'] },
      { rank: 5, players: ['Son_Dula', 'ReyDelEmpire'] },
      { rank: 7, players: ['S-Nerro', 'Mischief'] },
      { rank: 9, players: ['TherianDog', 'Phenotype', 'Uncle Moton', 'Ace Trainer Raf'] },
      { rank: 13, players: ['Riolu', 'Travelodic', 'Yubei Belvet', 'Young Simba'] },
    ],
  },
  {
    eventUrl:           `${LP}/Battle_Arena_Melbourne/13/PokkenDX`,
    name:               'Battle Arena Melbourne 13',
    date:               '2023-06-11',
    location:           'Melbourne',
    prize_pool:         '$67.37',
    participants_count: 20,
    placements: [
      { rank: 1, players: ['IceBurgy'] },
      { rank: 2, players: ['Antwerp'] },
      { rank: 3, players: ['Santa'] },
      { rank: 4, players: ['Koopa'] },
      { rank: 5, players: ['Jamesibell', 'Enigma'] },
      { rank: 7, players: ['Dyna Hole', 'robin'] },
    ],
  },
  {
    eventUrl:           `${LP}/Battle_Arena_Melbourne/12/PokkenDX`,
    name:               'Battle Arena Melbourne 12',
    date:               '2022-05-15',
    location:           'Melbourne',
    prize_pool:         '$125.02',
    participants_count: 18,
    placements: [
      { rank: 1, players: ['Antwerp'] },
      { rank: 2, players: ['Santa'] },
      { rank: 3, players: ['IceBurgy'] },
      { rank: 4, players: ['DanDandy'] },
      { rank: 5, players: ['Midonnay', 'Sir Banana'] },
      { rank: 7, players: ['Koopa', 'Jamesibell'] },
    ],
  },
  {
    eventUrl:           `${LP}/Frostfire/2020/PokkenDX`,
    name:               'Frostfire 2020',
    date:               '2020-02-01',
    location:           'Online',
    prize_pool:         null,
    participants_count: 31,
    placements: [
      { rank: 1, players: ['Jukem'] },
      { rank: 2, players: ['Mewtater'] },
      { rank: 3, players: ['Wise'] },
      { rank: 4, players: ['Shadowcat'] },
      { rank: 5, players: ['ELM', 'SliceNDice'] },
      { rank: 7, players: ['NEO SINANJU', 'Jin'] },
    ],
  },
  {
    eventUrl:           `${LP}/Evolution_Championship_Series/2019/PokkenDX`,
    name:               'EVO 2019',
    date:               '2019-08-03',
    location:           'Las Vegas, NV',
    prize_pool:         null,
    participants_count: 35,
    placements: [
      { rank: 1, players: ['Mewtater'] },
      { rank: 2, players: ['Twixxie'] },
      { rank: 3, players: ['Utah'] },
      { rank: 4, players: ['Coach Steve'] },
      { rank: 5, players: ['UDL', 'EveryDamnDay'] },
      { rank: 7, players: ['Juno', 'Sharkham Knight'] },
    ],
  },
  {
    eventUrl:           `${LP}/Winter_Brawl/2019/3D_Edition/PokkenDX`,
    name:               'Winter Brawl 3D 2019',
    date:               '2019-02-24',
    location:           'Essington, PA',
    prize_pool:         '$340',
    participants_count: 34,
    placements: [
      { rank: 1, players: ['Wingtide'] },
      { rank: 2, players: ['Euclase'] },
      { rank: 3, players: ['Mewtater'] },
      { rank: 4, players: ['Flegar'] },
      { rank: 5, players: ['Rokso', 'ThankSwalot'] },
      { rank: 7, players: ['Jamm', 'Son_Dula'] },
    ],
  },
  {
    eventUrl:           `${LP}/Frosty_Faustings/2019/PokkenDX`,
    name:               'Frosty Faustings XI',
    date:               '2019-01-19',
    location:           'Lombard, IL',
    prize_pool:         null,
    participants_count: 48,
    placements: [
      { rank: 1, players: ['Wingtide'] },
      { rank: 2, players: ['ThankSwalot'] },
      { rank: 3, players: ['Mewtater'] },
      { rank: 4, players: ['TEC'] },
      { rank: 5, players: ['Kamaal', 'SlippingBug'] },
      { rank: 7, players: ['TheJrJam', 'Raikel'] },
    ],
  },
  {
    eventUrl:           `${LP}/Destiny/2018`,
    name:               'Destiny 2018',
    date:               '2018-11-11',
    location:           null,
    prize_pool:         null,
    participants_count: 100,
    placements: [
      { rank: 1, players: ['Euclase'] },
      { rank: 2, players: ['Mewtater'] },
      { rank: 3, players: ['Wingtide'] },
      { rank: 4, players: ['Ashgreninja1'] },
      { rank: 5, players: ['Burnside', 'slippingbug'] },
      { rank: 7, players: ['RoksoTheSavage', 'PuppyHavoc'] },
      { rank: 9, players: ['Toasty', 'JigglerJoggler', 'GCCI∀z$NICBOOM', 'Flegar'] },
      { rank: 13, players: ['Son_Dula', 'Twixxie', 'Coach Steve', 'Hatsune Gku'] },
      { rank: 17, players: ['ThankSwalot', 'OrlandoFox', 'ALLISTER', 'Brett', 'kiri', 'Jin', 'Mins', 'StarLuigi'] },
    ],
  },
  {
    eventUrl:           `${LP}/Eye_of_the_Storm/2018`,
    name:               'Eye of the Storm 2018',
    date:               '2018-10-14',
    location:           null,
    prize_pool:         null,
    participants_count: 41,
    placements: [
      { rank: 1, players: ['ThankSwalot'] },
      { rank: 2, players: ['Twixxie'] },
      { rank: 3, players: ['Jin'] },
      { rank: 4, players: ['JrJam'] },
      { rank: 5, players: ['RoksoTheSavage', 'Kamaal'] },
      { rank: 7, players: ['Ouroboro', 'SirSpudd'] },
      { rank: 9, players: ['Eclipse', 'SKDale', 'kaloncpu57', 'Raftsmew273'] },
    ],
  },
  {
    eventUrl:           `${LP}/Summer_Jam/12/Pokken`,
    name:               'Summer Jam 12',
    date:               '2018-09-02',
    location:           null,
    prize_pool:         null,
    participants_count: 23,
    placements: [
      { rank: 1, players: ['Flegar'] },
      { rank: 2, players: ['Son_Dula'] },
      { rank: 3, players: ['SoulGuitarist'] },
      { rank: 4, players: ['ReyDelEmpire'] },
      { rank: 5, players: ['Sandman', 'Geordi'] },
      { rank: 7, players: ['Kamon', 'SuperTiso'] },
    ],
  },
  {
    eventUrl:           `${LP}/Evolution_Championship_Series/2018/PokkenDX`,
    name:               'EVO 2018',
    date:               '2018-08-03',
    location:           'Las Vegas, NV',
    prize_pool:         null,
    participants_count: 52,
    placements: [
      { rank: 1, players: ['Twixxie'] },
      { rank: 2, players: ['Azazel'] },
      { rank: 3, players: ['Allister'] },
      { rank: 4, players: ['KalonCPU57'] },
      { rank: 5, players: ['ThunderGriffin', 'Niko'] },
      { rank: 7, players: ['WonderChef', 'Son_Dula'] },
    ],
  },
  {
    eventUrl:           `${LP}/Frosty_Faustings/2018/PokkenDX`,
    name:               'Frosty Faustings X',
    date:               '2018-01-21',
    location:           'Lombard, IL',
    prize_pool:         null,
    participants_count: 51,
    placements: [
      { rank: 1, players: ['slippingbug'] },
      { rank: 2, players: ['Twixxie'] },
      { rank: 3, players: ['Kino'] },
      { rank: 4, players: ['Toasty'] },
      { rank: 5, players: ['ThankSwalot', 'H2'] },
      { rank: 7, players: ['Bolimar', 'Thulius'] },
    ],
  },
  {
    eventUrl:           `${LP}/GENESIS/5/PokkenDX`,
    name:               'GENESIS 5',
    date:               '2018-01-20',
    location:           'Oakland, CA',
    prize_pool:         '$320',
    participants_count: 32,
    placements: [
      { rank: 1, players: ['ALLISTER'] },
      { rank: 2, players: ['Mewtater'] },
      { rank: 3, players: ['Nightshade'] },
      { rank: 4, players: ['P-@jigglypuff'] },
      { rank: 5, players: ['Couch', 'BadIntent'] },
      { rank: 7, players: ['McDareth', 'Jayy'] },
    ],
  },
  {
    eventUrl:           `${LP}/NEC/18/PokkenDX`,
    name:               'Northeast Championship 18',
    date:               '2017-12-15',
    location:           'King of Prussia, PA',
    prize_pool:         '$1,540',
    participants_count: 54,
    placements: [
      { rank: 1, players: ['Azazel'] },
      { rank: 2, players: ['slippingbug'] },
      { rank: 3, players: ['ELM'] },
      { rank: 4, players: ['Toasty'] },
      { rank: 5, players: ['Twixxie', 'RoksoTheSavage'] },
      { rank: 7, players: ['ALLISTER', 'ThankSwalot'] },
      { rank: 9, players: ['Bolimar', 'Thulius', 'Uho (Usahon)', 'Raikel'] },
      { rank: 13, players: ['Deity Light', 'SoulGuitarist', 'Flegar', 'Oreo'] },
    ],
  },
  {
    eventUrl:           `${LP}/Final_Boss/2017`,
    name:               'Final Boss 2017',
    date:               '2017-10-29',
    location:           'Newark, NJ',
    prize_pool:         '$3,440',
    participants_count: 94,
    placements: [
      { rank: 1, players: ['RoksoTheSavage'] },
      { rank: 2, players: ['ThankSwalot'] },
      { rank: 3, players: ['Kukkii'] },
      { rank: 4, players: ['Son_Dula'] },
      { rank: 5, players: ['Twixxie', 'Flegar'] },
      { rank: 7, players: ['SoulGuitarist', 'Coach Steve'] },
    ],
  },
  {
    eventUrl:           `${LP}/Evolution_Championship_Series/2017/Pokken`,
    name:               'EVO 2017',
    date:               '2017-07-16',
    location:           'Las Vegas, NV',
    prize_pool:         null,
    participants_count: 53,
    placements: [
      { rank: 1, players: ['Suicune Master'] },
      { rank: 2, players: ['SuperTurboRyan'] },
      { rank: 3, players: ['Allister'] },
      { rank: 4, players: ['KojiKOG'] },
      { rank: 5, players: ['WonderChef', 'CidFox'] },
      { rank: 7, players: ['RoyIsOurBoy', 'NG-Obscure'] },
    ],
  },
  {
    eventUrl:           `${LP}/Community_Effort_Orlando/2017/Pokken`,
    name:               'CEO 2017',
    date:               '2017-06-17',
    location:           'Orlando, FL',
    prize_pool:         null,
    participants_count: 121,
    placements: [
      { rank: 1, players: ['Slippingbug'] },
      { rank: 2, players: ['Double'] },
      { rank: 3, players: ['Allister'] },
      { rank: 4, players: ['Toasty'] },
      { rank: 5, players: ['Suicune Master', 'MeLo'] },
      { rank: 7, players: ['BadIntent', 'Zyflair'] },
    ],
  },
  {
    eventUrl:           `${LP}/NorCal_Regionals/2017/Pokken`,
    name:               'NorCal Regionals 2017',
    date:               '2017-04-16',
    location:           null,
    prize_pool:         null,
    participants_count: 32,
    placements: [
      { rank: 1, players: ['Twixxie'] },
      { rank: 2, players: ['Zyflair'] },
      { rank: 3, players: ['Swillo'] },
      { rank: 4, players: ['Suicune Master'] },
      { rank: 5, players: ['Savvy', 'Zyril'] },
      { rank: 7, players: ['WhiteyWhite', 'Ouroboro'] },
    ],
  },
  {
    eventUrl:           `${LP}/Final_Round/20/Pokken`,
    name:               'Final Round 20',
    date:               '2017-03-12',
    location:           'Atlanta, GA',
    prize_pool:         null,
    participants_count: 106,
    placements: [
      { rank: 1, players: ['Thulius'] },
      { rank: 2, players: ['Coach Steve'] },
      { rank: 3, players: ['Rasenryu'] },
      { rank: 4, players: ['Double'] },
      { rank: 5, players: ['Tronzilla', 'ThatOneGuy'] },
      { rank: 7, players: ['Helios42', 'Fosh'] },
    ],
  },
  {
    eventUrl:           `${LP}/Frosty_Faustings/2017/Pokken`,
    name:               'Frosty Faustings IX',
    date:               '2017-01-27',
    location:           'Elmhurst, IL',
    prize_pool:         '$270',
    participants_count: 27,
    placements: [
      { rank: 1, players: ['Suicune Master'] },
      { rank: 2, players: ['Thulius'] },
      { rank: 3, players: ['Rasenryu'] },
      { rank: 4, players: ['slippingbug'] },
      { rank: 5, players: ['Oreo', 'RoksoTheSavage'] },
      { rank: 7, players: ['Toasty', 'ThankSwalot'] },
      { rank: 9, players: ['Kukkii', 'Mins', 'Deity Light', 'SoulGuitarist'] },
      { rank: 13, players: ['Twixxie', 'Eclipse', 'Coach Steve', 'Raikel'] },
    ],
  },
  {
    eventUrl:           `${LP}/Evolution_Championship_Series/2016/Pokken`,
    name:               'EVO 2016',
    date:               '2016-07-16',
    location:           'Las Vegas, NV',
    prize_pool:         '$21,800',
    participants_count: 1180,
    placements: [
      { rank: 1, players: ['Tonosama'] },
      { rank: 2, players: ['buntan'] },
      { rank: 3, players: ['Swillo'] },
      { rank: 4, players: ['Potetin'] },
      { rank: 5, players: ['Suicune Master', 'Bosshog'] },
      { rank: 7, players: ['KojiKOG', 'Thulius'] },
    ],
  },
  {
    eventUrl:           `${LP}/DreamHack/2016/Summer/Pokken/Master`,
    name:               'DreamHack Summer 2016',
    date:               '2016-06-19',
    location:           'Jönköping',
    prize_pool:         '$10,000',
    participants_count: 48,
    placements: [
      { rank: 1, players: ['AngelDarksong'] },
      { rank: 2, players: ['Justinpig'] },
      { rank: 3, players: ['Schiggy'] },
      { rank: 4, players: ['Gwanyue'] },
      { rank: 5, players: ['Dark', 'Humpe'] },
      { rank: 7, players: ['Gallivantz', 'TearNine'] },
    ],
  },
];

async function main() {
  console.log(`\nNeos City — offline placements backfill`);
  console.log(`Backend:    ${BACKEND_URL}`);
  console.log(`Events:     ${EVENTS.length}\n`);

  try {
    await axios.get(`${BACKEND_URL}/api/tournaments?is_offline=true`);
  } catch (err) {
    console.error(`Cannot reach backend at ${BACKEND_URL}. Is it running?`);
    process.exit(1);
  }

  let ok = 0, failed = 0;
  for (const ev of EVENTS) {
    process.stdout.write(`  ${ev.name.padEnd(38)} `);
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/tournaments/import-liquipedia-placements`,
        ev,
        { headers: { 'x-admin-token': ADMIN_TOKEN } }
      );
      console.log(`✓ ${res.data.placements_inserted} placements (${res.data.participants} entrants)`);
      ok++;
    } catch (err) {
      console.log(`✗ ${err.response?.data?.error || err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Imported ${ok}, failed ${failed}.`);
  if (failed === 0) {
    console.log('Run `node recalculate_elo.js` to refresh per-player offline tier stats.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err.response?.data || err.message);
  process.exit(1);
});
