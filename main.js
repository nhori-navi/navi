// KomuMiru：地図の準備・位置情報の開始・アプリ化（最後に読み込む）
(window.KOMU_FV = window.KOMU_FV || {}).main = 5.1;
// ほかのファイルの関数をすべて読み込んでから、地図と位置情報を動かし始める

// ---------- 地図の準備 ----------
mapboxgl.accessToken = TOKEN;
map = new mapboxgl.Map({
  container: 'map', style: 'mapbox://styles/mapbox/standard',
  center: [139.33, 35.62], zoom: 11, language: 'ja',
  config: {basemap: {lightPreset: themeState().preset}} // 夜は最初から夜の地図
});
map.addControl(new mapboxgl.NavigationControl(), 'top-right');
map.on('load', () => {
  map.addSource('traffic', {type:'vector', url:'mapbox://mapbox.mapbox-traffic-v1'});
  map.addLayer({id:'traffic', type:'line', source:'traffic', 'source-layer':'traffic', paint:{
    'line-width':['interpolate',['linear'],['zoom'],8,1.5,14,4],
    'line-color':['match',['get','congestion'],'low',COLORS.low,'moderate',COLORS.moderate,'heavy',COLORS.heavy,'severe',COLORS.severe,'#999'],
    'line-opacity':0.85, 'line-emissive-strength':0.8}});
  const empty = {type:'FeatureCollection', features:[]};
  ['casing', 'seg', 'prop', 'inc', 'ics'].forEach(id => map.addSource(id, {type:'geojson', data:empty}));
  map.addLayer({id:'prop', type:'line', source:'prop', layout:{'line-cap':'round'},
    paint:{'line-color':'#8e44ad', 'line-width':6, 'line-dasharray':[1.5, 1], 'line-emissive-strength':1}});
  map.addLayer({id:'casing', type:'line', source:'casing', layout:{'line-cap':'round','line-join':'round'},
    paint:{'line-color':'#1f3a93', 'line-width':11, 'line-emissive-strength':1}});
  map.addLayer({id:'seg', type:'line', source:'seg', layout:{'line-cap':'round','line-join':'round'},
    paint:{'line-color':['get','color'], 'line-width':5, 'line-emissive-strength':1}});
  map.addLayer({id:'inc', type:'circle', source:'inc',
    paint:{'circle-radius':9, 'circle-color':'#8e44ad', 'circle-stroke-color':'#fff', 'circle-stroke-width':2, 'circle-emissive-strength':1}});
  map.addLayer({id:'ics', type:'circle', source:'ics',
    paint:{'circle-radius':7, 'circle-color':'#ff8c00', 'circle-stroke-color':'#fff', 'circle-stroke-width':2, 'circle-emissive-strength':1}});
  map.addLayer({id:'icsLabel', type:'symbol', source:'ics',
    layout:{'text-field':['get','name'], 'text-size':12, 'text-offset':[0, 1.3]},
    paint:{'text-color':'#b35900', 'text-halo-color':'#fff', 'text-halo-width':1.5, 'text-emissive-strength':1}});
  renderIcs();
  routeStyle(document.body.classList.contains('dark')); // 夜ならルートの縁取りを明るく
});
map.on('error', e => showErr('地図エラー：' + (e.error && e.error.message ? e.error.message : '不明')));
map.on('dragstart', () => { if (navOn) setFollow(false); });
map.on('click', e => {
  const p = [e.lngLat.lng, e.lngLat.lat];
  if (icPick) {
    icPick = false;
    const name = prompt('出口の名前（例：上野原IC）');
    if (name && name.trim()) { ics.push({name: name.trim(), p}); saveIcs(); $('guide').textContent = name.trim() + 'を登録しました。'; }
    return;
  }
  if (pickMode) { pickMode = false; setDest(p, '地図で指定した場所'); }
});

// ---------- 現在地 ----------
if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition(onPos, e => showErr('位置情報エラー：' + e.message),
    {enableHighAccuracy: true, maximumAge: 2000, timeout: 20000});
} else showErr('この端末では位置情報が使えません');


// ---------- アプリ化（ホーム画面に追加して全画面で開く） ----------
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(e => showErr('アプリ化の準備に失敗しました（' + e.message + '）'));
}
window.addEventListener('offline', () => showErr('通信できません。地図・渋滞・経路は、通信が戻るまで更新されません'));
window.addEventListener('online', () => showErr('通信が戻りました'));

// ---------- 画面まわり（丸ボタン・夜間モード・再開・版の表示）と使い方ナビ ----------
initUi();
initHelp();
