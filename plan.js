// KomuMiru：行き先を決めやすく、出発前に比べやすく（版11）
// ・🏠 家へ：お気に入りの1つを「家」にして（🏠）、🧭ルートの一番上のボタン1つで行き先に
// ・最近の行き先：検索や地図で決めた行き先を新しい順に10件（navi_hist）。お気に入りと同じ場所は入れない
// ・有料道路なしと比べる：結果のカードで exclude=toll を1回計算して並べる。「この道でナビ開始」は avoidToll で始める
// ・出発時刻で比べる：今・30分後・1時間後・1時間半後・2時間後（depart_at）。5回計算する
(window.KOMU_FV = window.KOMU_FV || {}).plan = 11;

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

// ---------- 起動 ----------
function initPlan() {
  $('homeBtn').onclick = goHome;
  renderHome(); renderHist();
}
