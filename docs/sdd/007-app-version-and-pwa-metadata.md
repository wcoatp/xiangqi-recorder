# SDD 007：單一 App 版本來源與 PWA 三輸入描述

> Status：Released<br>
> Owner：Codex<br>
> Created：2026-07-17<br>
> Updated：2026-07-17<br>
> Target branch：`main`<br>
> Related decisions：`D-002`, `D-008`, `D-012`<br>
> Depends on：工作包 006 已發布<br>
> Supersedes：無

## 1. Context

目前 `package.json`／`package-lock.json` 宣告 `0.1.0`，回饋診斷、設定頁與段級校準匯出卻由 `FeedbackDialog.tsx` 內的常數顯示 `0.3.0`。版本分散會讓錯誤回報、校準資料與後續完整備份無法可靠判斷由哪個 App 版本建立。

此外首頁已把語音、拍照、點棋盤視為三條等權主要輸入路徑，但 `package.json`、`index.html` 與 PWA manifest 的安裝描述仍只寫語音／點按，造成產品能力與安裝資訊不一致。

## 2. Goals

- 保留目前對外顯示的 App 版本 `0.3.0`，並讓 `package.json` 成為唯一人工維護的版本來源。
- 由 Vite 在 build 時封裝 package 版本，供設定、回饋診斷與段級校準匯出共用。
- 讓 package、HTML 與 PWA manifest 一致描述語音、拍照、點棋盤三種主要輸入。
- 補足穩定的 PWA `id`、`scope` 與適當 categories，不改變現有啟動流程。

## 3. Non-goals

- 不新增 URL Router、PWA shortcuts 或可深連結頁面。
- 不改變既有 `portrait` orientation、圖示、Service Worker 快取策略或 Firebase 設定。
- 不自動建立 Git tag、build number 或 commit hash，也不在本工作包定義未來升版政策。
- 不改 Dexie schema、備份格式、段級校準 schema 或 PIN 門禁。
- 不處理尚未啟用的 AI Token 欄位；完整備份工作包必須明確排除其值。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 007-D01 | 對外版本沿用 `0.3.0`，不倒退成 package 現有的 `0.1.0` | 設定、回饋與已匯出的校準檔目前都以 `0.3.0` 為可見版本 | Accepted |
| 007-D02 | `package.json.version` 是唯一人工維護來源，Vite 將 JSON import 封裝為 runtime 常數 | 避免 UI 元件互相匯入與多處手動同步，也讓 Vitest 共用同一來源 | Accepted |
| 007-D03 | 三處產品描述都明列「語音、拍照、點棋盤」 | 落實三輸入等權的既有產品決策 | Accepted |
| 007-D04 | PWA 增加固定 `id`／`scope` 與 games、education、utilities categories | 讓安裝識別穩定且更符合 App 性質，不改變頁內導航 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 007-FR01 | 設定頁、回饋診斷與段級校準匯出使用同一版本常數 | Must | 單元測試、build 與瀏覽器檢查 |
| 007-FR02 | `package.json` 與 lockfile 根套件版本一致 | Must | 自動測試與檔案檢查 |
| 007-FR03 | package、HTML meta 與 manifest 描述包含三種輸入 | Must | 單元測試、build 產物與 manifest 檢查 |
| 007-NFR01 | JSON import 有 TypeScript 型別，production bundle 不依賴 runtime 讀取 package 檔 | Must | `npm run build` |
| 007-NFR02 | 不新增 runtime 網路請求、個資或本機資料外傳 | Must | 程式差異檢查 |

## 6. UX flow

使用者流程不變。設定頁授權區仍顯示 `象棋記譜 v0.3.0`；回饋對話框的診斷內容與段級校準匯出中的 `appVersion` 會自動使用同一版本。安裝 PWA 時，瀏覽器取得的 manifest 描述會完整列出語音、拍照、點棋盤。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `package.json`, `package-lock.json` | 對齊 `0.3.0` 並補齊三輸入描述 | npm package metadata |
| `vite.config.ts` | 補齊 manifest | Vite／vite-plugin-pwa |
| `src/version.ts` | 由 package JSON import 提供 typed runtime version 模組 | Vite／Vitest JSON transform |
| `src/ui/FeedbackDialog.tsx`, `SettingsPage.tsx`, `RankCalibrationPage.tsx` | 改由版本模組取值 | `src/version.ts` |
| `index.html` | 補齊三輸入 meta description | 瀏覽器／搜尋／安裝資訊 |
| `src/version.test.ts` | 驗證 runtime 與 package 版本一致 | Vitest／Node fs |

### 7.2 Data model and migration

- 無 Dexie schema 或資料 migration。
- 既有校準匯出格式不變，只讓 `appVersion` 來源可靠一致。

### 7.3 Algorithms or interfaces

- `src/version.ts` 以 JSON named import 讀取 repository 根目錄 `package.json.version`；Vite／Vitest 在 transform 時將值封裝進模組。
- 應用程式其他模組只透過 `src/version.ts` 匯出的 `APP_VERSION` 取值。
- production runtime 不 fetch package metadata。

### 7.4 Offline, privacy, security, licensing

- 完全離線，沒有新增 runtime request。
- 不讀取或傳送 IndexedDB、PIN、Token、照片或校準紀錄。
- 沒有新增第三方套件或授權。

## 8. Acceptance criteria

- [x] `package.json`、lockfile 與 App runtime 都是 `0.3.0`。
- [x] UI 不再由 `FeedbackDialog.tsx` 定義或轉供版本常數。
- [x] 設定頁與回饋診斷顯示正確版本；段級校準匯出沿用同一來源。
- [x] package、HTML meta、build 後 manifest 都明列語音、拍照、點棋盤。
- [x] manifest 有固定 `id`、`scope`、`start_url`，且保持 standalone／portrait。
- [x] `npm test` 通過。
- [x] `npm run build` 通過，沒有新增 warning／syntax error。
- [x] production build 與正式站 manifest 完成實際檢查。
- [x] Master SDD、工作包索引與施工紀錄同步更新。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit | runtime 版本、package 與 lockfile 根版本一致 | 三者相同且符合 semver |
| Unit | package／HTML／Vite manifest 文字檢查 | 三輸入不缺漏 |
| Build | `npm run build` | TypeScript 與 Vite build 成功 |
| Browser | 設定授權區、回饋診斷、`manifest.webmanifest` | 顯示版本 `0.3.0`；manifest metadata 正確 |
| Regression | `npm test` | 現有記譜、復盤、棋規與校準測試不退化 |

## 10. Rollout and rollback

- 無 feature gate；metadata 與版本來源隨同一 production build 發布。
- 若注入失敗，build 應直接失敗，不發布含未定義版本的 bundle。
- 回滾可還原該 implementation commit；不涉及本機資料變更。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 下一次何時升版、採 semver 或 release build number？ | 產品負責人 | 第一個需要升版的後續 release | 本工作包不先假定 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-17
- 完成日期：2026-07-17
- 實際變更檔案：`package.json`, `package-lock.json`, `index.html`, `vite.config.ts`, `src/version.ts`, `src/version.test.ts`, `src/ui/FeedbackDialog.tsx`, `src/ui/SettingsPage.tsx`, `src/ui/RankCalibrationPage.tsx`, `docs/SDD.md`, `docs/sdd/README.md`, 本文件。
- 與原規格的差異：初版設計使用 Vite global define；測試發現獨立 `vitest.config.ts` 不會繼承該 define，改採 package JSON named import。仍為 build-time 封裝且沒有 runtime fetch，並避免 Vite／Vitest 設定漂移。

### Verification evidence

- `npm test`：2026-07-17 通過，14 個 test files／101 tests。
- `npm run build`：2026-07-17 通過；產物 `manifest.webmanifest` 含三輸入描述、`id`／`scope`／`start_url`、standalone／portrait 與 categories。僅保留既有 `tree.ts` dynamic/static import warning，沒有新增 warning。
- 手動／實機檢查：本機 Chromium 以 `http://127.0.0.1:5173` 檢查設定授權區與回饋診斷，兩者均顯示 `0.3.0`；首頁三輸入文案正常。正式站待 deployment 後驗證。
- 已知限制：本工作包不提供 URL deep link、自動升版策略或橫向 orientation；dev server 不產生 PWA manifest，manifest 以 production build 產物及正式站檢查。

### Git and release

- Commit：`b35bb57`（`chore: unify app version and PWA metadata`）。
- Push：2026-07-17 已推送 `main` 至 `origin/main`。
- Deploy：2026-07-17 已以 Firebase Hosting 發布 production build；正式 JS `/assets/index--f5Xj_X4.js`、CSS `/assets/index-BqP7AsxT.css`。
- 正式環境驗證：`https://xiangqi-recorder.web.app/?release=007-20260717` 回應 HTTP 200；COOP `same-origin`、COEP `require-corp`。正式 manifest 含語音／拍照／點棋盤、`id`／`scope`／`start_url`、standalone／portrait 與 categories；正式站設定頁及回饋診斷均顯示 `0.3.0`。
