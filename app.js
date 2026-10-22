(function () {
  var CFG = window.PUNCH_CONFIG, L = window.PunchLogic;
  var $ = function (id) { return document.getElementById(id); };
  var ALL_TABS = ['tab-punch', 'tab-makeup', 'tab-records', 'tab-admin', 'tab-review', 'tab-denied'];
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
      ALL_TABS.forEach(function (id) { show($(id), false); });
      showConsent('gate', quiet);
    } else {
      show($('consent'), false);
    }
    show($('consent-links'), false); // 老闆 10/22 指示不在打卡頁顯示查看／撤回連結；權利改向老闆提出
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
    ALL_TABS.forEach(function (id) { show($(id), false); });
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
    var bossTab = tab === 'admin' || tab === 'review';
    Array.prototype.forEach.call(document.querySelectorAll('.boss-tab'), function (b) { show(b, isBoss()); });
    show($('tab-punch'), punch); show($('tab-makeup'), tab === 'makeup'); show($('tab-records'), tab === 'records');
    show($('tab-admin'), tab === 'admin' && isBoss()); show($('tab-review'), tab === 'review' && isBoss());
    show($('tab-denied'), bossTab && !isBoss()); // 員工打開老闆頁：只顯示「僅老闆可使用」，不呼叫後端
    if (punch) {
      $('punchbtn').textContent = '確認' + (tab === 'in' ? '上班' : '下班') + '打卡';
      setMsg($('punchmsg'), '', ''); show($('gomakeup'), false); showDist(null); $('accline').textContent = ''; renderBtn();
    }
    if (tab === 'makeup') { $('mk-date').value = state.status.serverDate; $('mk-date').max = state.status.serverDate; }
    if (tab === 'records') loadRecords();
    if (tab === 'admin' && isBoss()) setAdminMode(ad.mode);
    if (tab === 'review' && isBoss()) loadReview('', '');
  }

  // ---------- 老闆專用：全員紀錄、補登審核（後端同樣檢查角色；前端只是不顯示） ----------
  function isBoss() { return !!(state.status && state.status.isBoss); }
  var ad = { mode: 'day' };

  function cell(tr, text, cls) { var td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.appendChild(td); return td; }
  function pill(text, kind) { var s = document.createElement('span'); s.className = 'st ' + kind; s.textContent = text; return s; }
  function head(cols) {
    var h = $('ad-head'); h.innerHTML = '';
    var tr = document.createElement('tr');
    cols.forEach(function (c) { var th = document.createElement('th'); th.textContent = c; tr.appendChild(th); });
    h.appendChild(tr);
  }
  function addPill(text) { var s = document.createElement('span'); s.className = 'pill'; s.textContent = text; $('ad-sum').appendChild(s); }
  function fillPeople(people) {
    var sel = $('ad-user'), cur = sel.value;
    if (sel.options.length - 1 === people.length) return;
    sel.innerHTML = '';
    var all = document.createElement('option'); all.value = ''; all.textContent = '全部員工'; sel.appendChild(all);
    people.forEach(function (p) { var o = document.createElement('option'); o.value = p.userId; o.textContent = p.name; sel.appendChild(o); });
    sel.value = cur;
  }
  function renderQuota(q) {
    $('ad-quota').textContent = q ? '本月 LINE 訊息 已用 ' + q.used + '／' + (q.limit === null ? '無上限' : '上限 ' + q.limit) : '';
  }
  function stKind(s) { return s === '已下班' || s === '已到' ? 'good' : s === '未到' ? 'warn' : s === '請假或缺卡' ? 'bad' : 'mute'; }

  function renderDay(r, uid) {
    fillPeople(r.rows.map(function (x) { return { userId: x.userId, name: x.name }; }));
    head(['姓名', '狀態', '上班', '下班', '備註']);
    var rows = uid ? r.rows.filter(function (x) { return x.userId === uid; }) : r.rows;
    if (!rows.length) setMsg($('ad-msg'), '沒有資料', '');
    var body = $('ad-body');
    rows.forEach(function (x) {
      var tr = document.createElement('tr');
      cell(tr, x.name, 'name');
      cell(tr, '').appendChild(pill(x.status, stKind(x.status)));
      cell(tr, x.inHm || '—'); cell(tr, x.outHm || '—');
      var due = x.dueOutHm && x.status === '已到' ? '應下班 ' + x.dueOutHm : '';
      cell(tr, [x.lateMin ? '遲到' + x.lateMin + '分' : '', x.earlyMin ? '早退' + x.earlyMin + '分' : '', due, x.makeup ? '補登' : ''].filter(String).join('　'), 'note');
      body.appendChild(tr);
    });
    var n = function (s) { return r.rows.filter(function (x) { return x.status === s; }).length; };
    addPill('已到／已下班 ' + (n('已到') + n('已下班')) + ' 人'); addPill('未到 ' + n('未到') + ' 人'); addPill('請假或缺卡 ' + n('請假或缺卡') + ' 人');
  }

  function renderMonth(r, uid) {
    fillPeople(r.people);
    var body = $('ad-body');
    if (uid && r.days) {
      var t = r.totals[0];
      addPill('應出勤 ' + t.workDays + ' 天'); addPill('實到 ' + t.attended + ' 天'); addPill('遲到 ' + t.lateCount + ' 次／' + t.lateMin + ' 分');
      addPill('早退 ' + t.earlyCount + ' 次／' + t.earlyMin + ' 分'); addPill('缺卡 ' + t.missingCount + ' 次'); addPill('補登 ' + t.makeupCount + ' 次'); addPill('工時 ' + t.workHours + ' 小時');
      head(['日期', '上班', '下班', '備註']);
      r.days.forEach(function (d) {
        var tr = document.createElement('tr');
        cell(tr, d.date.substring(5), 'name'); cell(tr, d.inHm || '—'); cell(tr, d.outHm || '—');
        cell(tr, [d.lateMin ? '遲到' + d.lateMin + '分' : '', d.earlyMin ? '早退' + d.earlyMin + '分' : '', d.missing ? '缺卡' : '', d.makeup ? '補登' : ''].filter(String).join(' '), 'note');
        body.appendChild(tr);
      });
      return;
    }
    head(['姓名', '出勤', '遲到', '早退', '缺卡', '補登', '工時']);
    r.totals.forEach(function (t) {
      var tr = document.createElement('tr');
      cell(tr, t.name, 'name'); cell(tr, t.attended + '/' + t.workDays);
      cell(tr, t.lateCount ? t.lateCount + '次' + t.lateMin + '分' : '—'); cell(tr, t.earlyCount ? t.earlyCount + '次' + t.earlyMin + '分' : '—');
      cell(tr, String(t.missingCount)); cell(tr, String(t.makeupCount)); cell(tr, t.workHours + 'h');
      body.appendChild(tr);
    });
    if (!r.totals.length) setMsg($('ad-msg'), '沒有資料', '');
  }

  function loadAdmin() {
    $('ad-body').innerHTML = ''; $('ad-sum').innerHTML = '';
    setMsg($('ad-msg'), '讀取中…', '');
    var uid = $('ad-user').value;
    var req;
    if (ad.mode === 'day') {
      $('ad-date').value = $('ad-date').value || state.status.serverDate;
      req = api({ action: 'adminDay', date: $('ad-date').value });
    } else {
      $('ad-month').value = $('ad-month').value || state.status.serverDate.substring(0, 7);
      req = api({ action: 'adminMonth', ym: $('ad-month').value, userId: uid || undefined });
    }
    req.then(function (r) {
      if (!r.ok) return setMsg($('ad-msg'), r.message, 'bad');
      setMsg($('ad-msg'), '', '');
      if (ad.mode === 'day') { renderDay(r, uid); renderQuota(r.lineQuota); } else renderMonth(r, uid);
    }).catch(function () { setMsg($('ad-msg'), '網路異常，請重試。', 'bad'); });
  }

  function setAdminMode(mode) {
    ad.mode = mode;
    Array.prototype.forEach.call(document.querySelectorAll('.seg button'), function (b) { b.setAttribute('aria-selected', b.dataset.ad === mode ? 'true' : 'false'); });
    show($('ad-day-ctl'), mode === 'day'); show($('ad-month-ctl'), mode === 'month');
    loadAdmin();
  }

  function loadReview(note, kind) {
    return api({ action: 'adminReview' }).then(function (r) {
      var list = $('rv-list'); list.innerHTML = '';
      if (!r.ok) return setMsg($('rv-msg'), r.message, 'bad');
      r.items.forEach(function (it) { list.appendChild(reviewItem(it)); });
      var tail = r.items.length ? '' : '目前沒有待審的補登申請。';
      setMsg($('rv-msg'), [note, tail].filter(String).join('　'), note ? kind : '');
    }).catch(function () { setMsg($('rv-msg'), '網路異常，請重試。', 'bad'); });
  }

  /** 每筆：核准／駁回都要二次確認（按下後出現「確定？」才送出）。 */
  function reviewItem(it) {
    var label = it.name + '　' + it.date + ' ' + (it.type === 'IN' ? '上班' : '下班') + ' ' + it.time;
    var box = document.createElement('div'); box.className = 'rv-item';
    var ttl = document.createElement('div'); ttl.className = 'ttl'; ttl.textContent = label;
    var why = document.createElement('div'); why.className = 'why'; why.textContent = '原因：' + it.reason + '（申請於 ' + String(it.appliedAt).substring(0, 16) + '）';
    var acts = document.createElement('div'); acts.className = 'rv-actions';
    var ok = document.createElement('button'); ok.className = 'btn'; ok.textContent = '核准'; ok.dataset.act = 'ask-ok';
    var no = document.createElement('button'); no.className = 'btn secondary'; no.textContent = '駁回'; no.dataset.act = 'ask-no';
    acts.appendChild(ok); acts.appendChild(no);
    var conf = document.createElement('div'); conf.className = 'rv-confirm hidden';
    var q = document.createElement('div');
    var row2 = document.createElement('div'); row2.className = 'rv-actions';
    var go = document.createElement('button'); go.className = 'btn'; go.textContent = '確定'; go.dataset.act = 'go';
    var back = document.createElement('button'); back.className = 'btn secondary'; back.textContent = '取消'; back.dataset.act = 'back';
    row2.appendChild(go); row2.appendChild(back); conf.appendChild(q); conf.appendChild(row2);
    var decision = '';
    function ask(d) { decision = d; q.textContent = '確定要「' + d + '」這筆補登嗎？' + label; show(acts, false); show(conf, true); }
    ok.addEventListener('click', function () { ask('核准'); });
    no.addEventListener('click', function () { ask('駁回'); });
    back.addEventListener('click', function () { show(conf, false); show(acts, true); });
    go.addEventListener('click', function () {
      go.disabled = true; back.disabled = true;
      api({ action: 'adminDecide', id: it.id, decision: decision }).then(function (r) {
        return loadReview(r.message || '', r.ok ? 'good' : 'bad');
      }).catch(function () { setMsg($('rv-msg'), '網路異常，請重試。', 'bad'); go.disabled = false; back.disabled = false; });
    });
    box.appendChild(ttl); box.appendChild(why); box.appendChild(acts); box.appendChild(conf);
    return box;
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
        Array.prototype.forEach.call(document.querySelectorAll('.seg button'), function (b) { b.addEventListener('click', function () { setAdminMode(b.dataset.ad); }); });
        ['ad-date', 'ad-month', 'ad-user'].forEach(function (id) { $(id).addEventListener('change', loadAdmin); });
        if (isGated()) applyGate(); else { applyGate(); setTab(L.parseEntry(location.search, location.hash)); }
      });
    }).catch(function (e) { fatal('LINE 登入初始化失敗：' + (e && e.message || e)); });
  }
  start();
})();
