// KomuMiru：はじめての紹介・使い方ナビ・ヘルプ（版8）
(window.KOMU_FV = window.KOMU_FV || {}).help = 8;
// ・はじめての紹介：初めて開いたときだけカード5枚（navi_help_v2.intro）
// ・使い方ナビ：ONの間、1秒ごとに「状況の吹き出し」→ なければ「手順」の吹き出しを出し、押す場所を黄色い枠で光らせる。
//   手順を全部終えると「レクチャー完了！」を10秒出して自動で OFF。吹き出しは読み上げない（案内の声と重ならないように）
// ・ヘルプ：項目ごとに開閉する説明。「？」はヘルプのその項目を開く。スマホの戻る操作で閉じる
// ・保存：navi_help（'1'＝ON／'0'＝OFF）、navi_help_v2 {intro, done:[済んだ手順]}

const HELP_KEY = 'navi_help', HELP2_KEY = 'navi_help_v2';
let helpOn = false, tipKey = '', hlEl = null, helpTimer = null;
let lastSit = '', sitClosed = '', lastOnce = ''; // 状況の吹き出し：直前の種類／× で閉じた種類／1回だけの説明
let h2 = {};
try { h2 = JSON.parse(localStorage.getItem(HELP2_KEY) || '{}') || {}; } catch (e) { h2 = {}; }
if (!Array.isArray(h2.done)) h2.done = [];
function saveH2() { try { localStorage.setItem(HELP2_KEY, JSON.stringify(h2)); } catch (e) {} }
const isPC = () => !(window.matchMedia && matchMedia('(pointer: coarse)').matches);
const visible = el => !!el && (el.style.display === 'block' || el.style.display === 'flex');

// ---------- はじめての紹介 ----------
const INTRO = [
  ['🚗', '渋滞を見て、道を比べるナビ', '高速のまま行く／途中で降りる／別の入口から乗る。渋滞のときに、どれが早いかをその場で比べます。まわりの道の渋滞も色で見えます。'],
  ['📊', '判定と提案', '「実質」＝早く着く分 − 遠回りの分 − 気疲れ（右折・細い道など）の分。得な案があれば、声と黄色の枠で知らせます。「判定」を押すと、案をまとめて比べます。'],
  ['🛣', '高速道路', 'どの入口（IC）から乗ると早いか、どこで降りると早いかを比べます。高速を走っている間は、この先の IC・JCT・SA・PA と到着時刻を一覧で出します。'],
  ['🧭', '出発前の下調べ', '目的地を決めると、結果のカードに到着時刻・距離・負担が出ます。地図の長押しで経由地や出発地、★でお気に入り、🔗で家族に行き先を送れます。'],
  ['📍', '安全と注意', '運転中は操作しないでください（停車中か同乗者が）。画面を消したり、ほかのアプリに切り替えたりすると案内が止まります。位置情報と記録は、この端末の中だけに保存します。']
];
let introI = 0;
function showIntro() {
  introI = 0; drawIntro(); $('intro').style.display = 'flex';
}
function drawIntro() {
  const c = INTRO[introI];
  $('inEmoji').textContent = c[0]; $('inTitle').textContent = c[1]; $('inText').textContent = c[2];
  $('inDots').innerHTML = INTRO.map((_, i) => `<span class="${i === introI ? 'on' : ''}"></span>`).join('');
  $('inPrev').style.visibility = introI ? 'visible' : 'hidden';
  $('inNext').textContent = introI === INTRO.length - 1 ? 'はじめる' : '次へ';
}
function closeIntro() {
  $('intro').style.display = 'none';
  h2.intro = 1; saveH2();
  let saved = null; try { saved = localStorage.getItem(HELP_KEY); } catch (e) {}
  if (saved === null) setHelp(true, true); // 初めての人は使い方ナビを ON で始める
}

// ---------- 使い方ナビ：手順 ----------
let stepSeen = {}, wasNav = false, stepT0 = 0, curStepKey = '', doneMsgUntil = 0;
const STEPS = [
  {key: 'dest', text: 'まず目的地を決めます。駅名・施設名・住所を入れて「検索」を押すか、地図を長押しして「ここを目的地にする」を選んでください。', el: () => $('searchRow'), done: () => !!dest || navOn},
  {key: 'card', text: '結果のカードです。到着時刻・所要時間・距離、高速を使うか、ルート上の渋滞、負担（右折や細い道などの気疲れの目安）を確かめます。', el: () => $('routeCard'), done: () => navOn || (cardState === 'ok' && seenFor('card', 6000))},
  {key: 'ic', text: '「🛣 乗るICを比べる」を押すと、入口ごとの到着時刻と実質を並べます（地図データを調べるので少しかかります）。今は飛ばすなら「×」を押してください。', el: () => $('rcIc') || $('routeCard'), done: () => navOn || (typeof icCmp !== 'undefined' && icCmp && icCmp.state === 'ok')},
  {key: 'start', text: '「▶ ナビ開始」を押すと案内が始まります。高速を使うときは、どの入口から乗ると早いかも比べて出します。', el: () => $('rcStart') || $('navFab'), done: () => navOn},
  {key: 'drive', pcSkip: true, text: '案内の画面です。大きな矢印と距離（曲がる100m手前で赤）、到着時刻。地図の右の ◎ は現在地への追従、「北↑／進↑／3D」は地図の向き。検索や設定は「▲ 詳しく」です。', el: () => $('drive'), done: () => seenFor('drive', 10000)},
  {key: 'judge', pcSkip: true, text: '渋滞が気になったら「判定」を押します。降りる・別の入口から乗る・迂回するなどの案をまとめて比べます。押してみてください。', el: () => $('judgeBtn'), done: () => lastJudge > stepT0 && !judging},
  {key: 'stop', pcSkip: true, text: '止めるときは「停止」を2回押します（誤って押さないように、1回目は赤くなるだけです）。', el: () => $('stop'), done: () => wasNav && !navOn},
  {key: 'set', text: '⚙️設定では、提案する差・確認間隔・遠回りの扱い・心的負担の重み・画面の明るさを変えられます。開いてみてください。', el: () => $('tab-set'), done: () => curTab === 'set' && seenFor('set', 3000)}
];
// 時間で済む手順は、その吹き出しを実際に出している間だけ数える（stepSeen[k]＝出していた合計ミリ秒）
function seenFor(k, ms) { return (stepSeen[k] || 0) >= ms; }
let lastTick = 0;
function curStep() {
  for (const s of STEPS) {
    if (h2.done.includes(s.key)) continue;
    if (s.pcSkip && isPC()) continue;
    return s;
  }
  return null;
}
function markDone(k) { if (!h2.done.includes(k)) { h2.done.push(k); saveH2(); } }

// ---------- 使い方ナビ：状況の吹き出し（手順より先に出す） ----------
function situation() {
  if (visible($('pickModal'))) return {key: 'pm', text: 'この場所を目的地・経由地・出発地のどれにするか選んでください。経由地は先に目的地を決めてから使えます。', el: null};
  if (pickMode) return {key: 'pick', text: '地図の上で、行きたい場所をタップしてください。', el: $('map')};
  if (originPick) return {key: 'opick', text: '地図の上で、出発地（下調べ用）をタップしてください。', el: $('map')};
  if (icPick) return {key: 'icpick', text: '料金所を出た先の一般道をタップして、出口の名前を付けてください。', el: $('map')};
  if (visible($('resume'))) return {key: 'resume', text: '前回のナビが途中で止まっていました。「続ける」で同じ目的地・同じ入口のまま再開します。', el: $('resume')};
  if (!pos && !origin) return {key: 'nopos', text: '現在地を探しています。位置情報の利用を聞かれたら「許可」を押してください。許可しない場合は、地図を長押しして「ここを出発地にする」で下調べができます。', el: $('locLine')};
  if (!navOn) {
    if ($('hits').querySelector('.hit')) return {key: 'hits', text: '候補から行き先をタップしてください。📍が付いているのは駅や施設、付いていないのは住所です。', el: $('hits')};
    if (dest && cardState === 'rough') return {key: 'rough', text: '現在地の精度が粗いので、ルートの計算を止めています。「出発地を地図で選ぶ」か「それでもこの位置で計算」を押すか、屋外で精度がよくなるのを待ってください。', el: $('routeCard')};
    return null;
  }
  if (visible($('banner'))) return {key: 'banner', text: 'もっと早いルートが見つかりました（地図の紫の点線）。「切り替える」でそのルートに変えます。「今回は見送る」なら、10分間は同じ案を出しません。', el: $('banner')};
  if (judging) return {key: 'judging', text: '判定中です。いくつもの案を計算しているので、少し待ってください。', el: $('judgeOut')};
  if ($('verdict') && Date.now() - lastJudge < 30000 && !h2.done.includes('verdictTip')) return {key: 'verdict', once: 'verdictTip', text: '判定の結果です。青い枠が結論で、その下に案が並びます。「この案で行く」を押すと切り替わります。「実質」は、遠回りと気疲れの分を差し引いた得です。', el: $('judgeOut')};
  if (!follow) return {key: 'follow', text: '地図を動かしたので、現在地への追従が止まっています。地図の右の ◎ を押すと現在地に戻ります。', el: $('mFollow')};
  if (visible($('hwy')) && !h2.done.includes('hwyTip')) return {key: 'hwy', once: 'hwyTip', text: '高速を走行中です。緑の枠は、この先の IC・JCT・SA・PA と到着予定時刻です。▲は渋滞です。', el: $('hwy')};
  if (viaEntry) return {key: 'entry', text: '選んだ入口（' + viaEntry.name + '）に向かっています。入口を過ぎると、ふつうの案内に戻ります。', el: $('exitInfo')};
  return null;
}

// ---------- 吹き出しと黄色い枠 ----------
function setHl(el) {
  if (hlEl === el) return;
  if (hlEl) hlEl.classList.remove('hl');
  hlEl = el;
  if (el) {
    el.classList.add('hl');
    if (el !== $('map') && el.scrollIntoView) el.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  }
}
function showTip(text, isStep) {
  if ($('tipText').textContent !== text) $('tipText').textContent = text;
  const warn = navOn ? '運転中の操作はやめましょう。操作は停車中か、同乗者が行ってください。' : '';
  if ($('tipWarn').textContent !== warn) $('tipWarn').textContent = warn;
  $('tipX').title = isStep ? 'この手順を飛ばす' : '閉じる';
  $('tip').style.display = 'block';
}
function hideTip() { $('tip').style.display = 'none'; setHl(null); }
// 手順を進める（状況の吹き出しを出している間も、済んだ手順は先に進める）
function advanceSteps() {
  let st = curStep();
  while (st && st.done()) { markDone(st.key); st = curStep(); }
  if (st && st.key !== curStepKey) { curStepKey = st.key; stepT0 = Date.now(); if (st.key === 'stop') wasNav = navOn; }
  return st;
}
function updateHelp() {
  if (navOn) wasNav = true;
  if (!helpOn) { hideTip(); return; }
  if (Date.now() < doneMsgUntil) return; // 「レクチャー完了！」を出している間
  const st = advanceSteps();
  // 状況の吹き出し（× で閉じたら、状況が変わるまで出さずに手順へ）。1回だけの説明は、終わったら済みにする
  const s = situation(), sk = s ? s.key : '';
  if (sk !== lastSit) { if (lastOnce) markDone(lastOnce); lastSit = sk; sitClosed = ''; lastOnce = s && s.once ? s.once : ''; }
  const now = Date.now(), dt = lastTick ? Math.min(now - lastTick, 2000) : 0; lastTick = now;
  if (s && sitClosed !== sk) { tipKey = 'sit:' + sk; showTip(s.text, false); setHl(uiReach(s.el)); return; }
  if (!st) { finishLecture(); return; }
  if (tipKey === 'step:' + st.key) stepSeen[st.key] = (stepSeen[st.key] || 0) + dt;
  tipKey = 'step:' + st.key;
  showTip(st.text, true); setHl(uiReach(st.el()));
}
function finishLecture() {
  doneMsgUntil = Date.now() + 10000;
  showTip('🎉 レクチャー完了！ お疲れさまでした。ヘルプはいつでも ⚙️設定の「？ 使い方（ヘルプ）」から開けます。使い方ナビは自動で OFF にします。', false);
  setHl(null);
  setTimeout(() => { doneMsgUntil = 0; setHelp(false, true); }, 10000);
}
function setHelp(on, save) {
  // ON に戻したら、手順を最初から
  if (on && !helpOn && save) { h2.done = h2.done.filter(k => k === 'hwyTip'); stepSeen = {}; curStepKey = ''; saveH2(); }
  helpOn = on;
  $('helpChk').checked = on;
  document.body.classList.toggle('help', on);
  sitClosed = ''; lastSit = ''; tipKey = '';
  if (save) { try { localStorage.setItem(HELP_KEY, on ? '1' : '0'); } catch (e) {} }
  clearInterval(helpTimer);
  if (on) helpTimer = setInterval(updateHelp, 1000);
  updateHelp();
}

// ---------- ヘルプ（項目ごとの説明） ----------
const SEC = [
  ['about', 'KomuMiru とは', '渋滞を見ながら「高速のまま行く／途中で降りる／別の入口から乗る／一般道で迂回する」を比べる、自分用のカーナビです。地図と渋滞は Mapbox、IC・SA・PA の場所は OpenStreetMap を使います。費用は無料の範囲で動かしています。ホーム画面に追加すると、アドレス欄のないアプリの画面で開けます（⚙️設定の「📲 ホーム画面に追加」）。'],
  ['screen', '画面の見方', '下のタブ：🧭ルート（目的地・結果のカード・お気に入り・出発地）／📊比較（定期比較の候補）／真ん中の ▶（ナビ開始）／🛣IC（出口・入口の登録）／⚙️設定。地図とパネルの境目の横棒を上下に動かすと地図の広さが変わります（2回タップで元に戻す。ナビ前とナビ中で別々に覚えます）。地図の右の丸いボタン：◎ は現在地への追従（青いときは追従中）、「北↑／進↑／3D」は地図の向き。ルートの線の色は渋滞の具合（緑：順調、黄：混雑、橙：渋滞、赤：大渋滞）、まわりの道も同じ色です。'],
  ['card', '目的地と結果のカード', '目的地は、駅名・施設名・住所の検索、「地図で指定」、地図の長押し、★お気に入り、共有リンクで決められます。決めるとナビの前にルートを1本計算して、結果のカードに到着時刻・所要時間・距離・高速を使うか・ルート上の渋滞・負担を出します。「▶ ナビ開始」で案内を始め、「目的地を消す」でやり直せます。'],
  ['stops', '経由地・お気に入り・共有・下調べ', '経由地：地図を長押し（パソコンは右クリック）→「ここに寄ってから行く」。最大3か所。地図に①②③の印、カードの ✕ で外します。通り過ぎると「通過しました」と知らせて外れます。経由地があるときは、入口の比較・判定・迂回の案は「次の経由地まで」の区間で比べます。お気に入り：カードの「★ 登録」で名前を付けて登録（20件まで）。共有：「🔗 共有」で目的地と経由地のリンクを作ります（出発地・現在地は入りません）。下調べ：「出発地を地図で選ぶ」か長押しの「ここを出発地にする」で、出発地から目的地までを「今出発した場合」で出します（ナビはいつも現在地から）。'],
  ['ic', '乗るICの比較', '高速を使うとき、現在地（または下調べの出発地）のまわりの入口を地図データから探し、入口ごとに「そこから乗った場合」の到着時刻・距離・実質を並べます。ナビを始めたときに自動で1回、一般道で「判定」を押したとき、ナビ前は結果のカードの「🛣 乗るICを比べる」で行います。入口を選ぶと「乗る入口：○○IC あと○km」と出て、その入口を通るように案内します。地図データが取れないときは2分後にもう一度試します。'],
  ['drive', 'ナビ中の画面', '地図を広くし、大きな矢印と距離（曲がる100m手前から赤）、到着時刻、乗る入口・次の出口、事故の情報を出します。ボタンは「判定」「停止」「▲ 詳しく」。停止は誤って押さないよう2回押し（1回目で赤くなり、3秒以内にもう一度）。「▲ 詳しく」で下のタブ（検索・候補・IC・設定）を出し、真ん中の「▼ 戻る」で閉じます。ページが閉じてしまっても、30分以内に開き直せば「前回のナビを続けますか？」と出ます。スマホを横にすると、地図いっぱいに右下の小さな箱で案内します。'],
  ['judge', '判定・定期比較・提案', '確認間隔（既定2分）ごとに、今のルート・別のルート・一般道だけのルートを最新の渋滞で計算し直し、📊比較に並べます。実質＝早く着く分（分）−遠回りの距離×設定（既定 1kmで1分）−気疲れの増えた分×重み。実質が「提案する差」（既定3分）以上なら、黄色の枠と声で知らせます（「今回は見送る」で10分間は出しません）。「判定」は、高速の上なら「次の出口で降りて一般道」「降りてから乗り直す」など、一般道なら別の入口や渋滞を左右に避ける迂回の案もまとめて比べます。この先に2km以上の渋滞があると、5分に1回まで自動で判定します。'],
  ['burden', '心的負担（気疲れの目安）', '右折（重め）・Uターン・左折・信号・踏切（重め）・急なカーブ・細い道の多さを数え、「負担 低・中・高」と内訳を出します。重み「中」のとき、右折0.5分、左折0.2分、信号0.1分、踏切1分、急カーブ0.3分、細い道1kmあたり2分の損とみなします。⚙️設定の「心的負担の重み」でなし／弱／中／強を選べます。信号・踏切・道の種類のデータがない道は、右左折と急カーブだけで数えます。'],
  ['hwy', '高速道路（出口・ハイウェイモード・ICの登録）', '高速の上で「判定」を押すと、この先40km（経由地があればその手前）の出口で降りた場合と比べます。高速を走っている間は、この先の IC・JCT・SA・PA を5件まで、残り距離と到着予定時刻で一覧にし、施設の間の渋滞は ▲ で出します（SA・PA・JCT は2km手前で読み上げ、反対車線の SA・PA は出しません）。地図データで拾えない IC は 🛣IC タブで登録できます（料金所を出た先の一般道をタップ）。'],
  ['night', '夜間モードと地図の向き', '⚙️設定の「画面の明るさ」：自動（日の入りから日の出まで暗い画面と夜の地図。夕方・明け方は夕暮れの色）／いつも明るい／いつも暗い。夜はルートの縁取りを白っぽく太くして見やすくしています。地図の向きは、地図の右の丸ボタンで 北↑ → 進↑ → 3D と切り替えます（進↑と3Dは進む向きが上になり、自分の位置が画面の下寄りになります）。'],
  ['loc', '現在地と保存', '現在地の精度を 🧭ルートに出します。200mより粗いときは、間違った場所から計算しないよう結果のカードの計算を止めます。次に開いたときは前回の場所（約100m単位）から地図を始めます。登録した IC・お気に入り・設定は、この端末のこのブラウザの中だけに保存します（パソコンとスマホは別々。Chrome で「Cookie とサイトデータ」を消すと消えます。iPhone はホーム画面から開いたアプリと Safari でも別です）。運営者のサーバーはなく、外へ送るのは地図・経路・検索のために必要な場所だけです。'],
  ['trouble', 'うまくいかないとき・出典', '赤い字は、うまくいかなかったことの知らせです。「入口（IC）の自動取得に失敗しました（本家：HTTP 504 …）」は地図データの取得先が混んでいるときで、2分後にもう一度試します。「利用回数の上限」は1回開くごとに経路の計算400回までで、開き直すと戻ります。「ファイルの版が合いません」は GitHub に古いファイルが残っているときです（置き直すか10分待つ）。画面を消したり、ほかのアプリに切り替えたりすると、位置の更新と案内が止まります（Webアプリの限界）。出典：地図・渋滞・経路・検索 © Mapbox、IC・JCT・SA・PA・料金所の場所 © OpenStreetMap contributors。']
];
// 「？」の名前 → ヘルプの項目
const Q_SEC = {app: 'about', buttons: 'screen', route: 'card', fav: 'stops', origin: 'loc', cands: 'judge', judge: 'judge', settings: 'judge', ics: 'hwy', hwy: 'hwy', status: 'trouble'};
function buildHelp() {
  $('helpSecs').innerHTML = SEC.map(([id, t, x]) => `<details class="hsec" id="h-${id}"><summary>${t}</summary><div class="htext">${x}</div></details>`).join('');
}
function openHelp(sec) {
  const box = $('helpBox');
  if (box.style.display !== 'flex') { box.style.display = 'flex'; try { history.pushState({komuHelp: 1}, ''); } catch (e) {} }
  document.querySelectorAll('.hsec').forEach(d => d.open = false);
  const d = sec && $('h-' + sec);
  if (d) { d.open = true; setTimeout(() => d.scrollIntoView && d.scrollIntoView({block: 'start'}), 30); }
  else $('helpScroll').scrollTop = 0;
}
function closeHelp(fromPop) {
  if ($('helpBox').style.display !== 'flex') return;
  $('helpBox').style.display = 'none';
  if (!fromPop) { try { if (history.state && history.state.komuHelp) history.back(); } catch (e) {} }
}

function initHelp() {
  buildHelp();
  // 紹介
  $('inNext').onclick = () => { if (introI < INTRO.length - 1) { introI++; drawIntro(); } else closeIntro(); };
  $('inPrev').onclick = () => { if (introI > 0) { introI--; drawIntro(); } };
  $('inSkip').onclick = closeIntro;
  // ヘルプ
  $('helpOpen').onclick = () => openHelp(null);
  $('helpClose').onclick = () => closeHelp(false);
  $('helpIntro').onclick = () => { closeHelp(false); showIntro(); };
  $('helpRestart').onclick = () => { closeHelp(false); setHelp(false, false); setHelp(true, true); showTab('route'); };
  window.addEventListener('popstate', () => closeHelp(true));
  // 使い方ナビ
  $('helpChk').onchange = () => setHelp($('helpChk').checked, true);
  $('tipX').onclick = () => {
    if (tipKey.startsWith('step:')) markDone(tipKey.slice(5)); // 手順の × は「この手順を飛ばす」
    else { sitClosed = lastSit; if (lastOnce) markDone(lastOnce); }
    updateHelp();
  };
  // 「？」：ヘルプのその項目を開く（あとから作られる部分にも効くよう、まとめて受ける）
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.q');
    if (b) { e.preventDefault(); openHelp(Q_SEC[b.dataset.q] || null); return; }
    if (helpOn) setTimeout(updateHelp, 80); // 押した結果をすぐ吹き出しに反映
  });
  let saved = null;
  try { saved = localStorage.getItem(HELP_KEY); } catch (e) {}
  setHelp(saved === null ? false : saved === '1', false);
  if (!h2.intro) showIntro(); // 初めて開いたとき（版7までを使っていた人にも一度だけ）
  else if (saved === null) setHelp(true, true);
}
