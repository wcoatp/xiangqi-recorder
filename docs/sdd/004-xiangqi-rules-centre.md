# SDD 004：象棋棋規中心與循環判定輔助

> Status：Verified<br>
> Owner：專案作者<br>
> Created：2026-07-17<br>
> Updated：2026-07-17<br>
> Target branch：`main`<br>
> Related decisions：`D-001`, `D-002`, `D-003`, `D-008`, `D-009`<br>
> Depends on：[中華民國象棋文化協會《中華民國象棋規則 113 年修訂版》](https://www.cccs.org.tw/Page?itemid=18&mid=35&IsShowRight=True)<br>
> Supersedes：無

## 1. Context

App 已能阻止不合法著法，並自動辨識將死與困斃；實體記譜也會提示相同局面重複，但目前只有「注意長打禁著」短句，無法協助棋友判斷勝、負、和及長將／長捉。

產品負責人於 2026-07-17 指定以上述協會 113 年修訂版為參考，把適用於 App 的一般勝負和與捉棋規則加入產品；摸子走子、離手為定、棋鐘操作與賽場紀律等純實體競賽規則不需要成為 App 判定功能。

協會規則的循環判決不是「盤面重複即和棋」：需先辨識雙方屬長將、長捉或未犯例，再比較嚴重程度。長捉另有根子、同類子、兵卒／將帥、分捉多子等例外，因此在沒有裁判級驗證前，不應由 App 自動宣判長捉。

## 2. Goals

- 提供本機可離線閱讀、台灣繁中的棋規中心，清楚區分 App 自動處理、需棋友確認及不適用規則。
- 讓棋友輸入紅黑雙方循環行為，依官方矩陣得到「和棋／紅負／黑負」判定輔助。
- 在實體記譜偵測到相同局面反覆或連續 100 著未吃子時，提供準確但不越權的提醒與棋規入口。
- 讓結束對局原因可記錄協議和、自然限著、循環不變、長將判負與長捉判負。

## 3. Non-goals

- 不實作摸子、離手、按鐘、遲到、服裝、通訊裝置或裁判犯規等實體賽場規則。
- 不宣稱 App 是協會裁判或正式賽事判決依據。
- 本階段不自動分類長捉，也不自動因重複盤面或 100 著未吃子結束棋局。
- 不新增後端、帳號、網路裁判或外部資料收集。
- 不逐字重製完整協會規則；App 提供產品情境摘要並連結官方全文。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 004-D01 | 首頁提供「棋規」固定入口，對局規則提醒也能直接進入 | 棋規應在需要前與需要時都容易找到 | Accepted |
| 004-D02 | 只自動判斷規則核心能確定的合法著法、將死與困斃 | 避免以不完整演算法誤判正式棋局 | Accepted |
| 004-D03 | 循環判定由使用者選擇雙方「長將／長捉／未犯例」，核心只套用官方比較矩陣 | 矩陣可確定，但長捉事實分類有大量例外 | Accepted |
| 004-D04 | 100 著未吃子與重複局面只提醒，不自動結束 | 正式規則仍有提出、審查與將軍著數等裁判條件 | Accepted |
| 004-D05 | 內容標明「依 113 年修訂版整理」並保留官方原文連結 | 方便追溯來源及未來版本更新 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 004-FR01 | 首頁可開啟棋規中心並返回原頁 | Must | 手機與鍵盤實際操作 |
| 004-FR02 | 棋規中心包含勝負、和棋、循環判決、長捉常見例外與不適用項目 | Must | 文案對照協會 113 年版 |
| 004-FR03 | 紅黑雙方各可選長將、長捉或未犯例，結果符合官方矩陣 | Must | 9 種組合單元測試 |
| 004-FR04 | 實體記譜相同局面出現至少三次時顯示中性提醒及棋規入口 | Must | 建立重複局面測試／瀏覽器操作 |
| 004-FR05 | 實體記譜連續 100 著未吃子時顯示自然限著審查提醒 | Must | 純函式單元測試 |
| 004-FR06 | 結束對局原因可保存自然限著、循環不變、長將與長捉判決 | Must | UI 與既有儲存流程測試 |
| 004-NFR01 | 棋規內容離線可用、不新增資料表或網路請求 | Must | build 內容與網路檢查 |
| 004-NFR02 | 文案不得把 App 描述成正式裁判，亦不得把重複盤面直接寫成和棋 | Must | 文案審查 |
| 004-NFR03 | 320、390、640 px 無水平溢出，選項可鍵盤操作 | Must | 瀏覽器檢查 |

## 6. UX flow

1. 首頁其他功能列新增「棋規」。
2. 棋規中心先說明版本與產品邊界，再依序呈現 App 自動處理、一般勝負和、循環盤面、長捉判斷重點與實體規則不適用範圍。
3. 循環判定小幫手預設雙方皆「未犯例」；使用者分別選擇紅黑行為後即時顯示判定與理由。
4. 實體記譜出現重複局面或自然限著門檻時，棋盤下方顯示提醒及「查看棋規」按鈕；返回後回到同一棋局。
5. 使用者仍由「結束對局」確認最終結果與原因，App 不擅自結束。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `src/core/adjudication.ts` | 循環比較矩陣、盤面出現次數與連續未吃子計數 | `board`, `fen`, `tree` |
| `src/core/adjudication.test.ts` | 9 種矩陣與計數邊界測試 | Vitest |
| `src/ui/RulesPage.tsx` | 棋規中心及互動判定小幫手 | React |
| `src/App.tsx` | 新增棋規 view 與來源頁返回資訊 | `RulesPage` |
| `src/ui/HomePage.tsx` | 首頁棋規入口與中國象棋 SVG 圖示 | App view |
| `src/ui/RecordPage.tsx` | 規則提醒、棋規入口、結束原因 | adjudication core |
| `src/styles.css` | 棋規頁與提醒的響應式樣式 | 現有 design tokens |

### 7.2 Data model and migration

- 不變更 Dexie schema。
- 最終結果沿用 `GameRow.result` 與 `resultReason`；只增加可選原因文案，不改舊資料。
- 棋規頁的判定選項只存在 React memory，不保存也不上傳。

### 7.3 Algorithms or interfaces

```ts
type CycleConduct = 'long-check' | 'long-chase' | 'none'
type CycleRuling = 'draw' | 'red-loses' | 'black-loses'

judgeCycle(red, black): CycleRuling
countCurrentPositionOccurrences(fens): number
countConsecutiveNonCapturePlies(initialFen, path): number
```

循環矩陣以 `長將 > 長捉 > 未犯例` 表示犯例嚴重度：雙方同級作和；等級不同時，較嚴重一方判負。這只在使用者已完成事實分類後套用，不負責判定某著是否構成捉。

未吃子計數從目前主線路徑向前累積；以前一局面的目的格是否有棋子判定該著為吃子。任何吃子都歸零。達 100 著只輸出審查提醒。

### 7.4 Offline, privacy, security, licensing

- 全部規則資料與演算法隨 App shell 打包，可離線使用。
- 不新增遙測或資料傳輸。
- 協會頁面只作規則來源連結；App 內容為必要摘要，不內嵌或逐字複製完整 PDF。
- 正式競賽仍以賽事章程及裁判判決為準。

## 8. Acceptance criteria

- [x] 首頁與重複／限著提醒皆能開啟棋規中心並正確返回。
- [x] 勝、負、和與長將／長捉摘要符合 113 年修訂版。
- [x] 9 種循環矩陣輸入全部得到正確結果。
- [x] 100 著未吃子計數遇吃子會歸零。
- [x] 重複盤面不會被 App 自動判和。
- [x] 結束對局可記錄新增的棋規原因。
- [x] 無 Dexie migration、無新增網路請求、無個資離開裝置。
- [x] `npm test` 通過。
- [x] `npm run build` 通過，沒有新增 warning／syntax error。
- [x] 320、390、640 px 與鍵盤流程完成檢查。
- [x] Master SDD、工作包索引與使用者文件同步更新。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit | 循環矩陣 3 × 3 | 同級和棋；長將優先判負；長捉對未犯例判負 |
| Unit | 盤面出現次數 | 只計輪走方等狀態相同的 position key |
| Unit | 連續未吃子計數 | 非吃子遞增，任何吃子歸零 |
| Browser | 首頁 → 棋規 → 判定小幫手 → 返回 | 不需網路、狀態與返回正確 |
| Browser | 記譜提醒 → 棋規 → 返回棋局 | 棋局仍存在且可繼續記錄 |
| Responsive | 320／390／640 px | 無水平捲動，控制項不截斷 |
| Regression | `npm test`, `npm run build` | 既有規則、記譜、校準與首頁不退化 |

## 10. Rollout and rollback

- 無 feature gate；棋規屬公開說明與既有記譜輔助。
- 回滾可移除新 view／入口與純函式，不影響任何 IndexedDB schema 或舊棋局。
- 若官方棋規更新，只需版本化文案與矩陣測試後重新發布。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 是否自動分類長捉？ | 產品負責人／未來棋規專家 | 另開後續 SDD 前 | 本階段不做；需裁判案例資料與專家校準 |
| 是否加入完整棋鐘與超時判定？ | 產品負責人 | 棋鐘工作包 | 本階段只保留手動結果原因 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-17。
- 完成日期：2026-07-17。
- 實際變更檔案：`src/core/adjudication.ts`、`src/core/adjudication.test.ts`、`src/ui/RulesPage.tsx`、`src/App.tsx`、`src/ui/HomePage.tsx`、`src/ui/RecordPage.tsx`、`src/styles.css`、`README.md`、`docs/SDD.md`、`docs/sdd/README.md` 與本文件。
- 與原規格的差異：無；長捉維持人工分類，App 只套用比較矩陣。

### Verification evidence

- `npm test`：通過；11 個 test files、90 tests，新增矩陣 9 組與重複／未吃子計數邊界測試。
- `npm run build`：通過；產出 `assets/index-Bi42IhUk.js`、`assets/index-BBVc1YQh.css`。只有既有 `tree.ts` 動態／靜態 import chunk warning，未新增錯誤。
- 手動／實機檢查：本機真實瀏覽器完成首頁入口、棋規返回、矩陣互動、結束原因切換；另匯入 8 著馬步循環棋譜，實際驗證「相同局面已出現 3 次」提醒、棋規入口及返回同一棋局。320／390／640 px 的 viewport、scroll width、卡片與三欄控制尺寸皆通過，無水平溢出。
- 已知限制：100 著提醒由單元測試覆蓋，未以 UI 實走 100 著；App 不自動分類長捉；正式賽事以裁判及該賽事附則為準。

### Git and release

- Commit：未建立。
- Push：未執行。
- Deploy：依 repository 預設在 implementation commit／push 後執行；尚未執行。
- 正式環境驗證：未執行。
