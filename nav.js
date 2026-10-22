// KomuMiru：目的地・出口の登録・現在地・走行中の案内・開始と停止
(window.KOMU_FV = window.KOMU_FV || {}).nav = 6;

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
let preview = null, previewSeq = 0, arrived = false;
const esc = t => String(t).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
async function previewRoute() {
  if (navOn || !dest) return;
  if (!pos) { renderCard('wait'); return; }
  const seq = ++previewSeq; renderCard('calc');
  try {
    const rs = await api([pos, dest], '');
    if (seq !== previewSeq || navOn) return;
    preview = prep(rs[0], 'おまかせ最速');
    preview.steps = (preview.r.legs[0] && preview.r.legs[0].steps) || [];
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
// state：calc（計算中）／wait（現在地待ち）／ok／fail（理由 msg）／arrived（到着した）
function renderCard(state, msg) {
  const box = $('routeCard');
  if (!dest || navOn) { box.classList.remove('show'); box.innerHTML = ''; return; }
  box.classList.add('show');
  let h = `<div class="cardH">📍 ${esc(destName || '目的地')}</div>`;
  if (state === 'calc') h += '<div class="small">ルートを計算しています…</div>';
  else if (state === 'wait') h += '<div class="small">現在地が分かりしだい、ルートを計算します。</div>';
  else if (state === 'fail') h += `<div class="small" style="color:#c0392b">ルートを計算できませんでした（${esc(msg || '')}）</div>`;
  else if (state === 'arrived') h += '<div class="rcMain"><b>到着しました</b></div>';
  else if (state === 'ok' && preview) {
    const c = preview, min = Math.round(c.r.duration / 60), mw = c.steps.some(isMwStep);
    h += `<div class="rcMain"><b>到着 ${hhmm(c.r.duration)}</b>（所要 ${min >= 60 ? Math.floor(min / 60) + '時間' + (min % 60) + '分' : min + '分'}）　${(c.r.distance / 1000).toFixed(1)}km</div>
      <div class="small">${mw ? '高速道路を使うルート' : '一般道だけのルート'}・ルート上の渋滞 ${(jamAhead(c) / 1000).toFixed(1)}km</div>
      <div class="small">${bdText(burden(c, 0))}</div>`;
  }
  h += `<div class="acts"><button id="rcStart" class="primary big"${pos ? '' : ' disabled'}>▶ ${state === 'arrived' ? 'もう一度ナビ' : 'ナビ開始'}</button>`
    + (state === 'fail' ? '<button id="rcRetry">もう一度計算</button>' : '') + '<button id="rcClear">目的地を消す</button></div>';
  if (state === 'ok') h += '<div class="small">ナビを始めると、乗るIC（入口）の比較と、渋滞の定期比較が始まります。</div>';
  box.innerHTML = h;
  $('rcStart').onclick = () => startNav();
  $('rcClear').onclick = clearDest;
  if ($('rcRetry')) $('rcRetry').onclick = previewRoute;
}
function clearDest() {
  if (navOn) return;
  dest = null; destName = ''; preview = null; previewSeq++; arrived = false;
  if (destMarker) { destMarker.remove(); destMarker = null; }
  ['casing', 'seg', 'inc', 'prop'].forEach(id => setData(id, []));
  $('start').disabled = true; renderCard();
  $('next').textContent = '目的地を設定してください';
  $('guide').textContent = '目的地を検索するか、「地図で指定」を押して地図をタップしてください。';
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
  if (rem < 40) { speak('目的地に到着しました'); arrived = true; stopNav(); $('next').textContent = '到着しました'; return; }
  const rd = remDur(active);
  $('summary').textContent = `到着 ${hhmm(rd)}　残り ${Math.round(rd / 60)}分・${fmtDist(rem)}` + (destName ? `　→ ${destName}` : '');

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
// ナビを始める。opts（再開のとき）：{viaEntry：選んでいた入口, preferGeneral：一般道を選んでいたか}
async function startNav(opts) {
  if (!pos) { showErr('現在地がまだ取得できていません。少し待ってから押してください。'); return; }
  if (!dest) return;
  opts = opts || {};
  navOn = true; preferGeneral = !!opts.preferGeneral; viaEntry = opts.viaEntry || null;
  entryPending = !viaEntry; entryRetry = 0; clearTimeout(entryRetryTimer);
  previewSeq++; arrived = false; renderCard();
  $('start').disabled = true; $('stop').disabled = false; $('judgeOut').innerHTML = '';
  setDriving(true); setFollow(true);
  speak(opts.viaEntry !== undefined ? 'ナビを再開します' : 'ナビを開始します'); keepAwake();
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
