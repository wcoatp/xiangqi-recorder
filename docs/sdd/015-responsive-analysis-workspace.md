# SDD 015：響應式解棋工作台

> Status：Released<br>
> Owner：Codex／產品負責人<br>
> Created：2026-07-18<br>
> Updated：2026-07-18<br>
> Target branch：`main`<br>
> Related decisions：`D-008`, `D-017`, `D-018`, `D-019`<br>
> Depends on：SDD 006、013、014<br>
> Supersedes：無

## 1. Context

目前復盤與解棋共用單一直向 flex 欄：棋盤、播放工具、分析內容與棋譜由上而下排列，棋盤容器還有 `52vh` 上限。尚未產生分析結果時，在 820×1180 直向視窗量得棋盤外框約 796×614 px；完成分析後新增評分曲線、統計、關鍵著與本著判斷，這些內容會參與同一欄的高度分配，因此棋盤可能被壓縮，使用者無法穩定對照局面。

本工作包把復盤頁整理成「棋盤區」與「分析區」兩個有明確尺寸責任的窗格。目標不是增加棋力功能，而是讓現有本機引擎結果在手機與 iPad 直／橫向都能邊看棋盤邊閱讀。

## 2. Goals

- 分析內容從空白、進行中到完成時，不改變同一面板模式下的棋盤尺寸。
- 直向提供棋盤優先、半開、分析優先三種固定面板高度。
- 900 px 以上橫向採棋盤／分析左右雙欄，兩側可各自使用可用高度。
- 將本著、曲線、關鍵著、棋譜分頁，並保留點選後同步跳到對應局面的能力。

## 3. Non-goals

- 不修改分析引擎、搜尋強度、評分算法或著法標記門檻。
- 不修改棋譜、review、IndexedDB、匯出入或備份格式。
- 第一版不加入自由拖曳分隔線、跨工作階段記憶面板大小或 URL 路由。
- 不宣稱分析結果是協會裁判或棋力認證。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 015-D01 | 直向預設「棋盤優先」，另可切「半開」與「分析優先」 | 初次進入先保住對照棋盤，同時允許閱讀較長內容 | Accepted |
| 015-D02 | 第一版使用三段固定高度，不做拖曳 | 觸控可預期、鍵盤可操作，也避免 iPad viewport 時序問題 | Accepted |
| 015-D03 | 只有 900 px 以上且橫向才使用左右雙欄 | 避免 iPad 直向被硬拆成兩個過窄欄位 | Accepted |
| 015-D04 | 分析分頁為「本著／曲線／關鍵著／棋譜」 | 將高密度資訊分組，減少長欄同時擠壓畫面 | Accepted |
| 015-D05 | 面板大小只屬 view state | 本次不增加資料 migration 或備份契約 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 015-FR01 | 開啟解棋後顯示目前著摘要與四個分析分頁 | Must | 空白、分析中、完成及根節點皆有可理解文案 |
| 015-FR02 | 曲線、關鍵著與棋譜點選可更新棋盤局面 | Must | 逐一點選並確認目前節點改變 |
| 015-FR03 | 直向可切三種分析面板大小 | Must | 320、390、820 px 直向無水平 overflow，控制可觸控／鍵盤操作 |
| 015-FR04 | 寬橫向使用左右雙欄且分析區獨立捲動 | Must | 1180×820 與 1366×1024 檢查 grid 與 scroll container |
| 015-NFR01 | 同一面板模式下，分析前後棋盤幾何尺寸不變 | Must | 瀏覽器量測分析前、分析中、分析後的棋盤 bounding box |
| 015-NFR02 | 不變更任何持久資料契約 | Must | Git diff 無 store/schema/export 變更，既有測試通過 |

## 6. UX flow

1. 使用者從對局清單進入「解棋」，棋盤仍是主要焦點。
2. 開啟「解棋分析」後，直向畫面在棋盤下方顯示預設棋盤優先面板；橫向寬螢幕在右側顯示分析窗格。
3. 面板標題持續顯示目前著數、行棋方、著法與標記；尚未分析時顯示「尚未分析」，分析中顯示進度。
4. 「本著」負責啟動／取消／重跑與目前著判斷；「曲線」顯示評分走勢與雙方精準度；「關鍵著」列出主要失誤；「棋譜」列出完整著法。
5. 點曲線、關鍵著或棋譜後，棋盤與目前著摘要同步更新。分析失敗時留在本著頁顯示錯誤與可重試操作。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `src/ui/ReplayPage.tsx` | 工作台結構、分頁、面板尺寸 view state、分析內容拆分 | 沿用 `GameReview`、`MoveJudgment`、現有 `goto` |
| `src/styles.css` | 直向固定高度、寬橫向 grid、獨立 scroll 與響應式控制 | 沿用 App shell 與 Board 比例契約 |
| `docs/SDD.md`、`docs/sdd/README.md` | 記錄產品決策與施工狀態 | 本工作包 |

### 7.2 Data model and migration

- 無 Dexie schema、資料欄位或 migration。
- 分頁與面板大小是 React view state，重新進頁時回到預設值。
- 現有 review 與棋譜資料只讀取、不改寫格式。

### 7.3 Layout interface

- `replay-workspace` 負責棋盤窗格與分析窗格的排列。
- 直向分析窗格外層高度由三個離散 mode class 決定；內容層使用 `overflow-y: auto`。
- 900 px 以上橫向改為 grid，棋盤與分析各自 `min-height: 0`；尺寸按鈕不顯示，分析窗格使用可用列高。
- 棋盤不再以 `52vh` inline style 限高；其尺寸由棋盤窗格的實際可用空間與既有 SVG aspect ratio 決定。

### 7.4 Offline, privacy, security, licensing

- 所有分析仍由既有本機引擎執行，不新增網路請求。
- 不上傳棋譜或分析結果，不增加權限、PIN、第三方套件或授權來源。

## 8. Acceptance criteria

- [x] 使用者能在直向三種模式與寬橫向雙欄中對照棋盤與分析。
- [x] 分析內容增加不會改變同一模式的棋盤尺寸。
- [x] 本著、曲線、關鍵著與棋譜分頁的空白／進行中／完成狀態清楚。
- [x] 曲線、關鍵著、棋譜都能把棋盤帶到對應一步。
- [x] 320、390、820、1180、1366 px 代表尺寸無水平 overflow。
- [x] 不破壞 Master SDD 的本機優先與資料界線。
- [x] `npm test` 通過。
- [x] `npm run build` 通過，沒有新增 warning／syntax error。
- [x] commit、push、Firebase deploy 與正式站驗證完成。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit | 執行既有完整測試 | 既有 25 個測試檔全部通過 |
| Build | production build | TypeScript 與 Vite build 成功 |
| Browser／device | 320×568、390×844、820×1180 直向 | 三種面板可用、無水平 overflow、棋盤穩定 |
| Browser／device | 1180×820、1366×1024 橫向 | 左右雙欄、分析獨立捲動、尺寸控制隱藏 |
| Lifecycle | 建立隔離的短棋局並執行分析 | 分析前／中／後同一模式棋盤 bounding box 不變 |
| Regression | 點曲線、關鍵著、棋譜與接續功能 | `goto` 與既有復盤／接續入口維持可用 |

## 10. Rollout and rollback

- 不使用 feature gate；完成驗證後隨正式 web build 發布。
- 若版面出現阻斷，可回退本工作包的 React／CSS commit；沒有資料 migration 或資料回復需求。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 是否日後加入可拖曳分隔線與記憶面板偏好？ | 產品負責人 | 實機使用第一版後 | 不阻擋；另開工作包評估 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-18
- 完成日期：2026-07-18（程式與本機驗證完成，待發布）。
- 實際變更檔案：`src/ui/ReplayPage.tsx`、`src/styles.css`、`docs/SDD.md`、`docs/sdd/README.md`、本文件。
- 與原規格的差異：曲線另補左右方向鍵跳轉；320 px 控制列縮排以消除 7 px 的頁內水平 overflow，均屬原驗收範圍。

### Verification evidence

- `npm test`：2026-07-18 通過，25 個 test files／196 tests。
- `npm run build`：2026-07-18 通過，TypeScript 與 Vite production build 完成；只有既有的 `tree.ts` dynamic/static import 與 500 kB chunk 提示。
- 手動／瀏覽器檢查：本機真實引擎 3 局面分析完成。1180×820 下分析前／中／後棋盤均為 621.328×540 px，分析窗格均為 439.664×689.5 px；曲線方向鍵、關鍵著與棋譜分別驗證同步到正確 ply。
- 響應式證據：820×1180 三段面板為 250／500／760 px，棋盤皆維持 796×731.594 px；320×568、390×844、820×1180、1180×820、1366×1024 的 root／page 水平 overflow 均為 0。320 px 棋盤優先模式的分析 body 為 88 px 可視／177 px 內容、`overflow-y: auto`，證明內容改由局部捲動承擔。
- 冷進／旋轉：820×1180 冷進 `scrollTop=0`、棋盤頂端 118.5 px；旋轉至 1180×820 使用 grid，轉回直向恢復 flex、尺寸與 overflow 仍正確。
- 正式站：根網址與 `sw.js` 回應 200、`Cache-Control: no-cache, no-store, must-revalidate`、COOP `same-origin`、COEP `require-corp`；正式資產為 `index-CnMSfkr3.js`／`index-CuGbADa2.css`。
- 正式流程：820×1180 冷進為 flex，棋盤 796×731.594 px、compact 面板 796×250 px；1180×820 旋轉為 624.328／439.664 px grid，棋盤 621.328×540 px、分析面板 439.664×689.5 px，兩者 root／page overflow 皆為 0。
- 已知限制：既有受舊 Service Worker 控制的已開啟分頁可能先顯示上一版 precache；新 SW 接管後重新載入即取得上述新資產。同一台實體 iPad Air 的觸感仍需產品負責人補驗。

### Git and release

- Commit：`2d344b2`（`feat: add responsive analysis workspace`）。
- Push：2026-07-18 已推送 `main` 至 `origin`。
- Deploy：2026-07-18 已發布至 Firebase Hosting。
- 正式環境驗證：2026-07-18 已驗證 [正式站](https://xiangqi-recorder.web.app/) headers、Service Worker、新資產、iPad 直／橫向工作台與 overflow。

只有在驗證完成後才能標為 Verified；只有在正式部署並驗證後才能標為 Released。
