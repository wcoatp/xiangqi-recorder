# SDD 014：iPad 對弈棋盤首次直向排版穩定化

> Status：Verified<br>
> Owner：Codex／產品負責人<br>
> Created：2026-07-17<br>
> Updated：2026-07-17<br>
> Target branch：`main`<br>
> Related decisions：`D-008`, `D-017`, `D-018`<br>
> Depends on：工作包 012、013<br>
> Supersedes：無

## 1. Context

工作包 013 發布後，產品負責人在實體 iPad Air 的已安裝 App 中發現：裝置直向進入人機對弈棋盤時，畫面首次排版會被裁切；切到橫向正常，再切回直向後才會重新排成滿版。這代表工作包 013 留待實機確認的 standalone viewport 風險已實際發生。

程式檢查顯示，對弈頁仍以 inline `maxHeight: "56vh"` 限制棋盤，而共用 `Board` SVG 只有 `viewBox`，沒有明確 `width`、`height` 或 `preserveAspectRatio`；CSS 又只用 `max-width`／`max-height` 讓 flex 容器與 SVG 互相推算尺寸。內建瀏覽器以 iPad Air 代表尺寸 820×1180、1180×820、再回 820×1180 均無裁切，但棋盤高度分別精確等於 `56vh` 的 660.8px 與 459.2px。實體裝置只有旋轉後恢復，符合 iPadOS standalone 首次 viewport／SVG intrinsic sizing 重排時序問題的特徵。

本工作包不依賴旋轉或重新整理 workaround，而是移除對弈棋盤對 viewport 單位的直接依賴，讓 flex page 的實際剩餘空間成為唯一尺寸來源，並讓 SVG 比例可被瀏覽器確定計算。

## 2. Goals

- 已安裝 PWA 冷啟動後，在 iPad Air 直向首次進入對弈頁即可完整看見棋盤與操作列，不必先旋轉。
- 棋盤依頁面實際剩餘空間伸縮，維持 9:10 比例，不產生水平 overflow 或圖形變形。
- iPad 橫向、回到直向、手機直向與窄螢幕都維持穩定排版。
- 保留棋盤點按、提示箭頭、最後一步、將軍標記與既有自動記譜流程。

## 3. Non-goals

- 不重做棋盤視覺、棋子圖案、對弈控制列或引擎流程。
- 不修改其他頁面既有的 viewport 高度策略；共用 SVG 尺寸契約可改善所有棋盤，但本次主要驗收範圍是人機對弈頁。
- 第一輪不加入 `resize`、`orientationchange`、`visualViewport` 或強制 reflow 的 JavaScript workaround；只有 CSS／SVG 確定尺寸後，實體 iPad 仍失敗才另行評估。
- 不把自動化代表尺寸宣稱為實體 iPad standalone 驗收；正式發布後仍需同一台 iPad Air 補測。
- 不修改 IndexedDB、PWA manifest、Service Worker、引擎、棋規或段級校準資料。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 014-D01 | 人機對弈棋盤不再以 `vh` 決定高度，改由 page flex container 的實際剩餘空間配置。 | 避免 iPadOS standalone 首次 viewport 高度尚未穩定時把錯誤高度凍結到棋盤。 | Accepted |
| 014-D02 | 共用棋盤 SVG 明確提供 720×800 尺寸與 `xMidYMid meet` 比例契約，CSS 以明確 100% 寬高填入 wrapper。 | 讓 SVG viewport 與內容比例分工明確，避免只靠 auto size 與 max constraints 互相推算。 | Accepted |
| 014-D03 | 第一輪保持純 CSS／SVG 修正，不新增 viewport 監聽器。 | `visualViewport` 在 standalone 環境也可能不可靠；先採可預測、可回滾的原生版面契約。 | Accepted |
| 014-D04 | App 版本維持 v0.7.0。 | 本次只修正版面尺寸，不改資料、引擎或校準相容性。 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 014-FR01 | 對弈頁不得保留 inline `vh`／`dvh` 棋盤限高。 | Must | Source review；DOM computed style 不再由 viewport 百分比決定 wrapper 高度。 |
| 014-FR02 | 棋盤 SVG 必須有固定 intrinsic width／height 與明確 preserve aspect ratio。 | Must | DOM attributes；直／橫向量測可見棋盤維持 9:10。 |
| 014-FR03 | 820×1180 首次直向進入、1180×820 橫向、再回直向時，root、page、棋盤與操作列均在可用 viewport 內且無水平 overflow。 | Must | 內建瀏覽器冷進與 rotation sequence；實體 iPad 發布後補測。 |
| 014-FR04 | 320×568、390×844 與 640×900 不裁切主要操作列；空間不足時沿用 page 垂直捲動。 | Must | Browser geometry 與實際點擊。 |
| 014-NFR01 | 不新增 runtime 網路、資料寫入、權限或瀏覽器 viewport API。 | Must | Diff review。 |
| 014-NFR02 | 共用棋盤的點擊座標、標記與內容不得因 SVG element box 改變而錯位。 | Must | 點擊合法棋子、量測 SVG viewBox／preserveAspectRatio，回歸既有流程。 |

## 6. UX flow

1. 使用者在直向 iPad 開啟已安裝 App。
2. 從首頁進入「人機對弈」，完成設定並開始。
3. 對弈頁首次顯示即以 header 與操作列之間的實際剩餘空間呈現完整棋盤。
4. 切到橫向或再切回直向時，flex container 自動重新分配空間；不要求重新整理、離開頁面或觸發額外操作。
5. 在短螢幕中，操作列優先保持可達；頁面可依既有規則垂直捲動。

沒有新增空狀態或錯誤文案；引擎不支援、思考中、悔棋、提示與結束流程維持原行為。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `src/ui/PlayPage.tsx` | 加入專用 page class，移除 inline gap 與 `56vh` 棋盤限高。 | 現有 `.page`／`.board-wrap` flex layout。 |
| `src/ui/Board.tsx` | SVG 加入 `width`、`height` 與 `preserveAspectRatio`。 | 既有 720×800 viewBox。 |
| `src/styles.css` | 對弈頁 gap 改為 class；共用 Board SVG 改為明確 block、100% element viewport。 | `.board-wrap` 的 flex available size。 |
| `docs/SDD.md` | 記錄容器驅動棋盤決策、實機風險與施工／發布證據。 | 工作包 014。 |
| `docs/sdd/README.md` | 登錄工作包狀態與證據。 | 本文件。 |
| `docs/sdd/013-ipad-full-viewport-layout.md` | 將實體 iPad open question 連回本工作包。 | 工作包 013 已發布紀錄。 |

### 7.2 Data model and migration

- 無 Dexie schema、IndexedDB、localStorage、檔案格式或 migration 變更。
- 不碰現有對局與校準資料；回滾只需還原 TSX／CSS。

### 7.3 Algorithms or interfaces

- 棋盤 viewBox 固定為 `0 0 720 800`，內容比例為 9:10。
- SVG element 明確填滿 `.board-wrap` 的 available inline／block size；`preserveAspectRatio="xMidYMid meet"` 在 element viewport 內等比例置中棋盤內容。
- `.board-wrap` 保持 `flex: 1`、`min-height: 0`；對弈頁不再加入 viewport-based max height。
- React props、點擊 square index、引擎與資料介面完全不變。

### 7.4 Offline, privacy, security, licensing

- 不新增網路請求、套件、第三方資產或授權來源。
- 不讀寫棋譜以外的新資料，不接觸照片、PIN、Token 或校準原始資料。
- 修正隨既有 PWA shell 離線快取與 auto-update 發布。

## 8. Acceptance criteria

- [x] 對弈頁不再使用 `56vh` 或其他 viewport unit 限制棋盤。
- [x] SVG 尺寸與比例契約明確，棋盤無拉伸、點擊不偏移。
- [x] 320×568、390×844、640×900、820×1180 與 1180×820 無水平 overflow。
- [x] 820×1180 首次進入 → 1180×820 → 820×1180 的棋盤與操作列均在 page 內。
- [x] 對弈建局、棋盤點擊、提示／悔棋控制與返回首頁仍可操作。
- [x] 不破壞 Master SDD 的本機優先、資料、引擎與 iPad 全視窗界線。
- [x] `npm test` 通過。
- [x] `npm run build` 通過，沒有新增 warning／syntax error。
- [x] 文件與驗證證據同步更新。
- [ ] 正式站資產、headers 與 changed flow 完成驗證。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Source／DOM | 檢查 PlayPage、SVG attributes、computed layout | 無 viewport 限高；SVG 720×800、`xMidYMid meet`。 |
| Regression | `npm test` | 既有 25 個 test files／196 tests 不退化。 |
| Build | `npm run build` | production build 成功，無新增錯誤。 |
| Browser／phone | 320×568、390×844、640×900 冷進對弈並點棋 | 棋盤完整、控制列可達、點擊座標正確、無水平 overflow。 |
| Browser／iPad | 820×1180 冷進、1180×820、回 820×1180 | root／page／board／controls 不裁切，rotation 前後比例與 overflow 正確。 |
| Live | 正式站根網址、headers、資產、對弈 changed flow | 新版生效；no-cache 與 COOP／COEP 保留。 |
| Physical follow-up | 同一台 iPad Air 已安裝 App 冷啟直向進對弈 | 不需旋轉即可完整顯示；由產品負責人發布後確認。 |

## 10. Rollout and rollback

- 不設 feature gate；驗證完成後隨 production build 全量發布。
- 若共用 SVG sizing 造成其他棋盤頁重大退化，可回滾工作包 014 implementation commit；不需資料回復。
- 已安裝 PWA 若尚未取得新版，可完全關閉後重開；實體測試需從直向冷啟動開始。
- 若純 CSS／SVG 修正後實機問題仍存在，保留本版證據，另開小型 follow-up 評估 `pageshow` 後的 viewport stabilization，不在本工作包靜默加入 workaround。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 同一台 iPad Air 冷啟直向進對弈是否已不需旋轉？ | 產品負責人 | 正式部署後 | 等待發布後實機補測；不以 Chromium 模擬替代。 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-17
- 完成日期：2026-07-17
- 實際變更檔案：`src/ui/PlayPage.tsx`、`src/ui/Board.tsx`、`src/styles.css`、`docs/SDD.md`、`docs/sdd/README.md`、`docs/sdd/013-ipad-full-viewport-layout.md`、本文件。
- 與原規格的差異：無；SVG element 以 100% 寬高承接 wrapper，再由 `xMidYMid meet` 在 element viewport 內等比例置中棋盤內容，避免 auto size 再次參與 flex intrinsic sizing。

### Verification evidence

- `npm test`：25 個 test files／196 tests 全數通過。
- `npm run build`：通過；105 modules transformed、16 個 PWA precache entries，新 CSS 為 `index-CXIpcGPN.css`。保留既有 `tree.ts` dynamic import 與 500 kB chunk 提示，沒有新增編譯或 CSS 錯誤。
- 手動／實機檢查：內建瀏覽器先以 820×1180 冷進首頁 → 對弈設定 → 建局；SVG attributes 為 720×800／`viewBox="0 0 720 800"`／`xMidYMid meet`，wrapper `max-height: none`。首次直向 root 820×1180、page 820×1126、wrapper 796×950.5，棋盤可視內容、狀態、操作列與說明 bottom 均小於 page 1180，水平／垂直 overflow 都為 0；1180×820 橫向與回到 820×1180 後仍全部在 page 內，回直向幾何與首次直向一致。320×568、390×844、640×900 同樣無 overflow，控制列均可見。以 90 個 SVG 點擊格中的 square 27 → 36 實際走兵，引擎成功回覆黑方 `卒7進1(P7+1)`，證明等比例置中的點擊座標未偏移；console 無 error／warning。
- 已知限制：內建瀏覽器無法模擬 iPadOS standalone 首次 viewport 與 safe-area 時序；正式發布後仍需同一台實體 iPad Air 從直向冷啟補測，未補測前不宣稱已在實機確認修復。

### Git and release

- Commit：未建立。
- Push：未執行。
- Deploy：依 repository 預設在 implementation commit／push 後執行；尚未執行。
- 正式環境驗證：未執行。

只有在驗證完成後才能標為 Verified；只有在正式部署並驗證後才能標為 Released。
