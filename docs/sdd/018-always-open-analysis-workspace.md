# SDD 018：固定展開的解棋對照工作台

> Status：Released<br>
> Owner：Codex／產品負責人<br>
> Created：2026-07-19<br>
> Updated：2026-07-19<br>
> Target branch：`main`<br>
> Related decisions：`D-008`, `D-017`, `D-018`, `D-019`, `D-022`<br>
> Depends on：SDD 013、015、016<br>
> Supersedes：SDD 015 的 `015-D01`、`015-D02`、`015-FR03`（只取代直向三段面板，不取代雙欄與四分頁）

## 1. Context

SDD 015 已把解棋拆成棋盤區與分析區，但直向仍預設只有 250 px 的「棋盤優先」面板，並要求使用者在「棋盤優先／半開／分析優先」之間切換。2026-07-19 正式站以 820×1180 量測時，棋盤為 796×731.6 px，分析面板只有 250 px、內容區約 147 px；使用者必須先判斷要切哪個高度，才有足夠空間閱讀本著、曲線、關鍵著或棋譜。

產品負責人希望解棋頁不要再呈現會收合的分析抽屜，同時避免為了顯示分析而把上方棋盤縮得太小。本工作包保留 SDD 015 的棋盤／分析責任分離與寬橫向雙欄，只把直向改成單一、固定展開且內容獨立捲動的分析工作台。

## 2. Goals

- 進入解棋後直接得到足以閱讀的固定展開分析區，不必先選面板高度。
- 保留上方棋盤的穩定大尺寸；切換分頁或分析內容增長不得重新分配棋盤尺寸。
- 本著、曲線、關鍵著、棋譜四分頁固定可見，只有分頁內容在分析區內捲動。
- 保留 900 px 以上橫向的棋盤／分析雙欄與既有同步跳著能力。

## 3. Non-goals

- 不修改引擎、評分、標記門檻、棋譜、review 或 IndexedDB schema。
- 不加入拖曳分隔線、跨工作階段高度偏好或 JavaScript viewport workaround。
- 不重做一般復盤、即時引擎、接續新局或殘局自由分析版面。
- 不宣稱引擎判斷是協會裁判或棋力認證。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 018-D01 | 直向分析窗只保留一種固定展開高度，移除三段尺寸控制 | 解棋的主要任務是持續對照，不應要求使用者管理抽屜狀態 | Accepted |
| 018-D02 | 直向棋盤維持獨立尺寸責任，分析窗增加高度時由頁面垂直捲動承擔 | 寧可讓使用者自然捲動，也不把棋盤壓成難辨識的小圖 | Accepted |
| 018-D03 | 標題與四分頁不隨內容捲走，分頁內容使用獨立捲動區 | 切換本著、曲線、關鍵著與棋譜時始終知道目前所在位置 | Accepted |
| 018-D04 | 寬橫向延續左右雙欄，分析窗填滿可用欄高 | 既有 iPad 橫向與桌面對照方式有效，不需重做 | Accepted |
| 018-D05 | 本次功能版本升為 v0.10.0 | 每次正式功能發布都要讓 PWA 更新提示可辨識新版本 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 018-FR01 | 解棋工作台不得顯示「棋盤優先／半開／分析優先」控制 | Must | DOM 與鍵盤操作皆找不到分析面板大小 group |
| 018-FR02 | 直向分析窗固定展開，內容可在窗內獨立垂直捲動 | Must | 320、390、820 px 量測 dock／body 高度、overflow 與 scrollHeight |
| 018-FR03 | 本著、曲線、關鍵著與棋譜分頁持續顯示且可同步棋盤 | Must | 分頁切換與跳著回歸驗證 |
| 018-FR04 | 900 px 以上橫向維持左右雙欄 | Must | 1180×820、1366×1024 檢查 grid、兩欄與獨立捲動 |
| 018-NFR01 | 同一 viewport 的分析前／中／後及四分頁間，棋盤 bounding box 不變 | Must | 瀏覽器量測寬高與位置 |
| 018-NFR02 | 320～1366 px 無水平 overflow，iPad 冷進與直橫切換不需第二次旋轉修正 | Must | 代表 viewport matrix 與旋轉檢查 |
| 018-NFR03 | 不變更持久資料、隱私或離線契約 | Must | Git diff 無 schema／網路／備份變更，既有測試通過 |

## 6. UX flow

1. 使用者從「解棋」清單進入對局，棋盤在上方、固定展開的解棋工作台在下方；寬橫向則在右側。
2. 工作台標題持續顯示目前著摘要，下方固定顯示本著、曲線、關鍵著、棋譜四分頁。
3. 使用者不再選擇面板高度；分頁內容超過可視高度時，只捲動內容區。
4. 點曲線、關鍵著或棋譜後，棋盤跳到該局面，工作台尺寸與棋盤尺寸都不改變。
5. 尚未分析、分析中、完成、錯誤與重新分析狀態沿用既有文案與操作。一般復盤中的「💡 解棋」仍負責顯示或離開整個工作台，不作為工作台內的高度控制。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `src/ui/ReplayPage.tsx` | 移除 `AnalysisSize` state、選項、props 與尺寸控制 DOM | 沿用 `AnalysisTab`、`goto`、`GameReview` |
| `src/styles.css` | 單一固定展開高度、稍放寬直向棋盤上限、保留獨立 body scroll 與 landscape grid | 沿用 App shell、Board SVG 比例 |
| `package.json`、`package-lock.json` | 版本升為 v0.10.0 | 沿用 build-time 版本模組與 PWA prompt |
| `README.md`、`docs/SDD.md`、`docs/sdd/README.md` | 同步版本、產品決策、交接與驗證紀錄 | 本工作包 |

### 7.2 Data model and migration

- 無 Dexie schema、資料欄位或 migration。
- 移除的面板大小原本只存在 React view state，沒有保存於 IndexedDB 或備份。
- 既有棋譜與 review 原樣讀取，回滾不需資料處理。

### 7.3 Layout interface

- 直向 `analysis-dock` 使用單一 `clamp(360px, 46dvh, 500px)` 高度，不再由 mode class 改寫 CSS variable。
- `analysis-dock-header` 與 `analysis-tabs` 為固定列；`analysis-dock-body` 保持 `min-height: 0`、`overflow-y: auto`。
- 直向棋盤最大高度由 `min(62dvh, 760px)` 放寬為 `min(70dvh, 760px)`，寬度與 SVG 內在比例仍由容器決定。
- 900 px 以上橫向維持 grid；dock 高度改由 grid row 提供，棋盤與分析 body 各自捲動。

### 7.4 Offline, privacy, security, licensing

- 所有棋譜與分析仍在目前瀏覽器；不新增 API、追蹤、帳號或網路請求。
- 不接觸 PIN、Token、照片、校準資料或本機 IndexedDB 內容。
- 不增加第三方套件、模型、圖片或授權素材。

## 8. Acceptance criteria

- [x] 解棋頁沒有三段面板大小控制，分析工作台一進入就固定展開。
- [x] 四分頁固定可見，長內容只在分析 body 內捲動。
- [x] 直向棋盤維持可辨識大尺寸，分析前／中／後與分頁切換時幾何不變。
- [x] 曲線、關鍵著、棋譜仍能同步棋盤。
- [x] 320×568、390×844、820×1180、1180×820、1366×1024 無水平 overflow。
- [x] iPad 直→橫→直後版面恢復正確。
- [x] 不破壞 Master SDD 的本機優先、隱私、離線與資料契約。
- [x] `npm test` 與 `npm run build` 通過。
- [x] commit、push、Firebase deploy 與正式站驗證完成。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Baseline | 修改前 `npm test`、`npm run build` | 30 files／227 tests 與 v0.9.0 build 通過 |
| Unit／integration | 完整既有測試 | 棋譜、分析、版本、PWA、備份與殘局無回歸 |
| Build | v0.10.0 production build | TypeScript、Vite、PWA manifest 成功 |
| Browser／device | 320×568、390×844、820×1180 | 固定展開、body scroll、棋盤可辨識、overflow 0 |
| Browser／device | 1180×820、1366×1024 | 左右雙欄、獨立捲動、四分頁可用 |
| Lifecycle | 真實短局分析前／中／後 | 棋盤 bounding box 不變、進度與結果可讀 |
| Regression | 曲線鍵盤／點選、關鍵著、棋譜跳著、直橫旋轉 | 目前節點與棋盤同步，尺寸不漂移 |

## 10. Rollout and rollback

- 不設 feature gate；完成驗證後隨 v0.10.0 正式發布。
- 若直向固定高度造成阻斷，可回退本工作包 React／CSS implementation commit；沒有資料 migration 或資料回復需求。
- 既有等待中的 PWA 由 v0.8.0 起的確認式更新提示接手，不強制重載進行中的棋局。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 日後是否加入可拖曳的桌面分隔線？ | 產品負責人 | 實機使用固定展開版後 | 不阻擋；若需要另開 SDD，不恢復手機三段按鈕 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-19
- 完成日期：2026-07-19（程式與部署前驗證完成，待發布）。
- 實際變更檔案：`src/ui/ReplayPage.tsx`、`src/styles.css`、`package.json`、`package-lock.json`、`README.md`、`docs/SDD.md`、`docs/sdd/README.md`、本文件。
- 與原規格的差異：尚無。

### Verification evidence

- 修改前 `npm test`：2026-07-19 通過，30 個 test files／227 tests。
- 修改前 `npm run build`：2026-07-19 通過，v0.9.0 production build；只有既有單一 JS chunk 大於 500 kB 提示。
- 修改前正式站：820×1180 的棋盤 796×731.6 px；預設分析 dock 250 px、body 約 147 px，並顯示三段面板控制。
- 施工後 `npm test`：2026-07-19 通過，30 個 test files／227 tests。
- 施工後 `npm run build`：2026-07-19 通過，v0.10.0 production build、115 modules、PWA precache 16 entries；資產為 `index-CeGtwglx.js`／`index-aL9ISWDf.css`，只有既有單一 JS chunk 大於 500 kB 提示。
- DOM／響應式：三段控制與 `分析面板大小` group 數量皆為 0。320×568 的棋盤 296×328.9 px、dock 360 px、曲線 body 265／350 px；390×844 為棋盤 366×406.7 px、dock 388.2 px；820×1180 為棋盤 796×760 px、dock 500 px。各尺寸 root `clientWidth === scrollWidth`。
- 獨立捲動：320×568 曲線 body 由 `scrollTop 0 → 84.5` 時，頁面維持 `scrollTop 448`，證明長內容不再帶動整頁。
- 寬橫向／旋轉：1180×820 使用 grid，棋盤 621.3×540 px、dock 439.7×689.5 px；1366×1024 為棋盤 621.3×744 px、dock 439.7×893.5 px。820×1180 → 1180×820 → 820×1180 後直向尺寸精確恢復為 796×760／796×500 px，console error 0。
- 真實引擎生命週期：820×1180 的分析前／0/3 進行中／完成後，棋盤均為 796×760 px、dock 均為 796×500 px；曲線、關鍵著與棋譜切換也不改變寬高。
- 同步跳著：關鍵著把棋譜進度由 `-1` 帶到 `0`，棋譜第二著帶到 `1`；曲線與四分頁 ARIA selected／tabpanel 狀態正確。
- Production build：隔離的 `127.0.0.1:4173` 套用確認式 v0.9.0 → v0.10.0 更新後，320×568 與 iPad 直／橫／直尺寸、固定展開、無三段控制、root overflow 0、console error 0 均通過。
- 已知限制：同一台實體 iPad Air 仍由產品負責人在正式發布後補觸感確認。

### Git and release

- Commit：`f5baae8`（`feat: keep analysis workspace expanded`）。
- Push：2026-07-19 已推送 `main` 至 `origin`。
- Deploy：2026-07-19 已將 v0.10.0 production build 發布至 Firebase Hosting。
- 正式環境驗證：根網址、`sw.js`、`app-version.json` 均為 200；HTML／SW 為 `Cache-Control: no-cache, no-store, must-revalidate`，COOP `same-origin`、COEP `require-corp`；正式版本檔為 v0.10.0，資產為 `index-CeGtwglx.js`／`index-aL9ISWDf.css`。
- 正式更新流程：既有 v0.9.0 頁面顯示 v0.10.0 確認式提示，點「立即更新」後原有棋局仍在，設定頁顯示 v0.10.0，console error 0。
- 正式解棋流程：820×1180 棋盤 796×760 px、dock 796×500 px，三段控制數量 0；1180×820 旋轉後使用 grid、棋盤 621.3×540 px、dock 439.7×689.5 px，轉回直向精確恢復。曲線 tab 可直接切換且棋盤／dock 寬高不變，root overflow 0。

只有在驗證完成後才能標為 Verified；只有在正式部署並驗證後才能標為 Released。
