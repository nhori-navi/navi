// KomuMiru：経路の取得・定期比較・判定

// ---------- 経路取得 ----------
async function api(list, extra) {
  if (reqCount >= MAX_REQ) throw new Error('利用回数の上限に達しました（再読み込みでリセット）');
  reqCount++; $('counter').textContent = `API利用 ${reqCount}回`;
  const c = list.map(p => p[0].toFixed(6) + ',' + p[1].toFixed(6)).join(';');
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${c}?geometries=geojson&overview=full&steps=true&language=ja&annotations=congestion,duration&access_token=${TOKEN}${extra}`;
  const res = await fetch(url), j = await res.json();
  if (!res.ok || j.code !== 'Ok') throw new Error(`経路取得失敗 HTTP ${res.status} ${j.code || ''} ${j.message || ''}`);
  return j.routes;
}
function prep(r, name) {
  const coords = r.geometry.coordinates, cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distM(coords[i - 1], coords[i]));
  let cong = [], incs = [], dur = [];
  r.legs.forEach(l => {
    cong = cong.concat((l.annotation && l.annotation.congestion) || []);
    dur = dur.concat((l.annotation && l.annotation.duration) || []);
    (l.incidents || []).forEach(x => incs.push(x));
  });
  let ct = null;
  if (dur.length === coords.length - 1) {
    ct = [0]; dur.forEach((d, i) => ct.push(ct[i] + (Number(d) || 0)));
    const k = ct[ct.length - 1] ? r.duration / ct[ct.length - 1] : 0; // 合計を経路全体の所要時間にそろえる
    ct = k ? ct.map(v => v * k) : null;
  }
  return {r, name, coords, cum, cong, incs, ct};
}
function setActive(c) {
  active = c;
  active.steps = (c.r.legs[0] && c.r.legs[0].steps) || [];
  active.manAlong = active.steps.map(s => along(c, s.maneuver.location));
  drawActive();
  prepFacilities(c);
}
function drawActive() {
  const c = active, seg = [], pts = [];
  for (let i = 0; i < c.coords.length - 1; i++)
    seg.push({type:'Feature', properties:{color: COLORS[c.cong[i]] || COLORS.unknown},
      geometry:{type:'LineString', coordinates:[c.coords[i], c.coords[i + 1]]}});
  c.incs.forEach(x => { const p = c.coords[x.geometry_index_start || 0];
    if (p) pts.push({type:'Feature', properties:{}, geometry:{type:'Point', coordinates:p}}); });
  setData('casing', [{type:'Feature', properties:{}, geometry:c.r.geometry}]);
  setData('seg', seg); setData('inc', pts);
}

// ---------- 定期比較 ----------
async function compare() {
  if (!navOn || !pos || !dest) return;
  if (active && active.icLeg) return;
  if (busy) { if (!active) setTimeout(compare, 3000); return; }
  busy = true; $('status').textContent = '渋滞状況を確認中…';
  try {
    let curP = Promise.resolve(null);
    if (viaEntry) {
      // 選んだ入口（IC）を通る形で計算し直す（入口を通り過ぎるまで）
      const nm = active ? active.name : viaEntry.name + 'から乗る';
      curP = api([pos, viaEntry.p, dest], '&waypoints=0;2').then(rs => prep(rs[0], nm)).catch(e => { showErr(e.message); return null; });
    } else if (active) {
      const n = nearest(active.coords, pos), here = active.cum[n.i], total = totalOf(active);
      if (total - here > 2000) {
        const target = here + (total - here) * 0.5; let j = n.i;
        while (j < active.coords.length - 1 && active.cum[j] < target) j++;
        const nm = active.name;
        curP = api([pos, active.coords[j], dest], '&waypoints=0;2').then(rs => prep(rs[0], nm)).catch(e => { showErr(e.message); return null; });
      }
    }
    const altP = api([pos, dest], '&alternatives=true')
      .then(rs => rs.map((r, i) => prep(r, i ? '代替ルート' + i : 'おまかせ最速'))).catch(e => { showErr(e.message); return []; });
    const genP = api([pos, dest], '&exclude=motorway')
      .then(rs => [prep(rs[0], '一般道のみ')]).catch(e => { showErr(e.message); return []; });
    const [cur, alts, gens] = await Promise.all([curP, altP, genP]);
    const cands = alts.concat(gens);

    if (!active) {
      let pick = null;
      if (viaEntry && cur) pick = cur;
      else if (preferGeneral && gens.length) pick = gens[0];
      else if (cands.length) { cands.sort((a, b) => a.r.duration - b.r.duration); pick = cands[0]; }
      if (!pick) { $('status').textContent = 'ルートを取得できませんでした'; return; }
      setActive(pick);
    } else if (cur) setActive(cur);
    else { const m = cands.find(c => sameAs(c, active)); if (m) { m.name = active.name; setActive(m); } }

    const others = cands.filter(c => !sameAs(c, active)).sort((a, b) => scoreGain(b) - scoreGain(a));
    renderCards(others);
    checkProposal(others[0]);
    guide();
    $('status').textContent = '最終確認 ' + new Date().toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'});
    if (jamAhead(active) >= 2000 && Date.now() - lastJudge > 5 * 60000) judge(true);
  } finally { busy = false; }
}
function renderCards(others) {
  const curDur = remDur(active), curKm = remDist(active);
  let h = `<div class="card cur"><b>現在のルート</b>（${active.name}）<button class="q" data-q="cands">？</button><br>
    到着 ${hhmm(curDur)}　残り${Math.round(curDur / 60)}分・${(curKm / 1000).toFixed(1)}km<br>
    この先の渋滞 ${(jamAhead(active) / 1000).toFixed(1)}km<br><span class="small">${bdText(bdNow(active))}</span></div>`;
  others.forEach(c => {
    const d = remDur(c), dm = Math.round((d - curDur) / 60), g = Math.round(scoreGain(c));
    h += `<div class="card"><b>${c.name}</b>　${sgn(dm)}分／距離 ${fmtKm((remDist(c) - curKm) / 1000)}<br>
      到着 ${hhmm(d)}　実質 ${g >= 0 ? g + '分有利' : -g + '分不利'}<br><span class="small">${bdText(bdNow(c))}</span></div>`;
  });
  h += bdNote(active);
  if (!others.length) h += '<div class="small">ほかの候補はありません</div>';
  $('cands').innerHTML = h;
}
function hideBanner() { $('banner').style.display = 'none'; proposal = null; setData('prop', []); }
function checkProposal(best) {
  const thr = Number($('thr').value);
  if (!best || scoreGain(best) < thr || Date.now() < (ignored[best.name] || 0)) { hideBanner(); return; }
  proposal = best;
  const tg = Math.round((remDur(active) - remDur(best)) / 60), dk = (remDist(best) - remDist(active)) / 1000;
  $('bannerText').textContent = `${best.name}に切り替えると約${tg}分早く着きます（距離 ${fmtKm(dk)}、実質${Math.round(scoreGain(best))}分有利、${bdText(bdNow(best))}）`;
  $('banner').style.display = 'block';
  setData('prop', [{type:'Feature', properties:{}, geometry:best.r.geometry}]);
  const key = 'p' + best.name + tg;
  if (!spoken.has(key)) { spoken.add(key); speak(`より早いルートがあります。${best.name}で、約${tg}分早く着きます`); }
}
$('switchBtn').onclick = () => {
  if (!proposal) return;
  viaEntry = null; setActive(proposal); hideBanner(); speak('ルートを切り替えました');
  $('cands').innerHTML = '<div class="small">切り替えました。次回の確認で一覧を更新します。</div>';
};
$('ignoreBtn').onclick = () => { if (proposal) ignored[proposal.name] = Date.now() + 10 * 60000; hideBanner(); };

// ---------- 判定 ----------
async function judge(auto, withEntry) {
  if (!navOn || !active || !pos || !dest) { if (!auto) $('judgeOut').innerHTML = '<div class="small">ナビ開始後に使えます</div>'; return; }
  if (judging) return;
  if (active.icLeg) { if (!auto) $('judgeOut').innerHTML = '<div class="small">出口を出るまでは判定を止めています</div>'; return; }
  judging = true; lastJudge = Date.now();
  $('judgeOut').innerHTML = '<div class="small">判定中…</div>';
  try {
    const my = along(active, pos), st = active.steps[curStepIdx(my)];
    const onMw = st ? isMwStep(st) : false;
    const we = !onMw && (withEntry || entryPending);
    let cands = onMw ? await highwayCands(my) : await generalCands(my, we);
    const uniq = [];
    cands.forEach(x => { if (x.pc && uniq.some(y => y.pc && sameAs(x.pc, y.pc))) return; uniq.push(x); });
    let note = onMw ? '高速道路上の判定' : '一般道上の判定';
    if (we) note += '（乗るICの比較を含む）';
    if (!onMw && cands.noJam) note += '（この先15km以内に渋滞がないため、迂回候補は作っていません）';
    decide(uniq, auto, note, cands.curEntry);
  } finally { judging = false; }
}
async function highwayCands(my) {
  const cands = [];
  const altP = api([pos, dest], '&alternatives=true').then(rs => rs.map(r => prep(r, ''))).catch(e => { showErr(e.message); return []; });
  const exits = await findExits(my);
  const exP = Promise.all(exits.map(async ex => {
    const [toE, after, rej] = await Promise.all([
      api([pos, ex.E], '').then(r => r[0]).catch(() => null),
      api([ex.E, dest], '&exclude=motorway').then(r => r[0]).catch(() => null),
      api([pos, ex.E, dest], '&waypoints=0;2').then(r => r[0]).catch(() => null)
    ]);
    return {ex, toE, after, rej};
  }));
  const [alts, exRes] = await Promise.all([altP, exP]);
  exRes.forEach(({ex, toE, after, rej}) => {
    if (!toE || toE.distance > ex.a + 5000) return; // 逆方向の出口などは除外
    if (after) cands.push({
      label: `${ex.name}で降りて一般道（あと${fmtDist(ex.a)}）`,
      dur: toE.duration + after.duration, dist: toE.distance + after.distance,
      geom: toE.geometry.coordinates.concat(after.geometry.coordinates),
      bdParts: [prep(toE, ''), prep(after, '')],
      act: () => { const c = prep(toE, `${ex.name}で降りる`); c.icLeg = true; setActive(c); preferGeneral = true; }
    });
    if (rej) {
      const c = prep(rej, `${ex.name}で降りる（その後おまかせ）`);
      cands.push({label: `${ex.name}で降りて、その後おまかせ（乗り直しを含む）`, dur: rej.duration, dist: rej.distance,
        geom: c.coords, act: () => setActive(c), pc: c});
    }
  });
  alts.forEach(c => {
    if (sameAs(c, active)) return;
    const early = earlyExit(c, my);
    c.name = early ? '早めに降りる案' : '別の高速ルート';
    cands.push({label: early ? `早めに降りる案（${early}）` : '別の高速ルート', dur: c.r.duration, dist: c.r.distance,
      geom: c.coords, act: () => setActive(c), pc: c});
  });
  return cands;
}
async function generalCands(my, withEntry) {
  const cands = [];
  if (withEntry) entryPending = false;
  const entP = withEntry ? entryCands().catch(e => { showErr(e.message); return []; }) : Promise.resolve([]);
  const altP = api([pos, dest], '&alternatives=true').then(rs => rs.map(r => prep(r, ''))).catch(e => { showErr(e.message); return []; });
  let detP = Promise.resolve([]);
  const jam = jamSpan(my);
  if (jam) {
    const a = active.coords[jam.i1], b = active.coords[jam.i2], mid = active.coords[Math.floor((jam.i1 + jam.i2) / 2)];
    const brg = bearing(a, b);
    const offs = [[-90, 1500, '左'], [-90, 3000, '左'], [90, 1500, '右'], [90, 3000, '右']];
    detP = Promise.all(offs.map(([d, dist, side]) =>
      api([pos, offsetPt(mid, brg + d, dist), dest], '&waypoints=0;2')
        .then(r => ({c: prep(r[0], `${side}側へ迂回`), label: `渋滞を${side}側へ迂回（${dist / 1000}km外側）`}))
        .catch(() => null)));
  }
  const [alts, dets, ents] = await Promise.all([altP, detP, entP]);
  // 入口の取得に失敗したら、2分後にもう一度（3回まで）
  if (withEntry && entryFailed && entryRetry < ENTRY_RETRY_MAX) {
    entryRetry++; clearTimeout(entryRetryTimer);
    entryRetryTimer = setTimeout(() => { if (navOn && active && !judging) judge(true, true); }, 120000);
  }
  // 今のルートが乗る入口：同じ入口の案は「このまま」にまとめ、ほかの入口の案を並べる
  const curIn = withEntry ? entryOf(active) : null;
  if (curIn && curIn.name) cands.curEntry = curIn.name;
  ents.forEach(x => {
    if (curIn && distM(x.p, curIn.p) < 2500) { cands.curEntry = x.name; return; }
    if (sameAs(x.pc, active)) return;
    cands.push(x);
  });
  alts.forEach(c => {
    if (sameAs(c, active)) return;
    const usesMw = ((c.r.legs[0] && c.r.legs[0].steps) || []).some(isMwStep);
    c.name = usesMw ? '高速に戻る' : '代替ルート';
    cands.push({label: c.name, dur: c.r.duration, dist: c.r.distance, geom: c.coords, act: () => setActive(c), pc: c});
  });
  dets.forEach(x => {
    if (!x || sameAs(x.c, active)) return;
    cands.push({label: x.label, dur: x.c.r.duration, dist: x.c.r.distance, geom: x.c.coords, act: () => setActive(x.c), pc: x.c});
  });
  if (!jam) cands.noJam = true;
  return cands;
}
function decide(cands, auto, note, curEntry) {
  const thr = Number($('thr').value), w = wkm(), bw = bdw();
  const curDur = remDur(active), curDist = remDist(active), curB = bdNow(active);
  cands.forEach(c => {
    c.bd = c.bdParts ? bdSum(c.bdParts.map(p => burden(p, 0))) : c.pc ? bdNow(c.pc) : null;
    c.bDiff = c.bd ? c.bd.min - curB.min : 0; // 負担の増えた分（分）
    c.tGain = (curDur - c.dur) / 60; c.dKm = (c.dist - curDist) / 1000; c.sGain = c.tGain - w * c.dKm - bw * c.bDiff;
  });
  cands.sort((a, b) => b.sGain - a.sGain);
  const best = cands[0];
  let verdict, say, recommend = false;
  if (best && best.sGain >= thr) {
    recommend = true;
    verdict = `判定：${best.label}が有利。このままより約${Math.round(best.tGain)}分早く、距離${fmtKm(best.dKm)}（実質${Math.round(best.sGain)}分有利）`
      + (best.bDiff >= 2 ? '。ただし負担は大きめです' : best.bDiff <= -2 ? '。負担も軽くなります' : '');
    say = `${best.label.replace(/（.*?）/g, '')}${best.entry ? '案' : ''}が有利です。約${Math.round(best.tGain)}分早く着きます`;
    setData('prop', [{type:'Feature', properties:{}, geometry:{type:'LineString', coordinates: best.geom}}]);
  } else {
    verdict = '判定：差はわずかです。このままで問題ありません';
    say = 'このままで問題ありません';
    setData('prop', []);
  }
  let h = `<div id="verdict">${verdict}</div>
    <div class="small">${note}<button class="q" data-q="judge">？</button></div>
    <div class="card cur"><b>このまま</b>（${active.name}${curEntry ? '・' + curEntry + 'から乗る' : ''}）<br>到着 ${hhmm(curDur)}　残り${(curDist / 1000).toFixed(1)}km<br><span class="small">${bdText(curB)}</span></div>`;
  cands.forEach((c, i) => {
    const g = Math.round(c.sGain);
    h += `<div class="card"><b>${c.label}</b><br>
      到着 ${hhmm(c.dur)}（${sgn(-Math.round(c.tGain))}分、距離${fmtKm(c.dKm)}）<br>
      実質 ${g >= 0 ? g + '分有利' : -g + '分不利'}　<button data-c="${i}">この案で行く</button>`
      + (c.bd ? `<br><span class="small">${bdText(c.bd)}${bw && Math.abs(c.bDiff) >= 0.5 ? '　負担の差 ' + sgn(Math.round(c.bDiff * bw)) + '分' : ''}</span>` : '') + '</div>';
  });
  h += bdNote(active);
  if (!cands.length) h += '<div class="small">比べられる候補が見つかりませんでした</div>';
  $('judgeOut').innerHTML = h;
  $('judgeOut').querySelectorAll('button[data-c]').forEach(b => b.onclick = () => {
    viaEntry = null; cands[Number(b.dataset.c)].act(); hideBanner(); speak('ルートを切り替えました');
    $('judgeOut').innerHTML = '<div class="small">切り替えました</div>';
  });
  if (!auto || recommend) speak(say);
}
$('judgeBtn').onclick = () => judge(false, true);

