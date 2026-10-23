/**
 * 桂馬會 棋手自助系統（Player Portal）
 * 棋手自己登錄、修改、下架棋手名鑑的資料，系統直接寫入 GitHub。
 *
 * 流程
 *   登錄：填表 → Email 驗證 →（未成年：法定代理人同意）→ 主辦人一鍵核准 → 上線
 *   修改：輸入 Email → 收到專屬連結 → 修改後立即上線 → 主辦人收到通知（可一鍵還原）
 *   下架：在修改頁按「下架我的資料」→ 立即刪除頁面與照片
 *
 * 安裝方式見同資料夾的 README.md。
 */

const CONFIG = {
  OWNER: 'marcostseng',
  REPO: 'keima-club-site-v2',
  BRANCH: 'main',
  SITE: 'https://keima.club',
  ADMIN_EMAIL: 'admin@keima.club',   // 對外顯示的聯絡信箱
  NOTIFY_EMAIL: 'xshogi@gmail.com',  // 主辦人收通知的信箱（直接寄到 Gmail，避免轉寄被去重）
  APPROVE_NEW: true,      // true：新登錄要主辦人核准；false：Email 驗證後直接上線
  LINK_HOURS: 24,         // 修改連結有效時間
  ADMIN_LINK_DAYS: 14,    // 核准、還原連結有效時間
  MAX_BIO: 300,
  MAX_STYLES: 5,
  PHOTO_MAX_CHARS: 48000, // 大頭照 base64 上限（試算表單格上限 5 萬字）
  WEBAPP_URL: 'https://script.google.com/macros/s/AKfycbxlr14PhsT0fhfK47N8k1ticia9brU1Js171dxLCQTgkFnTgcoW-LjbD7foMSt9y44Vlw/exec',
  ONE_PER_EMAIL: true,    // 一個 Email 只能登錄一份棋手頁
};

const RANKS = ['15級','14級','13級','12級','11級','10級','9級','8級','7級','6級','5級','4級','3級','2級','1級',
  '初段','二段','三段','四段','五段','六段','七段','八段'];
const RESERVED = ['example-player','register','edit','index','admin'];
const P = { slug:0, email:1, guardian:2, status:3, created:4, updated:5, consent:6, pending:7, photo:8, real:9 };

/* ───────── 安裝 ───────── */

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_ID')) {
    const ss = SpreadsheetApp.create('桂馬會 棋手自助系統');
    ss.getSheets()[0].setName('Players')
      .appendRow(['slug','email','guardian_email','status','created','updated','consent','pending_json','pending_photo','real_name']);
    ss.insertSheet('Tokens').appendRow(['token','purpose','slug','expires','used']);
    ss.insertSheet('Log').appendRow(['time','slug','action','detail','prev_md']);
    props.setProperty('SHEET_ID', ss.getId());
  }
  if (!props.getProperty('GITHUB_TOKEN')) {
    throw new Error('請先到「專案設定 → 指令碼屬性」新增 GITHUB_TOKEN，再執行一次 setup。');
  }
  const r = gh_('get', '_players');
  if (r.code !== 200) throw new Error('GitHub 連線失敗（' + r.code + '）：請確認 token 有這個 repository 的 Contents 讀寫權限。');
  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, '棋手自助系統已建立',
    '試算表：https://docs.google.com/spreadsheets/d/' + props.getProperty('SHEET_ID') +
    '\n\nGitHub 連線正常。下一步：部署 → 新增部署作業 → 網頁應用程式，把網址填進網站的 _data/links.yml 的 player_portal。');
}

/** 已經手動建立的棋手頁，交給本人自助管理：在編輯器執行 linkExistingPlayer('wang-xiaoming', 'xxx@gmail.com') */
function linkExistingPlayer(slug, email) {
  if (!ghGetText_('_players/' + slug + '.md')) throw new Error('找不到 _players/' + slug + '.md');
  const sh = sheet_('Players');
  if (findRow_(slug)) throw new Error(slug + ' 已經在名單裡');
  sh.appendRow([slug, email.toLowerCase(), '', 'live', new Date(), new Date(), today_(), '', '', '']);
  sendEditLinks_(email.toLowerCase());
  return '已寄出修改連結給 ' + email;
}

/* ───────── 網頁 ───────── */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.t) return handleToken_(p.t);
    const view = ({ register: 'register', edit: 'request' })[p.p] || 'home';
    return page_(view, {});
  } catch (err) {
    console.error(err);
    return page_('msg', { title: '發生錯誤', text: '系統暫時無法處理，請稍後再試，或寫信到 ' + CONFIG.ADMIN_EMAIL + '。' });
  }
}

function page_(view, data) {
  const t = HtmlService.createTemplateFromFile('Portal');
  t.boot = JSON.stringify({ view: view, data: data, site: CONFIG.SITE, ranks: RANKS,
    maxBio: CONFIG.MAX_BIO, maxStyles: CONFIG.MAX_STYLES, year: new Date().getFullYear() })
    .replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle('棋手名鑑｜桂馬會')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function msg_(title, text) { return page_('msg', { title: title, text: text }); }

/* ───────── 前端呼叫 ───────── */

function getStrategies() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('strategies');
  if (hit) return JSON.parse(hit);
  try {
    const r = UrlFetchApp.fetch(CONFIG.SITE + '/api/strategies.json', { muteHttpExceptions: true });
    const list = JSON.parse(r.getContentText());
    cache.put('strategies', JSON.stringify(list), 21600);
    return list;
  } catch (err) { return []; }
}

function submitRegistration(f) {
  const d = clean_(f);
  const slug = String(f.slug || '').trim().toLowerCase();
  const email = String(f.email || '').trim().toLowerCase();
  const guardian = String(f.guardian || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 40 || RESERVED.indexOf(slug) >= 0)
    throw new Error('網址代號只能用英文小寫、數字和連字號，3～40 字，例如 wang-xiaoming。');
  if (!isEmail_(email)) throw new Error('Email 格式不正確。');
  if (f.minor && (!isEmail_(guardian) || guardian === email)) throw new Error('未滿 18 歲請填寫法定代理人的 Email（不能和本人相同）。');
  if (!f.consent) throw new Error('請勾選同意公開。');
  const photo = cleanPhoto_(f.photo);
  const realName = String(f.real_name || '').replace(/[\u0000-\u001F<>{}"]/g, '').trim().slice(0, 30);

  const done = '確認信已寄到 ' + email + '，請在 ' + CONFIG.LINK_HOURS + ' 小時內點信中的連結。沒收到的話，請看看垃圾郵件匣。';
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_('Players');
    // 同一個 Email 已有棋手頁或正在審核：不建立新資料，改寄信告知本人（畫面訊息相同，不透露 Email 是否登錄過）
    if (CONFIG.ONE_PER_EMAIL) {
      const mine = sh.getDataRange().getValues().map((v, i) => ({ index: i + 1, values: v }))
        .filter(r => r.index > 1 && r.values[P.email] === email);
      const active = mine.filter(r => ['live', 'pending', 'guardian'].indexOf(r.values[P.status]) >= 0)[0];
      if (active) {
        if (active.values[P.status] === 'live') sendEditLinks_(email, true);
        else MailApp.sendEmail({ to: email, subject: '【桂馬會】你的棋手名鑑登錄正在處理中',
          htmlBody: mailHtml_('登錄正在處理中', '<p>這個 Email 已經登錄過棋手名鑑（' + esc_(active.values[P.slug]) +
            '），目前正在等待確認或審核，不需要重新登錄。有問題請回信到 ' + CONFIG.ADMIN_EMAIL + '。</p>') });
        return done;
      }
      // 尚未點確認信的舊登錄（例如填錯資料重填）：以新的為準
      mine.filter(r => r.values[P.status] === 'verifying').reverse().forEach(r => sh.deleteRow(r.index));
    }
    const row = findRow_(slug);
    const stale = row && row.values[P.status] === 'verifying' &&
      new Date(row.values[P.created]).getTime() < Date.now() - CONFIG.LINK_HOURS * 3600e3;
    // 下架過的代號保留給原本的 Email（避免別人接手代號，連到他人的棋譜）
    const reservedByOther = row && row.values[P.status] === 'removed' && row.values[P.email] !== email;
    if ((row && !stale && ['rejected','removed'].indexOf(row.values[P.status]) < 0) || reservedByOther || ghGetText_('_players/' + slug + '.md'))
      throw new Error('網址代號「' + slug + '」已經有人使用，請換一個。');
    if (row) sh.deleteRow(row.index);
    sh.appendRow([slug, email, f.minor ? guardian : '', 'verifying', new Date(), new Date(), '',
      JSON.stringify(d), photo || '', realName]);
  } finally { lock.releaseLock(); }

  const link = tokenLink_('verify', slug, CONFIG.LINK_HOURS);
  MailApp.sendEmail({ to: email, subject: '【桂馬會】請確認你的棋手名鑑登錄',
    htmlBody: mailHtml_('確認你的 Email', '<p>你剛才在桂馬會棋手名鑑登錄了「' + esc_(d.title) + '」。請按下方按鈕確認這是你的 Email：</p>' +
      button_(link, '確認 Email') + '<p style="color:#666;font-size:13px">連結 ' + CONFIG.LINK_HOURS + ' 小時內有效。如果不是你本人操作，請忽略這封信。</p>') });
  return done;
}

function requestEditLink(email) {
  email = String(email || '').trim().toLowerCase();
  if (!isEmail_(email)) throw new Error('Email 格式不正確。');
  const cache = CacheService.getScriptCache(), key = 'req_' + email;
  const n = Number(cache.get(key) || 0);
  if (n >= 3) throw new Error('一小時內最多申請 3 次，請稍後再試。');
  cache.put(key, String(n + 1), 3600);
  sendEditLinks_(email);
  return '如果這個 Email 有登錄棋手名鑑，修改連結已經寄出，' + CONFIG.LINK_HOURS + ' 小時內有效。';
}

function submitEdit(token, f) {
  const tk = useToken_(token, 'edit', false);
  const row = findRow_(tk.slug);
  if (!row || row.values[P.status] !== 'live') throw new Error('這份資料已經不在名單上。');
  const d = clean_(f);
  const path = '_players/' + tk.slug + '.md';
  const prev = ghGetText_(path) || '';
  const old = parseMd_(prev);

  let photo = old.photo || '';
  const changes = [];
  const newPhoto = cleanPhoto_(f.photo);
  if (newPhoto || f.removePhoto) {
    if (photo) changes.push({ path: 'assets/img/players/' + photo, del: true });
    photo = '';
  }
  if (newPhoto) {
    photo = tk.slug + '-' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMddHHmm') + '.jpg';
    changes.push({ path: 'assets/img/players/' + photo, b64: newPhoto });
  }
  changes.push({ path: path, text: buildMd_(d, photo, old.honor_name, row.values[P.consent] || today_()) });
  ghCommit_('棋手自助更新：' + tk.slug, changes);
  touch_(row, 'live');
  sheet_('Log').appendRow([new Date(), tk.slug, 'edit', newPhoto ? '含新照片' : (f.removePhoto ? '移除照片' : ''), prev]);
  const logRow = sheet_('Log').getLastRow();

  const url = CONFIG.SITE + '/players/' + tk.slug + '/';
  MailApp.sendEmail({ to: CONFIG.NOTIFY_EMAIL, subject: '【棋手自助】' + d.title + ' 更新了資料',
    htmlBody: mailHtml_(d.title + ' 更新了資料', summary_(d, url) +
      (newPhoto ? '<p><img src="cid:p" width="120"></p>' : '') +
      '<p>資料已經上線，約 1～2 分鐘後生效。內容有問題時：</p>' +
      button_(tokenLink_('revert', tk.slug + '#' + logRow, CONFIG.ADMIN_LINK_DAYS * 24), '還原成上一版') + ' ' +
      button_(tokenLink_('hidephoto', tk.slug, CONFIG.ADMIN_LINK_DAYS * 24), '移除照片')),
    inlineImages: inline_(newPhoto) });
  notifyPlayer_(row, '【桂馬會】你的棋手資料已更新',
    '<p>你的棋手頁已更新，約 1～2 分鐘後就能看到：</p><p><a href="' + url + '">' + url + '</a></p>');
  return { text: '已儲存。約 1～2 分鐘後，棋手頁會顯示新的資料。', url: url };
}

function removeProfile(token) {
  const tk = useToken_(token, 'edit', false);
  const row = findRow_(tk.slug);
  if (!row || row.values[P.status] !== 'live') throw new Error('這份資料已經不在名單上。');
  const path = '_players/' + tk.slug + '.md';
  const prev = ghGetText_(path) || '';
  const old = parseMd_(prev);
  const changes = [{ path: path, del: true }];
  if (old.photo) changes.push({ path: 'assets/img/players/' + old.photo, del: true });
  ghCommit_('棋手下架：' + tk.slug, changes);
  useToken_(token, 'edit', true);
  touch_(row, 'removed');
  sheet_('Log').appendRow([new Date(), tk.slug, 'remove', '本人下架', prev]);
  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, '【棋手自助】' + (old.title || tk.slug) + ' 已下架',
    '本人已下架棋手頁 ' + tk.slug + '。棋譜檔中的 sente_id／gote_id 若填了這個代號，請改成不具名寫法。');
  notifyPlayer_(row, '【桂馬會】你的棋手頁已下架', '<p>你的棋手頁和照片已經刪除。想再登錄的話，隨時歡迎回來。</p>');
  return '已下架。約 1～2 分鐘後，棋手頁就會消失。';
}

/* ───────── 信中的連結 ───────── */

function handleToken_(token) {
  const tk = peekToken_(token);
  if (!tk) return msg_('連結無效', '這個連結不存在或已經過期。');
  if (tk.used) return msg_('已經處理過', '這個連結已經使用過了。');

  if (tk.purpose === 'edit') {
    const row = findRow_(tk.slug);
    if (!row || row.values[P.status] !== 'live') return msg_('找不到資料', '這份資料已經不在名單上。');
    const d = parseMd_(ghGetText_('_players/' + tk.slug + '.md') || '');
    return page_('edit', { token: token, slug: tk.slug, profile: d,
      photoUrl: d.photo ? CONFIG.SITE + '/assets/img/players/' + d.photo : '' });
  }

  const slug = tk.slug.split('#')[0];
  const row = findRow_(slug);
  if (!row) return msg_('找不到資料', '這份登錄已經不存在。');
  const status = row.values[P.status];
  const d = JSON.parse(row.values[P.pending] || '{}');

  if (tk.purpose === 'verify') {
    if (status !== 'verifying') return msg_('已經確認過', 'Email 已確認，不需要再按一次。');
    useToken_(token, 'verify', true);
    if (row.values[P.guardian]) {
      touch_(row, 'guardian');
      const link = tokenLink_('guardian', slug, 24 * 7);
      MailApp.sendEmail({ to: row.values[P.guardian], subject: '【桂馬會】請確認是否同意公開孩子的棋手資料',
        htmlBody: mailHtml_('法定代理人同意', '<p>您好，' + esc_(d.title) + ' 在桂馬會日本將棋俱樂部的「棋手名鑑」登錄了以下資料，並填寫您為法定代理人。資料公開在網站上前，需要您的同意：</p>' +
          summary_(d, '') + '<p>同意的話請按下方按鈕；不同意請忽略這封信，資料不會公開。之後孩子修改或下架資料時，您也會收到通知。</p>' +
          button_(link, '我同意公開') + '<p style="color:#666;font-size:13px">連結 7 天內有效。有任何問題請回信到 ' + CONFIG.ADMIN_EMAIL + '。</p>') });
      return msg_('Email 已確認', '已經寄信給你的法定代理人，請他按信中的「我同意公開」，之後就會進入審核。');
    }
    return afterConsent_(row, d);
  }

  if (tk.purpose === 'guardian') {
    if (status !== 'guardian') return msg_('已經處理過', '這份資料已經確認過了。');
    useToken_(token, 'guardian', true);
    afterConsent_(row, d);
    return msg_('謝謝您', '已收到您的同意。資料經主辦人確認後，就會刊登在棋手名鑑。');
  }

  if (tk.purpose === 'approve' || tk.purpose === 'approvehonor' || tk.purpose === 'reject') {
    if (status !== 'pending') return msg_('已經處理過', slug + ' 目前狀態是「' + status + '」。');
    useToken_(token, tk.purpose, true);
    if (tk.purpose === 'reject') {
      touch_(row, 'rejected');
      notifyPlayer_(row, '【桂馬會】棋手名鑑登錄結果',
        '<p>這次的登錄沒有通過審核。想了解原因或重新登錄，請回信到 ' + CONFIG.ADMIN_EMAIL + '。</p>');
      return msg_('已退回', slug + ' 已退回，系統已通知本人。');
    }
    const honor = tk.purpose === 'approvehonor' ? String(row.values[P.real] || '') : '';
    publishNew_(row, d, honor);
    return msg_('已核准', (honor ? '已列入「' + honor + '」的優勝紀錄。' : '') + slug + ' 已上線，約 1～2 分鐘後生效：' + CONFIG.SITE + '/players/' + slug + '/');
  }

  if (tk.purpose === 'revert') {
    const logRow = Number(tk.slug.split('#')[1]);
    const prev = sheet_('Log').getRange(logRow, 5).getValue();
    if (!prev) return msg_('無法還原', '找不到上一版的內容。');
    let md = String(prev);
    const pp = parseMd_(md).photo;
    if (pp && !ghGetSha_('assets/img/players/' + pp)) md = md.replace(/^photo:.*\n/m, '');
    ghPut_('_players/' + slug + '.md', Utilities.base64Encode(md, Utilities.Charset.UTF_8), '主辦人還原：' + slug);
    useToken_(token, 'revert', true);
    sheet_('Log').appendRow([new Date(), slug, 'revert', '主辦人還原', '']);
    return msg_('已還原', slug + ' 已還原成上一版（照片若已更換，舊照片無法復原）。');
  }

  if (tk.purpose === 'hidephoto') {
    const path = '_players/' + slug + '.md';
    const d2 = parseMd_(ghGetText_(path) || '');
    if (!d2.photo) return msg_('沒有照片', slug + ' 目前沒有照片。');
    ghCommit_('主辦人移除照片：' + slug, [{ path: 'assets/img/players/' + d2.photo, del: true },
      { path: path, text: buildMd_(d2, '', d2.honor_name, d2.consent || today_()) }]);
    useToken_(token, 'hidephoto', true);
    sheet_('Log').appendRow([new Date(), slug, 'hidephoto', '主辦人移除照片', '']);
    return msg_('已移除照片', slug + ' 的照片已移除。');
  }
  return msg_('連結無效', '無法辨識這個連結。');
}

function afterConsent_(row, d) {
  const slug = row.values[P.slug];
  if (!CONFIG.APPROVE_NEW) { publishNew_(row, d); return msg_('登錄完成', '你的棋手頁約 1～2 分鐘後上線：' + CONFIG.SITE + '/players/' + slug + '/'); }
  touch_(row, 'pending');
  const photo = row.values[P.photo];
  const h = CONFIG.ADMIN_LINK_DAYS * 24;
  MailApp.sendEmail({ to: CONFIG.NOTIFY_EMAIL, subject: '【棋手自助】新登錄待核准：' + d.title,
    htmlBody: mailHtml_('新登錄：' + esc_(d.title), summary_(d, '') +
      '<p>網址代號：' + slug + '<br>真實姓名（不公開）：' + esc_(row.values[P.real] || '未填') + '<br>Email：' + esc_(row.values[P.email]) +
      (row.values[P.guardian] ? '<br>法定代理人：' + esc_(row.values[P.guardian]) + '（已同意）' : '') + '</p>' +
      (photo ? '<p><img src="cid:p" width="120"></p>' : '') +
      honorBlock_(slug, row.values[P.real], h) +
      button_(tokenLink_('approve', slug, h), '核准上線') + ' ' + button_(tokenLink_('reject', slug, h), '退回')),
    inlineImages: inline_(photo) });
  return msg_('Email 已確認', '謝謝！資料經主辦人確認後就會上線，屆時會寄信通知你。');
}

function publishNew_(row, d, honor) {
  const slug = row.values[P.slug];
  const photoB64 = row.values[P.photo];
  let photo = '';
  const changes = [];
  if (photoB64) {
    photo = slug + '-' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMddHHmm') + '.jpg';
    changes.push({ path: 'assets/img/players/' + photo, b64: photoB64 });
  }
  const consent = today_();
  changes.push({ path: '_players/' + slug + '.md', text: buildMd_(d, photo, honor || '', consent) });
  ghCommit_('新增棋手：' + slug, changes);
  const sh = sheet_('Players');
  sh.getRange(row.index, P.consent + 1).setValue(consent);
  sh.getRange(row.index, P.pending + 1, 1, 2).setValues([['', '']]);
  touch_(row, 'live');
  sheet_('Log').appendRow([new Date(), slug, 'publish', '新登錄上線', '']);
  const url = CONFIG.SITE + '/players/' + slug + '/';
  notifyPlayer_(row, '【桂馬會】你的棋手頁已上線',
    '<p>你的棋手頁已經上線：</p><p><a href="' + url + '">' + url + '</a></p>' +
    '<p>之後想修改或下架，到棋手名鑑頁按「修改我的資料」，輸入這個 Email 就會收到修改連結。</p>');
}

/* ───────── 資料處理 ───────── */

function clean_(f) {
  const txt = (s, n) => String(s || '').replace(/[\u0000-\u0009\u000B-\u001F\u007F<>{}]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
  const title = txt(f.title, 20).replace(/\n/g, '');
  if (!title) throw new Error('請填寫顯示名稱。');
  const rank = RANKS.indexOf(f.rank) >= 0 ? f.rank : '';
  const y = Number(f.since), now = new Date().getFullYear();
  const since = y >= 1990 && y <= now ? y : '';
  const strats = getStrategies(), valid = strats.map(s => s.slug);
  const styles = (Array.isArray(f.styles) ? f.styles : []).filter(s => valid.indexOf(s) >= 0);
  // 自行輸入的戰法：名稱和戰法頁相同時換成戰法頁代號，其他保留文字（之後建立戰法頁會自動連結）
  String(f.custom_styles || '').split(/[、,，;；\/\n]+/).map(x => txt(x, 12).replace(/\n/g, '').replace(/["'\[\]]/g, ''))
    .filter(Boolean).slice(0, 3).forEach(name => {
      const hit = strats.filter(s => s.title === name || s.ja === name)[0];
      const v = hit ? hit.slug : name;
      if (styles.indexOf(v) < 0) styles.push(v);
    });
  styles.splice(CONFIG.MAX_STYLES);
  const bio = txt(f.bio, CONFIG.MAX_BIO).replace(/^\s*-{3,}\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return { title: title, alt_name: txt(f.alt_name, 40).replace(/\n/g, ''), rank: rank, since: since, styles: styles, bio: bio };
}

function cleanPhoto_(b64) {
  if (!b64) return '';
  const s = String(b64).replace(/^data:image\/jpeg;base64,/, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(s) || s.length > CONFIG.PHOTO_MAX_CHARS) throw new Error('照片格式或大小不符，請換一張再試。');
  return s;
}

function buildMd_(d, photo, honor, consent) {
  const q = s => JSON.stringify(String(s)); // JSON 字串即合法的 YAML 雙引號字串
  const L = ['---', '# 本人透過棋手自助系統管理；主辦人只需要時填 honor_name',
    'title: ' + q(d.title),
    'description: ' + q('桂馬會棋手' + d.title + '的段級位、對局紀錄與優勝紀錄。')];
  if (d.alt_name) L.push('alt_name: ' + q(d.alt_name));
  if (d.rank) L.push('rank: ' + q(d.rank));
  if (d.since) L.push('since: ' + Number(d.since));
  if (photo) L.push('photo: ' + q(photo));
  if (d.styles && d.styles.length) L.push('styles: [' + d.styles.map(q).join(', ') + ']');
  if (honor) L.push('honor_name: ' + q(honor));
  L.push('consent: ' + consent, 'self_managed: true', '---');
  return L.join('\n') + '\n' + (d.bio ? d.bio + '\n' : '');
}

function parseMd_(text) {
  const m = String(text).match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const o = { styles: [] };
  if (!m) return o;
  m[1].split('\n').forEach(line => {
    const k = line.match(/^(\w+):\s*(.*)$/);
    if (!k) return;
    let v = k[2].trim();
    if (v.charAt(0) === '"') { try { v = JSON.parse(v.match(/^"(?:[^"\\]|\\.)*"/)[0]); } catch (e) {} }
    else v = v.charAt(0) === '#' ? '' : v.replace(/\s+#.*$/, '').trim();
    if (k[1] === 'styles') v = String(v).replace(/[\[\]"']/g, '').split(',').map(s => s.trim()).filter(Boolean);
    o[k[1]] = v;
  });
  o.bio = m[2].trim();
  return o;
}

/* ───────── GitHub ───────── */

function gh_(method, path, body) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const url = 'https://api.github.com/repos/' + CONFIG.OWNER + '/' + CONFIG.REPO + '/contents/' +
    path.split('/').map(encodeURIComponent).join('/') + (method === 'get' ? '?ref=' + CONFIG.BRANCH : '');
  const opt = { method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  const r = UrlFetchApp.fetch(url, opt);
  let json = null; try { json = JSON.parse(r.getContentText()); } catch (e) {}
  return { code: r.getResponseCode(), json: json };
}
/** 把多個檔案的新增、修改、刪除合併成一次 commit（網站只重新建置一次） */
function ghCommit_(message, changes) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = ghApi_('get', 'git/ref/heads/' + CONFIG.BRANCH);
    if (ref.code !== 200) throw new Error('讀取 GitHub 分支失敗（' + ref.code + '）');
    const head = ref.json.object.sha;
    const base = ghApi_('get', 'git/commits/' + head).json.tree.sha;
    const tree = changes.map(c => {
      if (c.del) return { path: c.path, mode: '100644', type: 'blob', sha: null };
      if (c.b64) {
        const b = ghApi_('post', 'git/blobs', { content: c.b64, encoding: 'base64' });
        if (b.code >= 300) throw new Error('上傳檔案失敗（' + b.code + '）：' + c.path);
        return { path: c.path, mode: '100644', type: 'blob', sha: b.json.sha };
      }
      return { path: c.path, mode: '100644', type: 'blob', content: c.text };
    });
    const t = ghApi_('post', 'git/trees', { base_tree: base, tree: tree });
    if (t.code >= 300) throw new Error('建立檔案樹失敗（' + t.code + '）');
    const cm = ghApi_('post', 'git/commits', { message: message, tree: t.json.sha, parents: [head] });
    if (cm.code >= 300) throw new Error('建立 commit 失敗（' + cm.code + '）');
    const up = ghApi_('patch', 'git/refs/heads/' + CONFIG.BRANCH, { sha: cm.json.sha });
    if (up.code < 300) return;
    if (up.code !== 422) throw new Error('更新分支失敗（' + up.code + '）');
    Utilities.sleep(1500); // 同時有其他推送：重試
  }
  throw new Error('GitHub 忙碌中，請稍後再試。');
}
function ghApi_(method, endpoint, body) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const opt = { method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  const r = UrlFetchApp.fetch('https://api.github.com/repos/' + CONFIG.OWNER + '/' + CONFIG.REPO + '/' + endpoint, opt);
  let json = null; try { json = JSON.parse(r.getContentText()); } catch (e) {}
  return { code: r.getResponseCode(), json: json };
}

/** 真實姓名和 _data/titles.yml 的優勝者完全相同時，在核准信中提供「核准並列入優勝紀錄」 */
function honorBlock_(slug, realName, hours) {
  if (!realName) return '';
  const yml = ghGetText_('_data/titles.yml') || '';
  const names = {};
  const re = /\b(?:winner|name|spring|summer|autumn|winter):\s*([^,}\n#]+)/g;
  let m; while ((m = re.exec(yml))) names[m[1].trim().replace(/^["']|["']$/g, '')] = true;
  if (!names[realName]) return '';
  return '<p style="padding:10px 12px;background:#FBF3E4;border-left:4px solid #B08D45">真實姓名「' + esc_(realName) +
    '」和「棋戰與歷屆優勝」名單上的名字相同。確認是本人的話，按「核准並列入優勝紀錄」，棋手頁會自動顯示他的優勝紀錄。</p>' +
    button_(tokenLink_('approvehonor', slug, hours), '核准並列入優勝紀錄') + ' ';
}

function ghGetSha_(path) { const r = gh_('get', path); return r.code === 200 ? r.json.sha : null; }
function ghGetText_(path) {
  const r = gh_('get', path);
  if (r.code !== 200 || !r.json.content) return null;
  return Utilities.newBlob(Utilities.base64Decode(r.json.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
}
function ghPut_(path, b64, message) {
  const body = { message: message, content: b64, branch: CONFIG.BRANCH };
  const sha = ghGetSha_(path); if (sha) body.sha = sha;
  const r = gh_('put', path, body);
  if (r.code >= 300) throw new Error('寫入 GitHub 失敗（' + r.code + '）：' + path);
}
function ghDelete_(path, message) {
  const sha = ghGetSha_(path); if (!sha) return;
  const r = gh_('delete', path, { message: message, sha: sha, branch: CONFIG.BRANCH });
  if (r.code >= 300) throw new Error('刪除 GitHub 檔案失敗（' + r.code + '）：' + path);
}

/* ───────── 試算表與連結 ───────── */

function sheet_(name) { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getSheetByName(name); }

function findRow_(slug) {
  const v = sheet_('Players').getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) if (v[i][P.slug] === slug) return { index: i + 1, values: v[i] };
  return null;
}

function touch_(row, status) {
  sheet_('Players').getRange(row.index, P.status + 1, 1, 3).setValues([[status, row.values[P.created], new Date()]]);
  row.values[P.status] = status;
}

function sendEditLinks_(email, already) {
  const rows = sheet_('Players').getDataRange().getValues().filter((r, i) => i > 0 && r[P.email] === email && r[P.status] === 'live');
  if (!rows.length) return;
  const links = rows.map(r => '<p><b>' + esc_(r[P.slug]) + '</b><br>' + button_(tokenLink_('edit', r[P.slug], CONFIG.LINK_HOURS), '修改這份資料') + '</p>').join('');
  MailApp.sendEmail({ to: email, subject: '【桂馬會】棋手資料修改連結',
    htmlBody: mailHtml_('修改你的棋手資料', (already ? '<p>這個 Email 已經有棋手頁了，不需要重新登錄。想更新資料的話，按下方按鈕修改：</p>' : '<p>按下方按鈕就能修改或下架你的棋手頁：</p>') + links +
      '<p style="color:#666;font-size:13px">連結 ' + CONFIG.LINK_HOURS + ' 小時內有效，期間可以多次修改。不是你本人申請的話，請忽略這封信。</p>') });
}

function tokenLink_(purpose, slug, hours) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  sheet_('Tokens').appendRow([token, purpose, slug, new Date(Date.now() + hours * 3600e3), '']);
  return (CONFIG.WEBAPP_URL || ScriptApp.getService().getUrl()) + '?t=' + token;
}

function peekToken_(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token))) return null;
  const v = sheet_('Tokens').getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (v[i][0] === token) {
    if (new Date(v[i][3]) < new Date()) return null;
    return { row: i + 1, purpose: v[i][1], slug: String(v[i][2]), used: !!v[i][4] };
  }
  return null;
}

function useToken_(token, purpose, markUsed) {
  const tk = peekToken_(token);
  if (!tk || tk.purpose !== purpose) throw new Error('連結無效或已過期，請重新申請。');
  if (tk.used) throw new Error('這個連結已經用過了，請重新申請修改連結。');
  if (markUsed) sheet_('Tokens').getRange(tk.row, 5).setValue(new Date());
  return tk;
}

/* ───────── 信件 ───────── */

function notifyPlayer_(row, subject, html) {
  const cc = row.values[P.guardian] || '';
  MailApp.sendEmail({ to: row.values[P.email], cc: cc, subject: subject, htmlBody: mailHtml_(subject.replace(/^【桂馬會】/, ''), html) });
}

function summary_(d, url) {
  const rows = [['顯示名稱', d.title], ['英文／日文名稱', d.alt_name], ['段級位', d.rank], ['首次參賽', d.since],
    ['常用戰法', (d.styles || []).join('、')], ['個人簡介', d.bio]].filter(r => r[1]);
  return '<table style="border-collapse:collapse;font-size:14px">' + rows.map(r =>
    '<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;white-space:nowrap">' + r[0] +
    '</td><td style="padding:4px 0;white-space:pre-wrap">' + esc_(r[1]) + '</td></tr>').join('') + '</table>' +
    (url ? '<p><a href="' + url + '">' + url + '</a></p>' : '');
}

function mailHtml_(title, body) {
  return '<div style="font-family:sans-serif;max-width:560px;line-height:1.7;color:#2B2320">' +
    '<h2 style="color:#1E2A4A;font-size:20px">' + title + '</h2>' + body +
    '<p style="color:#888;font-size:12px;margin-top:32px">桂馬會日本將棋俱樂部 ' + CONFIG.SITE + '</p></div>';
}
function button_(href, text) {
  return '<a href="' + href + '" style="display:inline-block;background:#A3320B;color:#fff;padding:10px 20px;text-decoration:none;margin:4px 4px 4px 0">' + text + '</a>';
}
function inline_(b64) { return b64 ? { p: Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', 'p.jpg') } : {}; }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
function isEmail_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function today_() { return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'); }
