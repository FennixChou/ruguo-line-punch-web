// 前端純函式（瀏覽器與 Node 測試共用）
(function (root) {
  function haversineM(lat1, lng1, lat2, lng2) {
    var R = 6371008.8, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function formatDistance(m) {
    if (m === null || m === undefined || isNaN(m)) return '—';
    return m < 1000 ? Math.round(m) + ' 公尺' : (Math.round(m / 100) / 10) + ' 公里';
  }
  /** 依目前位置與門檻，決定畫面狀態：ok / poor / out / none */
  function locationState(pos, status) {
    if (!pos) return { kind: 'none', text: '尚未取得位置' };
    var d = Math.round(haversineM(pos.lat, pos.lng, status.company.lat, status.company.lng));
    if (!(pos.accuracy <= status.maxAccuracyM)) {
      return { kind: 'poor', distanceM: d, text: '定位不夠準確（誤差約 ' + Math.round(pos.accuracy) + ' 公尺），請開啟「精確位置」後重新定位' };
    }
    if (d > status.radiusM) {
      return { kind: 'out', distanceM: d, text: '不在打卡範圍內（' + status.radiusM + ' 公尺），無法直接打卡' };
    }
    return { kind: 'ok', distanceM: d, text: '在打卡範圍內（' + status.radiusM + ' 公尺）' };
  }
  function geoErrorText(code) {
    return { 1: '沒有位置權限。請到手機「設定 → 隱私權與安全性 → 定位服務 → LINE」選「使用 App 期間」並開啟「精確位置」。',
      2: '目前讀不到位置，請移到收訊較好的地方。', 3: '定位逾時，請重試。' }[code] || '定位失敗，請重試。';
  }
  function parseEntry(search, hash) {
    var q = new URLSearchParams(search || '');
    var p = q.get('p');
    if (!p) {
      var st = q.get('liff.state'); // LIFF 轉址時可能把原參數包在這裡
      if (st) p = new URLSearchParams(st.replace(/^\?/, '')).get('p');
    }
    if (!p && hash) p = String(hash).replace(/^#/, '');
    return ['in', 'out', 'makeup', 'records'].indexOf(p) >= 0 ? p : 'in';
  }
  var api = { haversineM: haversineM, formatDistance: formatDistance, locationState: locationState, geoErrorText: geoErrorText, parseEntry: parseEntry };
  if (typeof module !== 'undefined') module.exports = api; else root.PunchLogic = api;
})(typeof window !== 'undefined' ? window : this);
