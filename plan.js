// KomuMiru：行き先を決めやすく、出発前に比べやすく（版11）
// ・🏠 家へ：お気に入りの1つを「家」にして（🏠）、🧭ルートの一番上のボタン1つで行き先に
// ・最近の行き先：検索や地図で決めた行き先を新しい順に10件（navi_hist）。お気に入りと同じ場所は入れない
// ・有料道路なしと比べる：結果のカードで exclude=toll を1回計算して並べる。「この道でナビ開始」は avoidToll で始める
// ・出発時刻で比べる：今・30分後・1時間後・1時間半後・2時間後（depart_at）。5回計算する
// ・（版12）出発前のひとこと：道中と行き先の天気（Open-Meteo）、日の入り。ナビ開始のときに1回だけ読み上げ
(window.KOMU_FV = window.KOMU_FV || {}).plan = 12;

// 有料道路を使わないルートで始めたか（ルートを外れて組み直すとき・定期比較の「今のルート」もそれに合わせる）
let avoidToll = false;

// ---------- 🏠 家 ----------
// navi_home＝家にしたお気に入りの位置 [経度, 緯度]。なければ名前が「家」「自宅」のお気に入り
function homeFav() {
  let hp = null;
  try { hp = JSON.parse(lsGetStr('navi_home', 'null')); } catch (e) { hp = null; }
  if (Array.isArray(hp)) return favs.find(f => distM(f.p, hp) < 30) || null;
  return favs.find(f => /^(家|自宅|🏠.*)$/.test(f.name.trim())) || null;
}
function setHome(i) {
  const f = favs[i]; if (!f) return;
  const cur = homeFav();
  if (cur && cur === f) { lsSetStr('navi_home', JSON.stringify([0, 0])); showErr('🏠 家の指定を外しました'); } // 外す（どのお気に入りにも当たらない位置）
  else { lsSetStr('navi_home', JSON.stringify(f.p)); showErr('🏠 「' + esc(f.name) + '」を家にしました'); }
  renderFavs(); renderHome();
}
function goHome() {
  const f = homeFav();
  if (!f) { showErr('家が決まっていません。★ お気に入りの 🏠 を押して、家にするお気に入りを決めてください'); showTab('route'); const c = $('favCard'); if (c && c.scrollIntoView) c.scrollIntoView({block: 'center'}); return; }
  setDest(f.p, f.name);
}
function renderHome() {
  const b = $('homeBtn'); if (!b) return;
  const f = homeFav();
  b.innerHTML = f ? `🏠 家へ<small>${esc(f.name)}</small>` : '🏠 家へ<small>お気に入りの 🏠 で家を決めてください</small>';
  b.classList.toggle('unset', !f);
}

// ---------- 最近の行き先 ----------
const HIST_KEY = 'navi_hist', HIST_MAX = 10, HIST_SHOW = 5;
let hist = [], histAll = false;
try { hist = JSON.parse(lsGetStr(HIST_KEY, '[]')) || []; if (!Array.isArray(hist)) hist = []; } catch (e) { hist = []; }
hist = hist.filter(h => h && Array.isArray(h.p) && h.name);
function saveHist() { lsSetStr(HIST_KEY, JSON.stringify(hist)); renderHist(); }
function addHist(p, name) {
  if (!p || favs.some(f => distM(f.p, p) < 50)) { renderHist(); return; } // お気に入りと同じ場所は入れない
  hist = hist.filter(h => distM(h.p, p) >= 50);
  hist.unshift({name: name || '地図で指定した場所', p: [Number(p[0].toFixed(5)), Number(p[1].toFixed(5))], t: Date.now()});
  hist = hist.slice(0, HIST_MAX); saveHist();
}
function renderHist() {
  const el = $('histList'); if (!el) return;
  const list = hist.filter(h => !favs.some(f => distM(f.p, h.p) < 50));
  if (!list.length) { el.innerHTML = ''; return; }
  const d = t => { const x = new Date(t || 0); return t ? `${x.getMonth() + 1}/${x.getDate()}` : ''; };
  const show = histAll ? list : list.slice(0, HIST_SHOW);
  el.innerHTML = '<div class="histH">最近の行き先</div>'
    + show.map(h => `<div class="histRow"><button class="histGo" data-hist="${hist.indexOf(h)}">🕘 ${esc(h.name)}<span>${d(h.t)}</span></button><button class="histDel" data-histdel="${hist.indexOf(h)}" aria-label="消す">✕</button></div>`).join('')
    + `<div class="histFoot">${list.length > HIST_SHOW ? `<button id="histMore">${histAll ? 'たたむ' : 'もっと見る（' + list.length + '件）'}</button>` : ''}<button id="histClear">履歴をすべて消す</button></div>`;
  el.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => { const h = hist[Number(b.dataset.hist)]; if (h) setDest(h.p, h.name); });
  el.querySelectorAll('[data-histdel]').forEach(b => b.onclick = () => { hist.splice(Number(b.dataset.histdel), 1); saveHist(); });
  if ($('histMore')) $('histMore').onclick = () => { histAll = !histAll; renderHist(); };
  $('histClear').onclick = () => { if (confirm('最近の行き先をすべて消しますか？')) { hist = []; saveHist(); } };
}

// ---------- 結果のカード：有料道路なし・出発時刻で比べる ----------
let tollCmp = null, timeCmp = null;
function planReset() { tollCmp = null; timeCmp = null; }
function planBtns() {
  return '<button id="rcToll">💴 有料道路なしと比べる</button><button id="rcTime">🕒 出発時刻で比べる</button>';
}
function planBind() {
  if ($('rcToll')) $('rcToll').onclick = compareToll;
  if ($('rcTime')) $('rcTime').onclick = compareTimes;
  document.querySelectorAll('[data-tollgo]').forEach(b => b.onclick = () => startNav({avoidToll: true}));
  if ($('tollMap')) $('tollMap').onclick = () => { if (tollCmp && tollCmp.c) { drawRoute(tollCmp.c); fitRoute(tollCmp.c); } };
  if ($('tollBack')) $('tollBack').onclick = () => { if (preview) { drawRoute(preview); fitRoute(preview); } };
}
async function compareToll() {
  if (!preview) return;
  tollCmp = {state: 'calc'}; renderCard('ok');
  try {
    const rs = await api([fromPt(), dest], '&exclude=toll');
    const c = prep(rs[0], '有料道路なし'); c.steps = [].concat(...c.r.legs.map(l => l.steps || []));
    tollCmp = {state: 'ok', c, same: sameAs(c, preview)};
  } catch (e) { tollCmp = {state: 'fail', msg: e.message}; }
  if (!navOn && dest) renderCard('ok');
}
// depart_at に渡す時刻（その場所の時刻、秒なし）
function departStr(t) {
  const d = new Date(t), z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}
const TIME_OFFS = [0, 30, 60, 90, 120]; // 分
async function compareTimes() {
  if (!preview) return;
  timeCmp = {state: 'calc'}; renderCard('ok');
  const base = Math.ceil(Date.now() / 60000) * 60000;
  const rows = await Promise.all(TIME_OFFS.map(async m => {
    const t = base + m * 60000;
    try {
      const rs = await api([fromPt(), dest], m ? '&depart_at=' + departStr(t) : '');
      return {m, t, dur: rs[0].duration, dist: rs[0].distance};
    } catch (e) { return {m, t, err: e.message}; }
  }));
  timeCmp = rows.every(r => r.err) ? {state: 'fail', msg: rows[0].err} : {state: 'ok', rows};
  if (!navOn && dest) renderCard('ok');
}
function planHtml() {
  let h = '';
  if (tollCmp) {
    h += '<div class="planBox">';
    if (tollCmp.state === 'calc') h += '<div class="small">有料道路を使わないルートを計算しています…</div>';
    else if (tollCmp.state === 'fail') h += `<div class="small" style="color:#c0392b">有料道路なしのルートを計算できませんでした（${esc(jaErr(tollCmp.msg))}）</div>`;
    else {
      const c = tollCmp.c, b = preview;
      if (tollCmp.same) h += '<div><b>💴 有料道路なし</b>：このルートと同じ道です（有料道路を使っていません）</div>';
      else {
        const dm = Math.round((c.r.duration - b.r.duration) / 60), dk = (c.r.distance - b.r.distance) / 1000;
        h += `<div><b>💴 有料道路なし</b>　到着 ${hhmm(c.r.duration)}（${sgn(dm)}分、距離${fmtKm(dk)}）</div>
          <div class="small">${bdText(burden(c, 0))}・ルート上の渋滞 ${(jamTotal(c) / 1000).toFixed(1)}km</div>
          <div class="small">料金は出せません（Mapbox の経路に日本の通行料金がないため）</div>
          <div class="acts"><button id="tollMap">地図で見る</button><button id="tollBack">元のルートを見る</button><button data-tollgo="1" class="primary">この道でナビ開始</button></div>`;
      }
    }
    h += '</div>';
  }
  if (timeCmp) {
    h += '<div class="planBox"><div><b>🕒 出発時刻で比べる</b></div>';
    if (timeCmp.state === 'calc') h += '<div class="small">5つの出発時刻で計算しています…</div>';
    else if (timeCmp.state === 'fail') h += `<div class="small" style="color:#c0392b">計算できませんでした（${esc(jaErr(timeCmp.msg))}）</div>`;
    else {
      const ok = timeCmp.rows.filter(r => !r.err), mx = Math.max(...ok.map(r => r.dur)), mn = Math.min(...ok.map(r => r.dur));
      const tm = t => new Date(t).toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'});
      timeCmp.rows.forEach(r => {
        if (r.err) { h += `<div class="tRow"><span class="tL">${tm(r.t)} 発${r.m ? '' : '（今）'}</span><span class="small">計算できませんでした</span></div>`; return; }
        const best = r.dur === mn && ok.length > 1;
        h += `<div class="tRow${best ? ' best' : ''}"><span class="tL">${tm(r.t)} 発${r.m ? '' : '（今）'} → ${tm(r.t + r.dur * 1000)} 着</span>`
          + `<span class="tBar"><i style="width:${Math.max(8, Math.round(r.dur / mx * 100))}%"></i></span><span class="tD">${durTxt(r.dur)}${best ? ' ★' : ''}</span></div>`;
      });
      h += `<div class="small">★＝所要時間がいちばん短い出発時刻。今に近い時刻は今の渋滞を少し混ぜ、先の時刻は普段の同じ曜日・時間の傾向で見積もります（連休の特別な渋滞や事故は読めません）。${origin ? '下調べの出発地からの計算です。' : ''}</div>`;
    }
    h += '</div>';
  }
  return h;
}

// ---------- ナビ中の判定：有料道路を使わない案 ----------
async function tollCand() {
  try {
    const rs = await api([pos, dest], '&exclude=toll');
    const c = prep(rs[0], '有料道路なし');
    if (active && sameAs(c, active)) return null;
    return {label: '有料道路を使わない', dur: c.r.duration, dist: c.r.distance, geom: c.coords, act: () => setActive(c), pc: c};
  } catch (e) { return null; }
}

// ---------- 版12：出発前のひとこと（道中と行き先の天気・日の入り） ----------
// 結果のカードのルートの上、最大6か所（出発地・約25kmごと・行き先）を「そこを通るころ」の予報で見る。
// 天気は Open-Meteo（無料・鍵なし）に1回だけ問い合わせる（地点は0.01°＝約1km単位）。同じルートなら30分は取り直さない
const WX_STEP_M = 25000, WX_MAX = 6, WX_KEEP_MIN = 30;
let wxCache = null; // {key, t, state:'calc'|'ok'|'fail', lines:[{ic, text}], say, sun}
function wxKey(c) { const a = c.coords[0], b = c.coords[c.coords.length - 1]; return [a, b].map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(';') + '|' + Math.round(c.r.distance / 1000); }
function wxPoints(c) {
  const D = totalOf(c), list = [0];
  for (let a = WX_STEP_M; a < D - WX_STEP_M / 2; a += WX_STEP_M) list.push(a);
  list.push(D);
  let use = list;
  if (list.length > WX_MAX) { use = []; for (let i = 0; i < WX_MAX; i++) use.push(list[Math.round(i * (list.length - 1) / (WX_MAX - 1))]); }
  return use.map((a, i) => ({a, p: pointAt(c, a), sec: timeAt(c, a), last: i === use.length - 1}));
}
// 天気の言い方：雪（降雪 >0 か天気の番号 71〜77・85・86）／雨（1時間に0.5mm以上か、強いにわか雨・雷雨）
function wxKind(w) {
  if (!w) return null;
  if ((w.sn || 0) > 0 || [71, 73, 75, 77, 85, 86].includes(w.code)) return 'snow';
  if ((w.pr || 0) >= 0.5 || [65, 67, 81, 82, 95, 96, 99].includes(w.code)) return 'rain';
  return null;
}
async function wxFetch(c) {
  if (!c || !c.coords) return;
  const key = wxKey(c);
  if (wxCache && wxCache.key === key && (wxCache.state === 'calc' || Date.now() - wxCache.t < WX_KEEP_MIN * 60000)) { wxCache.sun = sunInfo(c); return; }
  const pts = wxPoints(c), t0 = Date.now();
  wxCache = {key, t: t0, state: 'calc', lines: [], say: '', sun: sunInfo(c)};
  const my = wxCache;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + pts.map(x => x.p[1].toFixed(2)).join(',')
      + '&longitude=' + pts.map(x => x.p[0].toFixed(2)).join(',')
      + '&hourly=precipitation,snowfall,temperature_2m,weather_code&forecast_days=3&timezone=Asia%2FTokyo';
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 12000);
    const res = await fetch(url, {signal: ctl.signal}); clearTimeout(tm);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    let js = await res.json(); if (!Array.isArray(js)) js = [js];
    const z = n => String(n).padStart(2, '0');
    pts.forEach((x, i) => {
      const at = new Date(t0 + x.sec * 1000), hr = (js[i] && js[i].hourly) || {};
      const k = `${at.getFullYear()}-${z(at.getMonth() + 1)}-${z(at.getDate())}T${z(at.getHours())}:00`;
      const n = (hr.time || []).indexOf(k);
      x.at = at;
      x.w = n < 0 ? null : {pr: hr.precipitation ? hr.precipitation[n] : null, sn: hr.snowfall ? hr.snowfall[n] : null,
        t: hr.temperature_2m ? hr.temperature_2m[n] : null, code: hr.weather_code ? hr.weather_code[n] : null};
    });
    if (pts.every(x => !x.w)) throw new Error('予報がありません');
    my.lines = wxLines(pts); my.say = wxSay(pts); my.state = 'ok';
  } catch (e) { my.state = 'fail'; }
  if (wxCache === my && !navOn && dest && preview && wxKey(preview) === key) renderCard('ok');
}
function wxWhere(x) { return x.last ? `行き先（${destName || '目的地'}）` : x.a < 1000 ? '出発地あたり' : `${Math.round(x.a / 1000)}km先あたり`; }
function wxTime(d) { const m = Math.round(d.getMinutes() / 10) * 10, h = d.getHours() + (m === 60 ? 1 : 0); return `${h % 24}:${String(m % 60).padStart(2, '0')}ごろ`; }
function wxLines(pts) {
  const out = [], seen = {};
  pts.forEach(x => {
    const k = wxKind(x.w); if (!k || seen[k]) return; seen[k] = 1;
    const amt = k === 'rain' ? `（1時間に${Math.max(0.5, Math.round(x.w.pr * 10) / 10)}mm）` : '';
    out.push({ic: k === 'snow' ? '❄' : '☔', text: x.last ? `${wxWhere(x)}は、着くころ${k === 'snow' ? '雪' : '雨'}の予報${amt}` : `${wxTime(x.at)}、${wxWhere(x)}で${k === 'snow' ? '雪' : '雨'}${amt}`});
  });
  const cold = pts.find(x => x.w && x.w.t !== null && x.w.t <= 1);
  if (cold) out.push({ic: '🧊', text: `${wxTime(cold.at)}、${wxWhere(cold)}は気温${Math.round(cold.w.t)}℃。路面の凍結に注意`});
  if (!out.length) out.push({ic: '☀', text: '道中・行き先とも、雨や雪の予報はありません'});
  return out;
}
function wxSay(pts) {
  const x = pts.find(y => wxKind(y.w)), cold = pts.find(y => y.w && y.w.t !== null && y.w.t <= 1);
  if (x) { const k = wxKind(x.w) === 'snow' ? '雪' : '雨'; return x.last ? `行き先は、着くころ${k}の予報です` : x.a < 1000 ? `出発地あたりで${k}の予報です` : `この先、${Math.round(x.a / 1000)}キロ先あたりで${k}の予報です`; }
  if (cold) return '気温が低く、路面の凍結に注意してください';
  return '';
}
// 日の入り（行き先、着く日の）。太陽の高さが −0.83° を下回る時刻を12時〜22時の間で探す（通信なし）
function sunsetAt(p, day) {
  let lo = new Date(day), hi = new Date(day);
  lo.setHours(12, 0, 0, 0); hi.setHours(22, 0, 0, 0);
  if (sunAlt(p[0], p[1], lo) < -0.83 || sunAlt(p[0], p[1], hi) > -0.83) return null;
  for (let i = 0; i < 30; i++) { const m = new Date((lo.getTime() + hi.getTime()) / 2); if (sunAlt(p[0], p[1], m) > -0.83) lo = m; else hi = m; }
  return hi;
}
function sunInfo(c) {
  const p = c.coords[c.coords.length - 1], arr = new Date(Date.now() + c.r.duration * 1000);
  const ss = sunsetAt(p, arr); if (!ss) return null;
  const tm = d => d.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}), diff = (ss - arr) / 60000;
  const morning = sunAlt(p[0], p[1], arr) <= -0.83 && arr.getHours() < 12;
  if (morning) return {ic: '🌙', text: `着くころはまだ暗い時間です（日の入り ${tm(ss)}）`, small: false};
  if (diff < 0) return {ic: '🌙', text: `着くころは暗くなっています（日の入り ${tm(ss)}）`, small: false};
  if (diff <= 120) return {ic: '🌇', text: `日の入り ${tm(ss)}。着いてから約${diff < 60 ? Math.max(10, Math.round(diff / 10) * 10) + '分' : Math.round(diff / 60) + '時間'}で暗くなります`, small: false};
  return {ic: '🌇', text: `日の入り ${tm(ss)}（行き先）`, small: true};
}
function wxHtml() {
  if (!preview) return '';
  const k = wxKey(preview);
  if (!wxCache || wxCache.key !== k) return '';
  let h = '';
  if (wxCache.state === 'calc') h += '<div class="small">道中の天気を調べています…</div>';
  else if (wxCache.state === 'ok') h += wxCache.lines.map(l => `<div class="wxL">${l.ic} ${esc(l.text)}</div>`).join('');
  const s = wxCache.sun;
  if (s) h += `<div class="${s.small ? 'small' : 'wxL'}">${s.ic} ${esc(s.text)}</div>`;
  return h ? `<div class="wxBox">${h}</div>` : '';
}
// ナビを始めたときに1回だけ（雨・雪・凍結の予報があるとき）
function wxStartSay() {
  if (!wxCache || wxCache.state !== 'ok' || !wxCache.say || !preview || wxCache.key !== wxKey(preview)) return '';
  return wxCache.say;
}

// ---------- 起動 ----------
function initPlan() {
  $('homeBtn').onclick = goHome;
  renderHome(); renderHist();
}
