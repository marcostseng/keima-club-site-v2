/* 桂馬會 每日詰將棋 /tsume/
 * 題目資料：頁面內 <script id="tsume-data">（來自 _data/tsume.yml）
 * 紀錄：localStorage「keima-tsume-v1」，只存在本機
 */
(function () {
  "use strict";

  var root = document.getElementById("tsume");
  var dataEl = document.getElementById("tsume-data");
  if (!root || !dataEl) return;

  var PROBLEMS = [];
  try { PROBLEMS = JSON.parse(dataEl.textContent) || []; } catch (e) { PROBLEMS = []; }
  PROBLEMS.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var BY_DATE = {};
  PROBLEMS.forEach(function (p) { BY_DATE[p.date] = p; });

  var KANJI = "〇一二三四五六七八九";
  var BOARD_CH = { K: "玉", R: "飛", B: "角", G: "金", S: "銀", N: "桂", L: "香", P: "步",
    "+R": "龍", "+B": "馬", "+S": "全", "+N": "圭", "+L": "杏", "+P": "と" };
  var NAME = { K: "玉", R: "飛", B: "角", G: "金", S: "銀", N: "桂", L: "香", P: "步",
    "+R": "龍", "+B": "馬", "+S": "成銀", "+N": "成桂", "+L": "成香", "+P": "と" };
  var HAND_ORDER = ["R", "B", "G", "S", "N", "L", "P"];
  var STORE_KEY = "keima-tsume-v1";

  /* ---------- 日期 ---------- */
  function todayTaipei() {
    try { return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function addDays(iso, n) {
    var d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  var TODAY = todayTaipei();

  /* ---------- 紀錄 ---------- */
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || { solved: {}, missed: {} }; }
    catch (e) { return { solved: {}, missed: {} }; }
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 無痕模式等 */ }
  }
  var store = loadStore();
  store.solved = store.solved || {};
  store.missed = store.missed || {};

  function streak() {
    var d = store.solved[TODAY] ? TODAY : addDays(TODAY, -1);
    var n = 0;
    while (BY_DATE[d] && store.solved[d]) { n++; d = addDays(d, -1); }
    return n;
  }

  /* ---------- 局面 ---------- */
  function parseSfen(sfen) {
    var parts = sfen.split(" ");
    var board = [];
    parts[0].split("/").forEach(function (row) {
      var r = [], prom = false;
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (ch === "+") { prom = true; continue; }
        if (/\d/.test(ch)) { for (var k = 0; k < +ch; k++) r.push(null); continue; }
        var up = ch.toUpperCase();
        r.push({ t: up, p: prom, s: ch === up ? "b" : "w" });
        prom = false;
      }
      board.push(r);
    });
    var hands = { b: {}, w: {} };
    HAND_ORDER.forEach(function (k) { hands.b[k] = 0; hands.w[k] = 0; });
    var h = parts[2] || "-", num = "";
    if (h !== "-") {
      for (var j = 0; j < h.length; j++) {
        var c = h[j];
        if (/\d/.test(c)) { num += c; continue; }
        var side = c === c.toUpperCase() ? "b" : "w";
        hands[side][c.toUpperCase()] += num ? +num : 1;
        num = "";
      }
    }
    return { board: board, hands: hands };
  }
  // board[r][c]：r = 段-1，c = 9-筋
  function sq(file, rank) { return file + String.fromCharCode(96 + rank); }
  function rc(usiSq) { return { r: usiSq.charCodeAt(1) - 97, c: 9 - +usiSq[0] }; }
  function key(p) { return (p.p ? "+" : "") + p.t; }

  function applyUsi(pos, usi) {
    var info = { drop: null, piece: null, promote: false, from: null, to: null, captured: null };
    if (usi[1] === "*") {
      var t = usi[0], to = rc(usi.slice(2, 4));
      var side = pos.turn;
      pos.board[to.r][to.c] = { t: t, p: false, s: side };
      pos.hands[side][t]--;
      info.drop = t; info.piece = t; info.to = usi.slice(2, 4);
    } else {
      var f = rc(usi.slice(0, 2)), d = rc(usi.slice(2, 4));
      var pc = pos.board[f.r][f.c];
      var cap = pos.board[d.r][d.c];
      info.piece = key(pc);
      if (cap) {
        pos.hands[pc.s][cap.t] = (pos.hands[pc.s][cap.t] || 0) + 1;
        info.captured = cap;
      }
      pos.board[f.r][f.c] = null;
      var promote = usi[4] === "+";
      pos.board[d.r][d.c] = { t: pc.t, p: pc.p || promote, s: pc.s };
      info.promote = promote; info.from = usi.slice(0, 2); info.to = usi.slice(2, 4);
    }
    pos.turn = pos.turn === "b" ? "w" : "b";
    return info;
  }

  /* ---------- 走法（只用來標示可走的格子；對錯以正解判斷） ---------- */
  var GOLD = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]];
  var STEPS = {
    K: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
    G: GOLD, S: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 1]],
    N: [[-2, -1], [-2, 1]], P: [[-1, 0]]
  };
  var ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]], DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  function targets(pos, r, c) {
    var pc = pos.board[r][c], out = [], dir = pc.s === "b" ? 1 : -1;
    function ok(rr, cc) { return rr >= 0 && rr < 9 && cc >= 0 && cc < 9; }
    function step(list) {
      list.forEach(function (v) {
        var rr = r + v[0] * dir, cc = c + v[1];
        if (!ok(rr, cc)) return;
        var t = pos.board[rr][cc];
        if (!t || t.s !== pc.s) out.push([rr, cc]);
      });
    }
    function slide(list) {
      list.forEach(function (v) {
        var rr = r + v[0] * dir, cc = c + v[1];
        while (ok(rr, cc)) {
          var t = pos.board[rr][cc];
          if (t) { if (t.s !== pc.s) out.push([rr, cc]); break; }
          out.push([rr, cc]);
          rr += v[0] * dir; cc += v[1];
        }
      });
    }
    if (pc.p && "SNLP".indexOf(pc.t) >= 0) step(GOLD);
    else if (pc.t === "R") { slide(ORTH); if (pc.p) step(DIAG); }
    else if (pc.t === "B") { slide(DIAG); if (pc.p) step(ORTH); }
    else if (pc.t === "L") slide([[-1, 0]]);
    else step(STEPS[pc.t]);
    return out;
  }

  function dropTargets(pos, t) {
    var out = [];
    for (var r = 0; r < 9; r++) for (var c = 0; c < 9; c++) {
      if (pos.board[r][c]) continue;
      if ((t === "P" || t === "L") && r === 0) continue;
      if (t === "N" && r <= 1) continue;
      if (t === "P") {
        var nifu = false;
        for (var k = 0; k < 9; k++) {
          var x = pos.board[k][c];
          if (x && x.s === "b" && x.t === "P" && !x.p) nifu = true;
        }
        if (nifu) continue;
      }
      out.push([r, c]);
    }
    return out;
  }

  /* ---------- 記法：▲2三金打、▲同飛成 ---------- */
  function notation(info, side, prevTo, wasPromotable) {
    var mark = side === "b" ? "▲" : "△";
    var place = info.to === prevTo ? "同" : info.to[0] + KANJI[info.to.charCodeAt(1) - 96];
    if (info.drop) return mark + place + NAME[info.drop] + "打";
    var s = mark + place + NAME[info.piece];
    if (info.promote) s += "成";
    else if (wasPromotable) s += "不成";
    return s;
  }
  function promotable(pc, fromR, toR) {
    if (pc.p || pc.t === "K" || pc.t === "G") return false;
    if (pc.s === "b") return fromR <= 2 || toR <= 2;
    return fromR >= 6 || toR >= 6;
  }
  function mustPromote(pc, toR) {
    if (pc.s !== "b") return false;
    if ((pc.t === "P" || pc.t === "L") && toR === 0) return true;
    return pc.t === "N" && toR <= 1;
  }

  /* ---------- 畫面 ---------- */
  var els = {
    title: root.querySelector("[data-t=title]"),
    meta: root.querySelector("[data-t=meta]"),
    board: root.querySelector("[data-t=board]"),
    hand: root.querySelector("[data-t=hand]"),
    msg: root.querySelector("[data-t=msg]"),
    log: root.querySelector("[data-t=log]"),
    reset: root.querySelector("[data-t=reset]"),
    reveal: root.querySelector("[data-t=reveal]"),
    answer: root.querySelector("[data-t=answer]"),
    promo: root.querySelector("[data-t=promo]"),
    streak: root.querySelector("[data-t=streak]"),
    cal: root.querySelector("[data-t=cal]"),
    calTitle: root.querySelector("[data-t=caltitle]"),
    prev: root.querySelector("[data-t=prev]"),
    next: root.querySelector("[data-t=next]"),
    report: root.querySelector("[data-t=report]")
  };

  var cur = null, pos = null, ply = 0, sel = null, prevTo = null, busy = false, done = false, hl = {};
  var calMonth = null;

  function pickDate() {
    var q = new URLSearchParams(location.search).get("d");
    if (q && BY_DATE[q] && q <= TODAY) return q;
    if (BY_DATE[TODAY]) return TODAY;
    var past = PROBLEMS.filter(function (p) { return p.date <= TODAY; });
    if (past.length) return past[past.length - 1].date;
    return PROBLEMS.length ? PROBLEMS[0].date : null; // 開站前：顯示第一題當預告
  }

  function load(date) {
    cur = BY_DATE[date];
    if (!cur) { els.msg.textContent = "目前沒有題目。"; return; }
    var parsed = parseSfen(cur.sfen);
    pos = { board: parsed.board, hands: parsed.hands, turn: "b" };
    ply = 0; sel = null; prevTo = null; busy = false; done = false; hl = {};
    var d = cur.date.split("-");
    els.title.textContent = +d[1] + " 月 " + +d[2] + " 日・" + cur.moves + " 手詰";
    var pre = cur.date > TODAY ? "（預告題）" : "";
    els.meta.textContent = "先手（▲）先走，" + cur.moves + " 手將死後手的玉。" + pre;
    els.log.innerHTML = "";
    els.answer.hidden = true;
    els.answer.textContent = "";
    els.reveal.hidden = false;
    els.promo.hidden = true;
    setMsg(store.solved[cur.date] ? "這題已經解過了，可以再解一次。" : "點棋子、再點目的地；打入請先點下方的持駒。", "");
    if (els.report) {
      var base = els.report.getAttribute("data-href") || "";
      els.report.href = base.indexOf("mailto:") === 0
        ? base + "?subject=" + encodeURIComponent("詰將棋回報 " + cur.date + " " + cur.id)
        : base;
    }
    if (history.replaceState) {
      var url = date === TODAY ? location.pathname : location.pathname + "?d=" + date;
      history.replaceState(null, "", url);
    }
    calMonth = cur.date.slice(0, 7);
    draw();
    drawSide();
  }

  function setMsg(t, kind) {
    els.msg.textContent = t;
    els.msg.className = "tsume-msg" + (kind ? " is-" + kind : "");
  }

  function draw() {
    var html = "";
    for (var r = 0; r < 9; r++) for (var c = 0; c < 9; c++) {
      var pc = pos.board[r][c], file = 9 - c, rank = r + 1;
      var cls = "tsume-sq";
      if (hl[r + "," + c] === "t") cls += " is-target";
      if (hl[r + "," + c] === "last") cls += " is-last";
      if (sel && sel.r === r && sel.c === c) cls += " is-sel";
      var label = file + KANJI[rank] + (pc ? (pc.s === "b" ? "先手" : "後手") + NAME[key(pc)] : "空");
      html += '<button type="button" class="' + cls + '" data-r="' + r + '" data-c="' + c +
        '" aria-label="' + label + '">' +
        (pc ? '<span class="tsume-pc' + (pc.s === "w" ? " is-gote" : "") + (pc.p ? " is-prom" : "") + '">' +
          BOARD_CH[key(pc)] + "</span>" : "") + "</button>";
    }
    els.board.innerHTML = html;

    var hand = "", any = false;
    HAND_ORDER.forEach(function (t) {
      var n = pos.hands.b[t];
      if (!n) return;
      any = true;
      var on = sel && sel.drop === t ? " is-sel" : "";
      hand += '<button type="button" class="tsume-hpc' + on + '" data-drop="' + t + '" aria-label="持駒' + NAME[t] + n + '枚">' +
        '<span class="tsume-pc">' + BOARD_CH[t] + "</span>" + (n > 1 ? "<b>" + n + "</b>" : "") + "</button>";
    });
    els.hand.innerHTML = any ? hand : '<span class="tsume-none">持駒：無</span>';
  }

  function clearSel() { sel = null; hl = {}; }

  function onBoard(e) {
    var b = e.target.closest(".tsume-sq");
    if (!b || busy || done) return;
    var r = +b.dataset.r, c = +b.dataset.c, pc = pos.board[r][c];
    if (sel && hl[r + "," + c] === "t") {
      if (sel.drop) return tryMove(sel.drop + "*" + sq(9 - c, r + 1), null);
      var from = pos.board[sel.r][sel.c];
      var base = sq(9 - sel.c, sel.r + 1) + sq(9 - c, r + 1);
      if (mustPromote(from, r)) return tryMove(base + "+", null);
      if (promotable(from, sel.r, r)) return askPromote(base);
      return tryMove(base, null);
    }
    if (pc && pc.s === "b") {
      sel = { r: r, c: c }; hl = {};
      targets(pos, r, c).forEach(function (t) { hl[t[0] + "," + t[1]] = "t"; });
    } else clearSel();
    draw();
  }

  function onHand(e) {
    var b = e.target.closest(".tsume-hpc");
    if (!b || busy || done) return;
    var t = b.dataset.drop;
    if (sel && sel.drop === t) { clearSel(); draw(); return; }
    sel = { drop: t }; hl = {};
    dropTargets(pos, t).forEach(function (x) { hl[x[0] + "," + x[1]] = "t"; });
    draw();
  }

  function askPromote(base) {
    busy = true;
    els.promo.hidden = false;
    els.promo.querySelectorAll("button").forEach(function (btn) {
      btn.onclick = function () {
        els.promo.hidden = true;
        busy = false;
        tryMove(base + (btn.dataset.p === "1" ? "+" : ""), null);
      };
    });
    els.promo.querySelector("button").focus();
  }

  function isCorrect(usi) {
    if (usi === cur.answer[ply]) return true;
    return ply === cur.answer.length - 1 && (cur.last_alt || []).indexOf(usi) >= 0;
  }

  function playMove(usi) {
    var side = pos.turn, wasProm = false;
    if (usi[1] !== "*") {
      var f = rc(usi.slice(0, 2)), d = rc(usi.slice(2, 4));
      wasProm = promotable(pos.board[f.r][f.c], f.r, d.r);
    }
    var info = applyUsi(pos, usi);
    var text = notation(info, side, prevTo, wasProm);
    prevTo = info.to;
    var to = rc(info.to);
    hl = {}; hl[to.r + "," + to.c] = "last";
    var li = document.createElement("li");
    li.textContent = text;
    els.log.appendChild(li);
    ply++;
    return text;
  }

  function tryMove(usi) {
    var snapshot = JSON.stringify(pos), prevSnap = prevTo;
    clearSel();
    if (isCorrect(usi)) {
      playMove(usi);
      draw();
      if (ply >= cur.answer.length) return solved();
      setMsg("正確！看玉怎麼逃…", "ok");
      busy = true;
      setTimeout(function () {
        playMove(cur.answer[ply]);
        busy = false;
        draw();
        setMsg("輪到你了，下一步也要將軍（王手）。", "");
      }, 550);
      return;
    }
    // 錯誤：先顯示這一步，再退回
    busy = true;
    var text = playMove(usi);
    els.log.lastChild.className = "is-wrong";
    draw();
    setMsg(text + " 不是正解，再想想。", "ng");
    if (!store.solved[cur.date]) { store.missed[cur.date] = true; saveStore(); }
    setTimeout(function () {
      pos = JSON.parse(snapshot);
      ply--;
      els.log.removeChild(els.log.lastChild);
      prevTo = prevSnap;
      hl = {};
      busy = false;
      draw();
    }, 900);
  }

  function solved() {
    done = true;
    store.solved[cur.date] = true;
    saveStore();
    setMsg("正解！" + cur.moves + " 手詰完成。", "ok");
    els.reveal.hidden = true;
    drawSide();
  }

  function reset() { load(cur.date); }

  function reveal() {
    els.answer.hidden = false;
    els.answer.textContent = "正解：" + cur.answer_text +
      ((cur.last_alt && cur.last_alt.length) ? "（最後一手另有其他詰法，也算正解）" : "");
    els.reveal.hidden = true;
    if (!store.solved[cur.date]) { store.missed[cur.date] = true; saveStore(); }
    drawSide();
  }

  /* ---------- 連續天數與月曆 ---------- */
  function drawSide() {
    var n = streak();
    els.streak.innerHTML = n ? "連續解題 <b>" + n + "</b> 天" : "今天開始累積連續天數";
    var ym = calMonth.split("-"), y = +ym[0], m = +ym[1];
    els.calTitle.textContent = y + " 年 " + m + " 月";
    var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    var days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var html = "";
    "日一二三四五六".split("").forEach(function (w) { html += '<span class="tsume-wd">' + w + "</span>"; });
    for (var i = 0; i < first; i++) html += "<span></span>";
    for (var d = 1; d <= days; d++) {
      var iso = calMonth + "-" + (d < 10 ? "0" : "") + d;
      var has = !!BY_DATE[iso], open = has && iso <= TODAY;
      var cls = "tsume-day";
      if (store.solved[iso]) cls += " is-solved";
      else if (open && (store.missed[iso] || iso < TODAY)) cls += " is-missed";
      if (cur && iso === cur.date) cls += " is-cur";
      if (iso === TODAY) cls += " is-today";
      html += open
        ? '<button type="button" class="' + cls + '" data-date="' + iso + '">' + d + "</button>"
        : '<span class="' + cls + ' is-off">' + d + "</span>";
    }
    els.cal.innerHTML = html;
    var months = PROBLEMS.map(function (p) { return p.date.slice(0, 7); });
    els.prev.disabled = !months.some(function (x) { return x < calMonth; });
    els.next.disabled = !months.some(function (x) { return x > calMonth && x <= TODAY.slice(0, 7); });
  }

  function shiftMonth(n) {
    var ym = calMonth.split("-"), y = +ym[0], m = +ym[1] + n;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    calMonth = y + "-" + (m < 10 ? "0" : "") + m;
    drawSide();
  }

  els.board.addEventListener("click", onBoard);
  els.hand.addEventListener("click", onHand);
  els.reset.addEventListener("click", reset);
  els.reveal.addEventListener("click", reveal);
  els.prev.addEventListener("click", function () { shiftMonth(-1); });
  els.next.addEventListener("click", function () { shiftMonth(1); });
  els.cal.addEventListener("click", function (e) {
    var b = e.target.closest("[data-date]");
    if (b) { load(b.dataset.date); root.scrollIntoView({ behavior: "smooth", block: "start" }); }
  });

  var start = pickDate();
  if (start) load(start); else setMsg("題目準備中。", "");
})();
