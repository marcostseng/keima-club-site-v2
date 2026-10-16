/* 桂馬會 棋譜播放器：讀取 KIF（平手），逐手播放。
   用法：<div class="kifu" data-kifu="/assets/kifu/xxx.kif" data-start="last" data-compact></div> */
(function () {
  'use strict';

  var ZEN = { '１': 1, '２': 2, '３': 3, '４': 4, '５': 5, '６': 6, '７': 7, '８': 8, '９': 9 };
  var RANK = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var RANK_K = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var KIF_PIECE = {
    '歩': 'FU', '香': 'KY', '桂': 'KE', '銀': 'GI', '金': 'KI', '角': 'KA', '飛': 'HI', '玉': 'OU', '王': 'OU',
    'と': 'TO', '成香': 'NY', '杏': 'NY', '成桂': 'NK', '圭': 'NK', '成銀': 'NG', '全': 'NG', '馬': 'UM', '龍': 'RY', '竜': 'RY'
  };
  var PROMOTE = { FU: 'TO', KY: 'NY', KE: 'NK', GI: 'NG', KA: 'UM', HI: 'RY' };
  var BASE = { TO: 'FU', NY: 'KY', NK: 'KE', NG: 'GI', UM: 'KA', RY: 'HI' };
  var NAME = { FU: '步', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛', OU: '玉', TO: 'と', NY: '杏', NK: '圭', NG: '全', UM: '馬', RY: '龍' };
  var LABEL = { FU: '步', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛', OU: '玉', TO: 'と', NY: '成香', NK: '成桂', NG: '成銀', UM: '馬', RY: '龍' };
  var HAND_ORDER = ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU'];
  var ENDINGS = ['投了', '中断', '千日手', '持将棋', '詰み', '切れ負け', '反則勝ち', '反則負け', '入玉勝ち', '不戦勝', '不戦敗', '先日手'];
  var END_ZH = { '投了': '投了', '中断': '中斷', '千日手': '千日手', '持将棋': '持將棋', '詰み': '詰み', '切れ負け': '超時負', '反則勝ち': '反則勝', '反則負け': '反則負', '入玉勝ち': '入玉勝' };
  var MOVE_RE = /^(?:([１-９1-9])([一二三四五六七八九])|同[\s　]*)(成銀|成桂|成香|全|圭|杏|歩|香|桂|銀|金|角|飛|玉|王|と|馬|龍|竜)(不成|成|打)?(?:\((\d)(\d)\))?/;

  function initialBoard() {
    var b = [];
    for (var r = 0; r <= 9; r++) { b[r] = []; for (var f = 0; f <= 9; f++) b[r][f] = null; }
    var back = ['KY', 'KE', 'GI', 'KI', 'OU', 'KI', 'GI', 'KE', 'KY']; // 9筋→1筋
    for (var i = 0; i < 9; i++) {
      b[1][9 - i] = { t: back[i], s: 1 };
      b[9][9 - i] = { t: back[i], s: 0 };
      b[3][9 - i] = { t: 'FU', s: 1 };
      b[7][9 - i] = { t: 'FU', s: 0 };
    }
    b[2][8] = { t: 'HI', s: 1 }; b[2][2] = { t: 'KA', s: 1 };
    b[8][8] = { t: 'KA', s: 0 }; b[8][2] = { t: 'HI', s: 0 };
    return b;
  }
  function emptyHands() { return [{}, {}]; }
  function cloneState(st) {
    return {
      b: st.b.map(function (row) { return row.slice(); }),
      h: [Object.assign({}, st.h[0]), Object.assign({}, st.h[1])],
      last: null
    };
  }

  function parse(text) {
    var lines = text.replace(/\r/g, '').split('\n');
    var info = {}, moves = [], startComment = [], error = null, ending = null;
    var inMoves = false, prev = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^変化[：:]/.test(line)) break; // 只讀本譜
      if (line.charAt(0) === '*') {
        var c = line.slice(1).trim();
        if (moves.length) moves[moves.length - 1].comment.push(c); else startComment.push(c);
        continue;
      }
      if (line.charAt(0) === '#' || line.charAt(0) === '&') continue;
      var hm = line.match(/^([^：:\s]+)[：:](.*)$/);
      if (!inMoves && hm && !/^\s*\d/.test(line)) { info[hm[1]] = hm[2].trim(); continue; }
      if (/^手数-+指手/.test(line)) { inMoves = true; continue; }
      var mm = line.match(/^\s*(\d+)\s+(\S.*)$/);
      if (!mm) continue;
      inMoves = true;
      var body = mm[2];
      var endWord = ENDINGS.filter(function (w) { return body.indexOf(w) === 0; })[0];
      if (endWord) { ending = endWord; break; }
      var m = body.match(MOVE_RE);
      if (!m) { error = '第 ' + mm[1] + ' 手無法解析：' + body; break; }
      var same = !m[1];
      var to;
      if (same) {
        if (!prev) { error = '第 ' + mm[1] + ' 手的「同」找不到前一手'; break; }
        to = prev;
      } else {
        to = [ZEN[m[1]] || parseInt(m[1], 10), RANK[m[2]]];
      }
      moves.push({
        n: parseInt(mm[1], 10), to: to, same: same,
        piece: KIF_PIECE[m[3]], mod: m[4] || '',
        from: m[5] ? [parseInt(m[5], 10), parseInt(m[6], 10)] : null,
        comment: []
      });
      prev = to;
    }
    return { info: info, moves: moves, startComment: startComment, error: error, ending: ending };
  }

  function play(kif) {
    var st0 = { b: initialBoard(), h: emptyHands(), last: null };
    var states = [st0], labels = [];
    for (var i = 0; i < kif.moves.length; i++) {
      var mv = kif.moves[i];
      var side = i % 2; // 平手：奇數手為先手
      var st = cloneState(states[states.length - 1]);
      var f = mv.to[0], r = mv.to[1];
      var piece;
      if (mv.mod === '打' || !mv.from || mv.from[0] === 0) {
        var base = mv.piece;
        if (!st.h[side][base]) return { states: states, labels: labels, error: '第 ' + mv.n + ' 手：持駒中沒有這個棋子' };
        st.h[side][base]--;
        piece = { t: base, s: side };
      } else {
        var src = st.b[mv.from[1]][mv.from[0]];
        if (!src) return { states: states, labels: labels, error: '第 ' + mv.n + ' 手：起點沒有棋子' };
        st.b[mv.from[1]][mv.from[0]] = null;
        var t = src.t;
        if (mv.mod === '成' && PROMOTE[t]) t = PROMOTE[t];
        piece = { t: t, s: side };
      }
      var cap = st.b[r][f];
      if (cap) {
        var ct = BASE[cap.t] || cap.t;
        if (ct !== 'OU') st.h[side][ct] = (st.h[side][ct] || 0) + 1;
      }
      st.b[r][f] = piece;
      st.last = [f, r];
      states.push(st);
      var mark = side === 0 ? '▲' : '△';
      var where = mv.same ? '同' : (f + RANK_K[r]);
      var mod = mv.mod === '打' ? (mv.from ? '' : '打') : mv.mod;
      labels.push(mark + where + LABEL[mv.piece] + mod);
    }
    return { states: states, labels: labels, error: null };
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function handText(h) {
    var parts = [];
    HAND_ORDER.forEach(function (t) {
      if (h[t]) parts.push(NAME[t] + (h[t] > 1 ? h[t] : ''));
    });
    return parts.length ? parts.join(' ') : 'なし';
  }

  function build(root, kif, game) {
    var compact = root.hasAttribute('data-compact');
    var sente = root.getAttribute('data-sente') || kif.info['先手'] || '先手';
    var gote = root.getAttribute('data-gote') || kif.info['後手'] || '後手';
    var max = game.states.length - 1;
    var step = root.getAttribute('data-start') === 'first' ? 0 : max;

    root.textContent = '';
    var left = el('div', 'left');
    var hg = el('div', 'db-hand');
    var board = el('div', 'db-board');
    var fl = el('div', 'fl'); fl.setAttribute('aria-hidden', 'true');
    for (var f = 9; f >= 1; f--) fl.appendChild(el('span', null, String(f)));
    var row = el('div', 'row');
    var bd = el('div', 'bd'); bd.setAttribute('role', 'img');
    var cells = [];
    for (var r = 1; r <= 9; r++) {
      for (var ff = 9; ff >= 1; ff--) {
        var sq = el('div', 'sq'); var pc = el('span', 'pc');
        sq.appendChild(pc); bd.appendChild(sq);
        cells.push({ f: ff, r: r, sq: sq, pc: pc });
      }
    }
    var rn = el('div', 'rn'); rn.setAttribute('aria-hidden', 'true');
    for (var k = 1; k <= 9; k++) rn.appendChild(el('span', null, RANK_K[k]));
    row.appendChild(bd); row.appendChild(rn);
    board.appendChild(fl); board.appendChild(row);
    var hs = el('div', 'db-hand');

    var ctl = el('div', 'db-ctl');
    function btn(text, aria, fn) {
      var b = el('button', null, text); b.type = 'button';
      if (aria) b.setAttribute('aria-label', aria);
      b.addEventListener('click', fn); ctl.appendChild(b); return b;
    }
    btn('|◀', '回到開始局面', function () { go(0); });
    btn('◀', '上一手', function () { go(step - 1); });
    btn('▶', '下一手', function () { go(step + 1); });
    btn('▶|', '最後一手', function () { go(max); });
    var pos = el('span', 'pos'); pos.setAttribute('aria-live', 'polite'); ctl.appendChild(pos);

    left.appendChild(hg); left.appendChild(board); left.appendChild(hs); left.appendChild(ctl);
    root.appendChild(left);

    var list = [], comment = null;
    if (!compact) {
      var side = el('div', 'side');
      side.appendChild(el('h2', 'db-h2', '棋譜'));
      var moves = el('div', 'db-moves');
      var items = ['開始局面'].concat(game.labels);
      if (kif.ending) items.push(END_ZH[kif.ending] || kif.ending);
      items.forEach(function (label, i) {
        var b = el('button', 'mv'); b.type = 'button';
        b.appendChild(el('span', 'n', i === 0 || i > max ? '' : String(i)));
        b.appendChild(el('span', null, label));
        var target = Math.min(i, max);
        b.addEventListener('click', function () { go(target); });
        moves.appendChild(b); list.push(b);
      });
      side.appendChild(moves);
      var cbox = el('div', 'db-box kifu-comment');
      cbox.appendChild(el('h3', null, '棋譜註解'));
      comment = el('p', null, '');
      cbox.appendChild(comment);
      side.appendChild(cbox);
      root.appendChild(side);
    }
    if (game.error || kif.error) {
      var note = el('p', 'db-note', '※ ' + (kif.error || game.error) + '，只顯示到可解析的位置。');
      left.appendChild(note);
    }

    function go(s) {
      step = Math.max(0, Math.min(max, s));
      var st = game.states[step];
      cells.forEach(function (c) {
        var p = st.b[c.r][c.f];
        c.pc.textContent = p ? (p.t === 'OU' && p.s === 1 ? '王' : NAME[p.t]) : '';
        c.pc.className = p && p.s === 1 ? 'pc gote' : 'pc';
        c.sq.className = st.last && st.last[0] === c.f && st.last[1] === c.r ? 'sq last' : 'sq';
      });
      hg.textContent = '△' + gote + '　持駒：' + handText(st.h[1]);
      hs.textContent = '▲' + sente + '　持駒：' + handText(st.h[0]);
      var label = step === 0 ? '開始局面' : '第 ' + step + ' 手 ' + game.labels[step - 1];
      pos.textContent = label;
      bd.setAttribute('aria-label', '盤面：' + label);
      list.forEach(function (b, i) { b.className = i === step ? 'mv on' : 'mv'; });
      if (list[step] && list[step].scrollIntoView && !compact) {
        var box = list[step].parentNode;
        var top = list[step].offsetTop - box.offsetTop;
        if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 44) box.scrollTop = top - 88;
      }
      if (comment) {
        var cm = step === 0 ? kif.startComment : kif.moves[step - 1].comment;
        comment.textContent = cm && cm.length ? cm.join('\n') : '（這一手沒有註解）';
        comment.parentNode.style.display = '';
      }
    }
    root.tabIndex = 0;
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { go(step - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { go(step + 1); e.preventDefault(); }
    });
    go(step);
  }

  function decode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('shift_jis').decode(buf); }
  }

  function init(root) {
    var src = root.getAttribute('data-kifu');
    if (!src || root.getAttribute('data-ready')) return;
    root.setAttribute('data-ready', '1');
    fetch(src).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      var kif = parse(decode(buf));
      if (kif.info['手合割'] && kif.info['手合割'] !== '平手') {
        root.querySelector('.kifu-fallback').textContent = '目前只支援平手棋譜。';
        return;
      }
      build(root, kif, play(kif));
    }).catch(function () {
      var fb = root.querySelector('.kifu-fallback');
      if (fb) fb.textContent = '棋譜讀取失敗，請下載 KIF 檔查看。';
    });
  }

  if (typeof module !== 'undefined') { module.exports = { parse: parse, play: play }; return; }
  document.querySelectorAll('.kifu[data-kifu]').forEach(init);
})();
