# SDD 016：PWA 新版提示與安全更新

> Status：Released<br>
> Owner：Codex／產品負責人<br>
> Created：2026-07-18<br>
> Updated：2026-07-18<br>
> Target branch：`main`<br>
> Related decisions：`D-008`, `D-012`, `D-020`<br>
> Depends on：SDD 007、012、013、015<br>
> Supersedes：無

## 1. Context

目前 `vite-plugin-pwa` 使用 `registerType: "autoUpdate"`，新版 Service Worker 啟用時會直接重新載入所有已開啟的 App 分頁。工作包 015 正式發布時也實際觀察到：既有分頁第一次導覽仍由舊 precache 回傳舊資產，等新 Service Worker 接管後再重新載入才取得新版。使用者因此可能遇到「已部署但畫面仍是舊的」，也可能在記譜、對弈或分析途中被自動重新載入。

本工作包改為使用者可控制的更新提示：偵測到等待中的新版後顯示目前與可用版本、允許稍後處理，按下更新才啟用新版並重新載入。版本資訊仍只有 `package.json.version` 一個人工來源，build 額外產生不快取的版本描述檔供舊 bundle 在更新事件發生後查詢。

## 2. Goals

- 新版 Service Worker 準備完成時，全站顯示清楚且可操作的更新提示。
- 顯示目前 App 版本；能取得時同時顯示可用新版版本。
- 使用者可選擇稍後或立即更新，不在背景強制打斷目前操作。
- 立即更新只有一次有效動作，成功後由新 Service Worker 接管並重新載入。
- 版本描述檔由 package 版本自動產生、禁止快取且不被 precache。

## 3. Non-goals

- 不修改棋譜、設定、校準、IndexedDB schema、備份格式或引擎。
- 不新增帳號、後端、推播、分析追蹤或遠端設定服務。
- 不清除使用者 Cache Storage、IndexedDB 或其他網站資料。
- 不處理瀏覽器的「安裝 App」提示；本次只處理已載入 App 的版本更新。
- 不承諾作業系統完全終止 PWA 時仍能立即發現更新；更新檢查依瀏覽器 Service Worker 生命週期。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 016-D01 | Service Worker 由 `autoUpdate` 改為 `prompt` | 不在棋手操作途中自動重載 | Accepted |
| 016-D02 | 非模態提示固定在 App 底部，可「稍後」或「立即更新」 | 全站可見、不改變棋盤尺寸；保留使用者決定時機 | Accepted |
| 016-D03 | 提示說明進度已保存在本機，更新後回首頁 | App 沒有 URL Router；必須誠實告知重載結果 | Accepted |
| 016-D04 | build 產生 `/app-version.json`，不進 precache 且正式站 no-store | 舊 bundle 必須從網路取得真正的新版本號，不能再讀舊快取 | Accepted |
| 016-D05 | 每個正式功能版本都要更新 `package.json.version` | 相同版本號無法向使用者清楚區分新舊 bundle | Accepted |
| 016-D06 | 同一次套用更新只允許一個 Promise | 防止連點多次送出 skip-waiting／reload | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 016-FR01 | 等待中的新版觸發提示，未有新版時不占畫面 | Must | 模擬 `onNeedRefresh` 前後檢查 DOM |
| 016-FR02 | 提示顯示目前版本與可取得的新版版本 | Must | mock version manifest 成功、失敗及同版本三種情況 |
| 016-FR03 | 「稍後」只關閉本次提示，不改資料 | Must | 點擊後提示消失，無 storage／DB 寫入 |
| 016-FR04 | 「立即更新」進入忙碌狀態並只呼叫 updater 一次 | Must | 連點／並行測試仍只有一次呼叫 |
| 016-FR05 | 套用失敗時顯示錯誤並可重試 | Must | updater reject 後恢復可操作按鈕 |
| 016-NFR01 | 320～1366 px 無水平 overflow，保留 safe-area | Must | 手機、iPad 直／橫向瀏覽器檢查 |
| 016-NFR02 | `/app-version.json` 由 package 版本產生且不被 SW precache | Must | production build 與 `sw.js` 內容檢查 |
| 016-NFR03 | 正式站版本檔、首頁與 SW 皆使用正確 no-cache/no-store 契約 | Must | Firebase 部署後檢查 HTTP headers |

## 6. UX flow

1. App 正常載入並註冊目前 Service Worker，不顯示任何更新 UI。
2. 瀏覽器下載並完成新版 Service Worker 安裝；舊頁收到 `onNeedRefresh`。
3. 底部提示立即出現「新版本已準備完成」，先顯示目前版本；背景以 `cache: no-store` 查詢新版版本描述檔，成功後補上「目前 vX → 新版 vY」。
4. 使用者選「稍後」，提示在本次頁面生命週期內關閉；下次重新載入若新版仍在等待，瀏覽器可再次提示。
5. 使用者選「立即更新」，兩個按鈕停用並顯示「正在更新…」；只送出一次 skip-waiting。新版取得控制權後重新載入，因 App 沒有 router 而回到首頁，本機資料保留。
6. 若套用 Promise 失敗，提示顯示「更新尚未完成」與錯誤說明，使用者可重試或稍後。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `src/main.tsx` | 以 prompt 模式註冊 SW，串接 controller | `virtual:pwa-register` |
| `src/pwa/updateController.ts` | 外部狀態、版本查詢、dismiss／apply 單飛邏輯 | `APP_VERSION`, Fetch API |
| `src/pwa/versionManifest.ts` | 版本檔序列化與嚴格解析 | package version |
| `src/ui/PwaUpdatePrompt.tsx` | 全站可存取提示與無障礙狀態 | React external store |
| `src/App.tsx`, `src/styles.css` | 掛載提示與響應式視覺 | App shell／safe-area |
| `vite.config.ts` | prompt 設定與 build-time 版本資產 | Vite plugin API |
| `firebase.json`, `public/_headers` | 版本檔 no-store headers | Firebase／替代靜態主機 |
| `package.json`, `package-lock.json` | App 版本升至 v0.8.0 | 單一人工版本來源 |

### 7.2 Data model and migration

- 無 Dexie schema、migration 或持久偏好。
- 更新提示狀態只存在目前 JavaScript 頁面生命週期。
- 「稍後」不寫 localStorage／sessionStorage；重新載入後由 Service Worker 真實狀態重新判定。

### 7.3 Interfaces and invariants

- `UpdateSnapshot.phase`：`idle | ready | applying | error`。
- `announceUpdate(loadVersion)`：先同步進入 `ready`，再非阻塞載入版本；版本載入失敗不隱藏更新提示。
- `applyUpdate()`：同時多次呼叫共用同一個 in-flight Promise；成功後等待 Workbox `controlling` 事件重新載入。
- `app-version.json`：僅接受 `{ "version": "非空且長度受限字串" }`，其他結構視為未知版本。
- 版本檔不得加入 Workbox `globPatterns`；請求加入 timestamp query 並使用 `cache: "no-store"`。
- 開發模式可用 `?pwa-update-preview=<version>` 觸發純 UI 預覽；production build 必須移除這條測試路徑。

### 7.4 Offline, privacy, security, licensing

- 正常離線功能不變；離線時不可能下載新版，亦不顯示假更新。
- 版本查詢只傳送一般 GET，不含棋譜、裝置識別、設定或個資。
- 不新增套件、權限或授權來源。
- 版本檔不是安全機制，只是使用者溝通資訊；真正更新仍由同源 Service Worker 控制。

## 8. Acceptance criteria

- [x] 新版等待時提示出現，平常不顯示。
- [x] 成功顯示目前／新版版本，版本檔失敗時仍可更新。
- [x] 稍後、立即更新、忙碌、失敗與重試狀態可用。
- [x] 立即更新的並行呼叫只執行一次 updater。
- [x] 提示具非模態 region 與預先掛載的 live status，鍵盤焦點與觸控按鈕可用。
- [x] 320、390、820、1180、1366 px 無水平 overflow。
- [x] build 版本檔正確、no-store 且未被 precache。
- [x] 不破壞本機資料與 Master SDD 產品界線。
- [x] `npm test` 通過。
- [x] `npm run build` 通過。
- [x] commit、push、Firebase deploy 與正式站驗證完成。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit | manifest serialize／parse | 合法版本 round trip；多餘欄位、空值、超長與非物件拒絕 |
| Unit | controller announce／dismiss／apply | prompt state 正確；版本失敗降級；單飛；失敗可重試 |
| Build | production output | `app-version.json` 為 v0.8.0，`sw.js` 不含該 URL，preview query 不在 bundle |
| Browser | dev preview | 提示文案、稍後、更新中、錯誤狀態及鍵盤／觸控可用 |
| Responsive | 320×568、390×844、820×1180、1180×820、1366×1024 | safe-area、按鈕換行、無水平 overflow，不遮住 App drawer |
| Live | Firebase headers and update | root／SW／version headers 正確；v0.8.0 等待下一版時能提示並由使用者套用 |
| Regression | 全站入口、設定版本、IndexedDB | App 正常載入；設定顯示 v0.8.0；無 schema／資料改動 |

## 10. Rollout and rollback

- v0.8.0 首次發布時，仍在執行 v0.7.0 autoUpdate bundle 的已開啟分頁可能自動重載一次；自 v0.8.0 起後續版本才使用新提示流程。
- 若提示阻斷操作，可回退 React 掛載並暫時恢復 autoUpdate；沒有資料 migration 或回復需求。
- 不以清 Cache 或刪除 Service Worker 作為一般回滾步驟。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 是否未來讓「稍後」跨重新載入記住一段時間？ | 產品負責人 | 觀察提示頻率後 | 不阻擋；第一版只關閉目前頁面 |
| 是否加入更新內容摘要／release notes？ | 產品負責人 | 有穩定 changelog 發布流程後 | 不阻擋；第一版只顯示版本 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-18
- 完成日期：2026-07-18（程式與本機驗證）。
- 實際變更檔案：`src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/ui/PwaUpdatePrompt.tsx`, `src/pwa/updateController.ts`, `src/pwa/updateController.test.ts`, `src/pwa/versionManifest.ts`, `src/pwa/versionManifest.test.ts`, `vite.config.ts`, `tsconfig.node.json`, `package.json`, `package-lock.json`, `firebase.json`, `public/_headers`, `tsconfig.*.tsbuildinfo` 與本工作包／Master SDD／索引。
- 與原規格的差異：無。build 與前端共用同一個版本描述序列化器；開發預覽以 450ms 後可重試失敗模擬驗證忙碌與錯誤狀態，正式 bundle 會移除該入口。

### Verification evidence

- `npm test`：通過，27 個 test files／216 tests；新增 manifest exact-shape、no-store fetch、announce／dismiss、單飛套用與失敗重試測試。
- `npm run build`：通過；輸出 `app-version.json` v0.8.0、`index-CIxthfdQ.js`、`index-Cj87mXLr.css` 與 16 筆 precache。既有 `tree.ts` 動／靜態 import 與 500 kB chunk 警告仍為非阻擋警告。
- Production 產物：`app-version.json` 為 `{"version":"0.8.0"}`；`sw.js` 不含版本檔；production JS 不含 `pwa-update-preview`。
- 內建瀏覽器開發預覽：確認目前 v0.8.0／新版 v0.8.1、「稍後」關閉、更新中雙按鈕停用、錯誤文案與重試重新進入忙碌狀態；預先掛載 `role=status` 可朗讀狀態。
- 一般本機入口：無等待新版時 prompt count 0、announcer 為空；設定頁顯示 `象棋記譜 v0.8.0`。
- 響應式：320×568、390×844、820×1180、1180×820、1366×1024 的 html／body 水平 overflow 均為 0；提示完整位於 viewport，320px 錯誤狀態高度 176.64px、左右／底部各 8px，按鈕高度 40.5px；其餘按鈕高度 42px。
- 層級：App drawer z-index 100，高於提示 90；提示不改變棋盤／頁面 layout 尺寸。
- 正式 production bundle：Firebase HTML 引用的 `index-CIxthfdQ.js`／`index-Cj87mXLr.css` 均為 200；同一份本機 production preview 在 820×1180 載入，overflow 0、announcer 1、idle prompt 0，設定顯示 v0.8.0。
- 已知限制：v0.7.0 本身沒有提示 UI；部署當下既有 `web.app` 分頁在一般 reload 與瀏覽器快捷強制 reload 後仍由舊 Service Worker 回傳 `index-CnMSfkr3.js`，因此未以刪除 SW／Cache Storage 的方式破壞或干預本機資料。真正跨正式版本提示需由已載入 v0.8.0 的分頁觀察後續部署，本版以單元測試、dev preview、production bundle 與正式 HTTP 產物驗證補足。

### Git and release

- Commit：`11de252 feat: add safe PWA update prompt`。
- Push：`main` 已推送至 `origin`（`b6b7cba..11de252`）。
- Deploy：2026-07-18 已發布至 [Firebase Hosting](https://xiangqi-recorder.web.app/)；19 個 dist files、7 個新檔上傳完成。
- 正式環境驗證：根網址、`sw.js`、`app-version.json` 均 HTTP 200，`Cache-Control: no-cache, no-store, must-revalidate` 與 COOP／COEP 正確；版本檔為 `{"version":"0.8.0"}`，HTML 引用本次 JS／CSS，兩項資產均 HTTP 200。

只有在驗證完成後才能標為 Verified；只有在正式部署並驗證後才能標為 Released。
