// KomuMiru：走った記録・着いたときのまとめ・記録の一覧・GPX・まとめて控える（版10）
// ・ナビ中だけ位置を記録する（recStart → recPoint → recFinish）。保存先はこの端末の IndexedDB「komumiru」だけ
//   （ほかのミルシリーズと共有している localStorage を圧迫しないため）。どこにも送らない
// ・途中の記録は30秒ごとに下書き（draft）として残し、30分以内の「ナビの再開」ではそのまま続ける
// ・到着か停止で、1km以上または3分以上走っていれば記録として残し、まとめのカードを出す（運転中は出さない）
// ・記録は新しい順に100回分まで（LOG_MAX）。古いものから消す
(window.KOMU_FV = window.KOMU_FV || {}).log = 10;

const LOG_DB = 'komumiru', LOG_MAX = 100, DRAFT_MIN = 30;
const SLOW_KMH = 10;       // これより遅い間を「のろのろ・停止」に数える
const PT_STEP_M = 50, PT_STEP_S = 20; // 走った道の点：50m 動くか20秒たったら1つ
const GAP_S = 60, GAP_M = 500;        // これ以上あいたら「途切れ」（画面を消していたなど）

// ---------- IndexedDB（ブラウザの中の大きめのデータベース） ----------
let logDbP = null;
function logDb() {
  if (logDbP) return logDbP;
  logDbP = new Promise((ok, ng) => {
    if (!window.indexedDB) { ng(new Error('この端末では記録を保存できません（IndexedDB が使えません）')); return; }
    const rq = indexedDB.open(LOG_DB, 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('drives')) db.createObjectStore('drives', {keyPath: 'id'});
      if (!db.objectStoreNames.contains('draft')) db.createObjectStore('draft', {keyPath: 'k'});
    };
    rq.onsuccess = () => ok(rq.result);
    rq.onerror = () => ng(rq.error || new Error('記録の保存場所を開けません'));
  });
  logDbP.catch(() => { logDbP = null; });
  return logDbP;
}
function idb(store, mode, fn) {
  return logDb().then(db => new Promise((ok, ng) => {
    const tx = db.transaction(store, mode), st = tx.objectStore(store);
    let out; const r = fn(st);
    if (r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => ok(out);
    tx.onerror = () => ng(tx.error || new Error('保存できませんでした'));
    tx.onabort = () => ng(tx.error || new Error('保存できませんでした'));
  }));
}
const allDrives = () => idb('drives', 'readonly', st => st.getAll()).then(a => (a || []).sort((x, y) => y.id - x.id));
const putDrive = d => idb('drives', 'readwrite', st => st.put(d));
const delDrive = id => idb('drives', 'readwrite', st => st.delete(id));
function logSaveErr(e, what) {
  const m = e && e.name === 'QuotaExceededError' ? '保存場所がいっぱいです。古い記録を削除してください' : (e && e.message) || e;
  showErr(`${what}を保存できませんでした（${m}）`);
}
// 100回を超えたら古いものから消す
async function trimDrives() {
  const a = await allDrives();
  for (const d of a.slice(LOG_MAX)) await delDrive(d.id);
}

// ---------- 記録をとる ----------
let rec = null, recLastFix = null, recDraftTimer = null;
function recNew() {
  const t = Date.now();
  return {id: t, t0: t, t1: t, from: placeName(pos), to: destName || '地図で指定した場所', toP: dest ? dest.slice() : null,
    dist: 0, mw: 0, gen: 0, slow: 0, judge: 0, prop: 0, sw: 0, gain: 0,
    ics: [], facs: [], gap: false, arrived: false, kind: null, pts: []};
}
// 出発地の名前：お気に入りの300m以内ならその名前
function placeName(p) {
  if (!p) return '出発地';
  let best = null;
  (typeof favs !== 'undefined' ? favs : []).forEach(f => { const d = distM(p, f.p); if (d < 300 && (!best || d < best.d)) best = {name: f.name, d}; });
  return best ? best.name : '出発地';
}
async function recStart(opts) {
  opts = opts || {};
  let d = null;
  try { d = await idb('draft', 'readonly', st => st.get('cur')); } catch (e) {}
  const fresh = d && d.rec && Date.now() - d.rec.t1 < DRAFT_MIN * 60000;
  if (opts.resume && fresh) {                                   // 再開：前の記録の続き（閉じていた間は直線でつなぐ）
    rec = d.rec; const lp = rec.pts[rec.pts.length - 1];
    recLastFix = lp ? {p: [lp[0], lp[1]], t: rec.t1} : null;
  }
  else {
    if (d && d.rec) await recSave(d.rec, false);                // 閉じたままになっていた記録は残してから
    rec = recNew();
  }
  rec.to = destName || rec.to; rec.toP = dest ? dest.slice() : rec.toP;
  clearInterval(recDraftTimer); recDraftTimer = setInterval(recDraft, 30000);
  recDraft();
}
function recDraft() {
  if (!rec) return;
  idb('draft', 'readwrite', st => st.put({k: 'cur', rec})).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (document.hidden) recDraft(); });
window.addEventListener('pagehide', recDraft);

// 位置が届くたびに（ナビ中だけ）
function recPoint(c) {
  if (!rec || !navOn || !pos) return;
  const acc = c && c.accuracy, now = Date.now();
  if (acc !== undefined && acc !== null && acc > 100) return; // 粗すぎる位置は使わない
  const p = pos.slice(), last = recLastFix;
  if (last) {
    const dt = (now - last.t) / 1000, dm = distM(last.p, p);
    if (dt <= 0) return;
    if (dm / dt > 70) return;                                  // 時速250km超＝位置の飛び
    const kmh = (c && typeof c.speed === 'number' && c.speed >= 0) ? c.speed * 3.6 : dm / dt * 3.6;
    if (dt <= 30 && kmh < SLOW_KMH) rec.slow += dt;
    if (dt > GAP_S && dm > GAP_M) rec.gap = true;
    rec.dist += dm;
    const k = recKind(p) || rec.kind || 'gen';
    if (k === 'mw') rec.mw += dm; else rec.gen += dm;
    recIc(k, p);
  } else rec.kind = rec.kind || recKind(p);
  recLastFix = {p, t: now};
  rec.t1 = now;
  const lp = rec.pts[rec.pts.length - 1];
  const sec = Math.round((now - rec.t0) / 1000);
  if (!lp || distM([lp[0], lp[1]], p) >= PT_STEP_M || sec - lp[2] >= PT_STEP_S)
    rec.pts.push([Number(p[0].toFixed(5)), Number(p[1].toFixed(5)), sec]);
  recFacs(p);
}
// 今いる所が高速か一般道か：ルートから60m以内のときだけ、そのルートの区間の種類で決める
function recKind(p) {
  if (!active || !active.mw || !active.coords) return null;
  const n = nearest(active.coords, p);
  if (n.d > 60) return null;
  return active.mw[n.i] ? 'mw' : 'gen';
}
// 高速に乗った・降りたを、そのときの入口・出口の名前で残す
function recIc(k, p) {
  if (k === rec.kind) return;
  if (k === 'mw') {
    const e = active && typeof entryOf === 'function' ? entryOf(active) : null;
    rec.ics.push({in: (e && e.name) || nearFacName(p, ['IC', '料金所']) || null, out: null});
  } else if (rec.kind === 'mw') {
    let last = rec.ics[rec.ics.length - 1];
    if (!last) { last = {in: null, out: null}; rec.ics.push(last); }
    last.out = nearFacName(p, ['IC', '料金所']) || nearIcsName(p) || null;
  }
  rec.kind = k;
}
function nearFacName(p, types) {
  let best = null;
  ((active && active.fac) || []).forEach(f => {
    if (!types.includes(f.type) || !f.p) return;
    const d = distM(p, f.p); if (d < 3000 && (!best || d < best.d)) best = {name: f.name, d};
  });
  return best ? best.name : null;
}
function nearIcsName(p) {
  let best = null;
  (typeof ics !== 'undefined' ? ics : []).forEach(ic => { const d = distM(p, ic.p); if (d < 3000 && (!best || d < best.d)) best = {name: ic.name, d}; });
  return best ? best.name : null;
}
// 通り過ぎた JCT・SA・PA（ハイウェイモードの施設で、そばを通ったもの）
function recFacs(p) {
  ((active && active.fac) || []).forEach(f => {
    if (!f.p || !['JCT', 'SA', 'PA'].includes(f.type)) return;
    if (rec.facs.includes(f.name)) return;
    if (distM(p, f.p) < 250) rec.facs.push(f.name);
  });
}
// 回数：judge（判定を押した）／prop（提案が出た）
function recCount(k) { if (rec && navOn) rec[k] = (rec[k] || 0) + 1; }
// 切り替えた：そのときの「約○分早く着く」を足す
function recSwitch(min) { if (!rec || !navOn) return; rec.sw++; if (min > 0) rec.gain += min; }

// 到着・停止で
async function recFinish(arrivedNow) {
  clearInterval(recDraftTimer); recDraftTimer = null;
  const r = rec; rec = null; recLastFix = null;
  try { await idb('draft', 'readwrite', st => st.delete('cur')); } catch (e) {}
  if (!r) return;
  r.arrived = !!arrivedNow;
  const saved = await recSave(r, true);
  if (saved) { showSummary(saved, true); renderLog(); }
}
// 記録として残す（短すぎるものは残さない）。残したら記録を返す
async function recSave(r, warn) {
  if (!r || (r.dist < 1000 && r.t1 - r.t0 < 3 * 60000)) return null;
  const out = Object.assign({}, r); delete out.kind;
  out.gain = Math.round(out.gain); out.slow = Math.round(out.slow); out.dist = Math.round(out.dist);
  out.mw = Math.round(out.mw); out.gen = Math.round(out.gen);
  try { await putDrive(out); await trimDrives(); return out; }
  catch (e) { if (warn) logSaveErr(e, '走った記録'); return null; }
}
// 開いたとき：30分を過ぎた下書き（閉じたままになっていた記録）は、記録として残しておく
async function recSweep() {
  try {
    const d = await idb('draft', 'readonly', st => st.get('cur'));
    if (d && d.rec && Date.now() - d.rec.t1 >= DRAFT_MIN * 60000) {
      await idb('draft', 'readwrite', st => st.delete('cur'));
      await recSave(d.rec, false);
    }
  } catch (e) {}
}

// ---------- 表示の道具 ----------
const WD = '日月火水木金土';
function dDate(t) { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; }
function dTime(t) { return new Date(t).toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}); }
function dDur(sec) { const m = Math.max(0, Math.round(sec / 60)); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分`; }
function dKm(m) { return m >= 10000 ? Math.round(m / 1000) + 'km' : (m / 1000).toFixed(1) + 'km'; }
function icLine(r) {
  return (r.ics || []).filter(x => x.in || x.out).map(x => `${x.in || '（入口不明）'} → ${x.out || '（出口不明）'}`).join('、');
}

// ---------- 着いたときのまとめ（カード） ----------
let sumShown = null;
function showSummary(r, fresh) {
  sumShown = r;
  const sec = (r.t1 - r.t0) / 1000, kmh = sec > 0 ? r.dist / sec * 3.6 : 0;
  const mwP = r.dist > 0 ? Math.round(r.mw / (r.mw + r.gen || 1) * 100) : 0;
  let gainTxt;
  if (r.gain > 0) gainTxt = `<div class="sGain">提案に乗って <b>約${r.gain}分</b> 早く着いた見込み</div><div class="small">切り替えたときに出ていた「約○分早く着きます」の合計です（Mapbox の見積もりにもとづく目安）</div>`;
  else if (r.sw > 0) gainTxt = `<div class="sGain">ルートを${r.sw}回切り替えました</div>`;
  else gainTxt = `<div class="sGain">判定${r.judge}回・提案${r.prop ? r.prop + '回' : 'はなし'}${!r.prop ? '（このままが最善でした）' : '（このまま走りました）'}</div>`;
  const ic = icLine(r);
  $('sumCard').innerHTML = `
    <div class="sHead"><b>${fresh ? (r.arrived ? 'おつかれさまでした' : 'ナビを止めました') : dDate(r.t0) + ' の記録'}</b><button class="x" id="sumX" aria-label="閉じる">×</button></div>
    <div class="sRoute">${esc(r.from)} → ${esc(r.to)}<span class="small">　${dDate(r.t0)} ${dTime(r.t0)}〜${dTime(r.t1)}</span></div>
    <div class="sNums"><div><b>${dKm(r.dist)}</b><span>距離</span></div><div><b>${dDur(sec)}</b><span>時間</span></div><div><b>${Math.round(kmh)}</b><span>平均 km/h</span></div></div>
    <div class="sBar" title="高速と一般道"><i style="width:${mwP}%"></i></div>
    <div class="sBarL"><span>高速 ${dKm(r.mw)}</span><span>一般道 ${dKm(r.gen)}</span></div>
    ${ic ? `<div class="sLine">🛣 ${esc(ic)}</div>` : ''}
    ${r.facs && r.facs.length ? `<div class="sLine small">通過：${esc(r.facs.slice(0, 8).join('・'))}${r.facs.length > 8 ? ' ほか' : ''}</div>` : ''}
    <div class="sLine">🐢 のろのろ・停止 ${dDur(r.slow)}<span class="small">（時速${SLOW_KMH}km未満。信号待ちも入ります）</span></div>
    ${gainTxt}
    ${r.gap ? '<div class="small">※ 画面を消していたなどで記録が途切れた所は、直線でつないで数えています</div>' : ''}
    <div class="sBtns"><button id="sumGpx">GPXで書き出す</button>${fresh ? '' : '<button id="sumDel">削除</button>'}<button id="sumClose" class="primary">閉じる</button></div>`;
  document.body.classList.add('sum');
  $('sumX').onclick = $('sumClose').onclick = hideSummary;
  $('sumGpx').onclick = () => saveGpx(r);
  if ($('sumDel')) $('sumDel').onclick = async () => {
    if (!confirm(`${dDate(r.t0)} ${esc(r.to)} の記録を削除しますか？`)) return;
    try { await delDrive(r.id); } catch (e) { showErr('削除できませんでした'); return; }
    hideSummary(); renderLog();
  };
  drawTrack(r);
}
function hideSummary() {
  document.body.classList.remove('sum'); sumShown = null;
  if (map && map.getSource && map.getSource('drive')) setData('drive', []);
}
// 走った道を地図に描いて、全体が見えるように寄せる
function drawTrack(r) {
  if (!map || !map.getSource || !map.getSource('drive')) return;
  const c = (r.pts || []).map(p => [p[0], p[1]]);
  if (c.length < 2) { setData('drive', []); return; }
  setData('drive', [{type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: c}}]);
  if (typeof setFollow === 'function') try { setFollow(false); } catch (e) {}
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  c.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
  try { map.fitBounds([[x0, y0], [x1, y1]], {padding: {top: 40, bottom: 40, left: 40, right: 40}, duration: 800, bearing: 0, pitch: 0}); } catch (e) {}
}
function addTrackLayer() {
  if (!map || !map.addSource || (map.getSource && map.getSource('drive'))) return;
  try {
    map.addSource('drive', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    map.addLayer({id: 'drive', type: 'line', source: 'drive', layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {'line-color': '#a9502b', 'line-width': 5, 'line-opacity': 0.9, 'line-emissive-strength': 1}});
  } catch (e) {}
}

// ---------- GPX（位置の記録の標準的なファイル形式）で書き出す ----------
function gpxOf(r) {
  const x = s => String(s).replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'}[c]));
  const pts = (r.pts || []).map(p => `<trkpt lat="${p[1]}" lon="${p[0]}"><time>${new Date(r.t0 + p[2] * 1000).toISOString()}</time></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="KomuMiru" xmlns="http://www.topografix.com/GPX/1/1">\n`
    + `<metadata><name>${x(r.from + ' → ' + r.to)}</name><time>${new Date(r.t0).toISOString()}</time></metadata>\n`
    + `<trk><name>${x(r.from + ' → ' + r.to)}</name><type>driving</type><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>\n`;
}
function stamp(t) { const d = new Date(t), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`; }
function download(name, text, type) {
  try {
    const url = URL.createObjectURL(new Blob([text], {type}));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    return true;
  } catch (e) { showErr('書き出せませんでした（' + e.message + '）'); return false; }
}
function saveGpx(r) {
  if (!r.pts || r.pts.length < 2) { showErr('この記録には走った道の点がありません'); return; }
  if (download(`komumiru_${stamp(r.t0)}.gpx`, gpxOf(r), 'application/gpx+xml')) showErr('GPXを書き出しました（ダウンロードのフォルダ）');
}

// ---------- 記録の一覧（📊比較・記録のタブ） ----------
let logLimit = 20;
async function renderLog() {
  const box = $('logList'); if (!box) return;
  let a;
  try { a = await allDrives(); } catch (e) { box.innerHTML = `<div class="small">${esc(e.message || '記録を読めません')}</div>`; $('logMonth').textContent = ''; return; }
  const now = new Date(), ym = d => { const x = new Date(d); return x.getFullYear() * 12 + x.getMonth(); };
  const mon = a.filter(r => ym(r.t0) === ym(now));
  $('logMonth').textContent = a.length ? `${now.getMonth() + 1}月：${mon.length}回・${dKm(mon.reduce((s, r) => s + r.dist, 0))}` + (mon.some(r => r.gain) ? `・早く着いた見込み 約${mon.reduce((s, r) => s + (r.gain || 0), 0)}分` : '') : '';
  if (!a.length) { box.innerHTML = '<div class="small">まだ記録がありません。ナビで1km以上（または3分以上）走ると、ここに残ります。</div>'; return; }
  box.innerHTML = a.slice(0, logLimit).map(r => `<button class="logRow" data-log="${r.id}">
      <span class="lD">${dDate(r.t0)} ${dTime(r.t0)}</span>
      <span class="lR">${esc(r.from)} → ${esc(r.to)}</span>
      <span class="lN">${dKm(r.dist)}・${dDur((r.t1 - r.t0) / 1000)}${r.gain ? `・<b>約${r.gain}分早く</b>` : ''}${r.gap ? '・途切れあり' : ''}</span></button>`).join('')
    + (a.length > logLimit ? `<button id="logMore">もっと見る（全${a.length}回）</button>` : '');
  box.querySelectorAll('[data-log]').forEach(b => b.onclick = () => { const r = a.find(x => String(x.id) === b.dataset.log); if (r) showSummary(r, false); });
  if ($('logMore')) $('logMore').onclick = () => { logLimit += 50; renderLog(); };
}

// ---------- まとめて控える（書き出し・読み込み） ----------
const BK_KEYS = ['navi_cmp', 'navi_theme', 'navi_view', 'navi_help', 'navi_split', 'navi_split_drive'];
async function exportAll() {
  let drives = [];
  try { drives = await allDrives(); } catch (e) {}
  const settings = {};
  BK_KEYS.forEach(k => { const v = lsGetStr(k, null); if (v !== null) settings[k] = v; });
  const data = {app: 'KomuMiru', kind: 'hikae', v: 1, at: new Date().toISOString(), ver: window.KOMU_V,
    ics, favs, settings, drives};
  if (download(`komumiru_hikae_${stamp(Date.now())}.json`, JSON.stringify(data), 'application/json'))
    $('bkMsg').textContent = `書き出しました：出口${ics.length}・お気に入り${favs.length}・記録${drives.length}回（ダウンロードのフォルダ）`;
}
async function importAll(file) {
  let d;
  try { d = JSON.parse(await file.text()); } catch (e) { showErr('読み込めない形式です（KomuMiru の控えのファイルを選んでください）'); return; }
  if (!d || d.app !== 'KomuMiru' || d.kind !== 'hikae') { showErr('KomuMiru の控えのファイルではありません'); return; }
  const same = (a, b) => a && b && Array.isArray(a.p) && Array.isArray(b.p) && a.name === b.name && distM(a.p, b.p) < 30;
  let nIc = 0, nFav = 0, nDr = 0, nSkip = 0;
  (Array.isArray(d.ics) ? d.ics : []).forEach(x => { if (x && x.name && Array.isArray(x.p) && !ics.some(y => same(x, y))) { ics.push({name: x.name, p: x.p}); nIc++; } });
  (Array.isArray(d.favs) ? d.favs : []).forEach(x => {
    if (!x || !x.name || !Array.isArray(x.p) || favs.some(y => same(x, y))) return;
    if (favs.length >= FAV_MAX) { nSkip++; return; }
    favs.push({name: x.name, p: x.p}); nFav++;
  });
  if (nIc) saveIcs();
  if (nFav) saveFavs();
  const s = d.settings || {};
  BK_KEYS.forEach(k => { if (typeof s[k] === 'string') lsSetStr(k, s[k]); });
  try {
    const have = new Set((await allDrives()).map(r => r.id));
    for (const r of (Array.isArray(d.drives) ? d.drives : [])) {
      if (!r || typeof r.id !== 'number' || have.has(r.id) || !Array.isArray(r.pts)) continue;
      await putDrive(r); nDr++;
    }
    await trimDrives();
  } catch (e) { logSaveErr(e, '読み込んだ記録'); }
  $('bkMsg').textContent = `読み込みました：出口${nIc}・お気に入り${nFav}・記録${nDr}回を追加${nSkip ? `（お気に入りは20件までのため${nSkip}件は入れていません）` : ''}。設定は控えの値にそろえました（画面は開き直すと反映されます）。`;
  renderLog();
}

// ---------- 起動 ----------
function initLog() {
  $('bkExport').onclick = exportAll;
  $('bkImport').onclick = () => $('bkFile').click();
  $('bkFile').onchange = () => { const f = $('bkFile').files[0]; if (f) importAll(f); $('bkFile').value = ''; };
  if (map && map.on) {
    if (map.loaded && map.loaded() && map.isStyleLoaded && map.isStyleLoaded()) addTrackLayer();
    map.on('load', addTrackLayer);
    map.on('style.load', addTrackLayer);
  }
  // 下のタブを押したら、まとめのカードは閉じる（タブの中身が見えるように）
  document.querySelectorAll('.tb').forEach(b => b.addEventListener('click', () => { if (document.body.classList.contains('sum')) hideSummary(); }));
  recSweep().then(renderLog);
}
