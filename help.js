// KomuMiru：使い方ナビ
// ・ONの間、今の状況に合わせて「次にやること」を吹き出しで出し、押す場所を黄色い枠で光らせる
// ・「？」を押すと、その部分の説明を出す
// ・吹き出しは読み上げない（案内の声と重ならないように）
// ・初めて開いたときはON。切り替えたら端末に覚えておく（navi_help）

const HELP_KEY = 'navi_help';
let helpOn = false, tipKey = '', tipClosed = '', tipQ = null, hlEl = null, helpTimer = null;

// 「？」の説明
const HELP_Q = {
  app: 'KomuMiru は、渋滞を見ながら「高速のまま行く／途中で降りる／別の入口から乗る」を比べるナビです。'
    + 'ホーム画面に追加すると、アドレス欄のないアプリの画面で開けます（Chrome の「︙」→「ホーム画面に追加」→「インストール」）。'
    + '使い方ナビは、右の「使い方ナビ」でいつでも ON／OFF できます。',
  buttons: 'ナビ開始：ルートを計算して案内を始めます。停止：案内をやめます。'
    + '判定：今いる場所から、降りる・別の入口から乗る・迂回するなどの案をまとめて比べます（渋滞が気になったときに）。'
    + '追従：ON の間は地図が現在地についてきます。地図を指で動かすと OFF になります。',
  judge: '青い枠が結論です。「このまま」と各案を、到着時刻・距離・実質で比べています。'
    + '実質＝早く着く分（分）−遠回りの分−心的負担の増えた分です。設定の「提案する差」以上に有利な案があると勧めます。'
    + '「負担 低・中・高」は運転の気疲れの目安で、右折・Uターン・左折・信号・踏切・急カーブ・細い道を数えています（右折と踏切は重め）。'
    + '「この案で行く」を押すと、そのルートに切り替わります。',
  cands: '確認間隔（既定2分）ごとに、今のルートとほかの候補を最新の渋滞で計算し直した一覧です。'
    + '地図の紫の点線は勧めている候補、ルートの色は渋滞の具合です（緑：順調、黄：混雑、橙：渋滞、赤：大渋滞）。',
  settings: '提案する差：何分以上有利なら知らせるか。'
    + '確認間隔：渋滞を確かめ直す間隔。短いほど早く気づけますが、利用回数（API）が増えます。'
    + '遠回り1km＝○分：距離が延びる案をどれだけ割り引くか。0 なら時間だけで比べます。'
    + '心的負担の重み：右折・信号・踏切・急カーブ・細い道の多さを、どれだけ割り引くか。「なし」なら負担は比べません。',
  ics: '出口や入口（IC）は地図データから自動で探しますが、拾えない IC は自分で登録できます。'
    + '「出口を登録」を押し、料金所を出た先の一般道をタップして名前を付けます。登録した IC は入口の候補にも使います。'
    + '書き出し・読み込みで、ほかの端末に移せます。',
  hwy: '高速を走っている間だけ出る、この先の施設の一覧です。左の色札は種類（IC・JCT・SA・PA・料金所）、右は残り距離と到着予定時刻、▲は施設の間の渋滞です。'
    + 'SA・PA・JCT は2km手前で読み上げます。反対車線の SA・PA は出しません。',
  status: 'API利用：経路の計算を頼んだ回数です。1回開くごとに400回までで、超えると比較が止まります（ページを開き直すと0に戻ります）。'
    + '赤い字は、うまくいかなかったことの知らせです。'
};

const visible = el => el && el.style.display === 'block';

// 今の状況から「次にやること」を決める
function helpState() {
  if (pickMode) return {key: 'pick', text: '地図の上で、行きたい場所をタップしてください。', el: $('map')};
  if (icPick) return {key: 'icpick', text: '料金所を出た先の一般道をタップして、出口の名前を付けてください。', el: $('map')};
  if (!pos) return {key: 'nopos', text: '現在地を探しています。位置情報の利用を聞かれたら「許可」を押してください。', el: null};
  if (!navOn) {
    if ($('hits').querySelector('.hit')) return {key: 'hits', text: '候補から行き先をタップしてください。📍が付いているのは駅や施設、付いていないのは住所です。', el: $('hits')};
    if (!dest) return {key: 'search', text: '行き先（駅名・施設名・住所）を入れて「検索」を押してください。地図から選ぶときは「地図で指定」を押します。', el: $('searchRow')};
    return {key: 'start', text: '「ナビ開始」を押すと、ルートを計算して案内を始めます。高速を使うときは、どの入口（IC）から乗ると早いかも比べて出します。', el: $('start')};
  }
  if (visible($('banner'))) return {key: 'banner', text: 'もっと早いルートが見つかりました（地図の紫の点線）。「切り替える」でそのルートに変えます。「今回は見送る」なら、10分間は同じ案を出しません。', el: $('banner')};
  if (judging) return {key: 'judging', text: '判定中です。いくつもの案を計算しているので、少し待ってください。', el: $('judgeOut')};
  if ($('verdict') && Date.now() - lastJudge < 90000) return {key: 'verdict' + lastJudge, text: '判定の結果です。青い枠が結論で、その下に案が並びます。「この案で行く」を押すと切り替わります。「実質」は、遠回りの分を差し引いた得です。', el: $('judgeOut')};
  if (!follow) return {key: 'follow', text: '地図を動かしたので、現在地への追従が止まっています。「追従：ON」を押すと現在地に戻ります。', el: $('followBtn')};
  if (visible($('hwy'))) return {key: 'hwy', text: '高速を走行中です。緑の枠は、この先の IC・JCT・SA・PA と到着予定時刻です。▲は渋滞です。', el: $('hwy')};
  if (viaEntry) return {key: 'entry', text: '選んだ入口（' + viaEntry.name + '）に向かっています。入口を過ぎると、ふつうの案内に戻ります。', el: $('exitInfo')};
  return {key: 'nav', text: '案内中です。確認間隔ごとに渋滞を確かめ、早いルートがあれば声で知らせます。渋滞が気になったら「判定」で、降りる・乗る・迂回の案をまとめて比べられます。', el: $('judgeBtn')};
}

function setHl(el) {
  if (hlEl === el) return;
  if (hlEl) hlEl.classList.remove('hl');
  hlEl = el;
  if (el) {
    el.classList.add('hl');
    if (el !== $('map') && el.scrollIntoView) el.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  }
}

function showTip(text) {
  if ($('tipText').textContent !== text) $('tipText').textContent = text;
  const warn = navOn ? '運転中の操作はやめましょう。操作は停車中か、同乗者が行ってください。' : '';
  if ($('tipWarn').textContent !== warn) $('tipWarn').textContent = warn;
  $('tip').style.display = 'block';
}

function updateHelp() {
  if (!helpOn) { $('tip').style.display = 'none'; setHl(null); return; }
  if (tipQ) { showTip(HELP_Q[tipQ] || ''); setHl(null); return; }
  const s = helpState();
  if (s.key !== tipKey) { tipKey = s.key; tipClosed = ''; }
  if (tipClosed === s.key) { $('tip').style.display = 'none'; setHl(null); return; }
  showTip(s.text);
  setHl(s.el);
}

function setHelp(on, save) {
  helpOn = on;
  $('helpChk').checked = on;
  document.body.classList.toggle('help', on);
  tipQ = null; tipClosed = ''; tipKey = '';
  if (save) { try { localStorage.setItem(HELP_KEY, on ? '1' : '0'); } catch (e) {} }
  clearInterval(helpTimer);
  if (on) helpTimer = setInterval(updateHelp, 1000);
  updateHelp();
}

function initHelp() {
  let saved = null;
  try { saved = localStorage.getItem(HELP_KEY); } catch (e) {}
  $('helpChk').onchange = () => setHelp($('helpChk').checked, true);
  $('tipX').onclick = () => { if (tipQ) tipQ = null; else tipClosed = tipKey; updateHelp(); };
  // 「？」：あとから作られる部分（判定の結果など）にも効くよう、まとめて受ける
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.q');
    if (b) { e.preventDefault(); tipQ = b.dataset.q; updateHelp(); return; }
    if (helpOn) setTimeout(updateHelp, 80); // 押した結果をすぐ吹き出しに反映
  });
  setHelp(saved === null ? true : saved === '1', false); // 初めて開いたときは ON
}
