# SDD 012：人機對弈設定獨立頁

> Status：Verified（待 commit／push／正式部署）<br>
> Owner：Codex<br>
> Created：2026-07-17<br>
> Updated：2026-07-17<br>
> Target branch：`main`<br>
> Related decisions：`D-003`, `D-004`, `D-008`, `D-010`, `D-012`, `D-016`<br>
> Depends on：工作包 003、005、007<br>
> Supersedes：無

## 1. Context

首頁「對弈」目前以 `HomePage` 尾端的 overlay dialog 呈現姓名、執紅／執黑與級段設定。當遮罩或定位樣式沒有正常接手時，表單會依 DOM 順序落在「最近對局」下方；即使遮罩正常，這個主要功能的導航層級也與復盤、解棋、殘局等獨立頁不一致。

本工作包把建局設定提升為 App state 內的獨立 view。這不是 URL Router，也不更動實際 `PlayPage` 或 IndexedDB 對局格式。

## 2. Goals

- 點首頁「對弈」後離開首頁內容，進入獨立的人機對弈設定頁。
- 漢堡選單與功能指南的「人機對弈」使用同一個設定 view。
- 設定頁清楚提供返回首頁、姓名、紅黑方、相對級段與開始對弈。
- 維持台灣繁中、中國象棋視覺、窄螢幕可用性與現有建局資料語意。

## 3. Non-goals

- 不改「開始紀錄」與「回饋」既有 dialog。
- 不改一般 `PlayPage` 棋盤、引擎棋力、人類化選著、悔棋或終局功能。
- 不改段級校準實驗室與 PIN 內校準對弈。
- 不新增 URL Router、後端、IndexedDB schema 或公開段級映射。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 012-D01 | 新增 `play-setup` App view，建局成功後才進既有 `play` view | 對齊主要功能導航，同時保持設定與棋盤責任分離 | Accepted |
| 012-D02 | 首頁、drawer、指南三個入口全部導向同一 view | 避免同一功能保留兩種導航與兩套 UI | Accepted |
| 012-D03 | 返回／取消不建立棋局；建立中停用重複送出並顯示本機錯誤 | 防止連點產生重複的零著人機局 | Accepted |
| 012-D04 | App 版本維持 `0.7.0` | 全域 `APP_VERSION` 也是校準局快照相容鍵；純導航修正不應讓既有 v0.7.0 進行中校準局變成跨版本唯讀 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 012-FR01 | 首頁對弈卡點擊後，首頁 hero、主要功能與最近對局不得仍留在設定表單上方 | Must | browser DOM／visual smoke |
| 012-FR02 | 獨立頁提供「返回首頁」、姓名、紅黑方、相對級段、免責文案與「開始對弈」 | Must | browser／copy audit |
| 012-FR03 | drawer 與指南捷徑進入相同 `play-setup` view，drawer active target 仍為人機對弈 | Must | navigation smoke／typecheck |
| 012-FR04 | 建局沿用 `games` mode=`play`、playerSide、level、初始 FEN／tree 與玩家名冊保存 | Must | code audit／existing tests |
| 012-NFR01 | 320／390／640 px 無橫向溢位；控制可用鍵盤與觸控操作 | Must | responsive browser smoke |
| 012-NFR02 | 不新增 dependency、網路請求、資料 migration 或西洋棋／Elo 文案 | Must | diff／build audit |

## 6. UX flow

1. 使用者從首頁、漢堡選單或功能指南選「人機對弈」。
2. App 將整個主內容切換為人機對弈設定頁，頂端提供「← 返回首頁」。
3. 使用者輸入姓名、選執紅／執黑與相對級段。
4. 點「開始對弈」後先建立並保存零著 `play` 棋局，再切換至既有 `PlayPage`。
5. 點返回則直接回首頁，不建立棋局。

## 7. Technical design

- `src/App.tsx`：新增 `play-setup` view 與 render branch。
- `src/ui/PlaySetupPage.tsx`：由原 `PlayDialog` 搬移建局表單與 persistence 流程，改成獨立頁並加入送出狀態／錯誤回報。
- `src/ui/HomePage.tsx`：首頁卡直接 `go({ name: 'play-setup' })`，移除尾端 `PlayDialog`。
- `src/ui/AppMenu.tsx`、`src/ui/GuidePage.tsx`：統一入口與 active title。
- `src/styles.css`：新增獨立頁 hero／card／響應式樣式；不依賴 overlay 定位。

無 Dexie schema、PWA route 或引擎變更。重新整理仍依既有架構回首頁。

## 8. Acceptance criteria

- [x] 首頁「對弈」進入獨立設定畫面，不再把表單放在首頁最下方。
- [x] 返回首頁不新增棋局；開始後進入原有對弈棋盤。
- [x] 漢堡選單與指南捷徑都導向同一設定畫面。
- [x] UI 只顯示 App 相對級／段，不顯示 Elo 或認證暗示。
- [x] `npm test`、`npm run build`、`git diff --check` 通過。
- [x] 320／390／640 px 與桌面流程完成 browser smoke。
- [ ] commit、push、Firebase deploy 與正式站流程驗證完成。

## 9. Risks and mitigations

| 風險 | 影響 | 緩解 |
|---|---|---|
| 舊 `home.action='play'` call site 遺漏 | 某入口仍打開舊流程或 type error | 全庫搜尋 `action: 'play'` 與 `HomeAction`，由 TypeScript build 把關 |
| 連點開始建立重複棋局 | 最近對局出現多筆零著局 | 建立中停用返回與開始按鈕，單次 await 後導航 |
| 窄螢幕表單／range 標籤擠壓 | 現場手機難操作 | mobile-first card、可換行刻度與 320／390 px 實測 |

## 10. Construction record

### Implementation

- 開始日期：2026-07-17
- 完成日期：2026-07-17（程式與本機驗證；正式發布待完成）。
- 實際變更檔案：`src/ui/PlaySetupPage.tsx`、`src/ui/HomePage.tsx`、`src/ui/AppMenu.tsx`、`src/ui/GuidePage.tsx`、`src/App.tsx`、`src/styles.css`、`tsconfig.app.tsbuildinfo`、Living SDD／工作包索引／README。
- 與原規格的差異：為避免純 UI 修正觸發校準局跨版本唯讀，App 版本維持 `0.7.0`；建局資料格式與一般 `PlayPage` 未變。

### Verification evidence

- `npm test`：通過，25 個 test files／196 tests。
- `npm run build`：通過，105 modules；CSS `index-QrFBhgRn.css`、JS `index-P-3URtN4.js`。只有既有 tree dynamic/static import 與 500 kB chunk size 提示。
- App 內瀏覽器本機流程：首頁卡、drawer 與功能指南皆進入同一獨立設定頁；取消返回首頁；選協助者執黑後建立棋局，成功進入既有棋盤並由引擎落第一著。
- 響應式：320、390、640 px 的 document/body scroll width 都等於 viewport；設定 card 邊界保持在 viewport 內，無橫向溢位。桌面視覺檢查確認 hero、表單與級段刻度正常。
- 已知限制：沿用 App 現有 state navigation，重新整理設定頁仍回首頁；沒有新增 React DOM component test，導航與建局由 TypeScript build、既有 store tests 與實際瀏覽器流程共同驗證。

### Git and release

- Commit：待完成。
- Push：待完成。
- Deploy：待完成。
- 正式環境驗證：待完成。
