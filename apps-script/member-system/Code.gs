/**
 * 桂馬會 會員系統（Google Apps Script，綁定在「桂馬會會員名冊」試算表）
 * ⚠ 這個檔案不要放進網站 repository。
 *
 * 功能：
 *  1. setup() 建立入會申請表、會員名冊、觸發器
 *  2. 申請表送出 → 寫入會員名冊（待繳費）→ 寄繳費說明信、通知主辦人
 *     繳費回報表送出 → 填入名冊的匯款末五碼 → 通知主辦人對帳
 *  3. 名冊「狀態」改為「已入會」→ 自動配發會員編號 → 寄歡迎信
 *  4. 網站 /member/ 的 Email 驗證碼登入（部署為網頁應用程式）
 *  5. 棋手稱號自動同步：會員名冊 → GitHub 的 _data/member_players.yml
 *     （只寫棋手檔名；只由試算表觸發器與計時器執行，網站 API 無法觸發）
 *
 * 指令碼屬性（專案設定 → 指令碼屬性）：
 *  PAYMENT_INFO     匯款資訊（銀行、帳號），寫在繳費說明信裡
 *  LINE_ID          你的 LINE ID（會員加好友後由你邀請入群；只給登入的會員）
 *  MATERIALS_URL    會員教材資料夾連結（只給登入的會員）
 *  GITHUB_TOKEN     與棋手自助系統相同的 fine-grained token（只限本 repo、Contents 讀寫）
 *  PLAYER_SHEET_ID  棋手自助系統試算表的 ID（用 Email 自動比對棋手檔名）
 */

const CFG = {
  MEMBERS: '會員名冊',
  SESSIONS: 'Sessions',
  PREFIX: 'KM-',
  DIGITS: 4,
  SITE: 'https://keima.club',
  ADMIN_EMAIL: 'admin@keima.club',   // 對外顯示、會員回信的信箱
  NOTIFY_EMAIL: 'xshogi@gmail.com',  // 主辦人收通知（新申請、繳費回報）
  TZ: 'Asia/Taipei',
  SESSION_DAYS: 180,
  OTP_TTL: 600,      // 驗證碼有效 10 分鐘
  OTP_MAX_TRIES: 5,
  RESEND_WAIT: 60,   // 同一 Email 60 秒內不重寄
  GH_OWNER: 'marcostseng',
  GH_REPO: 'keima-club-site-v2',
  GH_BRANCH: 'main',
  MEMBER_PLAYERS_PATH: '_data/member_players.yml'
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;  // 棋手檔名格式（防止寫入奇怪內容）

const COLS = ['申請時間', '姓名', '顯示名稱', 'Email', '手機', '段級位', '繳費方式', '匯款末五碼',
  '未滿18歲', '法定代理人', '名鑑稱號', '狀態', '會員編號', '入會日期', '編號信', '備註', '棋手檔名'];

const STATUS = { PENDING: '待繳費', ACTIVE: '已入會', SUSPENDED: '停權', CANCELLED: '取消' };

// 表單題目（改題目文字時這裡也要一起改）
const Q = {
  name: '姓名',
  display: '顯示名稱',
  email: 'Email',
  phone: '手機',
  rank: '目前程度',
  pay: '繳費方式',
  last5: '匯款帳號末五碼',
  minor: '是否未滿 18 歲',
  guardian: '法定代理人姓名',
  badge: '棋手名鑑會員稱號',
  consent: '個人資料使用同意'
};

// 繳費回報表題目
const PQ = {
  email: '入會申請時填寫的 Email',
  last5: '匯款帳號末五碼',
  date: '匯款日期',
  note: '備註'
};

/* ───────────── 初始設定（在編輯器手動執行；可重複執行） ───────────── */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('這個指令碼沒有綁定試算表。請打開「桂馬會會員名冊」試算表 → 擴充功能 → Apps Script，把程式碼貼在那裡再執行 setup。');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SS_ID', ss.getId());
  ['PAYMENT_INFO', 'LINE_ID', 'MATERIALS_URL', 'GITHUB_TOKEN', 'PLAYER_SHEET_ID'].forEach(k => {
    if (props.getProperty(k) === null) props.setProperty(k, '');
  });

  // 會員名冊
  let sh = ss.getSheetByName(CFG.MEMBERS) || ss.insertSheet(CFG.MEMBERS);
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold'); // 新增欄位時補上標題
  sh.setFrozenRows(1);
  const body = n => sh.getRange(2, col_(n), sh.getMaxRows() - 1);
  body('狀態').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(Object.values(STATUS), true).build());
  ['手機', '匯款末五碼', '會員編號'].forEach(n => body(n).setNumberFormat('@'));
  body('入會日期').setNumberFormat('yyyy-mm-dd');
  body('編號信').setNumberFormat('yyyy-mm-dd hh:mm');

  // 登入工作階段（隱藏）
  let ses = ss.getSheetByName(CFG.SESSIONS) || ss.insertSheet(CFG.SESSIONS);
  if (ses.getLastRow() === 0) ses.appendRow(['tokenHash', '會員編號', '到期']);
  ses.getRange('A:A').setNumberFormat('@');
  ses.hideSheet();

  // 入會申請表
  let form;
  const formId = props.getProperty('FORM_ID');
  if (formId) {
    form = FormApp.openById(formId);
  } else {
    form = buildForm_();
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
    props.setProperty('FORM_ID', form.getId());
  }

  // 繳費回報表
  let payForm;
  const payId = props.getProperty('PAY_FORM_ID');
  if (payId) {
    payForm = FormApp.openById(payId);
  } else {
    payForm = buildPayForm_();
    payForm.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
    props.setProperty('PAY_FORM_ID', payForm.getId());
  }

  // 觸發器
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('handleFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('cleanSessions').timeBased().everyDays(1).atHour(4).create();
  ScriptApp.newTrigger('syncMemberPlayers').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('checkTokenExpiry').timeBased().everyDays(1).atHour(9).create();

  if (props.getProperty('GITHUB_TOKEN')) {
    const r = ghContents_('get', '_players');
    Logger.log(r.code === 200 ? 'GitHub 連線正常。' : 'GitHub 連線失敗（' + r.code + '），請檢查 GITHUB_TOKEN。');
  } else {
    Logger.log('尚未設定 GITHUB_TOKEN：棋手稱號不會自動同步。');
  }

  Logger.log('入會申請表：\n' + form.getPublishedUrl());
  Logger.log('繳費回報表（會自動附在繳費說明信裡）：\n' + payForm.getPublishedUrl());
}

function buildForm_() {
  const f = FormApp.create('桂馬會入會申請');
  f.setDescription(
    '桂馬會日本將棋俱樂部入會費 NT$1,000（一次性，無年費）。\n' +
    '會員權益：會員專屬 LINE 社群與教材、龍馬盃額滿時優先遞補、例會滿座時優先入座。\n' +
    '送出後會收到繳費說明信；確認收款後，我們會寄出你的會員編號。');
  f.setConfirmationMessage('已收到申請！請到 Email 查看繳費說明（沒看到請檢查垃圾郵件匣）。');
  f.setAllowResponseEdits(false);

  f.addTextItem().setTitle(Q.name).setHelpText('會員名冊用，不會公開。').setRequired(true);
  f.addTextItem().setTitle(Q.display).setHelpText('會員證、棋手名鑑上顯示的名字，可以用暱稱。').setRequired(true);
  f.addTextItem().setTitle(Q.email).setHelpText('寄送會員編號，也是登入會員專區用的 Email。').setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  f.addTextItem().setTitle(Q.phone).setHelpText('選填，只用於聯絡，不會公開。');
  f.addMultipleChoiceItem().setTitle(Q.rank)
    .setChoiceValues(['剛開始學', '級位', '段位', '不確定']);
  f.addMultipleChoiceItem().setTitle(Q.pay).setRequired(true)
    .setChoiceValues(['銀行匯款', '例會現場繳費']);
  f.addTextItem().setTitle(Q.last5).setHelpText('選擇匯款的人填寫，方便對帳。');
  f.addMultipleChoiceItem().setTitle(Q.minor).setRequired(true).setChoiceValues(['否', '是']);
  f.addTextItem().setTitle(Q.guardian).setHelpText('未滿 18 歲請填寫，並須經法定代理人同意入會。');
  f.addMultipleChoiceItem().setTitle(Q.badge).setRequired(true)
    .setHelpText('如果你日後登錄棋手名鑑，是否在棋手頁顯示「桂馬會會員」稱號？之後可以隨時更改。')
    .setChoiceValues(['同意顯示', '不顯示']);
  f.addCheckboxItem().setTitle(Q.consent).setRequired(true)
    .setChoiceValues(['我同意桂馬會為會員管理、活動通知與會員身分驗證使用以上資料，不提供給第三方。']);
  return f;
}

function buildPayForm_() {
  const f = FormApp.create('桂馬會入會費繳費回報');
  f.setDescription('匯款入會費 NT$1,000 後，請填寫這份表單，方便我們對帳。');
  f.setConfirmationMessage('已收到繳費回報！確認入帳後，我們會寄出你的會員編號。');
  f.addTextItem().setTitle(PQ.email).setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  f.addTextItem().setTitle(PQ.last5).setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextMatchesPattern('^[0-9]{5}$')
      .setHelpText('請填 5 位數字').build());
  f.addDateItem().setTitle(PQ.date).setRequired(true);
  f.addParagraphTextItem().setTitle(PQ.note).setHelpText('選填，例如用家人的帳戶匯款');
  return f;
}

/* 繳費回報表網址，預先填好 Email */
function payFormUrl_(email) {
  const id = PropertiesService.getScriptProperties().getProperty('PAY_FORM_ID');
  if (!id) return '';
  const f = FormApp.openById(id);
  const item = f.getItems().find(i => i.getTitle() === PQ.email);
  if (!item) return f.getPublishedUrl();
  return f.createResponse().withItemResponse(item.asTextItem().createResponse(email)).toPrefilledUrl();
}

/* ───────────── 表單送出 ───────────── */

function handleFormSubmit(e) {
  if (e.namedValues && e.namedValues[PQ.date]) return handlePayReport_(e);
  const v = k => String(((e.namedValues || {})[Q[k]] || [''])[0] || '').trim();
  const email = norm_(v('email'));
  const dup = findMember_(r => norm_(r.Email) === email && r.狀態 === STATUS.ACTIVE);

  const row = {
    申請時間: new Date(),
    姓名: v('name'),
    顯示名稱: v('display'),
    Email: email,
    手機: txt_(v('phone')),
    段級位: v('rank'),
    繳費方式: v('pay'),
    匯款末五碼: txt_(v('last5')),
    未滿18歲: v('minor'),
    法定代理人: v('guardian'),
    名鑑稱號: v('badge'),
    狀態: STATUS.PENDING,
    會員編號: '',
    入會日期: '',
    編號信: '',
    備註: dup ? '已是會員 ' + dup.會員編號 : (v('minor') === '是' && !v('guardian') ? '未成年，缺法定代理人' : '')
  };
  members_().appendRow(COLS.map(c => row[c]));
  if (!dup) sendApplyMail_(row);
  notify_('【入會申請】' + row.顯示名稱 + '（' + row.繳費方式 + '）',
    '有一筆新的入會申請。\n\n' +
    '姓名：' + row.姓名 + '\n顯示名稱：' + row.顯示名稱 + '\nEmail：' + row.Email +
    '\n程度：' + row.段級位 + '\n繳費方式：' + row.繳費方式 +
    (row.未滿18歲 === '是' ? '\n未滿 18 歲，法定代理人：' + (row.法定代理人 || '（未填）') : '') +
    (row.備註 ? '\n⚠ ' + row.備註 : '') +
    '\n\n收到入會費後，把名冊的「狀態」改為「已入會」即可配發編號。\n' + ss_().getUrl());
}

function handlePayReport_(e) {
  const v = t => String(((e.namedValues || {})[t] || [''])[0] || '').trim();
  const email = norm_(v(PQ.email));
  const last5 = v(PQ.last5);
  const date = v(PQ.date);
  const note = v(PQ.note);
  const pending = rows_().filter(r => norm_(r.Email) === email && r.狀態 === STATUS.PENDING);
  const r = pending[pending.length - 1];
  if (r) {
    const sh = members_();
    sh.getRange(r._row, col_('匯款末五碼')).setValue(txt_(last5));
    const memo = sh.getRange(r._row, col_('備註'));
    memo.setValue([memo.getValue(), '匯款回報 ' + date + (note ? '（' + note + '）' : '')].filter(String).join('；'));
  }
  notify_('【入會繳費回報】' + (r ? r.顯示名稱 : email) + ' 末五碼 ' + last5,
    (r ? '' : '⚠ 名冊裡找不到這個 Email 的「待繳費」申請，請人工核對。\n\n') +
    'Email：' + email + '\n匯款帳號末五碼：' + last5 + '\n匯款日期：' + date +
    (note ? '\n備註：' + note : '') +
    '\n\n對帳無誤後，把名冊的「狀態」改為「已入會」即可配發編號。\n' + ss_().getUrl());
}

/* ───────────── 開通會員 ───────────── */

function handleEdit(e) {
  const r = e.range;
  if (r.getSheet().getName() !== CFG.MEMBERS || r.getRow() < 2) return;
  if (r.getNumRows() === 1 && r.getNumColumns() === 1 && r.getColumn() === col_('狀態') && e.value === STATUS.ACTIVE) {
    activateRow_(r.getRow());
  }
  // 影響棋手稱號的欄位有變動 → 同步到網站（內容沒變就不會 commit）
  const watch = ['狀態', '名鑑稱號', '棋手檔名'].map(col_);
  const c1 = r.getColumn(), c2 = c1 + r.getNumColumns() - 1;
  if (watch.some(c => c >= c1 && c <= c2)) syncMemberPlayers();
}

/**
 * 開通一列會員：
 *  - 會員編號空白 → 配發下一個編號；已填 → 保留（可手動指定編號）
 *  - 入會日期空白且有申請時間（從申請表來的）→ 填今天；手動匯入的既有會員照填的
 *  - 「編號信」空白 → 寄歡迎信並記錄寄出時間；已寄過就不重寄
 */
function activateRow_(rowNum) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = members_();
    const noCell = sh.getRange(rowNum, col_('會員編號'));
    const mailCell = sh.getRange(rowNum, col_('編號信'));
    const no = String(noCell.getValue()).trim();
    if (no && rows_().filter(r => String(r.會員編號).trim() === no).length > 1) {
      noCell.setBackground('#f4c7c3');
      sh.getRange(rowNum, col_('備註')).setValue('⚠ 會員編號 ' + no + ' 重複，未寄信。修正後把狀態改回「已入會」');
      toast_('會員編號 ' + no + ' 重複，未寄信。');
      return false;
    }
    noCell.setBackground(null);
    if (!no) noCell.setValue(nextNumber_());
    // 入會日期：透過申請表入會的（有申請時間）自動填今天；手動匯入的既有會員照填的，空白就留空
    const dateCell = sh.getRange(rowNum, col_('入會日期'));
    if (dateCell.getValue() === '' && sh.getRange(rowNum, col_('申請時間')).getValue() !== '') {
      dateCell.setValue(new Date());
    }
    if (mailCell.getValue() !== '') return false;
    SpreadsheetApp.flush();
    sendWelcomeMail_(rowObj_(rowNum));
    mailCell.setValue(new Date());
    return true;
  } finally {
    lock.releaseLock();
  }
}

/* 名冊中重複的會員編號（手動填寫既有會員編號時檢查用） */
function duplicateNumbers_() {
  const seen = {}, dup = [];
  rows_().forEach(r => {
    const no = String(r.會員編號).trim();
    if (!no) return;
    if (seen[no] && dup.indexOf(no) < 0) dup.push(no);
    seen[no] = true;
  });
  return dup;
}

function nextNumber_() {
  const max = rows_().reduce((m, r) => {
    const n = parseInt(String(r.會員編號).replace(CFG.PREFIX, ''), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return CFG.PREFIX + String(max + 1).padStart(CFG.DIGITS, '0'); // 接在既有最大編號之後
}

/* 試算表選單：批次開通（例如匯入既有會員）、重寄歡迎信 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('桂馬會')
    .addItem('開通選取列的會員', 'activateSelected')
    .addItem('重寄會員編號信（選取列）', 'resendWelcome')
    .addItem('立即同步棋手稱號', 'syncNow')
    .addToUi();
}

function activateSelected() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== CFG.MEMBERS) return ui.alert('請先到「' + CFG.MEMBERS + '」選取要開通的列。');
  const dup = duplicateNumbers_();
  if (dup.length) return ui.alert('會員編號重複，請先修正：' + dup.join('、'));
  const range = sh.getActiveRange();
  let done = 0;
  for (let i = range.getRow(); i < range.getRow() + range.getNumRows(); i++) {
    if (i < 2) continue;
    sh.getRange(i, col_('狀態')).setValue(STATUS.ACTIVE);
    if (activateRow_(i)) done++;
  }
  const sync = syncMemberPlayers();
  ui.alert('已開通，寄出 ' + done + ' 封會員編號信（之前寄過的不重寄）。\n' + sync);
}

function resendWelcome() {
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== CFG.MEMBERS) return;
  const range = sh.getActiveRange();
  let sent = 0;
  for (let i = Math.max(range.getRow(), 2); i < range.getRow() + range.getNumRows(); i++) {
    const m = rowObj_(i);
    if (m.會員編號 && m.狀態 === STATUS.ACTIVE) {
      sendWelcomeMail_(m);
      sh.getRange(i, col_('編號信')).setValue(new Date());
      sent++;
    }
  }
  SpreadsheetApp.getUi().alert('已重寄 ' + sent + ' 封。');
}

/* ───────────── 棋手稱號同步（會員名冊 → GitHub） ───────────── */

function syncNow() {
  SpreadsheetApp.getUi().alert(syncMemberPlayers());
}

/** 計時器（每小時）、名冊異動、選單都會呼叫；回傳一行結果說明 */
function syncMemberPlayers() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return '同步進行中，稍後會再執行。';
  try {
    return syncMemberPlayers_();
  } catch (err) {
    console.error(err);
    notifyOnce_('sync-fail', '【會員系統】棋手稱號同步失敗',
      '錯誤訊息：' + err.message + '\n\n' +
      '網站和會員登入不受影響，只是棋手頁的會員稱號暫時不會更新。\n' +
      '如果訊息是 401，代表 GitHub token 已過期或失效，請依照 token 到期通知信的步驟更新。\n' +
      '修好後在會員名冊按「桂馬會 → 立即同步棋手稱號」。\n\n' + ss_().getUrl());
    return '棋手稱號同步失敗：' + err.message;
  } finally {
    lock.releaseLock();
  }
}

function syncMemberPlayers_() {
  if (!PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN')) return '尚未設定 GITHUB_TOKEN，未同步棋手稱號。';
  autoMatchPlayers_();

  const dir = ghContents_('get', '_players');
  if (dir.code !== 200) throw new Error('讀取 GitHub 棋手資料夾失敗（' + dir.code + '）');
  const existing = {};
  dir.json.forEach(f => { if (/\.md$/.test(f.name)) existing[f.name.replace(/\.md$/, '')] = true; });

  const slugs = {};
  rows_().forEach(r => {
    const slug = String(r.棋手檔名 || '').trim().toLowerCase();
    if (!slug || r.狀態 !== STATUS.ACTIVE || r.名鑑稱號 !== '同意顯示') return;
    if (!SLUG_RE.test(slug)) return addNote_(r._row, '棋手檔名格式不符，未同步');
    if (!existing[slug]) return addNote_(r._row, '找不到棋手頁 ' + slug + '，未同步');
    slugs[slug] = true;
  });
  const list = Object.keys(slugs).sort();
  const text = '# 自動產生，請勿手動修改（來源：會員名冊，由會員系統每小時同步）\n' +
    '# 會員且同意顯示稱號的棋手檔名；只有檔名，沒有會員編號或個人資料\n' +
    (list.length ? list.map(x => '- ' + x).join('\n') : '[]') + '\n';

  const cur = ghContents_('get', CFG.MEMBER_PLAYERS_PATH);
  const sha = cur.code === 200 ? cur.json.sha : null;
  const old = cur.code === 200
    ? Utilities.newBlob(Utilities.base64Decode(cur.json.content.replace(/\s/g, ''))).getDataAsString('UTF-8') : '';
  if (old === text) return '棋手稱號已是最新（' + list.length + ' 位）。';

  const body = { message: '會員稱號自動同步（' + list.length + ' 位）', branch: CFG.GH_BRANCH,
    content: Utilities.base64Encode(text, Utilities.Charset.UTF_8) };
  if (sha) body.sha = sha;
  const put = ghContents_('put', CFG.MEMBER_PLAYERS_PATH, body);
  if (put.code >= 300) throw new Error('寫入 GitHub 失敗（' + put.code + '）');
  return '棋手稱號已同步到網站（' + list.length + ' 位），約 1～2 分鐘後生效。';
}

/** 已入會、還沒填棋手檔名的會員：用 Email 比對棋手自助系統，找到就自動填入 */
function autoMatchPlayers_() {
  const id = PropertiesService.getScriptProperties().getProperty('PLAYER_SHEET_ID');
  if (!id) return;
  const ps = SpreadsheetApp.openById(id).getSheetByName('Players');
  if (!ps) return;
  const byEmail = {};
  ps.getDataRange().getValues().slice(1).forEach(v => {
    if (v[3] === 'live' && v[0] && v[1]) byEmail[norm_(v[1])] = String(v[0]);
  });
  const sh = members_();
  rows_().forEach(r => {
    if (r.狀態 !== STATUS.ACTIVE || String(r.棋手檔名 || '').trim()) return;
    const slug = byEmail[norm_(r.Email)];
    if (!slug) return;
    sh.getRange(r._row, col_('棋手檔名')).setValue(slug);
    addNote_(r._row, '棋手檔名依 Email 自動比對');
  });
}

/* ───────────── GitHub token 到期檢查（每天早上 9 點） ───────────── */

const TOKEN_ALERT_DAYS = [30, 14, 7, 3, 1, 0]; // 剩這些天數時寄信提醒

function checkTokenExpiry() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) return Logger.log('尚未設定 GITHUB_TOKEN。');
  const r = UrlFetchApp.fetch('https://api.github.com/repos/' + CFG.GH_OWNER + '/' + CFG.GH_REPO, {
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  });
  if (r.getResponseCode() === 401) {
    notifyOnce_('token-invalid', '【緊急】桂馬會 GitHub token 已失效', tokenGuide_('已經失效（過期或被撤銷）'));
    return Logger.log('GitHub token 已失效。');
  }
  const headers = r.getHeaders();
  let exp = '';
  Object.keys(headers).forEach(k => { if (k.toLowerCase() === 'github-authentication-token-expiration') exp = String(headers[k]); });
  const m = exp.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return Logger.log('這組 token 沒有到期日。');
  const expDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const left = Math.round((expDate - today) / 864e5);
  Logger.log('GitHub token 到期日：' + m[0] + '（剩 ' + left + ' 天）');
  if (TOKEN_ALERT_DAYS.indexOf(left) >= 0) {
    notifyOnce_('token-' + left, '【提醒】桂馬會 GitHub token 將在 ' + left + ' 天後到期（' + m[0] + '）',
      tokenGuide_('將在 ' + m[0] + ' 到期，還剩 ' + left + ' 天'));
  }
}

function tokenGuide_(state) {
  return '網站的 GitHub token ' + state + '。\n\n' +
    '■ 到期後會怎樣\n' +
    '・棋手自助系統：棋手無法登錄、修改、下架資料\n' +
    '・會員系統：棋手頁的會員稱號不會更新\n' +
    '・不受影響：網站瀏覽、會員專區登入、入會申請、寄信\n\n' +
    '■ 更新步驟（約 3 分鐘）\n' +
    '1. GitHub → 右上頭像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens\n' +
    '2. 點這組 token → Regenerate token → 選新的到期日 → 複製 github_pat_ 開頭的新 token\n' +
    '3. 棋手自助系統的 Apps Script → 專案設定 → 指令碼屬性 → GITHUB_TOKEN 貼上新值\n' +
    '4. 會員系統的 Apps Script → 同樣更新 GITHUB_TOKEN\n' +
    '5. 在會員名冊按「桂馬會 → 立即同步棋手稱號」，顯示成功就完成了\n\n' +
    '兩個 Apps Script 都要更新，漏一個就有一邊會壞。';
}

/* 同一件事一天最多通知一次 */
function notifyOnce_(key, subject, body) {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
  if (props.getProperty('notified:' + key) === today) return;
  notify_(subject, body);
  props.setProperty('notified:' + key, today);
}

function addNote_(rowNum, text) {
  const cell = members_().getRange(rowNum, col_('備註'));
  const cur = String(cell.getValue() || '');
  if (cur.indexOf(text) < 0) cell.setValue(cur ? cur + '；' + text : text);
}

function ghContents_(method, path, body) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const url = 'https://api.github.com/repos/' + CFG.GH_OWNER + '/' + CFG.GH_REPO + '/contents/' +
    path.split('/').map(encodeURIComponent).join('/') + (method === 'get' ? '?ref=' + CFG.GH_BRANCH : '');
  const opt = { method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  const r = UrlFetchApp.fetch(url, opt);
  let json = null;
  try { json = JSON.parse(r.getContentText()); } catch (err) {}
  return { code: r.getResponseCode(), json: json };
}

/* ───────────── 網站 API（部署為網頁應用程式） ───────────── */

function doGet() {
  return json_({ ok: true, service: 'keima-member' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  try {
    switch (req.action) {
      case 'requestCode': return json_(requestCode_(req.email));
      case 'verifyCode': return json_(verifyCode_(req.email, req.code));
      case 'me': return json_(me_(req.token));
      case 'logout': return json_(logout_(req.token));
      default: return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server_error' });
  }
}

function requestCode_(rawEmail) {
  const email = norm_(rawEmail);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'invalid_email' };
  const cache = CacheService.getScriptCache();
  if (cache.get('rl:' + email)) return { ok: false, error: 'too_soon' };
  cache.put('rl:' + email, '1', CFG.RESEND_WAIT);

  const m = findMember_(r => norm_(r.Email) === email && r.狀態 === STATUS.ACTIVE);
  if (m) {
    const code = String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 10), 16) % 1000000).padStart(6, '0');
    cache.put('otp:' + email, JSON.stringify({ code: code, tries: 0 }), CFG.OTP_TTL);
    mail_(email, '【桂馬會】會員專區驗證碼 ' + code,
      m.顯示名稱 + ' 你好：\n\n' +
      '你的會員專區驗證碼是：' + code + '\n' +
      '10 分鐘內有效。如果不是你本人操作，忽略這封信即可。\n\n' +
      '桂馬會日本將棋俱樂部\n' + CFG.SITE + '/member/');
  }
  return { ok: true }; // 不論是否為會員都回傳相同結果，避免被用來查詢誰是會員
}

function verifyCode_(rawEmail, rawCode) {
  const email = norm_(rawEmail);
  const cache = CacheService.getScriptCache();
  const raw = cache.get('otp:' + email);
  if (!raw) return { ok: false, error: 'expired' };
  const o = JSON.parse(raw);
  if (o.tries >= CFG.OTP_MAX_TRIES) {
    cache.remove('otp:' + email);
    return { ok: false, error: 'too_many' };
  }
  if (String(rawCode || '').trim() !== o.code) {
    o.tries++;
    cache.put('otp:' + email, JSON.stringify(o), CFG.OTP_TTL);
    return { ok: false, error: 'wrong_code' };
  }
  cache.remove('otp:' + email);

  const m = findMember_(r => norm_(r.Email) === email && r.狀態 === STATUS.ACTIVE);
  if (!m) return { ok: false, error: 'not_member' };

  const token = Utilities.getUuid() + Utilities.getUuid();
  const exp = new Date(Date.now() + CFG.SESSION_DAYS * 864e5);
  sessions_().appendRow([hash_(token), m.會員編號, exp]);
  return { ok: true, token: token, member: publicMember_(m) };
}

function me_(token) {
  const s = findSession_(token);
  if (!s) return { ok: false, error: 'unauthorized' };
  const m = findMember_(r => r.會員編號 === s.no && r.狀態 === STATUS.ACTIVE);
  if (!m) return { ok: false, error: 'unauthorized' };
  return { ok: true, member: publicMember_(m) };
}

function logout_(token) {
  const s = findSession_(token);
  if (s) sessions_().deleteRow(s.row);
  return { ok: true };
}

/* 只回傳網站需要的欄位，不回傳姓名、電話 */
function publicMember_(m) {
  const p = PropertiesService.getScriptProperties();
  return {
    no: m.會員編號,
    name: m.顯示名稱,
    since: fmtDate_(m.入會日期),
    links: {
      lineId: (p.getProperty('LINE_ID') || '').replace(/^@?~?/, ''),
      materials: p.getProperty('MATERIALS_URL') || ''
    }
  };
}

function cleanSessions() {
  const sh = sessions_();
  const last = sh.getLastRow();
  if (last < 2) return;
  const vals = sh.getRange(2, 1, last - 1, 3).getValues();
  const now = new Date();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (!(new Date(vals[i][2]) > now)) sh.deleteRow(i + 2);
  }
}

/* ───────────── 信件 ───────────── */

function sendApplyMail_(m) {
  const payInfo = PropertiesService.getScriptProperties().getProperty('PAYMENT_INFO') || '（匯款資訊請洽 ' + CFG.ADMIN_EMAIL + '）';
  const howToPay = m.繳費方式 === '例會現場繳費'
    ? '你選擇「例會現場繳費」：請在下次例會向工作人員繳交 NT$1,000。\n例會時間：' + CFG.SITE + '/#meetups'
    : '你選擇「銀行匯款」：請匯款 NT$1,000 到以下帳戶。\n' + payInfo +
      '\n\n匯款後請填寫繳費回報表，方便我們對帳：\n' + (payFormUrl_(m.Email) || '（或直接回覆這封信，告訴我們帳號末五碼）');
  mail_(m.Email, '【桂馬會】已收到入會申請',
    m.顯示名稱 + ' 你好：\n\n' +
    '已收到你的入會申請，謝謝！入會費 NT$1,000（一次性，無年費）。\n\n' +
    howToPay + '\n\n' +
    '確認收款後，我們會寄出你的會員編號與會員專區登入方式。\n\n' +
    '有任何問題，直接回覆這封信即可。\n\n桂馬會日本將棋俱樂部\n' + CFG.SITE);
}

function sendWelcomeMail_(m) {
  const lineId = (PropertiesService.getScriptProperties().getProperty('LINE_ID') || '').replace(/^@?~?/, '');
  mail_(m.Email, '【桂馬會】你的會員編號是 ' + m.會員編號,
    m.顯示名稱 + ' 你好：\n\n' +
    '感謝你成為桂馬會日本將棋俱樂部的會員！\n\n' +
    '會員編號：' + m.會員編號 + '\n' +
    (m.入會日期 ? '入會日期：' + fmtDate_(m.入會日期) + '\n' : '') + '\n' +
    '■ 會員專區\n' + CFG.SITE + '/member/\n用這個 Email 收驗證碼登入，可以查看會員證和會員教材。\n\n' +
    (lineId ? '■ 加入會員專屬 LINE 群\n' +
      '1. 加 LINE 好友：ID「' + lineId + '」\n   https://line.me/ti/p/~' + encodeURIComponent(lineId) + '\n' +
      '2. 傳訊息告訴我你的會員編號 ' + m.會員編號 + '\n' +
      '3. 我確認後會邀請你進入會員群\n\n' : '') +
    '■ 會員權益\n' +
    '・會員專屬 LINE 社群與教材\n' +
    '・龍馬盃額滿時優先遞補（報名時請填寫會員編號）\n' +
    '・例會滿座時優先入座\n' +
    (m.名鑑稱號 === '同意顯示' ? '・登錄棋手名鑑時，棋手頁會顯示「桂馬會會員」稱號\n' : '') +
    '\n有任何問題，直接回覆這封信即可。\n\n桂馬會日本將棋俱樂部\n' + CFG.SITE);
}

function notify_(subject, body) {
  MailApp.sendEmail({ to: CFG.NOTIFY_EMAIL, subject: subject, body: body, name: '桂馬會會員系統' });
}

function toast_(msg) {
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, '桂馬會', 8); } catch (err) {}
}

function mail_(to, subject, body) {
  MailApp.sendEmail({ to: to, subject: subject, body: body, name: '桂馬會', replyTo: CFG.ADMIN_EMAIL });
}

/* ───────────── 工具 ───────────── */

function ss_() { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SS_ID')); }
function members_() { return ss_().getSheetByName(CFG.MEMBERS); }
function sessions_() { return ss_().getSheetByName(CFG.SESSIONS); }
function col_(name) { return COLS.indexOf(name) + 1; }
function norm_(s) { return String(s || '').trim().toLowerCase(); }
/* 開頭加 ' 讓試算表當文字存，保留手機、帳號開頭的 0（' 不會顯示） */
function txt_(s) { return s ? "'" + s : ''; }

function rows_() {
  const sh = members_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, COLS.length).getValues().map((v, i) => {
    const o = { _row: i + 2 };
    COLS.forEach((c, j) => { o[c] = typeof v[j] === 'string' ? v[j].trim() : v[j]; });
    return o;
  });
}

function rowObj_(rowNum) {
  const v = members_().getRange(rowNum, 1, 1, COLS.length).getValues()[0];
  const o = { _row: rowNum };
  COLS.forEach((c, j) => { o[c] = typeof v[j] === 'string' ? v[j].trim() : v[j]; });
  return o;
}

function findMember_(pred) { return rows_().find(pred) || null; }

function findSession_(token) {
  if (!token) return null;
  const h = hash_(String(token));
  const sh = sessions_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const vals = sh.getRange(2, 1, last - 1, 3).getValues();
  const now = new Date();
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][0] === h) return new Date(vals[i][2]) > now ? { row: i + 2, no: vals[i][1] } : null;
  }
  return null;
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function fmtDate_(d) {
  return d instanceof Date ? Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd') : String(d || '');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* 查詢今日剩餘寄信額度（在編輯器手動執行） */
function checkQuota() {
  Logger.log('今日剩餘寄信額度：' + MailApp.getRemainingDailyQuota());
}
