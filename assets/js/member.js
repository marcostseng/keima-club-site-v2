/* 桂馬會 會員專區：Email 驗證碼登入（後端為 Google Apps Script） */
(function () {
  var root = document.getElementById('member-app');
  if (!root) return;

  var API = root.getAttribute('data-api');
  var KEY = 'keima_member_token';
  var VIEWS = ['loading', 'login', 'code', 'card'];
  var email = '';

  var MSG = {
    invalid_email: 'Email 格式不正確，請再檢查一次。',
    too_soon: '驗證碼剛寄出，請 1 分鐘後再重新取得。',
    expired: '驗證碼已過期，請重新取得。',
    wrong_code: '驗證碼不正確，請再輸入一次。',
    too_many: '錯誤次數太多，請重新取得驗證碼。',
    not_member: '這個 Email 不是已開通的會員。',
    server_error: '系統暫時無法處理，請稍後再試。',
    network: '連線失敗，請確認網路後再試。',
    no_api: '會員系統尚未設定，請寫信到 admin@keima.club。'
  };

  function $(sel) { return root.querySelector(sel); }
  function show(name) {
    VIEWS.forEach(function (v) { $('[data-view="' + v + '"]').hidden = v !== name; });
  }
  var store = {
    get: function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set: function (t) { try { localStorage.setItem(KEY, t); } catch (e) {} },
    del: function () { try { localStorage.removeItem(KEY); } catch (e) {} }
  };

  function call(action, data) {
    if (!API) return Promise.reject(new Error('no_api'));
    var body = Object.assign({ action: action }, data || {});
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('network');
      return res.json();
    });
  }

  function say(form, key, ok) {
    var el = form.querySelector('.m-msg');
    el.textContent = key ? (MSG[key] || key) : '';
    el.classList.toggle('ok', !!ok);
  }
  function busy(form, on) {
    form.querySelector('button[type="submit"]').disabled = on;
  }

  function render(m) {
    $('[data-f="no"]').textContent = m.no;
    $('[data-f="name"]').textContent = m.name;
    $('[data-f="since"]').textContent = m.since;
    $('.m-card-since').hidden = !m.since;
    var lineId = m.links && m.links.lineId;
    $('[data-line]').hidden = !lineId;
    if (lineId) {
      $('[data-f="lineId"]').textContent = lineId;
      $('[data-f="lineAdd"]').href = 'https://line.me/ti/p/~' + encodeURIComponent(lineId);
    }
    $('[data-f="no2"]').textContent = m.no;
    ['materials'].forEach(function (k) {
      var li = $('[data-link="' + k + '"]');
      var url = m.links && m.links[k];
      li.hidden = !url;
      if (url) li.querySelector('a').href = url;
    });
    show('card');
  }

  // 1. 寄驗證碼
  $('[data-form="email"]').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.currentTarget;
    email = $('#m-email').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say(form, 'invalid_email');
    say(form, '');
    busy(form, true);
    call('requestCode', { email: email }).then(function (r) {
      if (!r.ok && r.error !== 'too_soon') return say(form, r.error);
      $('[data-f="email"]').textContent = email;
      $('#m-code').value = '';
      say($('[data-form="code"]'), r.ok ? '' : 'too_soon', true);
      show('code');
      $('#m-code').focus();
    }).catch(function (err) {
      say(form, err.message === 'no_api' ? 'no_api' : 'network');
    }).then(function () { busy(form, false); });
  });

  // 2. 驗證並登入
  $('[data-form="code"]').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.currentTarget;
    var code = $('#m-code').value.replace(/\D/g, '');
    if (code.length !== 6) return say(form, 'wrong_code');
    say(form, '');
    busy(form, true);
    call('verifyCode', { email: email, code: code }).then(function (r) {
      if (!r.ok) {
        say(form, r.error);
        if (r.error === 'expired' || r.error === 'too_many') {
          setTimeout(function () { show('login'); }, 1800);
        }
        return;
      }
      store.set(r.token);
      render(r.member);
    }).catch(function () { say(form, 'network'); })
      .then(function () { busy(form, false); });
  });

  $('[data-act="back"]').addEventListener('click', function () {
    show('login');
    $('#m-email').focus();
  });

  $('[data-act="copy-id"]').addEventListener('click', function (e) {
    var btn = e.currentTarget;
    var id = $('[data-f="lineId"]').textContent;
    var done = function () { btn.textContent = '已複製'; setTimeout(function () { btn.textContent = '複製 ID'; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(id).then(done, function () {});
  });

  $('[data-act="logout"]').addEventListener('click', function () {
    var token = store.get();
    store.del();
    if (token) call('logout', { token: token }).catch(function () {});
    show('login');
  });

  // 開啟頁面時確認登入狀態
  var token = store.get();
  if (!token || !API) {
    show('login');
    if (!API) say($('[data-form="email"]'), 'no_api');
    return;
  }
  call('me', { token: token }).then(function (r) {
    if (r.ok) return render(r.member);
    store.del();
    show('login');
  }).catch(function () {
    show('login');
    say($('[data-form="email"]'), 'network');
  });
})();
