// KomuMiru：目的地・出口の登録・現在地・走行中の案内・開始と停止

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
      d.onclick = () => { setDest(f.p); $('hits').innerHTML = ''; };
      $('hits').appendChild(d);
    });
    if (!feats.length) $('hits').textContent = '見つかりませんでした。住所で試すか「地図で指定」を使ってください。';
  } catch (e) { $('hits').innerHTML = ''; showErr('検索エラー：' + e.message); }
};
$('search').addEventListener('keydown', e => { if (e.key === 'Enter') $('searchBtn').click(); });
function setDest(p) {
  dest = p; preferGeneral = false; viaEntry = null;
  if (destMarker) destMarker.remove();
  destMarker = new mapboxgl.Marker({color: '#c0392b'}).setLngLat(p).addTo(map);
  $('guide').textContent = '目的地を設定しました。「ナビ開始」を押してください。';
  if (!navOn) $('start').disabled = false; else { active = null; compare(); }
  // 入口探しに使う地図データを、ナビ開始の前に裏で取っておく
  if (pos) prefetchEntries(Math.min(25000, Math.max(8000, distM(pos, p) * 0.4)));
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
  pos = [p.coords.longitude, p.coords.latitude]; speed = p.coords.speed;
  if (!posMarker) {
    const el = document.createElement('div');
    el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#1e90ff;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.5)';
    posMarker = new mapboxgl.Marker({element: el}).setLngLat(pos).addTo(map);
    if (!navOn) map.jumpTo({center: pos, zoom: 13});
    prefetchEntries(15000); // 近くの入口のデータを裏で取っておく
    if (!dest) $('guide').textContent = '目的地を検索するか、「地図で指定」を押して地図をタップしてください。';
  } else posMarker.setLngLat(pos);
  if (navOn && follow) map.easeTo({center: pos, duration: 800});
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
  if (rem < 40) { speak('目的地に到着しました'); stopNav(); $('next').textContent = '到着しました'; return; }
  const rd = remDur(active);
  $('summary').textContent = `到着 ${hhmm(rd)}　残り ${Math.round(rd / 60)}分・${fmtDist(rem)}`;

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
  if (k >= active.steps.length || !(active.manAlong[k] > my + 5)) $('next').textContent = '目的地まで道なりです';
  else {
    const st = active.steps[k], dist = active.manAlong[k] - my, ins = st.maneuver.instruction || '';
    $('next').textContent = `${fmtDist(dist)}先　${ins}`;
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
$('start').onclick = async () => {
  if (!pos) { showErr('現在地がまだ取得できていません。少し待ってから押してください。'); return; }
  if (!dest) return;
  navOn = true; follow = true; preferGeneral = false; viaEntry = null; entryPending = true; entryRetry = 0; clearTimeout(entryRetryTimer); $('followBtn').textContent = '追従：ON';
  $('start').disabled = true; $('stop').disabled = false; $('judgeOut').innerHTML = '';
  speak('ナビを開始します'); keepAwake();
  map.easeTo({center: pos, zoom: 15});
  active = null; await compare(); restartTimer();
  if (active && !judging) judge(true);
};
function stopNav() {
  navOn = false; clearInterval(timer); clearTimeout(entryRetryTimer); viaEntry = null; entryPending = false;
  try { if (wakeLock) wakeLock.release(); } catch (e) {}
  hideBanner(); $('start').disabled = !dest; $('stop').disabled = true; $('hwy').style.display = 'none';
  $('exitInfo').textContent = ''; $('status').textContent = '停止中';
}
$('stop').onclick = () => { stopNav(); speak('ナビを終了します'); };
$('followBtn').onclick = () => {
  follow = !follow; $('followBtn').textContent = follow ? '追従：ON' : '追従：OFF';
  if (follow && pos) map.easeTo({center: pos});
};
