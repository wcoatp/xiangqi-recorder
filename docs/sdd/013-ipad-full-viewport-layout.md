# SDD 013：iPad 全視窗響應式版面

> Status：Released<br>
> Owner：Codex／產品負責人<br>
> Created：2026-07-17<br>
> Updated：2026-07-17<br>
> Target branch：`main`<br>
> Related decisions：`D-002`, `D-003`, `D-008`, `D-017`<br>
> Depends on：工作包 003、005、012<br>
> Supersedes：無

## 1. Context

目前 App 最外層 `#root` 使用 `max-width: 640px` 並置中。手機上看不出問題，但安裝到 iPad 主畫面或在較寬視窗中使用時，App shell、上方導覽列與首頁背景都只佔中央 640px；實測 1024px 直向左右各留 192px，1366px 橫向左右各留 363px。PWA manifest 同時固定 `orientation: portrait`，使橫向使用無法成為正式支援路徑。

這是 App 自己的版面限制，不是 iPad 尺寸不相容。工作包要讓外層畫布使用 iPadOS 實際分配給 PWA 的全部視窗，同時保留手機密度、文字可讀寬度、棋盤比例與 safe-area。

## 2. Goals

- App shell、導覽列與頁面背景在手機、iPad 直向、iPad 橫向及分割視窗都使用完整可用寬度。
- 首頁在寬畫面利用額外空間排列功能卡，不把手機卡片無限制拉寬。
- 長文與設定內容維持舒適閱讀寬度；棋盤維持正確比例並不產生水平捲動。
- PWA 不再鎖定直向，可跟隨裝置或視窗方向。
- 保留目前手機版、safe-area、深色模式、三條主要輸入路徑與本機資料行為。

## 3. Non-goals

- 不要求網頁隱藏 iPadOS 狀態列、Home 指示條或瀏覽器／多工系統邊界。
- 不保證 Split View、Stage Manager 或外接螢幕超出系統實際分配的視窗範圍。
- 不重做各功能視覺、不新增 Router、不改資料 schema、引擎、棋規或段級校準。
- 本次不宣稱模擬尺寸等同實體 iPad PWA 驗收；實機安裝仍是發布後的補充確認。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 013-D01 | 最外層 App shell 使用 100% 可用視窗，不再設全域 640px 上限。 | 全域手機上限是 iPad 無法滿版的直接原因。 | Accepted |
| 013-D02 | 可讀寬度改由各內容區局部控制，首頁寬版採多欄卡片。 | 滿版是畫布與導覽滿版，不代表文字、表單與卡片要無限制拉長。 | Accepted |
| 013-D03 | 移除 manifest 的固定直向設定。 | 實體棋盤旁與 iPad 鍵盤／支架使用都可能需要橫向。 | Accepted |
| 013-D04 | 版本維持 v0.7.0。 | 純版面與 manifest 方向修改不影響資料、引擎協定或校準相容性，避免無意凍結進行中的本機校準局。 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 013-FR01 | App root 的邊界寬度等於目前 viewport，不受 640px 上限影響。 | Must | 以 320、390、640、744、820、834、1024、1133、1366px 量測 root／shell／header。 |
| 013-FR02 | 首頁背景填滿畫布，內容在寬版置中並於 iPad 寬度使用四欄次要功能卡。 | Must | iPad 直向與橫向截圖、DOM computed style。 |
| 013-FR03 | 功能指南、棋規、設定、清單及棋盤頁不出現水平 overflow。 | Must | 代表性頁面逐頁量測 `scrollWidth <= clientWidth`。 |
| 013-FR04 | PWA 可跟隨直向或橫向。 | Must | build 後 manifest 不包含固定 `orientation: portrait`。 |
| 013-NFR01 | 保留 `viewport-fit=cover` 與既有 safe-area inset。 | Must | 檢查 HTML meta 與 CSS；瀏覽器尺寸回歸。 |
| 013-NFR02 | 320／390／640px 手機版功能卡、按鈕與 dialog 不退化。 | Must | 自動化瀏覽器實際點擊首頁、對弈設定與 drawer。 |
| 013-NFR03 | 不修改 IndexedDB、校準資料、隱私或網路資料流。 | Must | diff review；無 schema／store 變更。 |

## 6. UX flow

App 啟動後直接使用目前 PWA 視窗：

- 手機與窄分割視窗維持既有兩欄首頁及單欄功能頁。
- iPad 寬度的上方導覽、頁面背景使用全寬；首頁主要「開始紀錄」卡仍保持醒目，其餘四項功能排列為一列。
- 長文、表單與棋盤以局部最大寬度置中，左右空間屬同一 App 背景，而不是 body 外露的空白帶。
- 旋轉裝置或調整 Split View 後，CSS 直接依目前寬度重排，不要求重新安裝或重新整理。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `src/styles.css` | 移除 root 640px 上限；加入全視窗高度／寬度與 iPad 寬版內容規則；修正 drawer 起點。 | 現有 App shell 與 page class。 |
| `vite.config.ts` | 移除固定 portrait orientation。 | `vite-plugin-pwa` manifest 產物。 |
| `docs/SDD.md` | 新增全視窗產品決策、需求、風險與發布紀錄。 | 工作包 013。 |
| `docs/sdd/README.md` | 登錄工作包狀態與施工證據。 | 本文件。 |

### 7.2 Data model and migration

- 無 Dexie schema、localStorage、IndexedDB 或檔案格式變更。
- 不需 migration；回滾 CSS／manifest 即可。

### 7.3 Algorithms or interfaces

- `#root` 以 `width: 100%` 與動態 viewport 高度承接 App shell。
- 內容最大寬度下放到首頁、閱讀頁及一般頁面，不再由 root 統一限制。
- 寬版 breakpoint 只影響排列，不改 React view state、事件或資料介面。

### 7.4 Offline, privacy, security, licensing

- 不新增 runtime 網路請求、第三方資產或權限。
- PWA manifest 與 CSS 仍由既有 Service Worker 離線快取。
- 不讀寫照片、PIN、Token、棋譜或校準資料。

## 8. Acceptance criteria

- [x] 320～1366px 的 root／header 使用完整 viewport 寬度。
- [x] iPad mini、10/11 吋與 13 吋代表尺寸的直向／橫向不出現水平 overflow。
- [x] 首頁寬版背景滿版且功能卡使用額外空間；手機版維持既有密度。
- [x] drawer 從可用畫面左側開啟，不再依 640px 置中公式偏移。
- [x] build manifest 不鎖直向。
- [x] 不破壞 Master SDD 的本機優先、三輸入、象棋品牌與段級門禁界線。
- [x] `npm test` 通過。
- [x] `npm run build` 通過，沒有新增 warning／syntax error。
- [x] 正式站完成 headers、資產與 changed flow 驗證。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit／regression | `npm test` | 既有 25 個 test files／196 tests 不退化。 |
| Build | `npm run build`；檢查產生的 manifest | production build 成功且無固定 portrait。 |
| Browser／responsive | 320、390、640、744、820、834、1024、1133、1366px | root/header 滿寬、無水平 overflow、首頁 breakpoint 正確。 |
| Browser／flow | 首頁 → drawer；首頁 → 人機對弈設定；指南／棋規 | 導航、返回、觸控目標與內容排列正常。 |
| Live | Firebase 根網址、headers、manifest、正式首頁 | 新 CSS 生效、root no-cache、COOP／COEP 保留。 |

## 10. Rollout and rollback

- 不設 feature gate；驗證後隨 production build 全量發布。
- 若寬版造成重大回歸，可回滾工作包 013 commit，不涉及資料還原。
- 已安裝 PWA 由既有 auto-update Service Worker 取得新版；必要時完全關閉再開啟 App。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 實體 iPad standalone 的 safe-area 與旋轉體感是否符合預期？ | 產品負責人 | 正式部署後實機查看 | 不阻擋施工；模擬尺寸先驗證，發布後補實機觀察。 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-17
- 完成日期：2026-07-17
- 實際變更檔案：`src/styles.css`、`vite.config.ts`、`docs/SDD.md`、`docs/sdd/README.md`、本文件。
- 與原規格的差異：寬版 breakpoint 採 700px，使 744px iPad mini 直向也能使用四欄；同時排除首頁 `.overlay` 受內容定位 selector 影響，手機 dialog 恢復完整 fixed viewport 邊界。

### Verification evidence

- `npm test`：25 個 test files／196 tests 全數通過。
- `npm run build`：通過；產生 16 個 precache entries，`dist/manifest.webmanifest` 不含 `orientation`。保留既有 dynamic import 與 500 kB chunk 提示，沒有新增編譯錯誤。
- 手動／實機檢查：內建瀏覽器量測 320×568、390×844、640×900、744×1133、820×1180、834×1194、1024×1366、1133×744、1366×1024；所有 root／shell／header／page 寬度等於 viewport、水平 overflow 為 0。700px 以上首頁為四欄；1024／1366px 對弈設定頁內容 680px、指南與棋規內容 960px且外層 page 滿寬；drawer 於 1024px 的 left 為 0、寬 370px。320px 建立對局 overlay 為 fixed 320×568，dialog 寬 288px；首頁、drawer、對弈設定、指南、棋規 navigation flow 與 console error／warning 檢查通過。
- 已知限制：自動化 viewport 不能完整模擬 iPadOS standalone 狀態列、Home 指示條、Split View 與 Stage Manager；需發布後由實體 iPad 補充確認。PWA 更新後若仍顯示舊版，可完全關閉已安裝 App 再開啟。

### Git and release

- Commit：`30e72d8 feat: support full viewport iPad layouts`。
- Push：已推送 `main` 至 `origin/main`（`99938ff..30e72d8`）。
- Deploy：2026-07-17 已完成 `firebase deploy --only hosting`，18 個 dist files 發布至 [正式站](https://xiangqi-recorder.web.app/)。
- 正式環境驗證：根網址與 `sw.js` 回 200、`Cache-Control: no-cache, no-store, must-revalidate`、`Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Embedder-Policy: require-corp`；新 CSS `/assets/index-CBUV-4_L.css` 回 200，manifest 不含 orientation。內建瀏覽器於 1024×1366 與 1366×1024 量得 root／header／page 等於 viewport、`max-width: none`、四欄首頁、水平 overflow 0。

只有在驗證完成後才能標為 Verified；只有在正式部署並驗證後才能標為 Released。
