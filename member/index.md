---
layout: doc
lang: zh
title: 會員專區
description: 用入會時的 Email 收驗證碼登入，查看會員編號與會員證，加入會員專屬 LINE 群、取得會員教材。
---

<div id="member-app" class="member-app" data-api="{{ site.data.links.zh.member_api }}">

  <div data-view="loading">
    <p>正在確認登入狀態…</p>
  </div>

  <div data-view="login" hidden>
    <p>輸入入會時填寫的 Email，我們會寄一組 6 位數驗證碼給你，不需要密碼。</p>
    <form data-form="email" class="m-form" novalidate>
      <label for="m-email">Email</label>
      <div class="m-row">
        <input id="m-email" type="email" required autocomplete="email" inputmode="email" placeholder="you@example.com">
        <button type="submit" class="btn btn-primary">寄驗證碼</button>
      </div>
      <p class="m-msg" role="status" aria-live="polite"></p>
    </form>
    <p class="m-note">還不是會員？<a href="/join/">看入會方式</a></p>
  </div>

  <div data-view="code" hidden>
    <p>如果 <strong data-f="email"></strong> 是已開通的會員，10 分鐘內會收到驗證碼。沒收到的話，請先檢查垃圾郵件匣。</p>
    <form data-form="code" class="m-form" novalidate>
      <label for="m-code">驗證碼</label>
      <div class="m-row">
        <input id="m-code" type="text" required inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6 位數字">
        <button type="submit" class="btn btn-primary">登入</button>
      </div>
      <p class="m-msg" role="status" aria-live="polite"></p>
    </form>
    <p class="m-note"><button type="button" class="m-link" data-act="back">改用其他 Email</button></p>
  </div>

  <div data-view="card" hidden>
    <div class="m-card">
      <span class="m-piece" aria-hidden="true">桂馬</span>
      <p class="m-card-org">桂馬會日本將棋俱樂部 會員證</p>
      <p class="m-card-no" data-f="no"></p>
      <p class="m-card-name" data-f="name"></p>
      <p class="m-card-since">入會日期 <span data-f="since"></span></p>
    </div>

    <h2>會員專屬</h2>
    <div class="m-line" data-line hidden>
      <p><strong>加入會員專屬 LINE 群</strong>（非公開群，由管理員邀請）</p>
      <ol>
        <li>加 LINE 好友：ID <strong data-f="lineId"></strong>
          <span class="m-line-actions">
            <a class="m-btn" data-f="lineAdd" target="_blank" rel="noopener">加好友</a>
            <button type="button" class="m-secondary" data-act="copy-id">複製 ID</button>
          </span>
        </li>
        <li>傳訊息告訴我們你的會員編號 <strong data-f="no2"></strong></li>
        <li>確認後會邀請你進入會員群</li>
      </ol>
    </div>
    <ul class="m-links">
      <li data-link="materials"><a target="_blank" rel="noopener">會員教材</a></li>
    </ul>

    <h2>會員編號怎麼用</h2>
    <ul>
      <li>報名<a href="/titles/ryuma-2026/">龍馬盃</a>時，「是否為桂馬會會員」選「是」並填寫會員編號，額滿時優先遞補。</li>
      <li>例會滿座時優先入座，到場時出示這一頁即可。</li>
      <li>登錄<a href="/players/">棋手名鑑</a>的會員，棋手頁會顯示「桂馬會會員」稱號。</li>
    </ul>

    <p class="m-note">資料有誤或想更改 Email，請寫信到 <a href="mailto:admin@keima.club">admin@keima.club</a>。</p>
    <p><button type="button" class="btn btn-line" data-act="logout">登出</button></p>
  </div>

</div>

<style>
.member-app .m-form label{display:block;font-weight:700;margin-bottom:6px}
.member-app .m-row{display:flex;gap:8px;flex-wrap:wrap}
.member-app input{flex:1 1 14rem;min-width:0;height:48px;padding:0 14px;font:inherit;font-size:16px;border:1px solid var(--kin);border-radius:2px;background:#FBF8F2;color:var(--ink)}
.member-app button{font:inherit;cursor:pointer}
.member-app .btn{border:0}
.member-app .btn-line{border:1px solid var(--enji)}
.member-app button:disabled{opacity:.55;cursor:wait}
.member-app input:focus-visible,.member-app button:focus-visible,.member-app a:focus-visible{outline:2px solid var(--kin);outline-offset:2px}
.member-app .m-msg{min-height:1.6em;margin:6px 0 0;font-size:15px;color:var(--enji)}
.member-app .m-msg.ok{color:var(--ink-soft)}
.member-app .m-note{font-size:15px;color:var(--ink-soft)}
.member-app .m-link{background:none;border:0;padding:0;color:inherit;text-decoration:underline}
.member-app .m-card{position:relative;max-width:24rem;margin:8px 0 36px;padding:22px 92px 20px 24px;border-radius:3px;color:var(--koge);background-color:#EAD3A3;background-image:repeating-linear-gradient(98deg,rgba(120,78,28,.06) 0 2px,transparent 2px 11px);box-shadow:inset 0 0 0 1px rgba(90,59,42,.3),0 1px 0 rgba(90,59,42,.15)}
.member-app .m-card p{margin:0;color:var(--koge)}
.member-app .m-card-org{font-size:14px}
.member-app .m-card-no{margin:8px 0 2px!important;font-family:var(--serif);font-size:34px;font-weight:700;letter-spacing:.05em;font-variant-numeric:tabular-nums;line-height:1.15}
.member-app .m-card-name{font-family:var(--serif);font-size:19px;font-weight:700}
.member-app .m-card-since{margin-top:10px!important;font-size:14px}
.member-app .m-piece{position:absolute;top:20px;right:24px;width:48px;height:58px;display:flex;align-items:center;justify-content:center;padding-top:9px;background:#D4AE6C;color:var(--koge);clip-path:polygon(50% 0,86% 16%,100% 100%,0 100%,14% 16%);writing-mode:vertical-rl;font-family:var(--serif);font-weight:700;font-size:15px;letter-spacing:.1em}
.member-app .m-line{margin:0 0 16px}
.member-app .m-line li{margin:8px 0}
.member-app .m-line-actions{display:inline-flex;gap:6px;margin-left:6px;vertical-align:middle}
.member-app .m-btn{display:inline-block;padding:2px 12px;border-radius:2px;background:#06C755;color:#fff;font-size:15px;font-weight:700;text-decoration:none}
.member-app .m-secondary{padding:2px 12px;border:1px solid var(--kin);border-radius:2px;background:transparent;color:var(--ink);font-size:15px}
.member-app .m-links li[hidden]{display:none}
</style>

<script src="/assets/js/member.js" defer></script>
