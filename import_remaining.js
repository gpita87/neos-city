/**
 * Neos City — Import Remaining 6 Tonamel Tournaments
 * Run from the neos-city root directory:
 *   node import_remaining.js
 *
 * Requires the backend to be running on localhost:3001.
 */

const http = require('http');

async function post(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost', port: 3001,
      path: '/api/tournaments/import-tonamel',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve({ raw: body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getImported() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3001/api/tournaments', res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const list = JSON.parse(body);
          resolve(new Set(list.filter(t => t.tonamel_id).map(t => t.tonamel_id)));
        } catch { resolve(new Set()); }
      });
    }).on('error', reject);
  });
}

const TOURNAMENTS = [
  {
    tonamel_id: 'Ylgyj', name: '5th Pokkén Mouse Cup Online Event',
    series: 'nezumi', date: '2024-07-20', participants_count: 13,
    matches: [
      {"matchId":"#W1-1","p1":"ねずみ","p1Score":2,"p2":"でんきていこう","p2Score":0,"winner":"ねずみ","loser":"でんきていこう"},
      {"matchId":"#W6-1","p1":"アルタ","p1Score":2,"p2":"ポポポ","p2Score":3,"winner":"ポポポ","loser":"アルタ"},
      {"matchId":"#L1-1","p1":"ひさし","p1Score":2,"p2":"バルサミコsu","p2Score":1,"winner":"ひさし","loser":"バルサミコsu"},
      {"matchId":"#L2-1","p1":"でんきていこう","p1Score":1,"p2":"きもちいい","p2Score":2,"winner":"きもちいい","loser":"でんきていこう"},
      {"matchId":"#L2-2","p1":"ホダシ","p1Score":0,"p2":"ひさし","p2Score":2,"winner":"ひさし","loser":"ホダシ"},
      {"matchId":"#L2-3","p1":"manju","p1Score":1,"p2":"ほたるび","p2Score":2,"winner":"ほたるび","loser":"manju"},
      {"matchId":"#L2-4","p1":"がにこす","p1Score":0,"p2":"ねずみ","p2Score":2,"winner":"ねずみ","loser":"がにこす"},
      {"matchId":"#L3-1","p1":"きもちいい","p1Score":2,"p2":"ひさし","p2Score":0,"winner":"きもちいい","loser":"ひさし"},
      {"matchId":"#L3-2","p1":"ほたるび","p1Score":1,"p2":"ねずみ","p2Score":2,"winner":"ねずみ","loser":"ほたるび"},
      {"matchId":"#L4-1","p1":"狐白","p1Score":2,"p2":"きもちいい","p2Score":0,"winner":"狐白","loser":"きもちいい"},
      {"matchId":"#L4-2","p1":"アルタ","p1Score":2,"p2":"ねずみ","p2Score":3,"winner":"ねずみ","loser":"アルタ"},
      {"matchId":"#L5-1","p1":"狐白","p1Score":0,"p2":"ねずみ","p2Score":2,"winner":"ねずみ","loser":"狐白"},
      {"matchId":"#GF1-1","p1":"ポポポ","p1Score":1,"p2":"ねずみ","p2Score":3,"winner":"ねずみ","loser":"ポポポ"}
    ]
  },
  {
    tonamel_id: 'hI5wE', name: '4th Pokkén Mouse Cup Online Event',
    series: 'nezumi', date: '2024-06-22', participants_count: 15,
    matches: [
      {"matchId":"#W1-1","p1":"mishan","p1Score":0,"p2":"Player99048889","p2Score":2,"winner":"Player99048889","loser":"mishan"},
      {"matchId":"#L1-1","p1":"沖田 丈9 a.k.a.タジョウ","p1Score":1,"p2":"じゅでぃ","p2Score":2,"winner":"じゅでぃ","loser":"沖田 丈9 a.k.a.タジョウ"},
      {"matchId":"#L1-2","p1":"たくと","p1Score":1,"p2":"はむむ🐹💨","p2Score":2,"winner":"はむむ🐹💨","loser":"たくと"},
      {"matchId":"#L1-3","p1":"ないと","p1Score":1,"p2":"ねずみ","p2Score":2,"winner":"ねずみ","loser":"ないと"},
      {"matchId":"#L2-1","p1":"mishan","p1Score":0,"p2":"りゅ","p2Score":2,"winner":"りゅ","loser":"mishan"},
      {"matchId":"#L2-2","p1":"アルタ","p1Score":2,"p2":"じゅでぃ","p2Score":0,"winner":"アルタ","loser":"じゅでぃ"},
      {"matchId":"#L2-3","p1":"ほたるび","p1Score":0,"p2":"はむむ🐹💨","p2Score":2,"winner":"はむむ🐹💨","loser":"ほたるび"},
      {"matchId":"#L2-4","p1":"nasu_kgy","p1Score":2,"p2":"ねずみ","p2Score":0,"winner":"nasu_kgy","loser":"ねずみ"},
      {"matchId":"#L3-1","p1":"りゅ","p1Score":0,"p2":"アルタ","p2Score":2,"winner":"アルタ","loser":"りゅ"},
      {"matchId":"#L3-2","p1":"はむむ🐹💨","p1Score":0,"p2":"nasu_kgy","p2Score":2,"winner":"nasu_kgy","loser":"はむむ🐹💨"},
      {"matchId":"#L4-1","p1":"Player99048889","p1Score":0,"p2":"アルタ","p2Score":2,"winner":"アルタ","loser":"Player99048889"},
      {"matchId":"#L4-2","p1":"きもちいい","p1Score":0,"p2":"nasu_kgy","p2Score":2,"winner":"nasu_kgy","loser":"きもちいい"},
      {"matchId":"#L5-1","p1":"アルタ","p1Score":2,"p2":"nasu_kgy","p2Score":1,"winner":"アルタ","loser":"nasu_kgy"},
      {"matchId":"#L6-1","p1":"NAOYA","p1Score":1,"p2":"アルタ","p2Score":3,"winner":"アルタ","loser":"NAOYA"}
    ]
  },
  {
    tonamel_id: 'phldt', name: 'The 3rd Pokkén Mouse Cup Online Event',
    series: 'nezumi', date: '2024-05-11', participants_count: 29,
    matches: [
      {"matchId":"#W1-1","p1":"ていとくん","p1Score":2,"p2":"あらちょ。","p2Score":0,"winner":"ていとくん","loser":"あらちょ。"},
      {"matchId":"#W7-1","p1":"ポポポ","p1Score":3,"p2":"くら/kura","p2Score":0,"winner":"ポポポ","loser":"くら/kura"},
      {"matchId":"#L1-1","p1":"Guysun","p1Score":0,"p2":"はるさま","p2Score":2,"winner":"はるさま","loser":"Guysun"},
      {"matchId":"#L1-2","p1":"manju","p1Score":0,"p2":"ねずみ","p2Score":2,"winner":"ねずみ","loser":"manju"},
      {"matchId":"#L1-3","p1":"める","p1Score":0,"p2":"バルサミコsu","p2Score":2,"winner":"バルサミコsu","loser":"める"},
      {"matchId":"#L1-4","p1":"イッシー","p1Score":0,"p2":"サバ","p2Score":2,"winner":"サバ","loser":"イッシー"},
      {"matchId":"#L1-5","p1":"nasu_kgy","p1Score":0,"p2":"みず","p2Score":2,"winner":"みず","loser":"nasu_kgy"},
      {"matchId":"#L2-1","p1":"あらちょ。","p1Score":0,"p2":"なかのたろう","p2Score":2,"winner":"なかのたろう","loser":"あらちょ。"},
      {"matchId":"#L2-2","p1":"MUTO｜ムト(｀・ω・´)","p1Score":2,"p2":"はるさま","p2Score":1,"winner":"MUTO｜ムト(｀・ω・´)","loser":"はるさま"},
      {"matchId":"#L2-3","p1":"りゅ","p1Score":2,"p2":"ねずみ","p2Score":0,"winner":"りゅ","loser":"ねずみ"},
      {"matchId":"#L2-4","p1":"はむむ","p1Score":2,"p2":"バルサミコsu","p2Score":0,"winner":"はむむ","loser":"バルサミコsu"},
      {"matchId":"#L2-5","p1":"Player99048889","p1Score":1,"p2":"ほたるび","p2Score":2,"winner":"ほたるび","loser":"Player99048889"},
      {"matchId":"#L2-6","p1":"RARAッサム＠ハッサム全1","p1Score":0,"p2":"サバ","p2Score":2,"winner":"サバ","loser":"RARAッサム＠ハッサム全1"},
      {"matchId":"#L2-7","p1":"mishan","p1Score":2,"p2":"ホダシ","p2Score":1,"winner":"mishan","loser":"ホダシ"},
      {"matchId":"#L2-8","p1":"ていとくん","p1Score":2,"p2":"みず","p2Score":1,"winner":"ていとくん","loser":"みず"},
      {"matchId":"#L3-1","p1":"なかのたろう","p1Score":0,"p2":"MUTO｜ムト(｀・ω・´)","p2Score":2,"winner":"MUTO｜ムト(｀・ω・´)","loser":"なかのたろう"},
      {"matchId":"#L3-2","p1":"りゅ","p1Score":2,"p2":"はむむ","p2Score":0,"winner":"りゅ","loser":"はむむ"},
      {"matchId":"#L3-3","p1":"ほたるび","p1Score":1,"p2":"サバ","p2Score":2,"winner":"サバ","loser":"ほたるび"},
      {"matchId":"#L3-4","p1":"mishan","p1Score":0,"p2":"ていとくん","p2Score":2,"winner":"ていとくん","loser":"mishan"},
      {"matchId":"#L4-1","p1":"あだかー","p1Score":0,"p2":"MUTO｜ムト(｀・ω・´)","p2Score":2,"winner":"MUTO｜ムト(｀・ω・´)","loser":"あだかー"},
      {"matchId":"#L4-2","p1":"烏丸　レコ","p1Score":1,"p2":"りゅ","p2Score":2,"winner":"りゅ","loser":"烏丸　レコ"},
      {"matchId":"#L4-3","p1":"NAOYA","p1Score":1,"p2":"サバ","p2Score":2,"winner":"サバ","loser":"NAOYA"},
      {"matchId":"#L4-4","p1":"Player30204719","p1Score":2,"p2":"ていとくん","p2Score":1,"winner":"Player30204719","loser":"ていとくん"},
      {"matchId":"#L5-1","p1":"MUTO｜ムト(｀・ω・´)","p1Score":2,"p2":"りゅ","p2Score":0,"winner":"MUTO｜ムト(｀・ω・´)","loser":"りゅ"},
      {"matchId":"#L5-2","p1":"サバ","p1Score":1,"p2":"Player30204719","p2Score":2,"winner":"Player30204719","loser":"サバ"},
      {"matchId":"#L6-1","p1":"iTo...│いとう","p1Score":2,"p2":"MUTO｜ムト(｀・ω・´)","p2Score":1,"winner":"iTo...│いとう","loser":"MUTO｜ムト(｀・ω・´)"},
      {"matchId":"#L6-2","p1":"アルタ","p1Score":2,"p2":"Player30204719","p2Score":1,"winner":"アルタ","loser":"Player30204719"},
      {"matchId":"#L7-1","p1":"iTo...│いとう","p1Score":2,"p2":"アルタ","p2Score":0,"winner":"iTo...│いとう","loser":"アルタ"},
      {"matchId":"#L8-1","p1":"くら/kura","p1Score":3,"p2":"iTo...│いとう","p2Score":1,"winner":"くら/kura","loser":"iTo...│いとう"}
    ]
  },
  {
    tonamel_id: 'poW16', name: 'Pokkén Mouse Cup Rookies Online Event',
    series: 'nezumi_rookies', date: '2024-04-27', participants_count: 5,
    matches: [
      {"matchId":"#W1-1","p1":"Player23773499","p1Score":0,"p2":"manju","p2Score":2,"winner":"manju","loser":"Player23773499"},
      {"matchId":"#L1-1","p1":"Player23773499","p1Score":2,"p2":"Player36904017","p2Score":0,"winner":"Player23773499","loser":"Player36904017"},
      {"matchId":"#L2-1","p1":"manju","p1Score":0,"p2":"Player23773499","p2Score":2,"winner":"Player23773499","loser":"manju"},
      {"matchId":"#L3-1","p1":"バルサミコsu","p1Score":2,"p2":"Player23773499","p2Score":3,"winner":"Player23773499","loser":"バルサミコsu"}
    ]
  },
  {
    tonamel_id: 'VgSUo', name: 'The 2nd Pokkén Mouse Cup Online Event',
    series: 'nezumi', date: '2024-03-23', participants_count: 12,
    matches: [
      {"matchId":"#W1-1","p1":"たくと","p1Score":2,"p2":"Player36904017","p2Score":0,"winner":"たくと","loser":"Player36904017"},
      {"matchId":"#L1-1","p1":"Player36904017","p1Score":0,"p2":"バルサミコsu","p2Score":2,"winner":"バルサミコsu","loser":"Player36904017"},
      {"matchId":"#L1-2","p1":"める","p1Score":0,"p2":"がにこす","p2Score":2,"winner":"がにこす","loser":"める"},
      {"matchId":"#L1-3","p1":"はむむ","p1Score":0,"p2":"ほたるび","p2Score":2,"winner":"ほたるび","loser":"はむむ"},
      {"matchId":"#L1-4","p1":"NAOYA","p1Score":1,"p2":"たくと","p2Score":2,"winner":"たくと","loser":"NAOYA"},
      {"matchId":"#L2-1","p1":"バルサミコsu","p1Score":0,"p2":"がにこす","p2Score":2,"winner":"がにこす","loser":"バルサミコsu"},
      {"matchId":"#L2-2","p1":"ほたるび","p1Score":1,"p2":"たくと","p2Score":2,"winner":"たくと","loser":"ほたるび"},
      {"matchId":"#L3-1","p1":"ポポポ","p1Score":1,"p2":"がにこす","p2Score":2,"winner":"がにこす","loser":"ポポポ"},
      {"matchId":"#L3-2","p1":"りゅ","p1Score":1,"p2":"たくと","p2Score":2,"winner":"たくと","loser":"りゅ"},
      {"matchId":"#L4-1","p1":"がにこす","p1Score":2,"p2":"たくと","p2Score":1,"winner":"がにこす","loser":"たくと"},
      {"matchId":"#L5-1","p1":"ねずみ","p1Score":0,"p2":"がにこす","p2Score":3,"winner":"がにこす","loser":"ねずみ"}
    ]
  },
  {
    tonamel_id: 'nomkp', name: 'Pokkén Mouse Cup Online Event',
    series: 'nezumi', date: '2024-02-24', participants_count: 21,
    matches: [
      {"matchId":"#W1-1","p1":"しーく","p1Score":2,"p2":"バルサミコsu","p2Score":1,"winner":"しーく","loser":"バルサミコsu"},
      {"matchId":"#L1-1","p1":"バルサミコsu","p1Score":0,"p2":"NAOYA","p2Score":2,"winner":"NAOYA","loser":"バルサミコsu"},
      {"matchId":"#L1-2","p1":"あらちょ。","p1Score":1,"p2":"はるさま","p2Score":2,"winner":"はるさま","loser":"あらちょ。"},
      {"matchId":"#L1-3","p1":"烏丸　レコ","p1Score":0,"p2":"りゅ","p2Score":2,"winner":"りゅ","loser":"烏丸　レコ"},
      {"matchId":"#L1-4","p1":"狐白","p1Score":1,"p2":"nasu_kgy","p2Score":2,"winner":"nasu_kgy","loser":"狐白"},
      {"matchId":"#L1-5","p1":"サバ","p1Score":2,"p2":"manju","p2Score":0,"winner":"サバ","loser":"manju"},
      {"matchId":"#L2-1","p1":"くら/kura","p1Score":2,"p2":"NAOYA","p2Score":0,"winner":"くら/kura","loser":"NAOYA"},
      {"matchId":"#L2-2","p1":"はるさま","p1Score":2,"p2":"りゅ","p2Score":0,"winner":"はるさま","loser":"りゅ"},
      {"matchId":"#L2-3","p1":"ていとくん","p1Score":2,"p2":"nasu_kgy","p2Score":1,"winner":"ていとくん","loser":"nasu_kgy"},
      {"matchId":"#L2-4","p1":"ほたるび","p1Score":1,"p2":"サバ","p2Score":2,"winner":"サバ","loser":"ほたるび"},
      {"matchId":"#L3-1","p1":"ホダシ","p1Score":0,"p2":"くら/kura","p2Score":2,"winner":"くら/kura","loser":"ホダシ"},
      {"matchId":"#L3-2","p1":"みさ","p1Score":0,"p2":"はるさま","p2Score":2,"winner":"はるさま","loser":"みさ"},
      {"matchId":"#L3-3","p1":"がにこす","p1Score":2,"p2":"ていとくん","p2Score":0,"winner":"がにこす","loser":"ていとくん"},
      {"matchId":"#L3-4","p1":"BlueRose","p1Score":2,"p2":"サバ","p2Score":0,"winner":"BlueRose","loser":"サバ"},
      {"matchId":"#L4-1","p1":"くら/kura","p1Score":2,"p2":"はるさま","p2Score":0,"winner":"くら/kura","loser":"はるさま"},
      {"matchId":"#L4-2","p1":"がにこす","p1Score":1,"p2":"BlueRose","p2Score":2,"winner":"BlueRose","loser":"がにこす"},
      {"matchId":"#L5-1","p1":"あだかー","p1Score":1,"p2":"くら/kura","p2Score":2,"winner":"くら/kura","loser":"あだかー"},
      {"matchId":"#L5-2","p1":"ミツバキ","p1Score":1,"p2":"BlueRose","p2Score":2,"winner":"BlueRose","loser":"ミツバキ"},
      {"matchId":"#L6-1","p1":"くら/kura","p1Score":2,"p2":"BlueRose","p2Score":0,"winner":"くら/kura","loser":"BlueRose"},
      {"matchId":"#L7-1","p1":"しーく","p1Score":1,"p2":"くら/kura","p2Score":3,"winner":"くら/kura","loser":"しーく"}
    ]
  }
];

async function main() {
  console.log('🐭 Neos City — Importing remaining 6 Tonamel tournaments\n');

  let alreadyImported;
  try {
    alreadyImported = await getImported();
    console.log(`Already in DB: ${alreadyImported.size} Tonamel tournaments`);
  } catch (e) {
    console.error('❌ Cannot reach backend at localhost:3001:', e.message);
    process.exit(1);
  }

  let imported = 0, skipped = 0, errors = 0;

  for (const t of TOURNAMENTS) {
    if (alreadyImported.has(t.tonamel_id)) {
      console.log(`⏭️  Skipping (already imported): ${t.name}`);
      skipped++;
      continue;
    }

    process.stdout.write(`⏳ ${t.name} (${t.matches.length} matches)... `);
    try {
      const result = await post(t);
      if (result.error) throw new Error(result.error);
      const winner = Object.entries(result.placements || {}).find(([, v]) => v === 1)?.[0] || '?';
      console.log(`✅  🥇 ${winner}`);
      imported++;
    } catch (e) {
      console.log(`❌ ${e.message}`);
      errors++;
    }
  }

  console.log(`\n📊 Done — imported: ${imported}, skipped: ${skipped}, errors: ${errors}`);
}

main();
