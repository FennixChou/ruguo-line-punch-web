(function () {
  var CFG = window.PUNCH_CONFIG, L = window.PunchLogic;
  var $ = function (id) { return document.getElementById(id); };
  var state = { status: null, pos: null, tab: 'in', busy: false, perfBase: 0, relogin: false };

  function show(el, on) { el.classList.toggle('hidden', !on); }
  function setMsg(el, text, kind) { el.textContent = text; el.className = 'msg ' + (kind || '') + (text ? '' : ' hidden'); }
  function fatal(text) { var f = $('fatal'); f.textContent = text; show(f, true); }

  function api(payload) {
    payload.idToken = liff.getIDToken();
    return fetch(CFG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.code === 'AUTH_FAILED' && !state.relogin) { state.relogin = true; liff.logout(); liff.login({ redirectUri: location.href }); }
        return j;
      });
  }

  // 顯示用時鐘：以伺服器回傳的時間為基準向前走（僅顯示；實際記錄時間由伺服器決定）
  function tickClock() {
    if (!state.status) return;
    var parts = state.status.serverTime.split(':');
    var base = (+parts[0]) * 60 + (+parts[1]);
    var el = Math.floor((performance.now() - state.perfBase) / 1000);
    var tot = base * 60 + el;
    var hh = Math.floor(tot / 3600) % 24, mm = Math.floor(tot / 60) % 60;
    $('clock').textContent = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function readPos() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject({ code: 2 });
      navigator.geolocation.getCurrentPosition(function (p) {
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      }, function (e) { reject(e); }, { enableHighAccuracy: true, timeout: CFG.GEO_TIMEOUT_MS, maximumAge: 0 });
    });
  }

  function renderBtn() { $('punchbtn').disabled = state.busy; }
  function showDist(m) { $('dist').textContent = m === null || m === undefined ? '—' : L.formatDistance(m); }

  function doPunch() {
    if (state.busy) return;
    state.busy = true; renderBtn(); show($('gomakeup'), false); setMsg($('punchmsg'), '定位並打卡中…（只在此刻讀取一次位置）', '');
    var type = state.tab === 'out' ? 'OUT' : 'IN';
    readPos().then(function (p) {
      state.pos = p;
      return api({ action: 'punch', type: type, lat: p.lat, lng: p.lng, accuracy: p.accuracy });
    }).then(function (r) {
      if (r.distanceM !== undefined) showDist(r.distanceM);
      $('accline').textContent = state.pos ? '定位誤差約 ' + Math.round(state.pos.accuracy) + ' 公尺' : '';
      if (r.ok) {
        var extra = r.late ? '（遲到 ' + r.lateMin + ' 分）' : (r.early ? '（早退 ' + r.earlyMin + ' 分）' : '');
        if (r.type === 'IN' && r.dueOutHm) extra += '　今天 ' + r.dueOutHm + ' 後可下班';
        setMsg($('punchmsg'), r.message + '｜距公司 ' + L.formatDistance(r.distanceM) + extra, r.late || r.early ? 'warn' : 'good');
        return refreshStatus();
      }
      if (r.code === 'CONSENT_REQUIRED') { return refreshStatus().then(applyGate); }
      setMsg($('punchmsg'), r.message || '打卡失敗', r.code === 'ALREADY_IN' ? 'warn' : 'bad');
      show($('gomakeup'), r.code === 'OUT_OF_RANGE');
    }).catch(function (e) {
      setMsg($('punchmsg'), e && e.code ? L.geoErrorText(e.code) : '網路異常，請確認連線後重試。', 'bad');
    }).then(function () { state.busy = false; renderBtn(); });
  }

  // ---------- 個資告知同意 ----------
  function consentOf() { return state.status && state.status.consent; }
  function isGated() { var c = consentOf(); return !(c && c.agreed); }

  /** 依同意狀態切換畫面：未同意只顯示同意書；已同意才顯示分頁與打卡鈕。 */
  function applyGate(quiet) {
    var gated = isGated();
    show(document.querySelector('.tabs'), !gated);
    if (gated) {
      ['tab-punch', 'tab-makeup', 'tab-records'].forEach(function (id) { show($(id), false); });
      showConsent('gate', quiet);
    } else {
      show($('consent'), false);
    }
    show($('consent-links'), !gated);
  }

  function showConsent(mode, quiet) {
    var c = consentOf();
    $('consent-title').textContent = c.title || '個資告知同意書';
    $('consent-ver').textContent = '版本 ' + c.version;
    $('consent-text').textContent = c.text;
    $('consent-text').scrollTop = 0;
    show($('consent-gate-btns'), mode === 'gate');
    show($('consent-review-btns'), mode === 'review');
    $('consent-hint').textContent = mode === 'gate'
      ? (c.stale ? '同意書已更新，請重新閱讀並同意後才能繼續打卡。' : c.last === '撤回' ? '您先前已撤回同意，如要使用 LINE 打卡請重新同意。' : '請捲動閱讀全文。')
      : '您目前已同意此版本。';
    setMsg($('consent-msg'), '', '');
    ['tab-punch', 'tab-makeup', 'tab-records'].forEach(function (id) { show($(id), false); });
    show(document.querySelector('.tabs'), false); show($('consent-links'), false);
    show($('consent'), true);
    state.consentMode = mode;
    if (!quiet) api({ action: 'consent', decision: 'view', ua: navigator.userAgent });
  }

  function sendConsent(decision) {
    ['consent-agree', 'consent-withdraw'].forEach(function (id) { $(id).disabled = true; });
    return api({ action: 'consent', decision: decision, ua: navigator.userAgent }).then(function (r) {
      if (!r.ok && !r.consent) { setMsg($('consent-msg'), r.message || '送出失敗', 'bad'); return; }
      if (r.consent) state.status.consent = r.consent;
      if (decision === 'agree' && r.ok) { applyGate(); setTab(L.parseEntry(location.search, location.hash)); return; }
      if (decision === 'withdraw' && r.ok) { applyGate(true); }
      setMsg($('consent-msg'), r.message, r.ok ? (decision === 'agree' ? 'good' : 'warn') : 'bad');
    }).catch(function () { setMsg($('consent-msg'), '網路異常，請重試。', 'bad'); })
      .then(function () { ['consent-agree', 'consent-withdraw'].forEach(function (id) { $(id).disabled = false; }); });
  }

  function graceEnd(s) {
    var p = String(s.workStart).split(':'), m = (+p[0]) * 60 + (+p[1]) + (s.graceMin || 0);
    return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
  }

  function refreshStatus() {
    return api({ action: 'status' }).then(function (s) {
      if (!s.ok) { fatal(s.message || '無法取得狀態'); return false; }
      state.status = s; state.perfBase = performance.now();
      var rule = '上班 ' + s.workStart + '　下班 ' + s.workEnd;
      var tip = '';
      if (s.flexOut) {
        var h = (s.requiredWorkMin + s.breakMin) / 60;
        tip = '上班卡後滿 ' + (Math.round(h * 10) / 10) + ' 小時' + (s.breakMin ? '（含午休 ' + s.breakMin + ' 分鐘）' : '') + '可打卡簽退下班';
        if (s.dueOutHm) tip += '，今天 ' + s.dueOutHm + ' 後下班不算早退';
        rule = '上班打卡簽到時間為 ' + s.workStart + '（彈性至 ' + graceEnd(s) + '）';
      }
      $('who').textContent = s.name + '，您好　' + rule + (tip ? '｜' + tip : '');
      $('datestr').textContent = s.serverDate;
      tickClock();
      return true;
    });
  }

  function setTab(tab) {
    state.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    });
    var punch = tab === 'in' || tab === 'out';
    show($('tab-punch'), punch); show($('tab-makeup'), tab === 'makeup'); show($('tab-records'), tab === 'records');
    if (punch) {
      $('punchbtn').textContent = '確認' + (tab === 'in' ? '上班' : '下班') + '打卡';
      setMsg($('punchmsg'), '', ''); show($('gomakeup'), false); showDist(null); $('accline').textContent = ''; renderBtn();
    }
    if (tab === 'makeup') { $('mk-date').value = state.status.serverDate; $('mk-date').max = state.status.serverDate; }
    if (tab === 'records') loadRecords();
  }

  function submitMakeup() {
    var body = { action: 'makeup', type: $('mk-type').value, date: $('mk-date').value, time: $('mk-time').value, reason: $('mk-reason').value };
    $('mk-submit').disabled = true; setMsg($('mk-msg'), '送出中…', '');
    api(body).then(function (r) {
      setMsg($('mk-msg'), r.message, r.ok ? 'good' : 'bad');
      if (r.ok) { $('mk-reason').value = ''; }
    }).catch(function () { setMsg($('mk-msg'), '網路異常，請重試。', 'bad'); })
      .then(function () { $('mk-submit').disabled = false; });
  }

  function loadRecords() {
    var ym = $('rc-month').value || state.status.serverDate.substring(0, 7);
    $('rc-month').value = ym;
    setMsg($('rc-msg'), '讀取中…', '');
    api({ action: 'records', month: ym }).then(function (r) {
      if (!r.ok) return setMsg($('rc-msg'), r.message, 'bad');
      setMsg($('rc-msg'), '', '');
      var t = r.totals;
      $('rc-sum').innerHTML = '';
      [['應出勤', t.workDays + ' 天'], ['實到', t.attended + ' 天'], ['遲到', t.lateCount + ' 次'],
        ['缺卡', t.missingCount + ' 次'], ['補登', t.makeupCount + ' 次'], ['工時', t.workHours + ' 小時']]
        .forEach(function (kv) {
          var s = document.createElement('span'); s.className = 'pill'; s.textContent = kv[0] + ' ' + kv[1]; $('rc-sum').appendChild(s);
        });
      var body = $('rc-body'); body.innerHTML = '';
      r.days.forEach(function (d) {
        var tr = document.createElement('tr');
        var note = [d.lateMin ? '遲到' + d.lateMin + '分' : '', d.earlyMin ? '早退' + d.earlyMin + '分' : '',
          d.missing ? '缺卡' : '', d.makeup ? '補登' : ''].filter(String).join(' ');
        [d.date.substring(5), d.inHm || '—', d.outHm || '—', note].forEach(function (v) {
          var td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
        });
        body.appendChild(tr);
      });
    }).catch(function () { setMsg($('rc-msg'), '網路異常，請重試。', 'bad'); });
  }

  function start() {
    if (!/^https:\/\/script\.google\.com\//.test(CFG.GAS_URL) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(CFG.GAS_URL)) {
      return fatal('尚未設定後端網址（config.js 的 GAS_URL）。');
    }
    liff.init({ liffId: CFG.LIFF_ID }).then(function () {
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
      return refreshStatus().then(function (ok) {
        if (!ok) return;
        setInterval(tickClock, 5000);
        document.querySelectorAll('.tabs button').forEach(function (b) {
          b.addEventListener('click', function () { setTab(b.dataset.tab); });
        });
        $('punchbtn').addEventListener('click', doPunch);
        $('consent-agree').addEventListener('click', function () { sendConsent('agree'); });
        $('consent-withdraw').addEventListener('click', function () { sendConsent('withdraw'); });
        $('consent-back').addEventListener('click', function () { applyGate(); setTab(state.tab); });
        $('link-consent').addEventListener('click', function (ev) { ev.preventDefault(); showConsent('review'); });
        $('gomakeup').addEventListener('click', function () { setTab('makeup'); });
        $('mk-submit').addEventListener('click', submitMakeup);
        $('rc-month').addEventListener('change', loadRecords);
        if (isGated()) applyGate(); else { applyGate(); setTab(L.parseEntry(location.search, location.hash)); }
      });
    }).catch(function (e) { fatal('LINE 登入初始化失敗：' + (e && e.message || e)); });
  }
  start();
})();
