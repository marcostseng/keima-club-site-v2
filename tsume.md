---
layout: doc
lang: zh
permalink: /tsume/
title: "每日詰將棋：每天一題 1 手詰、3 手詰"
description: "每天一題詰將棋，平日 1 手詰、週末 3 手詰。直接在棋盤上作答，累積連續解題天數，適合剛學會規則的初學者練習。"
crumb: 入門
crumb_url: /learn/
---

詰將棋（詰将棋）是只練「怎麼將死對手」的題目。每天一題，平日是 1 手詰，週末是 3 手詰，花幾分鐘就能練到終盤的計算。

<link rel="stylesheet" href="{{ '/assets/css/tsume.css' | relative_url }}">
<section id="tsume" aria-label="每日詰將棋">
  <div class="tsume-main">
    <div class="tsume-head">
      <h2 data-t="title">每日詰將棋</h2>
      <p data-t="meta">載入中…</p>
    </div>
    <p class="tsume-gotehand">△ 玉方持駒：盤上與▲持駒以外的所有棋子</p>
    <div class="tsume-boardwrap">
      <div class="tsume-files" aria-hidden="true"><span>9</span><span>8</span><span>7</span><span>6</span><span>5</span><span>4</span><span>3</span><span>2</span><span>1</span></div>
      <div class="tsume-frame">
        <div class="tsume-board" data-t="board" role="grid" aria-label="棋盤"></div>
        <div class="tsume-ranks" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>七</span><span>八</span><span>九</span></div>
      </div>
    </div>
    <div class="tsume-hand" data-t="hand"></div>
    <div class="tsume-promo" data-t="promo" hidden>
      <span>要升變（成る）嗎？</span>
      <button type="button" data-p="1">成</button>
      <button type="button" data-p="0">不成</button>
    </div>
    <p class="tsume-msg" data-t="msg" role="status" aria-live="polite"></p>
    <div class="tsume-actions">
      <button type="button" data-t="reset">重來</button>
      <button type="button" data-t="reveal">看解答</button>
    </div>
    <p class="tsume-answer" data-t="answer" hidden></p>
    <ol class="tsume-log" data-t="log" aria-label="已下的手順"></ol>
  </div>
  <aside class="tsume-side">
    <p class="tsume-streak" data-t="streak"></p>
    <div>
      <div class="tsume-calhead">
        <button type="button" data-t="prev" aria-label="上個月">‹</button>
        <strong data-t="caltitle"></strong>
        <button type="button" data-t="next" aria-label="下個月">›</button>
      </div>
      <div class="tsume-cal" data-t="cal"></div>
      <p class="tsume-legend">綠色：已解開　紅線：還沒解開　點日期可以回頭解舊題。紀錄只存在這台裝置的瀏覽器。</p>
    </div>
    <p><a data-t="report" data-href="{{ site.data.links.zh.tsume_report | default: 'mailto:admin@keima.club' }}" href="{{ site.data.links.zh.tsume_report | default: 'mailto:admin@keima.club' }}">覺得題目或判定有誤？回報給我們</a></p>
  </aside>
</section>
<script type="application/json" id="tsume-data">{{ site.data.tsume | jsonify }}</script>
<script src="{{ '/assets/js/tsume.js' | relative_url }}" defer></script>

## 解題規則

攻方（▲）每一手都要將軍（王手）；玉方（△）會自動選最難纏的應手，而且可以用盤上與▲持駒以外的所有棋子來擋。第一次解詰將棋，建議先讀[詰將棋入門：規則、解題方法與練習建議](/tsume-shogi-beginner/)；棋子走法忘了，回到[第 2 課：棋子怎麼走（上）](/learn/02-moves-major/)。

## 下一步

每天解一題，大約一個月就會對常見的將死形狀有感覺。想找人一起練，歡迎[加入 LINE 社群](/#community)或[參加例會](/#meetups)；[入會](/join/)的會員每週還有一題 7 手詰。

<small>題目來源：[たぬき詰将棋](https://github.com/tokuhirom/tanuki-tsume-shogi)（Copyright © 2026 tokuhirom，MIT License），由桂馬會挑選並重新驗證。</small>
