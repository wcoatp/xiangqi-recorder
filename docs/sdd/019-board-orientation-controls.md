# SDD 019：棋盤座位方向與復盤視角控制

> Status：Verified<br>
> Owner：Codex／產品負責人<br>
> Created：2026-07-21<br>
> Updated：2026-07-21<br>
> Target branch：`main`<br>
> Related decisions：`D-001`, `D-008`, `D-017`, `D-018`, `D-019`, `D-023`<br>
> Depends on：SDD 008、013、014、018<br>
> Supersedes：無

## 1. Context

實體記譜目前只有設定頁的「面對面模式」開關：開啟後黑方棋子與上方控制列會旋轉 180°，適合裝置平放在兩位棋手之間；關閉則所有內容朝裝置持有者。實際記譜時若座位或裝置擺法改變，使用者必須離開棋局進設定才能切換，且畫面沒有直接說明目前是同向或對向。

復盤與解棋則固定紅方在下。棋友若想從黑方觀點檢討，或讓棋盤方向對照手邊實體棋盤，目前無法翻轉。棋盤元件既有 `bottom` 座標映射已能同步處理棋子、標記、箭頭與點擊層，因此本輪應把方向做成純顯示／輸入視角，而不是改寫 FEN、棋譜樹或著法座標。

產品負責人已於 2026-07-21 確認同一輪施工：記譜頁可即時切換「同向／對向」，復盤與解棋可切換「紅方在下／黑方在下」。人機對弈仍由使用者執棋方自動朝下。

## 2. Goals

- 記譜進行中可直接切換同向／對向，不需離開棋局，並立即同步黑方棋子與控制列方向。
- 復盤與解棋可直接切換紅方／黑方在下，棋子、上一著、分析箭頭與編輯點棋座標保持一致。
- 兩項選擇保存於目前瀏覽器；重開對應頁面後沿用。
- 在手機、iPad 直橫式與寬桌面維持大棋盤、可觸控與無水平 overflow。

## 3. Non-goals

- 不修改棋譜、FEN、著法、引擎評分、殘局題目或對局來源快照。
- 不讓人機對弈手動翻成對手在下；人機頁仍自動讓使用者執棋方在下。
- 不改動完整備份 schema v2；復盤視角是裝置 UI 偏好，不加入既有五項可攜偏好。
- 不新增帳號、後端、雲端同步、裝置感測或自動判斷座位方向。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 019-D01 | 「同向／對向」只控制實體記譜的座位閱讀方向 | 同一盤仍固定紅方在畫面下方；對向只讓黑方棋子與控制列轉向對座棋手 | Accepted |
| 019-D02 | 「紅方在下／黑方在下」只控制復盤與解棋的整盤視角 | 觀點切換不得產生新著法、變更目前節點或重算分析 | Accepted |
| 019-D03 | 翻轉沿用 `Board.bottom` 的顯示與點擊座標映射，不轉換資料 | 單一座標來源可避免顯示位置與點擊格不一致 | Accepted |
| 019-D04 | 記譜方向沿用既有 `tabletop`；復盤新增本機 `replayBottom` 設定 | 既有使用者選擇不中斷，兩種概念也不互相污染 | Accepted |
| 019-D05 | `replayBottom` 不加入完整備份 v2 的五項 allowlist | 維持 SDD 008 的已發布外部格式；視角可在每台裝置自行選擇 | Accepted |
| 019-D06 | 人機對弈維持使用者執棋方自動在下 | 對弈互動需要穩定玩家視角，與復盤檢討視角不同 | Accepted |
| 019-D07 | 本次功能版本升為 v0.11.0 | PWA 更新提示需辨識新的使用者功能版本 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 019-FR01 | 記譜棋盤旁提供「同向／對向」二選一，當局立即生效 | Must | 切換後黑方棋子與控制列旋轉狀態即時改變，棋譜節點不變 |
| 019-FR02 | 復盤／解棋提供「紅方在下／黑方在下」二選一，當頁立即生效 | Must | 量測代表棋子位置，切換後相對棋盤旋轉 180°，進度與 FEN 不變 |
| 019-FR03 | 編輯變着時兩個視角都能點到正確邏輯格 | Must | 分別完成合法著法，所建節點的 from／to 與畫面選取一致 |
| 019-FR04 | 方向選擇保存於目前瀏覽器並在重開頁面後沿用 | Must | 切換、離開／重進與 reload 驗證設定值 |
| 019-FR05 | 設定頁清楚說明記譜座位方向及復盤視角的差異 | Should | 台灣繁中、無 Elo／認證暗示，控制具有可讀 label |
| 019-NFR01 | 翻轉不得變更 FEN、棋譜樹、目前節點、分析資料或時間軸 | Must | 切換前後資料與 UI 狀態比較 |
| 019-NFR02 | 320～1366 px 無水平 overflow，觸控目標與 focus ring 可用 | Must | 代表 viewport matrix、鍵盤與點擊測試 |
| 019-NFR03 | 不新增網路請求、Dexie schema migration 或備份格式變更 | Must | Git diff、既有備份測試與正式站網路行為檢查 |

## 6. UX flow

### 6.1 實體記譜

1. 棋盤附近固定顯示「座位方向」控制；目前選項以選中底色與 `aria-pressed` 表示。
2. 「同向」代表雙方從同一裝置方向閱讀；黑方棋子與控制列不旋轉。
3. 「對向」代表裝置平放在雙方之間；黑方棋子與控制列旋轉 180°。
4. 使用者在任何著數切換都不取消目前棋局、選取格、聆聽狀態或照片流程，也不新增棋步。

### 6.2 復盤與解棋

1. 棋盤區顯示「觀看方向」控制，提供「紅方在下」與「黑方在下」。
2. 切換時同一局面原地翻轉；上一著框、分析箭頭、選取與合法目標一起映射。
3. 播放、時間軸、四個分析分頁、目前節點與編輯模式保持原狀。
4. 下次進入任一復盤／解棋沿用此裝置最後選擇。

### 6.3 人機對弈

- 不顯示本輪控制；沿用 `bottom={playerSide}`，讓使用者執棋方固定在下。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `src/store/db.ts` | 新增、驗證並載入 `replayBottom` 本機設定 | 現有 `settings` key/value table；不升 Dexie version |
| `src/ui/Board.tsx` | 為 90 格透明點擊層加入穩定 `data-square` 驗收識別 | 不改 `X/Y` 座標或點擊行為 |
| `src/ui/BoardOrientationControl.tsx` | 共用可存取的二選一方向控制 | React；無第三方套件 |
| `src/ui/RecordPage.tsx` | 在棋盤旁切換 `tabletop` | `AppContext.updateSettings`、既有 player-zone flip |
| `src/ui/ReplayPage.tsx` | 將 `settings.replayBottom` 傳入 `Board.bottom` | 既有 Board 座標映射與分析工作台 |
| `src/ui/SettingsPage.tsx` | 讓兩種方向偏好的用途可辨識 | App settings |
| `src/styles.css` | 緊湊 segmented control、響應式與深色模式 | 既有中國風色票 |
| `src/store/db.test.ts` | 設定預設、有效值與外部異常值正規化 | Vitest 純函式測試 |
| `package*.json`、README、SDD | v0.11.0 與交接／驗證紀錄 | 單一版本來源、工作包索引 |

### 7.2 Data model and migration

- `settings` 已是通用 `key`／`value` store；新增 `replayBottom: "red" | "black"` 不需變更 Dexie schema 或 migration。
- 舊瀏覽器沒有此 key 時回退 `"red"`，維持目前外觀。
- 非 `red`／`black` 的外部或舊值一律回退預設，不讓未知字串進入棋盤座標映射。
- `tabletop` 仍是完整備份 v2 的既有可攜偏好；`replayBottom` 明確排除，匯入舊備份不得覆寫本機復盤視角。
- 回滾舊版時多出的 settings row 會被忽略，不會造成資料遺失。

### 7.3 Algorithms or interfaces

- `Board.bottom` 保持邏輯座標不變：紅方在下時 `X(f)=f`、`Y(r)=9-r`；黑方在下時 `X(f)=8-f`、`Y(r)=r`。
- 棋子、宮線、星位、上一著、選取、目標、將軍圈、箭頭與 90 格透明點擊層共用同一 `X/Y` 映射。
- `tabletop` 只在 `piece.side !== bottom` 時旋轉棋子字形；記譜固定 `bottom="red"`，因此只影響黑方。
- 控制使用 native button、`role="group"`、群組 label 與 `aria-pressed`，不依賴顏色單獨傳達狀態。

### 7.4 Offline, privacy, security, licensing

- 方向切換與保存完全在目前瀏覽器；不新增 API、追蹤、帳號或網路請求。
- 不接觸 PIN、Token、照片、棋手資料或段級校準資料。
- 不增加套件、素材、模型或授權依賴。

## 8. Acceptance criteria

- [x] 記譜中可即時切換同向／對向，黑方閱讀方向正確。
- [x] 復盤與解棋可即時切換紅／黑方在下，所有疊加層同步。
- [x] 翻轉後點棋與編輯變着仍落在正確邏輯格。
- [x] 兩項選擇在本機持久化；舊資料與異常值安全回退。
- [x] 人機對弈仍自動讓使用者執棋方在下。
- [x] 不改完整備份 v2 schema，既有匯出入測試通過。
- [x] 320×568、390×844、820×1180、1180×820、1366×1024 無水平 overflow。
- [x] `npm test` 與 `npm run build` 通過。
- [ ] 文件、版本、commit、push、Firebase deploy 與正式站驗證完成。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Baseline | 修改前 `npm test`、`npm run build` | 30 files／227 tests 與 v0.10.0 build 通過 |
| Unit | `normalizeAppSettings` 的預設、red／black 與異常值 | 舊資料預設紅方在下，只有允許值可載入 |
| Integration | 完整既有備份、棋譜、分析與 PWA 測試 | 備份 exact schema 仍只有五項偏好，無回歸 |
| Browser | 記譜同向／對向與 reload | 翻轉立即生效並保存，不改著數 |
| Browser | 復盤紅／黑方在下、播放與編輯點棋 | 棋盤 180° 映射，進度／節點穩定，兩方向點棋正確 |
| Browser／device | 320×568、390×844、820×1180、1180×820、1366×1024 | 無水平 overflow，iPad 直橫切換與分析工作台可用 |
| Regression | 人機執紅／執黑棋盤 | `bottom` 仍等於 `playerSide`，本輪設定不介入 |

## 10. Rollout and rollback

- 不設 feature gate；完成驗證後隨 v0.11.0 正式發布。
- 若控制造成阻斷，可回退本工作包 UI／setting change；沒有 Dexie schema migration，舊版會忽略 `replayBottom` row。
- 記譜與復盤偏好都可由 UI 恢復預設；不需修改任何棋局資料。
- 既有確認式 PWA 更新提示負責讓使用者選擇新版套用時機，不強制重載進行中的棋局。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 殘局自由分析日後是否也要保存獨立紅／黑視角？ | 產品負責人 | 實際使用本輪控制後 | 不阻擋；殘局工作台另開 SDD，避免混用復盤偏好 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-21
- 完成日期：2026-07-21（程式與部署前驗證完成，待發布）。
- 實際變更檔案：`src/store/db.ts`、`src/store/db.test.ts`、`src/ui/Board.tsx`、`src/ui/BoardOrientationControl.tsx`、`src/ui/RecordPage.tsx`、`src/ui/ReplayPage.tsx`、`src/ui/SettingsPage.tsx`、`src/styles.css`、`package.json`、`package-lock.json`、`README.md`、`docs/SDD.md`、`docs/sdd/README.md`、本文件。
- 與原規格的差異：為了讓瀏覽器直接驗證翻轉後的邏輯格，90 格點擊層增加不影響執行的 `data-square`；復盤控制在 580 px 以下獨占標題列第二行，避免 521～580 px 分割視窗把棋局名稱壓成逐字換行。

### Verification evidence

- 修改前 `npm test`：2026-07-21 通過，30 個 test files／227 tests。
- 修改前 `npm run build`：2026-07-21 通過，v0.10.0 production build、115 modules、PWA precache 16 entries；只有既有單一 JS chunk 大於 500 kB 提示。
- 設定／備份定向測試：`src/store/db.test.ts`、`backup.test.ts`、`backup.integration.test.ts` 共 3 files／28 tests 通過；缺值回退紅方、red／black 有效值與異常值回退通過，backup v2 exact schema 仍只有五項偏好。
- 施工後 `npm test`：2026-07-21 通過，31 個 test files／231 tests。
- 施工後 `npm run build`：2026-07-21 通過，v0.11.0 production build、116 modules、PWA precache 16 entries；資產為 `index-BMBe3jr8.js`／`index-BtskPEkk.css`，只有既有單一 JS chunk 大於 500 kB 提示。
- 記譜互動：同向時黑方 player-zone transform 為 `none`、旋轉棋子 0；對向時為 180° matrix、旋轉棋子 16。兩模式分別以透明格 `27→36`、`54→45` 完成「兵九進一／卒1進1」，上一著標記與著數正確。
- 復盤翻轉：1366×1024 從紅方在下切黑方在下時，帥／將中心 Y 由 `801.9／156.7` 精確交換為 `156.7／801.9`；棋盤保持 1076×716.8 px、時間軸保持 `-1`、棋子數保持 32。
- 復盤編輯：黑方視角 `29→38`、紅方視角 `31→40` 都建立合法第一著，選取圈歸零、時間軸由 `-1` 到 `0`；證明顯示與點擊共用邏輯座標。
- 本機持久化：reload 後設定頁仍為記譜「對向」與復盤「黑方在下」，重新進復盤也維持黑方在下；驗收建立的本機測試棋局完成後已刪除。
- 響應式：記譜與復盤／解棋在 320×568、390×844、820×1180、1180×820、1366×1024 的 root overflow 均為 0；復盤 521、540、560、580 px 使用 92.5 px 雙行 topbar，590 px 回單行且全部無水平 overflow。
- iPad 解棋：820×1180 翻轉前後棋盤均為 796×760 px、dock 均為 796×500 px，時間軸、選中「本著」與 overflow 均不變；820×1180 → 1180×820 → 820×1180 後尺寸精確恢復，橫向維持 grid 雙欄。
- 人機回歸：既有「本機導覽測試」執黑局中將中心位於下方、帥位於上方，且方向控制數量為 0，證明仍沿用 `bottom={playerSide}`。
- 視覺／無障礙：820×1180 實際截圖確認方向 pills、選中狀態、棋盤與分析工作台不重疊；DOM 暴露「座位方向／觀看方向」group、文字按鈕與 `aria-pressed`，console error 0。
- Production preview：`127.0.0.1:4173` 既有 v0.10.0 shell 正確顯示「新版 v0.11.0」，點「立即更新」後回首頁；設定頁顯示 v0.11.0 與兩項新方向設定，記譜同向切換後 black-zone／棋子旋轉歸零、overflow 0、console error 0，驗收測試棋局已清理。
- 已知限制：同一台實體 iPad Air 的 standalone 觸感仍由產品負責人在正式發布後補確認；自動化已覆蓋相同 CSS viewport 的冷載、直橫切換與點棋。

### Git and release

- Commit：未建立。
- Push：未執行。
- Deploy：依 repository 預設在 implementation commit／push 後執行；尚未執行。
- 正式環境驗證：未執行。

只有在驗證完成後才能標為 Verified；只有在正式部署並驗證後才能標為 Released。
