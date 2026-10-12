// KomuMiru のサービスワーカー（裏で動く小さな係）
// ・アプリとしてホーム画面に入れる条件を満たす
// ・自分のファイル（index.html・js・css・アイコン）は毎回ネットから取り、取れたら控えを残す
//   → 更新はすぐ反映される。通信できないときだけ控えを使う
// ・地図・渋滞・経路（Mapbox）や OpenStreetMap には手を出さない
const CACHE = 'komumiru-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith('komumiru-') && k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  const base = new URL('./', self.registration.scope);
  if (req.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req, {cache: 'no-cache'});
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    } catch (err) {
      const hit = await caches.match(req) || await caches.match(req, {ignoreSearch: true})
        || (req.mode === 'navigate' ? await caches.match(base.href) || await caches.match(new URL('index.html', base).href) : null);
      if (hit) return hit;
      if (req.mode === 'navigate') return new Response(
        '<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>KomuMiru</title><body style="font-family:sans-serif;padding:24px;line-height:1.7">'
        + '<h2 style="color:#1f3a93">KomuMiru</h2>接続できません。<br>地図・渋滞・経路の計算には通信が必要です。通信できる場所で開き直してください。</body>',
        {headers: {'Content-Type': 'text/html; charset=utf-8'}});
      throw err;
    }
  })());
});
