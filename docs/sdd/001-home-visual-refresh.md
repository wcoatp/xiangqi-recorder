# SDD 001：首頁品牌與視覺整理

> Status：Released<br>
> Created：2026-07-16<br>
> Updated：2026-07-16<br>
> Implementation commit：`1bf5e21`<br>
> Deploy：2026-07-16 21:10（Asia/Taipei）／https://xiangqi-recorder.web.app/<br>
> Related decisions：`D-002`, `D-003`, `D-008`

## 1. Context

舊首頁使用西洋棋 `♟️` 與平台相依的 emoji。這會讓使用者誤認產品類型，不同手機的圖示重量也不一致。首頁同時只寫「語音／點按」，沒有呈現拍照是同等重要的輸入方式。

## 2. Goals

- 第一眼清楚辨識為中國象棋 App。
- 以現有「帥」圖示統一 PWA 與首頁品牌。
- 讓語音、拍照、點棋盤三條主要路徑等權呈現。
- 改善卡片層級、台灣繁中標點、觸控與鍵盤狀態。
- 保持既有路由、資料、引擎與對局流程不變。

## 3. Non-goals

- 不修改引擎難度演算法。
- 不新增段級校準功能。
- 不修改 Dexie schema 或既有對局資料。
- 不修改 Firebase 專案與 Hosting 架構；發布沿用既有設定。
- 不全面重做記譜、復盤、設定等其他頁面。

## 4. Requirements

| ID | 需求 | 結果 |
|---|---|---|
| 001-FR01 | 首頁不得使用西洋棋品牌圖案。 | 使用 `/icons/icon.svg` 的「帥」。 |
| 001-FR02 | 功能入口使用一致、可縮放的圖示。 | 以內嵌 SVG 取代首頁 emoji。 |
| 001-FR03 | 開始紀錄為主要 CTA。 | 改為跨欄主卡片。 |
| 001-FR04 | 語音、拍照、點棋盤等權呈現。 | 主卡片以三個同尺寸項目顯示。 |
| 001-NFR01 | 320px 不得水平溢出。 | 已通過 layout 檢查。 |
| 001-NFR02 | 支援深色模式、focus-visible 與 reduced motion。 | 已補齊 theme variables 與 media queries。 |
| 001-NFR03 | 不改功能與資料行為。 | 只修改 `HomePage.tsx` 與 `styles.css`。 |

## 5. Implemented design

- Hero 改為「帥」圖示、品牌標籤、標題與短說明。
- 主功能卡片使用暖棕色；其他功能維持米色紙張與朱紅圖示。
- 對弈、復盤、解棋、殘局、設定、回饋改用同一套線條 SVG。
- 最近對局改為真正的 button，補強鍵盤操作與文字溢出處理。
- 對弈視窗移除可見的西洋棋尺度說明，只保留「相對階梯、未經協會認證」。
- 台灣繁中標點改用 `・`、`，`、`（ ）`、`／`。
- 補上 hover、active、focus-visible、窄螢幕與 reduced-motion 行為。

## 6. Changed files

- `src/ui/HomePage.tsx`
- `src/styles.css`

## 7. Verification evidence

- `npm test`：7 個 test files、73 tests 全部通過。
- `npm run build`：成功；只有既有的 `tree.ts` 動態／靜態 import chunk 提示，沒有新增 CSS syntax error。
- `git diff --check`：通過。
- 390 × 844：主要卡片、四個功能入口與次要按鈕正常。
- 320 × 568：`contentWidth === viewportWidth`，無水平溢出。
- 640 × 900：主要卡片 608px，次要卡片維持兩欄各 298px。
- 「開始紀錄」與「對弈」對話框已實際開啟與關閉。
- 自動化瀏覽器不提供 IndexedDB，因此出現 Dexie 測試環境警示；這不是本工作包新增的資料層錯誤，真實資料功能仍須在支援 IndexedDB 的瀏覽器驗證。
- Firebase Hosting deploy 成功；正式 HTML 載入 `assets/index-D7tcMw0h.js`。
- 正式 bundle 已確認包含「實體對局好幫手」、語音、拍照、點棋盤，且不含西洋棋 `♟️` 品牌字元。
- 正式站回應包含 `Cross-Origin-Opener-Policy: same-origin` 與 `Cross-Origin-Embedder-Policy: require-corp`。

## 8. Rollback

可直接 revert implementation commit `1bf5e21`。本工作包沒有資料 migration，回滾不會改動使用者棋譜。

## 9. Handoff

- 狀態是 Released；若裝置仍顯示舊首頁，先重新整理或重新開啟 PWA，讓 Service Worker 取得新版 shell。
- 若後續全面整理其他頁面，請另開 SDD，不要把全 App 重構塞回本工作包。
- 首頁 icon component 目前放在 `HomePage.tsx`；只有第二個頁面也需要同一套 icon 時，再抽成共用元件。
