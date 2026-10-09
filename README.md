# 桂馬會 keima.club

## 網址
- 中文：/　/titles/　/learn/
- 日本語：/jp/　/jp/titles/

## 部署（GitHub Pages）
1. 把整個資料夾上傳到 repo 根目錄（保留資料夾結構）
2. Settings → Pages → Branch: main / root → Save
3. Custom domain 填 keima.club，勾選 Enforce HTTPS
4. Cloudflare DNS 指向 GitHub Pages
   A：185.199.108.153 / 185.199.109.153 / 185.199.110.153 / 185.199.111.153
   CNAME www → <你的帳號>.github.io

## 平常要改的地方
| 要改什麼 | 檔案 |
|---|---|
| 例會時間表（日期、時間、地點） | `_data/meetups.yml` |
| 報名表、教材資料夾網址（中日分開） | `_data/links.yml` |
| 棋戰優勝者、最新消息、規則（中日共用一份） | `_data/titles.yml` |
| 選單、按鈕等介面文字 | `_data/i18n.yml` |
| 首頁內容 | 中文 `index.html`、日文 `jp/index.html` |
| 入門課程 | `_lessons/`（Markdown） |
| 顏色、字體、版面 | `assets/css/site.css`（全站一份） |

## 入門課程
- 每課一個檔案；`order` 決定順序，新增第 11 課就複製一個檔案改 order: 11
- 加影片：YouTube 網址 `watch?v=` 後面的 ID 填進 `youtube: ""`

## 新增頁面並連結另一語言
兩個語言版本的頁面，開頭都加上相同的 `ref`（例如 `ref: about`），
並分別設定 `lang: zh` / `lang: ja`，語言切換按鈕會自動對應。

## 其他
- Cloudflare Web Analytics：在 `_layouts/base.html` 取消註解並填 token
- 上線後到 Google Search Console 新增網站並提交
- 本檔不會出現在網站上
