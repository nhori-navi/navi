// KomuMiru：画面まわり（版5）
// ・走行中の画面（大きな案内、▲詳しく、停止の2回押し）
// ・夜間モード（画面の明るさ：自動／いつも明るい／いつも暗い）
// ・地図の右の丸ボタン（◎追従、向き：北↑／進↑／3D）
// ・ナビの再開（30分以内に開き直したら続けるか聞く）
// ・版の表示と古いファイルの知らせ
// （版6）下のタブと真ん中の丸い▶、境目のつまみ、押して選ぶ並び、ホーム画面に追加
(window.KOMU_FV = window.KOMU_FV || {}).ui = 7;

function lsGetStr(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
function lsSetStr(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

// ---------- 走行中の画面 ----------
const NEAR_RED = 100;      // 曲がり角の何m手前から赤くするか
const STOP_ARM_MS = 3000;  // 停止の2回押しの待ち時間
function setDriving(on) {
  document.body.classList.toggle('driving', on);
  if (!on) document.body.classList.remove('more');
  $('moreBtn').textContent = '▲ 詳しく';
  resizeSoon();
}
$('moreBtn').onclick = () => {
  const m = document.body.classList.toggle('more');
  $('moreBtn').textContent = m ? '▼ 閉じる' : '▲ 詳しく';
  resizeSoon();
};
// 案内の矢印（SVG）。向きは maneuver の modifier から
const ARROW_DEG = {'straight': 0, 'slight right': 45, 'right': 90, 'sharp right': 135, 'slight left': -45, 'left': -90, 'sharp left': -135};
function arrowSvg(m) {
  const t = m ? m.type : '', mod = m ? (m.modifier || 'straight') : 'straight';
  if (t === 'arrive') return '<span class="flag">🏁</span>';
  if (mod === 'uturn') return '<svg viewBox="0 0 48 48"><path d="M14 44V20a10 10 0 0 1 20 0v8" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><path d="M24 26l10 12 10-12z" fill="currentColor"/></svg>';
  const deg = ARROW_DEG[mod] !== undefined ? ARROW_DEG[mod] : 0;
  return `<svg viewBox="0 0 48 48"><g transform="rotate(${deg} 24 24)"><path d="M24 46V16" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M24 2L10 20h28z" fill="currentColor"/></g></svg>`;
}
// guide() から呼ぶ：大きな案内を描く（m：次の曲がり角の maneuver、dist：そこまでの距離、text：説明）
function drawDrive(m, dist, text) {
  $('dArrow').innerHTML = arrowSvg(m);
  $('dDist').textContent = dist === null ? '' : fmtDist(dist) + '先';
  $('dText').textContent = text;
  $('drive').classList.toggle('near', dist !== null && dist <= NEAR_RED);
}
// 停止は2回押し：1回目で赤くなり「もう一度で停止」、3秒以内にもう一度で止める
let stopArmed = 0, stopArmTimer = null;
function stopPress() {
  if (window.__noStopConfirm || Date.now() - stopArmed < STOP_ARM_MS) {
    clearTimeout(stopArmTimer); stopArmed = 0;
    $('stop').classList.remove('arm'); $('stop').textContent = '停止';
    stopNav(); speak('ナビを終了します');
    return;
  }
  stopArmed = Date.now();
  $('stop').classList.add('arm'); $('stop').textContent = 'もう一度で停止';
  clearTimeout(stopArmTimer);
  stopArmTimer = setTimeout(() => { stopArmed = 0; $('stop').classList.remove('arm'); $('stop').textContent = '停止'; }, STOP_ARM_MS);
}

// ---------- 地図の大きさが変わったとき ----------
let resizeTimer = null;
function resizeSoon() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { try { map && map.resize && map.resize(); } catch (e) {} if (navOn && follow) followCam(); }, 60);
}
window.addEventListener('resize', resizeSoon);
window.addEventListener('orientationchange', resizeSoon);

// ---------- 地図の右の丸ボタン：追従と向き ----------
const VIEWS = ['north', 'head', '3d'], VIEW_LABEL = {north: '北↑', head: '進↑', '3d': '3D'};
let viewMode = VIEWS.includes(lsGetStr('navi_view', 'north')) ? lsGetStr('navi_view', 'north') : 'north';
let lastBrg = 0;
function setFollow(v) {
  follow = v;
  $('mFollow').classList.toggle('on', v);
  if (v && pos) followCam();
}
function setView(v) {
  viewMode = v; lsSetStr('navi_view', v);
  $('mView').textContent = VIEW_LABEL[v];
  $('mView').classList.toggle('on', v !== 'north');
  if (pos && (follow || !navOn)) followCam(); else camReset();
}
// 進む向き：GPS の向き（速さが毎秒2m以上のとき）→ ルートの向き → 前の向き
function headingNow() {
  if (gpsHead !== null && gpsHead !== undefined && !isNaN(gpsHead) && speed && speed > 2) return gpsHead;
  if (active && pos) {
    const n = nearest(active.coords, pos), a = active.coords[n.i], b = active.coords[Math.min(n.i + 1, active.coords.length - 1)];
    if (a && b && (a[0] !== b[0] || a[1] !== b[1])) return (bearing(a, b) + 360) % 360;
  }
  return lastBrg;
}
// 追従のカメラ：北↑は真上から、進↑・3D は進む向きを上にして、自分の位置を画面の下寄りに
function followCam(extra) {
  if (!map || !pos || !map.easeTo) return;
  const h = map.getContainer ? map.getContainer().clientHeight : 400;
  const o = {center: pos, duration: 800};
  if (navOn && viewMode !== 'north') {
    lastBrg = headingNow();
    Object.assign(o, {bearing: lastBrg, pitch: viewMode === '3d' ? 55 : 0, padding: {top: Math.round(h * 0.35), bottom: 0, left: 0, right: 0}});
  } else Object.assign(o, {bearing: 0, pitch: 0, padding: {top: 0, bottom: 0, left: 0, right: 0}});
  map.easeTo(Object.assign(o, extra || {}));
}
function camReset() { if (map && map.easeTo) map.easeTo({bearing: 0, pitch: 0, padding: {top: 0, bottom: 0, left: 0, right: 0}, duration: 500}); }
function initMapBtns() {
  const box = document.createElement('div'); box.id = 'mapBtns';
  box.innerHTML = '<button id="mFollow" class="mb on" title="現在地に追従">◎</button><button id="mView" class="mb" title="地図の向き">北↑</button>';
  (map.getContainer ? map.getContainer() : $('map')).appendChild(box);
  $('mFollow').onclick = () => { setFollow(!follow || !navOn); };
  $('mView').onclick = () => setView(VIEWS[(VIEWS.indexOf(viewMode) + 1) % VIEWS.length]);
  setView(viewMode);
  $('mFollow').classList.toggle('on', follow);
}

// ---------- 夜間モード ----------
// 太陽の高さ（度）。経度・緯度・日時から（およその式。誤差は数分程度）
function sunAlt(lon, lat, d) {
  const r = Math.PI / 180, t = d.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * t) * r, q = 280.459 + 0.98564736 * t;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * r, e = (23.439 - 0.00000036 * t) * r;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * t) % 24 + 24) % 24;
  const ha = (gmst * 15 + lon) * r - ra;
  return Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(ha)) / r;
}
// いまの画面の明るさ：{dark, preset（地図の day／dawn／dusk／night）}
function themeState() {
  const mode = lsGetStr('navi_theme', 'auto');
  if (mode === 'light') return {dark: false, preset: 'day'};
  if (mode === 'dark') return {dark: true, preset: 'night'};
  const c = pos || (map && map.getCenter ? (m => [m.lng, m.lat])(map.getCenter()) : null) || [139.33, 35.62];
  const now = new Date(), alt = sunAlt(c[0], c[1], now);
  if (alt >= -0.83) return {dark: false, preset: 'day'};
  if (alt >= -6) return {dark: true, preset: now.getHours() < 12 ? 'dawn' : 'dusk'};
  return {dark: true, preset: 'night'};
}
let themePreset = null;
// ルートの見え方：夜は縁取りを白っぽく太くし、まわりの道の渋滞の色を少し控えめにして、ルートを浮き立たせる
// （自分で描いた線は emissive-strength で夜の照明に沈まないようにしてある：main.js）
function routeStyle(dark) {
  if (!map || typeof map.setPaintProperty !== 'function' || !map.getLayer) return;
  const set = (id, k, v) => { try { if (map.getLayer(id)) map.setPaintProperty(id, k, v); } catch (e) {} };
  set('casing', 'line-color', dark ? '#f2f5ff' : '#1f3a93');
  set('casing', 'line-width', dark ? 13 : 11);
  set('seg', 'line-width', dark ? 7 : 5);
  set('traffic', 'line-opacity', dark ? 0.55 : 0.85);
  set('icsLabel', 'text-color', dark ? '#ffb347' : '#b35900');
  set('icsLabel', 'text-halo-color', dark ? '#1a1f2b' : '#fff');
}
function applyTheme() {
  const s = themeState();
  document.body.classList.toggle('dark', s.dark);
  routeStyle(s.dark);
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = s.dark ? '#121821' : '#1f3a93';
  if (s.preset !== themePreset && map && typeof map.setConfigProperty === 'function') {
    try { map.setConfigProperty('basemap', 'lightPreset', s.preset); themePreset = s.preset; } catch (e) {}
  }
}
function initTheme() {
  const sel = $('theme');
  sel.value = lsGetStr('navi_theme', 'auto');
  sel.onchange = () => { lsSetStr('navi_theme', sel.value); applyTheme(); };
  applyTheme();
  setInterval(applyTheme, 60000);
  if (map && map.on) map.on('style.load', () => { themePreset = null; applyTheme(); });
}

// ---------- ナビの再開 ----------
const SESSION_KEY = 'navi_session', SESSION_MIN = 30;
function saveSession() {
  if (!navOn || !dest) return;
  lsSetStr(SESSION_KEY, JSON.stringify({t: Date.now(), dest, destName, viaEntry, preferGeneral, vias}));
}
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
function initResume() {
  setInterval(saveSession, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSession(); });
  window.addEventListener('pagehide', saveSession);
  let s = null;
  try { s = JSON.parse(lsGetStr(SESSION_KEY, 'null')); } catch (e) {}
  if (!s || !Array.isArray(s.dest) || Date.now() - s.t > SESSION_MIN * 60000) { clearSession(); return; }
  const min = Math.max(1, Math.round((Date.now() - s.t) / 60000));
  $('resumeText').textContent = `前回のナビを続けますか？（目的地：${s.destName || '地図で指定した場所'}、${min}分前）`;
  $('resume').style.display = 'block';
  $('resumeNo').onclick = () => { clearSession(); $('resume').style.display = 'none'; };
  $('resumeYes').onclick = () => {
    $('resume').style.display = 'none';
    vias = Array.isArray(s.vias) ? s.vias.slice(0, 3) : []; drawVias();
    setDest(s.dest, s.destName || '', true);
    const go = () => startNav({viaEntry: s.viaEntry || null, preferGeneral: !!s.preferGeneral, resume: true});
    if (pos) go();
    else {
      $('guide').textContent = '現在地が分かりしだい、ナビを再開します。';
      const w = setInterval(() => { if (pos) { clearInterval(w); go(); } }, 1000);
    }
  };
}

// ---------- 版の表示と古いファイルの知らせ ----------
function checkVersion() {
  const need = window.KOMU_NEED || {}, have = window.KOMU_FV || {}, bad = [];
  Object.keys(need).forEach(k => { if (have[k] !== need[k]) bad.push(`${k}.js：${have[k] ? '古い版（版' + have[k] + '）' : '読み込めていません'}`); });
  $('verBox').textContent = `KomuMiru　版${window.KOMU_V || '?'}（${window.KOMU_DATE || ''}）`;
  if (bad.length) {
    $('verWarn').textContent = '⚠ ファイルの版が合いません：' + bad.join('、') + '。GitHub のファイルを置き直すか、10分ほど待ってから開き直してください。';
    $('verWarn').style.display = 'block';
  }
}

// ---------- 下のタブ ----------
const TABS = ['route', 'cmp', 'ic', 'set'];
let curTab = TABS.includes(lsGetStr('navi_tab', 'route')) ? lsGetStr('navi_tab', 'route') : 'route';
function showTab(t, noSave) {
  if (!TABS.includes(t)) t = 'route';
  curTab = t;
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('open', p.id === 'tab-' + t));
  document.querySelectorAll('.tb').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (!noSave) lsSetStr('navi_tab', t);
  $('panel').scrollTop = 0;
}
// 使い方ナビ用：見えていないタブの中の部品なら、そのタブのボタンを返す
function uiReach(el) {
  if (!el) return el;
  const pane = el.closest && el.closest('.pane');
  if (!pane) return el;
  const t = pane.id.replace('tab-', '');
  if (document.body.classList.contains('driving') && !document.body.classList.contains('more')) return $('moreBtn');
  return t === curTab ? el : document.querySelector(`.tb[data-tab="${t}"]`);
}
// 真ん中の丸いボタン：ナビ前は「▶ ナビ開始」、ナビ中（▲詳しくを開いたとき）は「▼ 戻る」
function fabTick() {
  const f = $('navFab');
  if (navOn) { f.disabled = false; f.innerHTML = '<b>▼</b><small>戻る</small>'; }
  else { f.disabled = !!$('start').disabled; f.innerHTML = '<b>▶</b><small>ナビ開始</small>'; }
}
function initTabs() {
  document.querySelectorAll('.tb').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $('navFab').onclick = () => { if (navOn) $('moreBtn').click(); else startNav(); };
  showTab(curTab, true);
  fabTick(); setInterval(fabTick, 400);
}

// ---------- 境目のつまみ（縦向きのスマホだけ。ナビ前とナビ中で別々に覚える） ----------
const SPLIT_DEF = {navi_split: 50, navi_split_drive: 70};
function splitKey() { return navOn ? 'navi_split_drive' : 'navi_split'; }
function applySplit() {
  const r = document.documentElement.style;
  r.setProperty('--split', Number(lsGetStr('navi_split', SPLIT_DEF.navi_split)) + '%');
  r.setProperty('--splitD', Number(lsGetStr('navi_split_drive', SPLIT_DEF.navi_split_drive)) + '%');
}
function initGrip() {
  applySplit();
  const g = $('grip'); let drag = false, moved = false, lastUp = 0, rz = 0;
  g.addEventListener('pointerdown', e => { drag = true; moved = false; g.classList.add('drag'); try { g.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
  g.addEventListener('pointermove', e => {
    if (!drag) return;
    const pct = Math.max(20, Math.min(80, e.clientY / window.innerHeight * 100));
    document.documentElement.style.setProperty(navOn ? '--splitD' : '--split', pct.toFixed(1) + '%');
    moved = true;
    if (Date.now() - rz > 100) { rz = Date.now(); try { map && map.resize && map.resize(); } catch (x) {} }
  });
  const up = e => {
    if (!drag) return; drag = false; g.classList.remove('drag');
    const k = splitKey(), v = navOn ? '--splitD' : '--split';
    if (moved) lsSetStr(k, parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) || SPLIT_DEF[k]);
    else if (Date.now() - lastUp < 400) { try { localStorage.removeItem(k); } catch (x) {} applySplit(); } // 2回タップで元に戻す
    lastUp = moved ? 0 : Date.now();
    resizeSoon();
  };
  g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
}

// ---------- 押して選ぶ並び（設定のプルダウンを丸いボタンの並びに） ----------
function initChips() {
  document.querySelectorAll('select.hid').forEach(sel => {
    const box = document.createElement('div'); box.className = 'chips'; box.dataset.for = sel.id;
    const unit = sel.dataset.unit || '';
    Array.from(sel.options).forEach(o => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.v = o.value;
      b.textContent = o.textContent + unit;
      b.onclick = () => { sel.value = o.value; sel.dispatchEvent(new Event('change')); syncChips(); };
      box.appendChild(b);
    });
    sel.after(box);
  });
  syncChips(); setInterval(syncChips, 1000);
}
function syncChips() {
  document.querySelectorAll('.chips').forEach(box => {
    const v = $(box.dataset.for).value;
    box.querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  });
}

// ---------- ホーム画面に追加 ----------
let installEv = null;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; appRow(); });
window.addEventListener('appinstalled', () => { installEv = null; showErr('ホーム画面に追加しました'); appRow(); });
function appRow() {
  if (isStandalone()) { $('appState').textContent = '📱 ホーム画面のアプリとして起動中'; $('appAdd').style.display = 'none'; $('appHow').textContent = ''; return; }
  $('appState').textContent = 'ホーム画面に追加すると、アドレス欄のないアプリの画面で開けます。';
  $('appAdd').style.display = '';
}
function initApp() {
  appRow();
  $('appAdd').onclick = async () => {
    if (installEv) { installEv.prompt(); try { await installEv.userChoice; } catch (e) {} installEv = null; appRow(); return; }
    $('appHow').textContent = isIOS()
      ? 'iPhone：画面の下の共有ボタン（四角から上向きの矢印）→「ホーム画面に追加」。Chrome のときは右上の共有ボタンから。ホーム画面から開いたアプリは、Safari とは保存場所が別になります（登録したICなどは入れ直しが必要）。'
      : 'Chrome の右上の「︙」→「ホーム画面に追加」→「インストール」を押してください。';
  };
}

// ---------- 地図の長押し（パソコンは右クリック）：目的地・経由地・出発地 ----------
let pickPt = null;
function openPick(p) {
  pickPt = p;
  $('pmDest').textContent = navOn ? 'ここを目的地にする（経由地はそのまま）' : 'ここを目的地にする';
  const full = vias.length >= VIA_MAX;
  $('pmVia').disabled = !dest || full;
  $('pmVia').textContent = full ? '経由地は3か所までです' : !dest ? '経由地（先に目的地を決めてください）' : 'ここに寄ってから行く（経由地）';
  $('pmOrigin').style.display = navOn ? 'none' : '';
  $('pickModal').style.display = 'flex';
}
function closePick() { $('pickModal').style.display = 'none'; pickPt = null; }
function initLongPress() {
  const el = map.getContainer ? map.getContainer() : $('map');
  let t = null, sx = 0, sy = 0;
  const cancel = () => clearTimeout(t);
  el.addEventListener('touchstart', e => {
    cancel();
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    t = setTimeout(() => {
      if (!map.unproject) return;
      const r = el.getBoundingClientRect(), ll = map.unproject([sx - r.left, sy - r.top]);
      openPick([ll.lng, ll.lat]);
    }, 600);
  }, {passive: true});
  el.addEventListener('touchmove', e => { if (Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 10) cancel(); }, {passive: true});
  el.addEventListener('touchend', cancel); el.addEventListener('touchcancel', cancel);
  if (map.on) map.on('contextmenu', e => { if (e && e.lngLat) openPick([e.lngLat.lng, e.lngLat.lat]); });
  $('pmDest').onclick = () => { const p = pickPt; closePick(); setDest(p, '地図で指定した場所'); };
  $('pmVia').onclick = () => { const p = pickPt; closePick(); addVia(p, '地図で選んだ地点'); };
  $('pmOrigin').onclick = () => { const p = pickPt; closePick(); setOrigin(p); };
  $('pmCancel').onclick = closePick;
  $('pickModal').onclick = e => { if (e.target === $('pickModal')) closePick(); };
}

function initUi() {
  initTabs();
  initLongPress();
  renderFavs(); renderOrigin(); updLoc();
  initGrip();
  initChips();
  initApp();
  initMapBtns();
  initTheme();
  initResume();
  checkVersion();
  $('stop').onclick = stopPress;
  readShareLink(); // 共有リンクから開いたとき
}
