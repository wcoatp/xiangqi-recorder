# SDD 003：首頁 3D 中國漫畫風主題

> Status：Released<br>
> Owner：專案作者<br>
> Created：2026-07-16<br>
> Updated：2026-07-16<br>
> Target branch：`main`<br>
> Related decisions：`D-002`, `D-003`, `D-008`<br>
> Depends on：SDD 001 首頁品牌與視覺整理<br>
> Supersedes：無

## 1. Context

SDD 001 已修正中國象棋品牌、三輸入入口與首頁資訊層級，但目前卡片仍偏一般扁平工具介面，背景也較單調。使用者已確認進一步施工，希望整個首頁具有 3D 漫畫感、適量中國風與更豐富的背景層次。

## 2. Goals

- 主要與次要功能卡片具有清楚的立體邊緣、按壓回饋與漫畫式輪廓。
- 以朱紅、玉青、米金、墨色與山景／祥雲／棋盤紋理營造現代中國風。
- 背景更有層次，但不干擾標題、功能名稱與觸控辨識。
- 保留原有首頁功能、三種輸入入口、深色模式與窄螢幕支援。

## 3. Non-goals

- 不改動首頁以外頁面的完整視覺系統。
- 不新增下載字型、第三方圖片或執行期網路相依。
- 不改動導航、引擎、IndexedDB schema、棋譜或校準資料。
- 不把中國風做成擬真的古董／宮廷風，維持親切、現代、容易操作。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 003-D01 | 以 CSS 與內嵌 SVG 建立景深，不使用點陣背景圖。 | 保持離線、清晰與小體積。 | Accepted |
| 003-D02 | 卡片使用硬邊陰影、上緣高光與按壓位移。 | 形成可觸碰的 3D 漫畫感。 | Accepted |
| 003-D03 | 次要卡片採低飽和中國傳統配色分區。 | 增加辨識度，同時避免過度花俏。 | Accepted |
| 003-D04 | 背景裝飾全部標為非語意內容。 | 不增加螢幕閱讀器雜訊。 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 003-FR01 | 首頁主要與次要功能入口維持原有行為。 | Must | 實際開啟開始紀錄、對弈與其他入口。 |
| 003-FR02 | 語音、拍照、點棋盤保持等權呈現。 | Must | 三個輸入項目尺寸、位置與對比一致。 |
| 003-FR03 | 首頁視覺明確為中國象棋，不使用西洋棋圖案。 | Must | 檢查品牌、棋盤紋理與圖示。 |
| 003-NFR01 | 320、390、640 px 無水平溢出或文字遮擋。 | Must | 三種 viewport 視覺與尺寸檢查。 |
| 003-NFR02 | 支援深色模式、鍵盤 focus 與 reduced motion。 | Must | CSS media query 與互動檢查。 |
| 003-NFR03 | 不新增第三方資產與資料存取。 | Must | dependency、network 與 git diff 檢查。 |

## 6. UX flow

入口與導航不變。使用者進入首頁後先看到「帥」品牌與山景／祥雲背景，再看到立體朱紅色「開始紀錄」主卡片；下方四張卡片以不同低飽和色區分對弈、復盤、解棋與殘局。卡片 hover 會微幅抬升，觸控／點擊時會向下壓，鍵盤操作仍以 `focus-visible` 顯示清楚外框。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `src/ui/HomePage.tsx` | 新增純裝飾背景層與祥雲 SVG。 | React，無新套件。 |
| `src/styles.css` | 首頁場景、卡片立體層、配色與響應式。 | 現有 CSS variables。 |
| `docs/SDD.md` | 更新首頁視覺基準與施工基準。 | 本工作包。 |
| `docs/sdd/README.md` | 登記工作包與發布狀態。 | 本工作包。 |

### 7.2 Data model and migration

不修改資料模型、Dexie schema 或本機資料；不需要 migration。

### 7.3 Algorithms or interfaces

沒有新增演算法或公開介面。背景為 `aria-hidden` 的靜態裝飾，卡片互動仍使用原生 `button`。

### 7.4 Offline, privacy, security, licensing

- 不增加網路請求，所有視覺由既有程式與 CSS 產生。
- 沒有資料離開裝置，也不新增權限。
- 沒有新增第三方素材或授權依賴。

## 8. Acceptance criteria

- [x] 首頁在 320、390、640 px 可正常閱讀與操作。
- [x] 主要與次要卡片具有一致的 3D 漫畫輪廓及按壓回饋。
- [x] 背景可看見山景、日輪、祥雲與淡棋盤紋理，內容仍保持清楚。
- [x] 語音、拍照、點棋盤三路徑等權呈現。
- [x] 深色模式與 reduced motion 有對應處理。
- [x] `npm test` 通過。
- [x] `npm run build` 通過，沒有新增 warning／syntax error。
- [x] 正式站部署並完成 live verification。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit | `npm test` | 既有規則與資料測試全數通過。 |
| Build | `npm run build` | TypeScript 與 production bundle 成功。 |
| Browser | 320、390、640 px 首頁截圖與 overflow 檢查 | 無水平溢出、卡片與背景層次正常。 |
| Interaction | 開始紀錄、對弈、主要導航、focus | 對話框與入口維持原行為。 |
| Release | Firebase 正式站、headers、bundle | 新版可載入且必要 COOP／COEP 標頭存在。 |

## 10. Rollout and rollback

本工作包不設 feature gate；完成驗證後直接發布。若視覺造成可讀性或裝置相容問題，可 revert 單一 implementation commit；因無資料 migration，不影響使用者棋譜。

## 11. Open questions

目前沒有阻擋問題。發布後由使用者以實際裝置確認風格喜好，後續細節調整另記於本工作包或新增工作包。

## 12. Construction record

### Implementation

- 開始日期：2026-07-16
- 完成日期：2026-07-16（待發布）。
- 實際變更檔案：`src/ui/HomePage.tsx`、`src/styles.css`、`docs/SDD.md`、`docs/sdd/README.md`、本工作包。
- 與原規格的差異：目前無。

### Verification evidence

- `npm test`：7 個 test files、73 tests 全部通過。
- `npm run build`：成功；只有既有的 `tree.ts` 動態／靜態 import chunk 提示，沒有新增 warning 或 CSS syntax error。
- 手動／實機檢查：內建瀏覽器以固定 iframe viewport 檢查 320 × 568、390 × 844、640 × 900；皆無水平溢出，品牌、主卡、四張功能卡與背景裝飾正常。「開始紀錄」及「對弈」視窗均可開啟與取消。
- 已知限制：CSS 系統字型在不同平台的書法字形可能略有不同；深色模式以樣式與 build 驗證，尚未在多款實體手機逐一檢查。

### Git and release

- Commit：`8de002f`（`feat: add 3d Chinese comic home theme`）。
- Push：已推送 `main` 至 `origin`。
- Deploy：2026-07-16 21:43（Asia/Taipei）部署至 Firebase Hosting；正式網址 https://xiangqi-recorder.web.app/ 。
- 正式環境驗證：HTML 載入 `assets/index-B1CA1VKt.css` 與 `assets/index-BslRcJwo.js`；回應含 `Cross-Origin-Opener-Policy: same-origin` 與 `Cross-Origin-Embedder-Policy: require-corp`；首頁七個入口皆可辨識，「開始紀錄」視窗可開啟與取消，正式站截圖確認為新版 3D 中國漫畫風。

只有在驗證完成後才能標為 Verified；只有在正式部署並驗證後才能標為 Released。
