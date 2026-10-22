// KomuMiru：目的地・出口の登録・現在地・走行中の案内・開始と停止
(window.KOMU_FV = window.KOMU_FV || {}).nav = 7;

// ---------- 目的地 ----------
$('pickBtn').onclick = () => { pickMode = true; icPick = false; $('guide').textContent = '地図上の目的地をタップしてください。'; };
// 目的地の検索：まず施設・駅も探せる検索（Search Box）、だめなら住所の検索（Geocoding）
async function searchPlaces(q) {
  const prox = pos ? `&proximity=${pos[0].toFixed(5)},${pos[1].toFixed(5)}` : '';
  const qs = `q=${encodeURIComponent(q)}&country=jp&language=ja&limit=7${prox}&access_token=${TOKEN}`;
  let feats = [];
  try {
    const r = await fetch('https://api.mapbox.com/search/searchbox/v1/forward?' + qs);
    const j = await r.json();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${j.message || ''}`);
    feats = (j.features || []).map(f => ({p: f.geometry.coordinates, name: f.properties.name || '',
      sub: f.properties.full_address || f.properties.place_formatted || '', poi: f.properties.feature_type === 'poi'}));
  } catch (e) { showErr('施設の検索に失敗しました（' + e.message + '）。住所の検索で探します'); }
  if (!feats.length) {
    const j = await (await fetch('https://api.mapbox.com/search/geocode/v6/forward?' + qs.replace('limit=7', 'limit=5'))).json();
    feats = (j.features || []).map(f => ({p: f.geometry.coordinates, name: f.properties.name || '',
      sub: f.properties.full_address || f.properties.place_formatted || '', poi: false}));
  }
  return feats;
}
$('searchBtn').onclick = async () => {
  const q = $('search').value.trim(); if (!q) return;
  $('hits').innerHTML = '<div class="small">検索中…</div>';
  try {
    const feats = await searchPlaces(q); $('hits').innerHTML = '';
    feats.forEach(f => {
      const d = document.createElement('div'); d.className = 'hit';
      const b = document.createElement('b'); b.textContent = (f.poi ? '📍' : '') + f.name;
      const sm = document.createElement('div'); sm.className = 'small';
      sm.textContent = f.sub && f.sub !== f.name ? f.sub : '';
      d.append(b, sm);
      d.onclick = () => { setDest(f.p, f.name); $('hits').innerHTML = ''; };
      $('hits').appendChild(d);
    });
    if (!feats.length) $('hits').textContent = '見つかりませんでした。住所で試すか「地図で指定」を使ってください。';
  } catch (e) { $('hits').innerHTML = ''; showErr('検索エラー：' + e.message); }
};
$('search').addEventListener('keydown', e => { if (e.key === 'Enter') $('searchBtn').click(); });
// noPreview：ナビの再開のときなど、結果のカードのルートを計算しない
function setDest(p, name, noPreview) {
  dest = p; preferGeneral = false; viaEntry = null; destName = name || '地図で指定した場所'; arrived = false;
  if (destMarker) destMarker.remove();
  destMarker = new mapboxgl.Marker({color: '#c0392b'}).setLngLat(p).addTo(map);
  $('guide').textContent = '目的地を設定しました。「▶ ナビ開始」を押してください。';
  $('next').textContent = '目的地：' + destName;
  if (!navOn) {
    $('start').disabled = false;
    if (typeof showTab === 'function') showTab('route');
    if (!noPreview) previewRoute();
  } else { active = null; compare(); }
  // 入口探しに使う地図データを、ナビ開始の前に裏で取っておく
  if (pos) prefetchEntries(Math.min(25000, Math.max(8000, distM(pos, p) * 0.4)));
}

// ---------- 結果のカード（ナビ前に、ルートを1本だけ計算して見せる） ----------
let preview = null, previewSeq = 0, arrived = false, forceRough = false, icCmp = null, cardState = '';
const esc = t => String(t).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const ROUGH_M = 200; // 現在地の精度がこれより粗いと、結果のカードの計算を止める
const isRough = () => posAcc !== null && posAcc !== undefined && posAcc > ROUGH_M;
const fmtAcc = m => m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(1) + 'km';
const fromPt = () => origin ? origin.p : pos;
async function previewRoute() {
  if (navOn || !dest) return;
  icCmp = null;
  if (!origin) {
    if (!pos) { renderCard('wait'); return; }
    if (isRough() && !forceRough) { renderCard('rough'); return; }
  }
  const seq = ++previewSeq; renderCard('calc');
  try {
    const rs = await api([fromPt(), dest], '');
    if (seq !== previewSeq || navOn) return;
    preview = prep(rs[0], 'おまかせ最速');
    preview.steps = [].concat(...preview.r.legs.map(l => l.steps || []));
    drawRoute(preview); fitRoute(preview); renderCard('ok');
  } catch (e) { if (seq === previewSeq && !navOn) { preview = null; renderCard('fail', e.message); } }
}
// ルート全体が見えるように地図を寄せる
function fitRoute(c) {
  if (!map || typeof map.fitBounds !== 'function') return;
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  c.coords.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
  try { map.fitBounds([[x0, y0], [x1, y1]], {padding: 50, duration: 800, bearing: 0, pitch: 0}); } catch (e) {}
}
const jamTotal = c => c.cong.reduce((s, g, i) => s + ((g === 'heavy' || g === 'severe') ? c.cum[i + 1] - c.cum[i] : 0), 0);
const durTxt = sec => { const m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + '時間' + (m % 60) + '分' : m + '分'; };
// state：calc（計算中）／wait（現在地待ち）／rough（現在地が粗い）／ok／fail（理由 msg）／arrived（到着した）
function renderCard(state, msg) {
  const box = $('routeCard');
  if (state !== undefined) cardState = state;
  if (!dest || navOn) { box.classList.remove('show'); box.innerHTML = ''; return; }
  box.classList.add('show');
  let h = `<div class="cardH">📍 ${esc(destName || '目的地')}</div>`;
  if (origin) h += `<div class="small">出発地：${esc(origin.name)}（下調べ。ナビは現在地から始めます）</div>`;
  if (vias.length) h += '<div class="viaList">経由：' + vias.map((v, i) => `<span class="viaTag">${'①②③'[i]} ${esc(v.name)}<button class="viaRm" data-rmvia="${i}" aria-label="外す">✕</button></span>`).join('') + '</div>';
  if (state === 'calc') h += '<div class="small">ルートを計算しています…</div>';
  else if (state === 'wait') h += '<div class="small">現在地が分かりしだい、ルートを計算します。</div>';
  else if (state === 'rough') h += `<div class="rough">現在地の精度が粗いため（約${fmtAcc(posAcc)}）、ルートの計算を止めています。屋外に出て精度がよくなると自動で計算します。<br><button id="rcOrigin">出発地を地図で選ぶ</button><button id="rcForce">それでもこの位置で計算</button></div>`;
  else if (state === 'fail') h += `<div class="small" style="color:#c0392b">ルートを計算できませんでした（${esc(jaErr(msg || ''))}）</div>`;
  else if (state === 'arrived') h += '<div class="rcMain"><b>到着しました</b></div>';
  else if (state === 'ok' && preview) {
    const c = preview, mw = c.steps.some(isMwStep);
    h += `<div class="rcMain"><b>到着 ${hhmm(c.r.duration)}</b>（所要 ${durTxt(c.r.duration)}）　${(c.r.distance / 1000).toFixed(1)}km</div>
      <div class="small">${origin ? '今出発した場合・' : ''}${mw ? '高速道路を使うルート' : '一般道だけのルート'}・ルート上の渋滞 ${(jamTotal(c) / 1000).toFixed(1)}km</div>
      <div class="small">${bdText(burden(c, 0))}</div>`;
  }
  h += `<div class="acts"><button id="rcStart" class="primary big"${pos ? '' : ' disabled'}>▶ ${state === 'arrived' ? 'もう一度ナビ' : origin ? '現在地からナビ開始' : 'ナビ開始'}</button>`
    + (state === 'fail' ? '<button id="rcRetry">もう一度計算</button>' : '') + '<button id="rcClear">目的地を消す</button></div>';
  h += '<div class="acts acts2"><button id="rcFav">★ 登録</button><button id="rcShare">🔗 共有</button>'
    + (state === 'ok' ? '<button id="rcIc">🛣 乗るICを比べる</button>' : '') + '</div>';
  if (state === 'ok') h += icCmpHtml();
  box.innerHTML = h;
  $('rcStart').onclick = () => startNav();
  $('rcClear').onclick = clearDest;
  $('rcFav').onclick = addFav;
  $('rcShare').onclick = shareDest;
  if ($('rcRetry')) $('rcRetry').onclick = previewRoute;
  if ($('rcIc')) $('rcIc').onclick = compareEntries;
  if ($('rcOrigin')) $('rcOrigin').onclick = () => $('originPickBtn').click();
  if ($('rcForce')) $('rcForce').onclick = () => { forceRough = true; previewRoute(); };
  box.querySelectorAll('[data-rmvia]').forEach(b => b.onclick = () => removeVia(Number(b.dataset.rmvia)));
  box.querySelectorAll('[data-icgo]').forEach(b => b.onclick = () => { const r = icCmp.rows[Number(b.dataset.icgo)]; startNav({viaEntry: {p: r.x.p, name: r.x.name}}); });
  box.querySelectorAll('[data-icmap]').forEach(b => b.onclick = () => { const r = icCmp.rows[Number(b.dataset.icmap)]; drawRoute(r.x.pc); fitRoute(r.x.pc); });
}
function clearDest() {
  if (navOn) return;
  dest = null; destName = ''; preview = null; previewSeq++; arrived = false; icCmp = null;
  vias = []; drawVias();
  if (destMarker) { destMarker.remove(); destMarker = null; }
  ['casing', 'seg', 'inc', 'prop'].forEach(id => setData(id, []));
  $('start').disabled = true; renderCard();
  $('next').textContent = '目的地を設定してください';
  $('guide').textContent = '目的地を検索するか、「地図で指定」を押して地図をタップしてください。';
}

// ---------- 乗るICを比べる（ナビ前。出発地か現在地から） ----------
async function compareEntries() {
  if (!preview) return;
  icCmp = {state: 'calc'}; renderCard('ok');
  try {
    const ents = await entryCands(fromPt());
    const base = preview, curIn = entryOf(base), bB = burden(base, 0).min, w = wkm(), bw = bdw();
    const rows = ents.map(x => {
      const tG = (base.r.duration - x.dur) / 60, dK = (x.dist - base.r.distance) / 1000, b = burden(x.pc, 0);
      return {x, tG, dK, b, s: tG - w * dK - bw * (b.min - bB), same: !!(curIn && distM(x.p, curIn.p) < 2500)};
    }).sort((a, b) => b.s - a.s);
    icCmp = {state: 'ok', rows, curName: curIn && curIn.name};
  } catch (e) { icCmp = {state: 'fail', msg: e.message}; }
  if (!navOn && dest) renderCard('ok');
}
function icCmpHtml() {
  if (!icCmp) return '';
  if (icCmp.state === 'calc') return '<div class="small icCmp">乗るICを比べています（地図データとルートを調べるので、少しかかります）…</div>';
  if (icCmp.state === 'fail') return `<div class="small icCmp" style="color:#c0392b">比べられませんでした（${esc(jaErr(icCmp.msg))}）</div>`;
  if (!icCmp.rows.length) return '<div class="small icCmp">比べられる入口が見つかりませんでした（次の行き先まで10km未満か、地図データが取れなかったため）。</div>';
  let h = `<div class="icCmp"><div class="small">このルートは${icCmp.curName ? '「' + esc(icCmp.curName) + '」から乗ります' : '高速の入口が分かりません'}。ほかの入口と比べると（${origin ? '今出発した場合' : '今の渋滞で'}）：</div>`;
  icCmp.rows.forEach((r, i) => {
    const g = Math.round(r.s);
    h += `<div class="icRow${r.same ? ' same' : ''}"><b>${esc(r.x.name)}から乗る</b>${r.same ? '（このルート）' : ''}<br>
      到着 ${hhmm(r.x.dur)}（${sgn(-Math.round(r.tG))}分、距離${fmtKm(r.dK)}）　実質 ${g >= 0 ? g + '分有利' : -g + '分不利'}<br>
      <span class="small">${bdText(r.b)}</span><br>
      <button data-icmap="${i}">地図で見る</button>${origin ? '' : `<button data-icgo="${i}" class="primary">この入口でナビ開始</button>`}</div>`;
  });
  return h + '</div>';
}

// ---------- お気に入りの行き先 ----------
const FAV_MAX = 20;
let favs = [];
try { favs = JSON.parse(localStorage.getItem('navi_favs') || '[]') || []; } catch (e) { favs = []; }
function saveFavs() {
  try { localStorage.setItem('navi_favs', JSON.stringify(favs)); } catch (e) { showErr('お気に入りの保存に失敗しました'); }
  renderFavs();
}
function renderFavs() {
  const el = $('favList'); if (!el) return;
  el.innerHTML = favs.length
    ? favs.map((f, i) => `<div class="favRow"><button class="favGo" data-fav="${i}">★ ${esc(f.name)}</button><button class="favDel" data-favdel="${i}">削除</button></div>`).join('')
    : '<div class="small">まだありません。結果のカードの「★ 登録」で追加できます。</div>';
  el.querySelectorAll('[data-fav]').forEach(b => b.onclick = () => { const f = favs[Number(b.dataset.fav)]; setDest(f.p, f.name); });
  el.querySelectorAll('[data-favdel]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.favdel);
    if (confirm(favs[i].name + ' をお気に入りから削除しますか？')) { favs.splice(i, 1); saveFavs(); }
  });
}
function addFav() {
  if (!dest) return;
  if (favs.length >= FAV_MAX) { showErr('お気に入りは20件までです。いらないものを削除してください'); return; }
  const n = prompt('お気に入りの名前', destName || '');
  if (!n || !n.trim()) return;
  favs.push({name: n.trim().replace(/\|/g, '').slice(0, 30), p: [Number(dest[0].toFixed(6)), Number(dest[1].toFixed(6))]});
  saveFavs(); showErr('★ お気に入りに登録しました：' + esc(n.trim()));
}

// ---------- 経由地（最大3か所） ----------
const VIA_MAX = 3;
let viaMarkers = [];
function addVia(p, name) {
  if (vias.length >= VIA_MAX) { showErr('経由地は3か所までです'); return; }
  vias.push({p, name: (name || '経由地' + (vias.length + 1)).replace(/\|/g, '').slice(0, 30)});
  afterViaChange();
}
function removeVia(i) { vias.splice(i, 1); afterViaChange(); }
function afterViaChange() {
  drawVias();
  if (navOn) { active = null; compare(); saveSession(); }
  else if (dest) previewRoute(); else renderCard();
}
function drawVias() {
  viaMarkers.forEach(m => m.remove());
  viaMarkers = vias.map((v, i) => {
    const el = document.createElement('div'); el.className = 'viaMk'; el.textContent = '①②③'[i];
    return new mapboxgl.Marker({element: el}).setLngLat(v.p).addTo(map);
  });
}

// ---------- 出発地を地図で選ぶ（下調べ専用。ナビはいつも現在地から） ----------
let originPick = false, originMarker = null;
function setOrigin(p, name) {
  origin = {p, name: name || '地図で選んだ地点'};
  if (originMarker) originMarker.remove();
  originMarker = new mapboxgl.Marker({color: '#2e7d32'}).setLngLat(p).addTo(map);
  renderOrigin();
  if (dest) previewRoute(); else $('guide').textContent = '出発地を決めました。目的地を検索するか、地図で指定してください。';
}
function clearOrigin(noPreview) {
  origin = null;
  if (originMarker) { originMarker.remove(); originMarker = null; }
  renderOrigin();
  if (!noPreview && dest && !navOn) previewRoute();
}
function renderOrigin() {
  if (!$('originText')) return;
  $('originText').textContent = origin ? `出発地：${origin.name}（下調べ）` : '出発地：現在地';
  $('originClear').style.display = origin ? '' : 'none';
}
$('originPickBtn').onclick = () => { originPick = true; pickMode = false; icPick = false; $('guide').textContent = '地図の上で、出発地をタップしてください。'; };
$('originClear').onclick = () => clearOrigin();

// ---------- 現在地の精度と前回の場所 ----------
let geoErrMsg = '', lastPosSave = 0;
function updLoc() {
  const el = $('locLine'); if (!el) return;
  if (!pos) el.textContent = '現在地：' + (geoErrMsg || '取得中…');
  else el.textContent = '現在地：' + (posAcc ? `精度 約${fmtAcc(posAcc)}${isRough() ? '（粗い）' : ''}` : '取得済み');
}
// 精度100m以内の位置を、1分に1回、約100m単位に丸めて覚える（次に開いたとき地図をそこから始める）
function saveLastPos() {
  if (!pos || posAcc === null || posAcc === undefined || posAcc > 100 || Date.now() - lastPosSave < 60000) return;
  lastPosSave = Date.now();
  try { localStorage.setItem('navi_lastpos', JSON.stringify([Number(pos[0].toFixed(3)), Number(pos[1].toFixed(3))])); } catch (e) {}
}
// 位置情報のエラーを日本語に（同じものは繰り返し並べない）
function onGeoErr(e) {
  const m = e && e.code === 1 ? '位置情報の利用が許可されていません（ブラウザの設定で、このサイトの位置情報を「許可」にしてください）'
    : e && e.code === 2 ? '現在地が取れません（屋内や電波の弱い所など）'
    : e && e.code === 3 ? '現在地の取得が時間切れになりました' : '現在地が取れません（' + jaErr(e && e.message) + '）';
  if (m !== geoErrMsg) { geoErrMsg = m; showErr(m); }
  updLoc();
}

// ---------- 共有リンク（目的地と経由地だけ。出発地・現在地は入れない） ----------
function shareUrl() {
  const f = p => p[0].toFixed(5) + ',' + p[1].toFixed(5);
  let u = location.origin + location.pathname + '?to=' + f(dest) + '&n=' + encodeURIComponent(destName || '');
  if (vias.length) u += '&via=' + vias.map(v => f(v.p)).join('|') + '&vn=' + vias.map(v => encodeURIComponent(v.name)).join('|');
  return u;
}
async function shareDest() {
  if (!dest) return;
  const url = shareUrl(), text = `KomuMiru：${destName || '目的地'}への行き先`;
  if (navigator.share) {
    try { await navigator.share({title: 'KomuMiru', text, url}); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); showErr('リンクをコピーしました。LINE などに貼り付けて送れます'); }
  catch (e) { prompt('このリンクをコピーして送ってください', url); }
}
// 開いたアドレスに共有リンクの目的地があれば読み込む
function readShareLink() {
  let q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
  const pp = s => { const a = String(s || '').split(',').map(Number); return a.length === 2 && a.every(isFinite) && Math.abs(a[0]) <= 180 && Math.abs(a[1]) <= 90 ? a : null; };
  const d = pp(q.get('to')); if (!d) return;
  const vs = (q.get('via') || '').split('|').filter(Boolean).map(pp), vn = (q.get('vn') || '').split('|');
  vias = [];
  vs.forEach((v, i) => { if (v && vias.length < VIA_MAX) vias.push({p: v, name: (vn[i] || '経由地' + (i + 1)).slice(0, 30)}); });
  drawVias();
  setDest(d, (q.get('n') || '共有された目的地').slice(0, 40));
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
}

// ---------- 出口の登録 ----------
function saveIcs() {
  try { localStorage.setItem('navi_ics', JSON.stringify(ics)); } catch (e) { showErr('出口の保存に失敗しました'); }
  renderIcs();
}
function renderIcs() {
  $('icList').innerHTML = ics.length
    ? ics.map((ic, i) => `<div>${ic.name}　<button data-del="${i}">削除</button></div>`).join('')
    : '<div class="small">まだ登録がありません</div>';
  $('icList').querySelectorAll('button').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.del);
    if (confirm(ics[i].name + 'を削除しますか？')) { ics.splice(i, 1); saveIcs(); }
  });
  setData('ics', ics.map(ic => ({type:'Feature', properties:{name: ic.name}, geometry:{type:'Point', coordinates: ic.p}})));
}
$('icAddBtn').onclick = () => { icPick = true; pickMode = false; $('guide').textContent = '料金所を出た先の一般道をタップしてください。'; };
$('icExport').onclick = () => { $('icText').value = JSON.stringify(ics); };
$('icImport').onclick = () => {
  try {
    const a = JSON.parse($('icText').value);
    if (!Array.isArray(a)) throw 0;
    ics = a.filter(x => x && x.name && Array.isArray(x.p)); saveIcs();
    $('guide').textContent = '出口データを読み込みました。';
  } catch (e) { showErr('読み込めない形式です'); }
};

// ---------- 現在地 ----------
function onPos(p) {
  pos = [p.coords.longitude, p.coords.latitude]; speed = p.coords.speed; gpsHead = p.coords.heading;
  const wasRough = isRough(); posAcc = p.coords.accuracy === undefined ? null : p.coords.accuracy; geoErrMsg = '';
  updLoc(); saveLastPos();
  // 粗くて止めていた結果のカードは、精度がよくなったら自動で計算する
  if (wasRough && !isRough() && dest && !navOn && !origin && cardState === 'rough') previewRoute();
  if (!posMarker) {
    const el = document.createElement('div');
    el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#1e90ff;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.5)';
    posMarker = new mapboxgl.Marker({element: el}).setLngLat(pos).addTo(map);
    if (!navOn) map.jumpTo({center: pos, zoom: 13});
    prefetchEntries(15000); // 近くの入口のデータを裏で取っておく
    if (dest && !navOn && !preview) previewRoute(); // 現在地を待っていた結果のカード
    if (!dest) $('guide').textContent = '目的地を検索するか、「地図で指定」を押して地図をタップしてください。';
  } else posMarker.setLngLat(pos);
  if (navOn && follow) followCam();
  if (navOn && active) guide();
}

// ---------- 走行中の案内 ----------
function guide() {
  if (!active || !pos) return;
  const n = nearest(active.coords, pos);
  if (n.d > 50) { offCount++; if (offCount >= 3 && !busy) { offCount = 0; speak('ルートを外れました。再検索します'); active = null; compare(); return; } }
  else offCount = 0;
  const my = along(active, pos), rem = totalOf(active) - my;
  if (active.icLeg && rem < 150) { active = null; speak('一般道のルートで案内を続けます'); compare(); return; }
  // 経由地を通り過ぎたら知らせて一覧から外す
  if (vias.length) {
    const v = vias[0], va = along(active, v.p);
    if (distM(pos, v.p) < 60 || my > va + 50) { speak(`経由地、${v.name}を通過しました`); vias.shift(); drawVias(); saveSession(); }
  }
  if (rem < 40 && !vias.length) { speak('目的地に到着しました'); arrived = true; stopNav(); $('next').textContent = '到着しました'; return; }
  const rd = remDur(active);
  $('summary').textContent = `到着 ${hhmm(rd)}　残り ${Math.round(rd / 60)}分・${fmtDist(rem)}` + (vias.length ? `　経由 ${vias.length}か所` : '') + (destName ? `　→ ${destName}` : '');

  const exits = exitsAhead(my);
  $('exitInfo').textContent = exits.length ? `次の出口：${exits[0].ic.name}　あと${fmtDist(exits[0].a)}` : '';
  if (viaEntry) {
    const vn = nearest(active.coords, viaEntry.p), va = active.cum[vn.i] - my;
    // 入口を通り過ぎた、または別のルートに切り替えたら、入口の指定を外す
    if (vn.d > 300 || va < -300) viaEntry = null;
    else $('exitInfo').textContent = `乗る入口：${viaEntry.name}　あと${fmtDist(va)}`;
  }

  const st0 = active.steps[curStepIdx(my)];
  renderHighway(my, st0 ? isMwStep(st0) : false);

  const k = curStepIdx(my) + 1;
  if (k >= active.steps.length || !(active.manAlong[k] > my + 5)) { $('next').textContent = '目的地まで道なりです'; drawDrive(null, null, '目的地まで道なり'); }
  else {
    const st = active.steps[k], dist = active.manAlong[k] - my, ins = st.maneuver.instruction || '';
    $('next').textContent = `${fmtDist(dist)}先　${ins}`;
    drawDrive(st.maneuver, dist, ins);
    const key = st.maneuver.location.map(v => v.toFixed(4)).join(',');
    const far = (speed && speed > 20) ? 1000 : 300;
    if (dist <= far && dist > 120 && !spoken.has(key + 'f')) { spoken.add(key + 'f'); speak(`${fmtDist(dist)}先、${ins}`); }
    if (dist <= 80 && !spoken.has(key + 'n')) { spoken.add(key + 'n'); speak(ins); }
  }

  let h = '';
  active.incs.forEach(x => {
    const ahead = (active.cum[x.geometry_index_start || 0] || 0) - my;
    if (ahead < -50) return;
    const label = INC[x.type] || x.type;
    const pre = exits.filter(e => e.a < ahead).pop();
    const preTxt = pre ? `<br>　手前の出口：${pre.ic.name}（あと${fmtDist(pre.a)}）` : '';
    h += `<div class="inc">● ${label}：${fmtDist(ahead)}先　${x.description || ''}${x.closed ? '（通行止め）' : ''}${preTxt}</div>`;
    if (ahead < 10000 && !spokenInc.has(x.id)) {
      spokenInc.add(x.id);
      speak(`この先${fmtDist(ahead)}で、${label}の情報があります` + (pre ? `。手前の出口は${pre.ic.name}です` : ''));
    }
  });
  $('incs').innerHTML = h || '<span class="small">ルート上の事故・規制情報なし</span>';
}

// ---------- 開始・停止 ----------
function restartTimer() { clearInterval(timer); timer = setInterval(compare, Number($('interval').value) * 60000); }
$('interval').onchange = () => { if (navOn) restartTimer(); };
// ナビを始める。opts：{viaEntry：乗る入口, preferGeneral：一般道を選んでいたか, resume：再開か}
async function startNav(opts) {
  if (!pos) { showErr('現在地がまだ取得できていません。少し待ってから押してください。'); return; }
  if (!dest) return;
  opts = opts || {};
  navOn = true; preferGeneral = !!opts.preferGeneral; viaEntry = opts.viaEntry || null;
  entryPending = !viaEntry; entryRetry = 0; clearTimeout(entryRetryTimer);
  previewSeq++; arrived = false; icCmp = null; renderCard(); clearOrigin(true); // ナビはいつも現在地から
  $('start').disabled = true; $('stop').disabled = false; $('judgeOut').innerHTML = '';
  setDriving(true); setFollow(true);
  speak(opts.resume ? 'ナビを再開します' : 'ナビを開始します'); keepAwake();
  followCam({zoom: 15});
  active = null; await compare(); restartTimer(); saveSession();
  if (active && !judging) judge(true);
}
$('start').onclick = () => startNav();
function stopNav() {
  navOn = false; clearInterval(timer); clearTimeout(entryRetryTimer); viaEntry = null; entryPending = false;
  try { if (wakeLock) wakeLock.release(); } catch (e) {}
  hideBanner(); $('start').disabled = !dest; $('stop').disabled = true; $('hwy').style.display = 'none';
  $('exitInfo').textContent = ''; $('status').textContent = '停止中';
  clearSession(); setDriving(false); camReset();
  // 結果のカードに戻す：到着したら「到着しました」、途中で止めたら今の場所からのルートを計算し直す
  if (dest) { if (arrived) renderCard('arrived'); else previewRoute(); }
}
