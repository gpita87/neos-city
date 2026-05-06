// ═══════════════════════════════════════════════════════════════════════════
// NEOS CITY — Batch Import Console Script
// Paste this entire block into the browser console on http://localhost:5173
// It sends all 518 harvested tournament slugs to the batch-import endpoint
// in chunks of 50, waits between chunks to avoid overwhelming the API.
// ═══════════════════════════════════════════════════════════════════════════

// 518 slugs total
const ALL_SLUGS = ['6rn5l0oz', '82g5sj9t', '8rd0p4mu', '4ly9e8mw', 'zesfy2jd', 'kvj0fnt9', 'z6rqwyd3', 'mmwvum33', 'isw6hzxe', 'jf1802xb', '93s6q8w5', 'hqzxffwe', '6hgw8m9i', 'clytogvf', 'y6cawhdp', 'toc9a1yr', 'jad0qvxu', 'f3jr3xzj', 'twutzsu9', '1khl8vbr', 'oduymhkp', 'jv8f5nwj', 'my35wqzw', 'd75sb2cd', 'flryv3ww', 'xq010u08', 'v0biors8', 'hdl9o2xo', '8b3n4kyl', 'u7p6x2yi', '74i1kyfm', 'nd8d4g0w', 'sg17u4tq', 'eqrf4vch', 'krdorycu', '4sjnajqs', 'x02jfpc6', 'k2k33kqb', '7tlqon2y', '3r2vol2f', 'c2cm5ht6', 'mbj5wjcn', '94hcayv7', 'z3jb1nkp', '1wvwi3ra', 'x61ksx3h', 'ko1848yx', 'iqmg386w', 'yyj3exuk', 'hpg0lvq8', 'ivxtctwz', 'u85klbwz', 'cqhwj8c1', 'uay3a33h', 'w9usslvz', '3gr1vu2e', 's89spuxp', '69yxj2a5', 'kb8lm3ih', '8ia36nwt', 'u1iuz9py', 'm1yj5ray', '2t68tnka', 's40oykt', 'crfvy5fb', 'x4ui2ia5', 'akozf8qu', 'hpiqax54', 'dpnsx5ou', 'pckiplxv', 'f8cjnl5w', 'wvrn9ftp', 'i7x7agrg', 'egztqfve', 'm81fev2l', 'y8za5717', 'jrl3gymx', 'vholj7ek', 'h5347985', 'xxn6wdhk', 'u5ceglzp', 'pwesm5c8', 'eotrna13', '4dzzco06', 'oh5yb63q', 'nq44jl2e', 'qsrin1wq', 'njz9mn07', 'cisz8kfx', '9zmnz5y', '1dfa8iq7', 'i4hfqksd', '89xcv1lw', 'g296hqes', 'h5u97ygo', 'l6kksvau', 'l53jgiln', 'e5mkyqdb', 'ggb0uisi', 'zsidt5dh', 'hrbamtj2', 'w8ppethq', '1ub6811t', 'k2evlj5p', 'vgb5pxs6', 'oujlvrtm', 'la2dsc3o', '7n2r6dzo', '8smug8ug', '7z64sycq', 'azy8oqwi', 'yjbgw7wk', '6m3jtq2d', 'b30tdmsv', 'wkfvhujn', 'if0bkzu3', 'ekh2acx1', 'wclziiyz', 'en7kcpyt', 'tkoavl1o', 'ol00gnqd', '1keo32pi', 'l4i17xkr', 'wybkrw8t', '5xgscdwd', 'gsnql8uk', '1h911eql', 'gcw1lqek', '4szdcce8', 'e265hdtm', '4tq9i3z5', '3jx59t5w', 'ezfq7l3s', 'k884mrxn', 'h5wvsoer', 'zg5nnvc1', 'ou517slo', '3hllpy2q', '81gneuxt', '194xc4dj', 'zhhzh7wr', 'ra32r33c', 'iqsr8bhm', '1nlukc9', 'wnm2hnfq', 'vba3zubh', 'fki9mxxj', 'g8gflqyj', 'bhle5zcf', 'juwh0098', 'v9vubbon', 'tizf8kxd', 'pym0w50o', 'iqdo0oik', '81rkahvi', '6rmrnouq', '26nneoxt', '5b87reku', '9ladjiy9', 'kn0owyzh', '9kkix60k', 'rtgna59', '4dtlmefo', 'kbfoof88', 'r1jjzexr', 'x7oye4sg', 'u9bfolsb', 'dz4z4jmq', 'ui7gug1', 'gg2b9em5', 'udrcdxh2', 'rtgna49', 'sm4hw8ls', 'dwe9whej', 'w7osk0t2', '5zevshc2', 'lpqoe7sj', 'ftiy2wz8', 'db2amxlq', 'sjdksk94', 'eotr5', '3gtke5y9', '16smawnn', 'eap5d0p0', 'btmrj9wd', 'wxz8s9f7', 'di6arrtj', '2dpv33of', 'q5hqybkk', 'yy0wbhjz', 'co9x3jnn', '6qs02yw6', 'jqb08v0k', 'h0m9z6lk', 'r8j1shv1', 'rjpm77y8', 'e8yaemf2', 'i8l9yr0k', '4da9cwub', 'jadt7us6', 'FFC173', 'FFC171', 'FFC169', 'FFC168', 'FFC165', 'FFC164', 'FFC161', 'FFC159', 'FFC158', 'FFC155', 'FFC154', 'FFC151', 'FFC149', 'FFC147', 'FFC145', 'ffc143', 'FFC140', 'FFC138', 'FFC135', 'FFC134', 'FFC132', 'FFC130', 'FFC128', 'FFC126', 'FFC125', 'FFC122', 'FFC120', 'FFC119', 'FFC117', 'FFC116', 'FFC114_', 'FFC111_', 'FFC109', 'FFC107', 'ffc104', 'FFC102', 'FFC101', 'FFC98', 'FFC96', 'FFC93', 'FFC92', 'FFC89', 'FFC88', 'FFC85', 'FFC83', 'FFC81', 'FFC80', 'FFC79', 'ffc78', 'ffc77', 'FFC76', 'FFC75', 'ffc73', 'FFC71', 'ffc70', 'FFC68', 'FFC66', 'FFC64', 'FFC61', 'FFC35', 'FFC34', 'FFC32', 'https://quarterlyrapport.challonge.com/quar2pokken', 'FFC16', 'PokkenWeeklyReturn107', 'PokkenWeeklyReturn106', 'lcbi6jy2', 'PokkenWeeklyReturn89', 'PokkenWeeklyReturn85', 'PokkenWeeklyReturn83', 'PokkenWeeklyReturn81', 'PokkenWeeklyReturn80', 'PokkenWeeklyReturn78', 'PokkenWeeklyReturn77', 'PokkenWeeklyReturn75', 'PokkenWeeklyReturn74', 'PokkenWeeklyReturn73', 'PokkenWeeklyReturn72', 'w7owpa31', 'MGPokken1', 'PokkenWeeklyReturn70', 'PokkenWeeklyReturn64', 'PokkenWeeklyReturn60', 'PokkenWeeklyReturn56', 'PokkenWeeklyReturn31', 'PokkenWeeklyReturn27', 'https://pokkenarena.challonge.com/PEXCS3_6', 'https://pokkenarena.challonge.com/PEXCS3_5', 'PokkenWeeklyReturn26', 'PokkenWeeklyReturn24', 'https://pokkenarena.challonge.com/PEXCS3_3', 'PokkenWeeklyReturn23', 'https://pokkenarena.challonge.com/PEXCS3_2', 'PokkenWeeklyReturn21', 'PokkenWeeklyReturn19', 'PSTBOB', 'FFC221', 'rtgna58', 'PokkenWeeklyReturn48', 'PokkenWeeklyReturn38', 'RTGEU01', 'RTGEU1', 'RTGEU0', 'FFC74', 'FFC72', 'FFC69', 'FFC67', 'FFC65', 'https://quarterlyrapport.challonge.com/quar4pokken', 'FFC60', 'FFC59', 'FFC56', 'FFC55', 'FFC53', 'FFC52', 'FFC50EU', 'FFC49', 'TCC_45', 'TCC_44', 'TCC_43_RR', 'TCC_42', 'TCC_41', 'TCC_40', 'Tcc_39', 'TCC_38', 'TCC_37', 'Tcc_36', 'TCC_35', 'TCC_34', 'TCC_33RR', 'TCC_32_', 'TCC_31_', 'TCC_30_', 'TCC_29_', 'TCC_28_', 'TCC_27_', 'TCC_27_RR', 'TCC_26_', 'TCC_25_', 'TCC_24_', 'TCC_24_RR', 'TCC_23', 'TCC_23RR', 'TCC_22_', 'TCC_21_', 'TCC_20', 'TCC_19_', 'RTGEU_72', 'TCC_19_RR', 'TCC_18_', 'PBR7', 'TCC_17_', 'RTGEU72', 'TCC_17_RR', 'RTG_EU72', 'FFC200', 'zfokx8k', 'TCC_16_', 'PBR4', 'RTGEU_71', 'RTGEU71', 'PBR3', 'EotEUR7', 'TCC_15_', 'RTGEU70', 'TCC_14', 'wk8m82r3', 'FFC189', 'TCC_13_', 'TCC_11_', 'TCC_10_', 'TCC_09', 'TCC_08', 'TCC_07', 'TCC_06', 'TCC_05', 'TCC_04', 'TCC_03', 'TCC_02', 'FFC166', 'vgr8f7yp', 'TdomeR', '5a9l47cu', 'FFC106', 'FFC105', 'FFC100', 'FFC97', 'FFC63', 'FFC62', 'jfvwkpb4', '84630h3d', 'FFC54', 'FFC47', 'o9jrnu3t', 'https://quarterlyrapport.challonge.com/quar3pokken', 'FFC41', 'nce5yfr2', 'FFC39', 'FFC37', 'bouuuuh', 'FFC30', 'eqbdn08y', 'WPOPDXDB', 'FFC29', 'FFC28', 'FFC27', 'FFC25', 'FFC24', 'FFC23', 'FFC22', 'PokkenWeeklyReturn104', 'PokkenWeeklyReturn100', 'PokkenWeeklyReturn95', 'PokkenWeeklyReturn93', 'PokkenWeeklyReturn92', 'PokkenWeeklyReturn88', 'PokkenWeeklyReturn84', 'dcmgb4', 'dcmrrw3', 'dcmp36', 'dcmgb3', 'dcmp35', 'FFC260', 'dcmgb2', 'dcmp34', 'dcmgb1', 'dcmrrw2', 'FFC220', '31go78h6', 'TdomeR15', 'TdomeR13', 'TdomeR10', 'FFC181', 'dcmrrw1', 'TdomeR8', 'TdomeR7', 'TdomeR5', 'TdomeR4', 'TdomeR2', 'FFC162', 'suls060j', '52e1axlm', 'FFC144', 'FFC142', 'kkmog0br', '4w9885yf', 'FFC127', 'FFC123', 'os4bvkfm', 'FFC121', 'aps5v0mb', 'FFC112', 'FFC110', 'FFC103', 'FFC99', 'g921qze3', 'FFC91', 'FFC87', 'FFC82', 'FFC253', 'FFC250', 'FFC247', 'FFC242', 'FFC230', 'FFC229', 'FFC226', 'FFC224', 'FFC222', 'FFC216', 'FFC199', 'FFC197', 'FFC182', 'FFC174', 'FFC170', 'FFC167', 'FFC21', 'GinIsLate', 'FFC14', 'PokkenWeeklyReturnRicky2', 'PokkenWeeklyReturn103', 'PokkenChess1', 'https://pokkenarena.challonge.com/PDEXCS2_F', 'https://pokkenarena.challonge.com/pdexcs2_7', 'fizy3udu', 'o7tv5q03', 'https://pokkenarena.challonge.com/PDEXCS2_3', 'PokkenWeeklyReturn76', 'PokkenWeeklyReturnRicky', 'PokkenWeeklyReturn68', 'https://pokkenarena.challonge.com/PDEXCS1_2', 'https://pokkenarena.challonge.com/PDEXCS1_1', 'PEXCS6_1', 'oo5wnsba', 'PokkenWeeklyReturn49', 'https://pokkenarena.challonge.com/PEXCS5_7', 'https://pokkenarena.challonge.com/PEXCS5_6', 'PokkenWeeklyReturn46', 'https://pokkenarena.challonge.com/PEXCS5_4', 'PokkenWeeklyReturn45', 'https://pokkenarena.challonge.com/PEXCS5_2', 'https://pokkenarena.challonge.com/PEXCS5_1', 'PokkenWeeklyReturn41', 'PokkenWeeklyReturn40', 'https://pokkenarena.challonge.com/PEXCS4_7', 'PokkenWeeklyReturn37', 'PokkenWeeklyReturn28', 'PokkenWeeklyReturn25', 'PokkenWeeklyReturn22', 'PokkenWeeklyReturn20', 'https://pokkenarena.challonge.com/PEXCS2_8', 'PokkenWeeklyReturn18', 'PokkenWeeklyReturn17', 'PokkenWeeklyReturn16', 'PokkenWeeklyReturn15', 'https://pokkenarena.challonge.com/PEXCS2_1', 'https://pokkenarena.challonge.com/PEXC5', 'https://pokkenarena.challonge.com/PEXC4', 'https://pokkenarena.challonge.com/PEXC3'];

(async () => {
  const CHUNK_SIZE = 50;          // slugs per batch-import call
  const DELAY_MS   = 2000;        // wait between chunks (ms) to respect rate limits
  const API        = 'http://localhost:3001/api/tournaments/batch-import';
  // Paste your ADMIN_TOKEN here (the same value as backend/.env ADMIN_TOKEN).
  const ADMIN_TOKEN = '';
  if (!ADMIN_TOKEN) {
    console.error('Set ADMIN_TOKEN at the top of this script before running.');
    return;
  }

  const totals = { imported: 0, skipped: 0, errors: 0 };
  const errorLog = [];

  const chunks = [];
  for (let i = 0; i < ALL_SLUGS.length; i += CHUNK_SIZE) {
    chunks.push(ALL_SLUGS.slice(i, i + CHUNK_SIZE));
  }

  console.log(`🚀 Starting batch import: ${ALL_SLUGS.length} slugs in ${chunks.length} chunks of ${CHUNK_SIZE}`);

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    console.log(`📦 Chunk ${ci + 1}/${chunks.length} — slugs: ${chunk[0]}…${chunk[chunk.length-1]}`);

    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
        body: JSON.stringify({ urls: chunk.map(s => `https://challonge.com/${s}`) })
      });
      const data = await r.json();

      totals.imported += data.imported || 0;
      totals.skipped  += data.skipped  || 0;
      totals.errors   += (data.errors  || []).length;
      if (data.errors && data.errors.length) {
        errorLog.push(...data.errors);
      }

      console.log(`  ✅ ${data.imported} imported, ⏭️ ${data.skipped} skipped, ❌ ${(data.errors||[]).length} errors`);
    } catch (e) {
      console.error(`  ❌ Chunk ${ci + 1} fetch failed:`, e.message);
      totals.errors += chunk.length;
    }

    if (ci < chunks.length - 1) {
      console.log(`  ⏳ Waiting ${DELAY_MS}ms…`);
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`🏁 DONE — Imported: ${totals.imported} | Skipped: ${totals.skipped} | Errors: ${totals.errors}`);
  if (errorLog.length) {
    console.log('Failed slugs:', errorLog.map(e => e.slug).join(', '));
  }
  console.log('Reload the page to see the results!');
})();
