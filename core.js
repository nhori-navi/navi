// KomuMiru：設定・共通の変数・計算の道具（最初に読み込む）
// ▼▼▼ ここにトークンを貼る（pk. で始まる文字列） ▼▼▼
const TOKEN = 'pk.eyJ1IjoiaG9yaWhha28iLCJhIjoiY211djd0ejljMDA5ZjMycHYxaTY3M3BsdSJ9.a1yefJYynC4k_YvllM5DVw';
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

let map = null; // 地図は main.js で作る

const $ = id => document.getElementById(id);
const COLORS = {low:'#2ecc71', moderate:'#f1c40f', heavy:'#e67e22', severe:'#c0392b', unknown:'#5dade2'};
const INC = {accident:'事故', congestion:'渋滞', construction:'工事', disabled_vehicle:'故障車',
  lane_restriction:'車線規制', road_closure:'通行止め', road_hazard:'路上障害物', weather:'気象',
  planned_event:'イベント', mass_transit:'公共交通', other_news:'その他', miscellaneous:'その他'};
const MAX_REQ = 400;

let reqCount = 0, pos = null, speed = null, dest = null, destMarker = null, posMarker = null;
let pickMode = false, icPick = false, navOn = false, follow = true, active = null, proposal = null;
let offCount = 0, busy = false, judging = false, lastJudge = 0, timer = null, wakeLock = null;
let preferGeneral = false;
let viaEntry = null, entryPending = false; // 選んだ入口（IC）／ナビ開始後に入口の比較を行う印
const spoken = new Set(), spokenInc = new Set(), spokenFac = new Set(), ignored = {};
let ics = [];
try { ics = JSON.parse(localStorage.getItem('navi_ics') || '[]'); } catch (e) { ics = []; }

// ---------- 共通 ----------
function showErr(m) {
  const t = new Date().toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'});
  $('err').innerHTML = `<div>${t} ${m}</div>` + $('err').innerHTML.split('</div>').slice(0, 2).join('</div>');
}
function speak(t) {
  try { const u = new SpeechSynthesisUtterance(t); u.lang = 'ja-JP'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
}
function setData(id, f) { const s = map.getSource(id); if (s) s.setData({type:'FeatureCollection', features:f}); }
function hhmm(sec) { return new Date(Date.now() + sec * 1000).toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}); }
function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.max(0, Math.round(m / 50) * 50) + 'm'; }
const fmtKm = v => (v >= 0 ? '+' : '') + v.toFixed(1) + 'km';
const sgn = v => (v > 0 ? '+' : '') + v;
const wkm = () => Number($('wkm').value);
async function keepAwake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (navOn && document.visibilityState === 'visible') keepAwake(); });

// ---------- 距離・方角の計算 ----------
function distM(a, b) {
  const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos((a[1] + b[1]) / 2 * r), y = (b[1] - a[1]) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}
function segDist(p, a, b) {
  const k = Math.cos(p[1] * Math.PI / 180) * 111320, m = 110540;
  const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * m, bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * m;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx, y = ay + t * dy;
  return {d: Math.sqrt(x * x + y * y), t};
}
function nearest(coords, p) {
  let best = {d: 1e12, i: 0, t: 0};
  for (let i = 0; i < coords.length - 1; i++) {
    const s = segDist(p, coords[i], coords[i + 1]);
    if (s.d < best.d) best = {d: s.d, i, t: s.t};
  }
  return best;
}
function along(c, p) {
  const n = nearest(c.coords, p), a = c.cum[n.i], b = c.cum[n.i + 1];
  return b === undefined ? a : a + n.t * (b - a);
}
function bearing(a, b) { const k = Math.cos(a[1] * Math.PI / 180); return Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180 / Math.PI; }
function offsetPt(p, brg, d) {
  const k = Math.cos(p[1] * Math.PI / 180) * 111320, m = 110540, r = brg * Math.PI / 180;
  return [p[0] + Math.sin(r) * d / k, p[1] + Math.cos(r) * d / m];
}
const totalOf = c => c.cum[c.cum.length - 1];
const remDist = c => pos ? Math.max(0, totalOf(c) - along(c, pos)) : totalOf(c);
// 道のりの位置 a までにかかる時間（秒）。区間ごとの所要時間があればそれで、なければ距離の割合で
function timeAt(c, a) {
  const T = totalOf(c); if (!T) return 0;
  if (!c.ct) return c.r.duration * Math.min(a, T) / T;
  let lo = 0, hi = c.cum.length - 1;
  if (a <= 0) return 0; if (a >= T) return c.ct[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c.cum[m] <= a) lo = m; else hi = m; }
  const s = c.cum[hi] - c.cum[lo];
  return c.ct[lo] + (s ? (a - c.cum[lo]) / s : 0) * (c.ct[hi] - c.ct[lo]);
}
const remDur = c => totalOf(c) ? timeAt(c, totalOf(c)) - (pos ? timeAt(c, along(c, pos)) : 0) : 0;
function jamAhead(c) {
  const n = pos ? nearest(c.coords, pos).i : 0; let j = 0;
  for (let i = n; i < c.coords.length - 1; i++) {
    const g = c.cong[i]; if (g === 'heavy' || g === 'severe') j += c.cum[i + 1] - c.cum[i];
  }
  return j;
}
function sameAs(c, base) {
  if (!base || base.coords.length < 2) return false;
  const pts = c.coords, step = Math.max(1, Math.floor(pts.length / 40)); let hit = 0, n = 0;
  for (let i = 0; i < pts.length; i += step) { n++; if (nearest(base.coords, pts[i]).d < 40) hit++; }
  return hit / n >= 0.85;
}
// 実質の得（分）：時間の短縮 − 遠回り距離×設定値
// 実質の得（分）：時間の短縮 − 遠回り距離×設定値 − 心的負担の増えた分×重み
function scoreGain(c) {
  return (remDur(active) - remDur(c)) / 60 - wkm() * (remDist(c) - remDist(active)) / 1000 - bdw() * (bdNow(c).min - bdNow(active).min);
}

// ---------- 心的負担 ----------
// 換算：重み「中」のとき、1つ（細い道は1km）あたり何分の損とみなすか
const BD_MIN = {right: 0.5, uturn: 0.5, left: 0.2, signal: 0.1, rail: 1, curve: 0.3, narrowKm: 2};
const NARROW = ['street', 'street_limited', 'service', 'track']; // 細い道とみなす道路の種類（Mapbox の分類）
const bdw = () => { const e = $('bdw'); return e ? Number(e.value) : 1; };
// 道のりの位置 a の地点
function pointAt(c, a) {
  const T = totalOf(c); if (a <= 0) return c.coords[0]; if (a >= T) return c.coords[c.coords.length - 1];
  let lo = 0, hi = c.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c.cum[m] <= a) lo = m; else hi = m; }
  const s = c.cum[hi] - c.cum[lo], t = s ? (a - c.cum[lo]) / s : 0, p = c.coords[lo], q = c.coords[hi];
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}
// 地点 p の道のりの位置（前から順に探すので、i から先だけを見る）
function alongFrom(c, p, i) {
  let best = {d: 1e12, i, t: 0};
  for (let k = i; k < c.coords.length - 1 && k < i + 600; k++) {
    const s = segDist(p, c.coords[k], c.coords[k + 1]);
    if (s.d < best.d) best = {d: s.d, i: k, t: s.t};
    if (best.d < 3 && s.d > 200) break;
  }
  if (best.d > 100) { const n = nearest(c.coords, p); best = {d: n.d, i: n.i, t: n.t}; }
  const a = c.cum[best.i], b = c.cum[best.i + 1];
  return {a: b === undefined ? a : a + best.t * (b - a), i: best.i};
}
// ルートごとに一度だけ、右左折・信号・踏切・細い道・急カーブの位置を調べて覚えておく
function bdData(c) {
  if (c._bd) return c._bd;
  const steps = [].concat(...c.r.legs.map(l => l.steps || []));
  const man = [], manA = [], sig = [], rail = [], road = [];
  let i = 0;
  steps.forEach(st => {
    const t = st.maneuver.type, m = st.maneuver.modifier || '';
    const pm = alongFrom(c, st.maneuver.location, i); i = pm.i; manA.push(pm.a);
    if (!['depart', 'arrive', 'merge', 'notification', 'roundabout', 'rotary', 'exit roundabout', 'exit rotary'].includes(t)) {
      const k = m === 'uturn' ? 'uturn' : (m === 'right' || m === 'sharp right') ? 'right' : (m === 'left' || m === 'sharp left') ? 'left' : null;
      if (k) man.push({a: pm.a, k});
    }
    (st.intersections || []).forEach(x => {
      let a;
      if (x.geometry_index !== undefined && c.cum[x.geometry_index] !== undefined) a = c.cum[x.geometry_index];
      else { const q = alongFrom(c, x.location, i); a = q.a; i = q.i; }
      if (x.traffic_signal) sig.push(a);
      if (x.railway_crossing) rail.push(a);
      if (x.mapbox_streets_v8 && x.mapbox_streets_v8.class) road.push({a, cls: x.mapbox_streets_v8.class});
    });
  });
  const T = totalOf(c), narrow = [];
  road.sort((x, y) => x.a - y.a).forEach((x, k) => { if (NARROW.includes(x.cls)) narrow.push([x.a, k + 1 < road.length ? road[k + 1].a : T]); });
  // 急カーブ：前後50mの向きが60度以上変わる所（曲がり角の案内がある所は除く）
  const curves = []; let inC = false, start = 0;
  for (let a = 50; a <= T - 50; a += 20) {
    const p0 = pointAt(c, a - 50), p1 = pointAt(c, a), p2 = pointAt(c, a + 50);
    let d = 0;
    if (distM(p0, p1) > 30 && distM(p1, p2) > 30) { d = Math.abs(bearing(p1, p2) - bearing(p0, p1)); if (d > 180) d = 360 - d; }
    if (d >= 60) { if (!inC) { inC = true; start = a; } }
    else if (inC) { inC = false; curves.push(start); }
  }
  if (inC) curves.push(start);
  c._bd = {man, sig, rail, narrow, curves: curves.filter(a => !manA.some(m => Math.abs(m - a) < 80)), hasRoad: road.length > 0};
  return c._bd;
}
// 道のりの位置 from から先の負担
function burden(c, from) {
  const d = bdData(c), f = from || 0;
  const b = {right: 0, uturn: 0, left: 0, signal: 0, rail: 0, curve: 0, narrowKm: 0};
  d.man.forEach(x => { if (x.a >= f) b[x.k]++; });
  d.sig.forEach(a => { if (a >= f) b.signal++; });
  d.rail.forEach(a => { if (a >= f) b.rail++; });
  d.curves.forEach(a => { if (a >= f) b.curve++; });
  d.narrow.forEach(([a0, a1]) => { const s = Math.max(a0, f); if (a1 > s) b.narrowKm += (a1 - s) / 1000; });
  return bdFinish(b, Math.max(0, totalOf(c) - f) / 1000);
}
// 合計の分数と、低・中・高の目安（10kmあたりの負担で決める。距離が短くても5kmとして数える）
function bdFinish(b, km) {
  b.km = km; b.min = 0;
  for (const k in BD_MIN) b.min += BD_MIN[k] * b[k];
  const per10 = b.min / Math.max(5, km) * 10;
  b.level = per10 < 3 ? '低' : per10 < 7 ? '中' : '高';
  return b;
}
// いくつかの区間（降りてから一般道、など）の負担を足し合わせる
function bdSum(list) {
  const b = {right: 0, uturn: 0, left: 0, signal: 0, rail: 0, curve: 0, narrowKm: 0}; let km = 0;
  list.forEach(x => { for (const k in b) b[k] += x[k]; km += x.km; });
  return bdFinish(b, km);
}
// 今いる位置から先の負担（ルートの上にいなければ最初から）
const bdNow = c => burden(c, pos && nearest(c.coords, pos).d < 300 ? along(c, pos) : 0);
function bdText(b) {
  const p = [];
  if (b.right) p.push('右折' + b.right);
  if (b.uturn) p.push('Uターン' + b.uturn);
  if (b.left) p.push('左折' + b.left);
  if (b.signal) p.push('信号' + b.signal);
  if (b.rail) p.push('踏切' + b.rail);
  if (b.curve) p.push('急カーブ' + b.curve);
  if (b.narrowKm >= 0.1) p.push('細い道' + b.narrowKm.toFixed(1) + 'km');
  return `負担 ${b.level}（${p.join('・') || 'ほぼなし'}）`;
}
// 信号・踏切・道路の種類のデータが来ていないときの注意書き
function bdNote(c) {
  const d = bdData(c);
  return (!d.sig.length && !d.rail.length && !d.hasRoad) ? '<div class="small">※信号・踏切・道路の種類のデータがないため、負担は右左折と急カーブだけで数えています</div>' : '';
}
// 高速道路かどうか
const isMwStep = s => (s.intersections || []).some(x => (x.classes || []).includes('motorway'));
function curStepIdx(my) {
  for (let s = 1; s < active.steps.length; s++) if (active.manAlong[s] > my + 5) return s - 1;
  return Math.max(0, active.steps.length - 1);
}
function firstExitAlong(c) {
  const st = (c.r.legs[0] && c.r.legs[0].steps) || [];
  for (let i = 1; i < st.length; i++) {
    if (isMwStep(st[i - 1]) && !isMwStep(st[i]))
      return {a: along(c, st[i].maneuver.location), txt: st[i - 1].maneuver.instruction || st[i].maneuver.instruction || ''};
  }
  return null;
}
function earlyExit(c, my) {
  const ce = firstExitAlong(c); if (!ce) return null;
  const ae = firstExitAlong(active);
  const activeExit = ae ? ae.a - my : totalOf(active) - my;
  return ce.a < activeExit - 1000 ? (ce.txt || '途中の出口') : null;
}
// この先にある登録済み出口（ルートから1.5km以内）
function exitsAhead(my) {
  if (!active) return [];
  return ics.map(ic => { const n = nearest(active.coords, ic.p); return {ic, off: n.d, a: active.cum[n.i] - my}; })
    .filter(x => x.off < 1500 && x.a > 100).sort((a, b) => a.a - b.a);
}
// この先の最初の渋滞区間（15km以内）
function jamSpan(my) {
  const c = active; let i1 = -1;
  for (let i = 0; i < c.coords.length - 1; i++) {
    if (c.cum[i] < my) continue; if (c.cum[i] > my + 15000) break;
    const g = c.cong[i]; if (g === 'heavy' || g === 'severe') { i1 = i; break; }
  }
  if (i1 < 0) return null;
  let i2 = i1, gap = 0;
  for (let i = i1 + 1; i < c.coords.length - 1; i++) {
    const g = c.cong[i];
    if (g === 'heavy' || g === 'severe') { i2 = i; gap = 0; } else if (++gap > 5) break;
  }
  if (c.cum[i2 + 1] - c.cum[i1] < 300) return null;
  return {i1, i2: i2 + 1};
}
