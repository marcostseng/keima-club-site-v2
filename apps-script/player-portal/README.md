# 棋手自助系統：安裝說明

棋手自己登錄、修改、下架棋手名鑑，系統直接寫入 GitHub。主辦人只需要做兩件事：收信按「核准上線」，以及在收到修改通知時視需要按「還原」。

## 運作方式

| 動作 | 棋手做的事 | 主辦人做的事 |
|---|---|---|
| 登錄 | 填表 → 點確認信（未成年：家長點同意信） | 收信按「核准上線」或「退回」 |
| 修改 | 輸入 Email → 點修改連結 → 修改後儲存 | 不用做事；收到通知，有問題時按「還原」或「移除照片」 |
| 下架 | 在修改頁按「下架我的資料」 | 不用做事；若棋譜填了這位棋手的代號，改成不具名寫法 |

Email 只存在你的 Google 試算表，不會進入公開的 repository。

## 一、建立 GitHub token（約 3 分鐘）

1. GitHub 右上角頭像 → **Settings** → 最下面 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**。
2. 依下表填寫：

| 欄位 | 填寫 |
|---|---|
| Token name | `keima-player-portal` |
| Expiration | 366 days（到期前 GitHub 會寄信提醒，屆時重新產生並更新指令碼屬性） |
| Repository access | **Only select repositories** → `keima-club-site-v2` |
| Permissions → Repository permissions → **Contents** | **Read and write** |

其他權限都不用開。按 **Generate token**，複製 `github_pat_` 開頭的字串（只會顯示一次）。

## 二、建立 Apps Script（約 5 分鐘）

1. 打開 https://script.google.com → **新專案**，命名為「桂馬會 棋手自助系統」。
2. 把 `Code.gs` 的內容貼進編輯器的 `程式碼.gs`。
3. 左側「檔案」旁按 **＋ → HTML**，命名為 `Portal`（不用打 .html），貼上 `Portal.html` 的內容。
4. 左側 **專案設定**（齒輪）：
   - 勾選「在編輯器中顯示 appsscript.json」，回到編輯器把 `appsscript.json` 換成本資料夾的版本。
   - 「指令碼屬性」→ 新增屬性：名稱 `GITHUB_TOKEN`，值貼上剛才的 token。
5. 回到編輯器，上方選擇 **setup** → **▶ 執行** → 依畫面授權（出現「Google 尚未驗證」時按「進階 → 前往」）。
6. admin@keima.club 收到「棋手自助系統已建立」就成功了。

## 三、部署並接上網站

1. 右上角 **部署 → 新增部署作業** → 類型選 **網頁應用程式**：
   - 執行身分：**我**
   - 誰可以存取：**所有人**
2. 按部署，複製網址（結尾是 `/exec`）。
3. 把網址貼到：
   - `Code.gs` 的 `CONFIG.WEBAPP_URL`，按儲存（信中的連結才會指向正式網址）。
   - 網站 `_data/links.yml` 的 `player_portal`，Commit → Push origin。
4. 打開 https://keima.club/players/ ，用自己的 Email 登錄一位測試棋手，走完確認信 → 核准 → 修改 → 下架，確認每封信都有收到。

**之後修改 Code.gs 時**：部署 → 管理部署作業 → 編輯（鉛筆）→ 版本選「新版本」→ 部署。網址不會變。

## 常用設定（`Code.gs` 最上方的 CONFIG）

| 設定 | 預設 | 說明 |
|---|---|---|
| `APPROVE_NEW` | `true` | 改成 `false`：新登錄 Email 驗證後直接上線，不用你核准 |
| `LINK_HOURS` | `24` | 修改連結有效時間，期間可以多次儲存 |
| `MAX_BIO` | `300` | 個人簡介字數上限 |

## 已經手動建立的棋手頁

在編輯器最上方的函式欄位輸入並執行（或暫時加一行呼叫）：

```js
linkExistingPlayer('wang-xiaoming', 'xxx@gmail.com')
```

本人會收到修改連結，之後就由本人自己管理。

## 安全設計

- 只有點過確認信的 Email 能修改該份資料；修改連結 24 小時失效，同一個 Email 一小時最多申請 3 次。
- 簡介、名稱會移除 `< > { }` 等符號，避免破壞網站版面或 Jekyll 建置。
- 照片在瀏覽器端裁切成 240×288 的 JPG；更換或下架時，舊照片會從 repository 刪除。
- 系統寫入的棋手檔有 `self_managed: true`。主辦人只需要時補填 `honor_name`，本人修改時會保留。
