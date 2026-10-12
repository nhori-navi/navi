// KomuMiru：OpenStreetMap から出口・入口・IC・JCT・SA・PA を取る／ハイウェイモード

// ---------- OpenStreetMap（Overpass）の取得：3か所に同時に頼み、最初に返ってきた答えを使う ----------
const OVERPASS = [['https://overpass-api.de/api/interpreter', '本家'],
  ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'VK'],
  ['https://overpass.kumi.systems/api/interpreter', 'kumi']];
async function overpass(q) {
  const reasons = [];
  const one = async ([u, label]) => {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(u, {method:'POST', body:'data=' + encodeURIComponent(q),
        headers:{'Content-Type':'application/x-www-form-urlencoded'}, signal: ctl.signal});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      let j; try { j = await r.json(); } catch (e) { throw new Error('応答が壊れていた'); }
      if (j.remark && /error/i.test(j.remark)) throw new Error('混雑で打ち切り');
      return j.elements || [];
    } catch (e) {
      reasons.push(label + '：' + (e.name === 'AbortError' ? '時間切れ' : e.name === 'TypeError' ? '接続できず' : e.message));
      throw e;
    } finally { clearTimeout(tm); }
  };
  try { return await Promise.any(OVERPASS.map(one)); }
  catch (e) { throw new Error(reasons.join('、')); }
}

// ---------- 出口の自動取得（OpenStreetMap）＋登録済み ----------
async function findExits(my) {
  const res = [];
  exitsAhead(my).filter(x => x.a > 300 && x.a < 40000)
    .forEach(x => res.push({name: x.ic.name, E: x.ic.p, a: x.a}));
  try {
    const pts = []; let next = my;
    for (let i = 0; i < active.coords.length; i++) {
      const a = active.cum[i];
      if (a < my) continue; if (a > my + 40000) break;
      if (a >= next) { pts.push(active.coords[i]); next = a + 1000; }
    }
    if (pts.length >= 2) {
      const ll = pts.map(p => p[1].toFixed(5) + ',' + p[0].toFixed(5)).join(',');
      const q = `[out:json][timeout:15];(node["highway"="motorway_junction"](around:150,${ll});node["barrier"="toll_booth"](around:2000,${ll}););out body;`;
      const els = await overpass(q);
      const booths = els.filter(e => e.tags && e.tags.barrier === 'toll_booth')
        .map(e => [e.lon, e.lat]).filter(p => nearest(active.coords, p).d > 40);
      els.filter(e => e.tags && e.tags.highway === 'motorway_junction').forEach(jn => {
        const p = [jn.lon, jn.lat], a = active.cum[nearest(active.coords, p).i] - my;
        if (a < 300 || a > 40000) return;
        let best = null;
        booths.forEach(b => { const d = distM(p, b); if (d < 1500 && (!best || d < best.d)) best = {b, d}; });
        if (!best) return;
        const name = jn.tags.name || jn.tags.ref || '出口';
        if (res.some(x => Math.abs(x.a - a) < 1500 || x.name === name)) return;
        res.push({name, E: best.b, a});
      });
    }
  } catch (e) { showErr('出口の自動取得に失敗しました（' + e.message + '）。登録済みの出口とMapboxの代替で判定します'); }
  return res.sort((x, y) => x.a - y.a).slice(0, 3);
}

// ---------- 乗るIC（入口）の自動取得（OpenStreetMap）＋登録済み ----------
function entryName(n) {
  n = (n || '').trim();
  if (/出口$/.test(n)) return n.replace(/出口$/, '入口');
  if (!/(IC|ＩＣ|インター|入口|ランプ)$/.test(n)) n += 'IC';
  return n;
}
// 料金所・IC・JCT・SA・PAの位置は 0.25度（約25km）のマスごとに端末に保存し、90日は取り直さない
const OSM_KEY = 'navi_osm_v1', ENT_T = 0.25, ENT_DAYS = 90, ENT_MAX = 80;
let entCache = {};
try { entCache = JSON.parse(localStorage.getItem(OSM_KEY) || '{}') || {}; localStorage.removeItem('navi_entry_v1'); } catch (e) { entCache = {}; }
function saveEntCache() {
  const keys = Object.keys(entCache).sort((a, b) => entCache[a].t - entCache[b].t);
  while (keys.length > ENT_MAX) delete entCache[keys.shift()];
  for (let k = 0; k < 5; k++) {
    try { localStorage.setItem(OSM_KEY, JSON.stringify(entCache)); return; }
    catch (e) { const old = keys.shift(); if (!old) return; delete entCache[old]; }
  }
}
const tileOf = p => Math.floor(p[0] / ENT_T) + ',' + Math.floor(p[1] / ENT_T);
// マス（"x,y" の一覧）のデータを返す。足りないマスだけ Overpass で取る
async function loadTiles(keys) {
  const now = Date.now();
  const need = keys.filter(k => { const t = entCache[k]; return !t || now - t.t > ENT_DAYS * 864e5; });
  let err = null;
  if (need.length) {
    const bbs = need.map(k => { const [x, y] = k.split(',').map(Number);
      return [y * ENT_T, x * ENT_T, (y + 1) * ENT_T, (x + 1) * ENT_T].map(v => v.toFixed(3)).join(','); });
    const u = f => '(' + bbs.map(bb => f + '(' + bb + ');').join('') + ')';
    // 料金所（本線上の料金所は除く）、IC・JCTの分かれ目、SA・PA
    const q = `[out:json][timeout:25];${u('node["barrier"="toll_booth"]')}->.b;way(bn.b)["highway"="motorway"]->.m;(.b; - node(w.m););out body;`
      + `${u('node["highway"="motorway_junction"]')};out body;${u('nwr["highway"~"^(services|rest_area)$"]')};out center;`;
    try {
      const els = await overpass(q);
      const fresh = {};
      need.forEach(k => fresh[k] = {t: now, b: [], j: [], s: []});
      els.forEach(e => {
        if (!e.tags) return;
        const lon = e.lon !== undefined ? e.lon : e.center && e.center.lon, lat = e.lat !== undefined ? e.lat : e.center && e.center.lat;
        if (lon === undefined) return;
        const t = fresh[tileOf([lon, lat])]; if (!t) return;
        const ll = [Number(lon.toFixed(5)), Number(lat.toFixed(5))];
        if (e.tags.barrier === 'toll_booth') t.b.push([ll[0], ll[1], e.tags.name || '']);
        else if (e.tags.highway === 'motorway_junction' && (e.tags.name || e.tags.ref)) t.j.push([ll[0], ll[1], e.tags.name || e.tags.ref]);
        else if (e.tags.highway === 'services' || e.tags.highway === 'rest_area')
          t.s.push([ll[0], ll[1], e.tags.name || '', e.tags.highway === 'services' ? 'SA' : 'PA']);
      });
      Object.assign(entCache, fresh); saveEntCache();
    } catch (e) { err = e; }
  }
  const b = [], j = [], sv = [];
  keys.forEach(k => { const t = entCache[k]; if (t) { b.push(...t.b); j.push(...t.j); sv.push(...(t.s || [])); } });
  return {b, j, s: sv, err, missing: keys.filter(k => !entCache[k]).length};
}
async function loadEntryTiles(R) {
  const dLat = R / 110540, dLon = R / (111320 * Math.cos(pos[1] * Math.PI / 180));
  const x0 = Math.floor((pos[0] - dLon) / ENT_T), x1 = Math.floor((pos[0] + dLon) / ENT_T);
  const y0 = Math.floor((pos[1] - dLat) / ENT_T), y1 = Math.floor((pos[1] + dLat) / ENT_T);
  const keys = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(x + ',' + y);
  return loadTiles(keys);
}

// ---------- ハイウェイモード：この先のIC・JCT・SA・PA ----------
let facBusy = false, facFailAt = 0;
function facName(n, type) {
  n = (n || '').trim().replace(/[（(][^）)]*[上下]り[^）)]*[）)]/g, '').replace(/サービスエリア/g, 'SA').replace(/パーキングエリア/g, 'PA').replace(/ジャンクション/g, 'JCT').trim();
  if (type === 'IC' && !/(IC|ＩＣ|インター|出口|入口|ランプ)$/.test(n)) n += 'IC';
  if ((type === 'SA' || type === 'PA') && !/(SA|PA|ハイウェイオアシス)$/.test(n)) n += type;
  return n;
}
// 進行方向に対して左側なら正（日本は左側通行なので、自分の側のSA・PAは左にある）
function sideOf(c, i, p) {
  const a = c.coords[i], b = c.coords[i + 1] || a, k = Math.cos(a[1] * Math.PI / 180);
  const vx = (b[0] - a[0]) * k, vy = b[1] - a[1], wx = (p[0] - a[0]) * k, wy = p[1] - a[1];
  return vx * wy - vy * wx;
}
function buildFacilities(c, data) {
  const list = [];
  const add = (type, name, p, a) => {
    if (!name || a < 0) return;
    if (list.some(x => (x.name === name && Math.abs(x.a - a) < 3000) || (x.type === type && Math.abs(x.a - a) < 700))) return;
    list.push({type, name, p, a});
  };
  const onMw = i => c.mw && c.mw[i];
  data.j.forEach(v => {
    const p = [v[0], v[1]], n = nearest(c.coords, p);
    if (!onMw(n.i)) return;
    // 分かれ目は自分の車線の上にある。少し離れていて右側なら反対車線のものなので除く
    if (n.d > 60 || (n.d > 12 && sideOf(c, n.i, p) < 0)) return;
    const raw = v[2], type = /JCT|ジャンクション/.test(raw) ? 'JCT' : /SA|サービスエリア/.test(raw) ? 'SA' : /PA|パーキングエリア/.test(raw) ? 'PA' : 'IC';
    add(type, facName(raw, type), p, c.cum[n.i] + n.t * (c.cum[n.i + 1] - c.cum[n.i]));
  });
  data.s.forEach(v => {
    const p = [v[0], v[1]], n = nearest(c.coords, p);
    if (!onMw(n.i) || n.d > 500 || sideOf(c, n.i, p) < 0) return;
    add(v[3], facName(v[2], v[3]), p, c.cum[n.i] + n.t * (c.cum[n.i + 1] - c.cum[n.i]));
  });
  // Mapbox の経路データにあるSA・PA・料金所も使う
  c.steps.forEach(st => (st.intersections || []).forEach(x => {
    const rs = x.rest_stop, tc = x.toll_collection;
    if (rs && rs.name) { const type = rs.type === 'service_area' ? 'SA' : 'PA'; add(type, facName(rs.name, type), x.location, along(c, x.location)); }
    if (tc && tc.type === 'toll_booth' && (x.classes || []).includes('motorway')) add('料金所', facName(tc.name || '本線料金所', ''), x.location, along(c, x.location));
  }));
  return list.sort((x, y) => x.a - y.a);
}
async function prepFacilities(c) {
  c.steps = c.steps || (c.r.legs[0] && c.r.legs[0].steps) || [];
  // 区間ごとに高速道路かどうか
  c.mw = new Array(c.coords.length).fill(false);
  let any = false;
  c.steps.forEach(st => { if (!isMwStep(st)) return; any = true;
    const a0 = along(c, st.maneuver.location), a1 = a0 + (st.distance || 0);
    for (let i = 0; i < c.coords.length; i++) if (c.cum[i] >= a0 - 30 && c.cum[i] <= a1 + 30) c.mw[i] = true; });
  if (!any) { c.fac = []; return; }
  const keys = []; let next = 0;
  for (let i = 0; i < c.coords.length; i++) if (c.mw[i] && c.cum[i] >= next) { const k = tileOf(c.coords[i]); if (!keys.includes(k)) keys.push(k); next = c.cum[i] + 2000; }
  const ready = keys.every(k => entCache[k]);
  if (ready || facBusy || Date.now() - facFailAt < 5 * 60000) {
    c.fac = buildFacilities(c, await loadTiles(keys.filter(k => entCache[k])));
    return;
  }
  facBusy = true;
  try {
    const data = await loadTiles(keys);
    if (data.err) { facFailAt = Date.now(); showErr('IC・SA・PAの取得に失敗しました（' + data.err.message + '）。経路データにある分だけ表示します'); }
    c.fac = buildFacilities(c, data);
  } finally { facBusy = false; }
  if (c === active && pos) guide();
}
function facLabel(t) { return {IC: 'IC', JCT: 'JCT', SA: 'SA', PA: 'PA', '料金所': '料金'}[t] || t; }
const FAC_COLOR = {IC: '#1f3a93', JCT: '#6c3483', SA: '#2e7d32', PA: '#558b2f', '料金所': '#7f8c8d'};
function readName(n) { return n.replace(/SA$/, 'サービスエリア').replace(/PA$/, 'パーキングエリア').replace(/JCT$/, 'ジャンクション').replace(/IC$/, 'インターチェンジ'); }
function jamBetween(c, a1, a2) {
  let j = 0;
  for (let i = 0; i < c.coords.length - 1; i++) {
    if (c.cum[i + 1] <= a1) continue; if (c.cum[i] >= a2) break;
    const g = c.cong[i]; if (g === 'heavy' || g === 'severe') j += Math.min(c.cum[i + 1], a2) - Math.max(c.cum[i], a1);
  }
  return j;
}
function renderHighway(my, onMw) {
  const box = $('hwy');
  const ahead = onMw && active.fac ? active.fac.filter(f => f.a > my + 50).slice(0, 5) : [];
  if (!ahead.length) { box.style.display = 'none'; return; }
  const t0 = timeAt(active, my);
  let h = '', prev = my;
  ahead.forEach(f => {
    const jam = jamBetween(active, prev, f.a);
    if (jam >= 300) h += `<div class="jam">▲ 渋滞 ${(jam / 1000).toFixed(1)}km</div>`;
    h += `<div class="fac"><span class="t" style="background:${FAC_COLOR[f.type] || '#555'}">${facLabel(f.type)}</span>`
      + `<span class="n">${f.name}</span><span class="d">${fmtDist(f.a - my)}　${hhmm(timeAt(active, f.a) - t0)}</span></div>`;
    prev = f.a;
  });
  box.innerHTML = h + '<div class="small" style="text-align:right">この先の施設<button class="q" data-q="hwy">？</button></div>'; box.style.display = 'block';
  // SA・PA・JCTは2km手前で読み上げ
  const f = ahead.find(x => (x.type === 'SA' || x.type === 'PA' || x.type === 'JCT') && x.a - my <= 2000 && x.a - my > 300);
  if (f && !spokenFac.has(f.name)) { spokenFac.add(f.name); speak(`この先${fmtDist(f.a - my)}、${readName(f.name)}です`); }
}

async function findEntries() {
  const D = distM(pos, dest);
  if (D < 10000) return [];
  // 目的地へ向かう方向にあるものだけ（大きく逆戻りする入口は除く）
  const ok = p => distM(pos, p) + distM(p, dest) <= D * 1.25 + 2000;
  const groups = [];
  ics.forEach(ic => { if (ok(ic.p)) groups.push({name: ic.name, c: ic.p, pts: [ic.p]}); });
  const R = Math.round(Math.min(25000, Math.max(8000, D * 0.4)));
  const tiles = await loadEntryTiles(R);
  if (tiles.err) showErr('入口（IC）の自動取得に失敗しました（' + tiles.err.message + '）。'
    + (tiles.missing ? '登録済みの出口とMapboxの代替で比べます' : '前回保存した分で比べます'));
  const jns = tiles.j.filter(v => !isJct(v[2])).map(v => ({p: [v[0], v[1]], name: v[2]}));
  const osm = [];
  tiles.b.forEach(v => {
    const p = [v[0], v[1]]; if (distM(pos, p) > R || !ok(p)) return;
    let g = osm.find(x => x.pts.some(q2 => distM(q2, p) < 600));
    if (!g) {
      let jn = null; jns.forEach(x => { const d = distM(x.p, p); if (d < 2500 && (!jn || d < jn.d)) jn = {name: x.name, d}; });
      g = {name: entryName(jn ? jn.name : v[2].replace(/料金所$/, '')), c: p, pts: []}; osm.push(g);
    }
    if (g.pts.every(q2 => distM(q2, p) > 30)) g.pts.push(p);
  });
  osm.forEach(g => {
    if (g.name === 'IC') g.name = '名前のない入口';
    const same = groups.find(x => x.name === g.name || distM(x.c, g.c) < 1500);
    if (same) { g.pts.forEach(p => { if (same.pts.length < 3) same.pts.push(p); }); return; }
    groups.push(g);
  });
  // 近くて、目的地への回り道が少ないものから最大5か所
  const score = g => { const a = distM(pos, g.c); return a + 2 * (a + distM(g.c, dest) - D); };
  return groups.sort((x, y) => score(x) - score(y)).slice(0, 5);
}
const isJct = n => /JCT|ジャンクション/.test(n || '');
// ルートが初めて高速道路に入る地点（道のりの距離）。高速を使わないなら -1
function mwStartAlong(c) {
  const st = (c.r.legs[0] && c.r.legs[0].steps) || [];
  for (const s of st) for (const x of (s.intersections || []))
    if ((x.classes || []).includes('motorway')) return along(c, x.location);
  return -1;
}
async function entryCands() {
  const groups = await findEntries();
  let calls = 0; const MAX_CALLS = 8;
  const res = await Promise.all(groups.map(async g => {
    for (const p of g.pts.slice(0, 2)) {
      if (calls >= MAX_CALLS) return null;
      calls++;
      const r = await api([pos, p, dest], '&waypoints=0;2').then(x => x[0]).catch(() => null);
      if (!r) continue;
      const c = prep(r, g.name + 'から乗る');
      const ap = along(c, p), am = mwStartAlong(c);
      // 本当にその入口から高速に入っているものだけ残す（逆向きの車線に吸い寄せられた経路などは捨てる）
      if (nearest(c.coords, p).d > 300 || am < 0 || Math.abs(am - ap) > 2500) continue;
      return {name: g.name, p, c, ap};
    }
    return null;
  }));
  return res.filter(Boolean).map(x => ({
    label: `${x.name}から乗る（入口まで${fmtDist(x.ap)}）`, entry: true, name: x.name,
    dur: x.c.r.duration, dist: x.c.r.distance, geom: x.c.coords, pc: x.c,
    act: () => { setActive(x.c); viaEntry = {p: x.p, name: x.name}; }
  }));
}

