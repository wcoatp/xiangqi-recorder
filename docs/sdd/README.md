# SDD 施工工作包索引

本目錄保存每一項可獨立施工、驗收與交接的規格。整個 App 的長期原則與架構在 [Master SDD](../SDD.md)；這裡只記錄單項變更。

## 工作包狀態

| 狀態 | 意義 |
|---|---|
| Proposed | 已記錄想法，尚未核准施工。 |
| Accepted | 範圍與驗收條件已確認，可開始施工。 |
| In Progress | 正在施工，文件應同步反映目前決策。 |
| Implemented | 程式完成，但驗證尚未全部完成。 |
| Verified | 測試、build 與必要的實際流程檢查已通過。 |
| Released | 已明確部署並驗證正式環境。 |
| Deferred | 暫緩，保留原因與重新啟動條件。 |
| Superseded | 已被另一份 SDD 取代，需附新文件連結。 |

## 工作包

| ID | 文件 | 狀態 | 程式 commit | 正式部署 | 摘要 |
|---|---|---|---|---|---|
| 001 | [首頁品牌與視覺整理](001-home-visual-refresh.md) | Released | `1bf5e21` | 2026-07-16 / [正式站](https://xiangqi-recorder.web.app/) | 換成「帥」品牌、統一 SVG、三輸入等權、響應式與無障礙整理。 |
| 002 | [本機段級校準實驗室](002-local-rank-calibration-lab.md) | Released（Phase 1） | `dba28db` | 2026-07-16 / [正式站](https://xiangqi-recorder.web.app/) | PIN 隱藏入口、10 個固定錨點、本機 profile／棋局資料骨架與版本化匯出；後續 phase 尚未核准。 |
| 003 | [首頁 3D 中國漫畫風主題](003-home-3d-chinese-comic-theme.md) | Released | `8de002f` | 2026-07-16 / [正式站](https://xiangqi-recorder.web.app/) | 立體漫畫卡片、山景祥雲與棋盤紋理背景、現代中國配色。 |
| 004 | [象棋棋規中心與循環判定輔助](004-xiangqi-rules-centre.md) | Released | `1cf403f` | 2026-07-17 / [正式站](https://xiangqi-recorder.web.app/) | 113 年版勝負和摘要、循環判定矩陣、長捉例外與對局規則提醒。 |
| 005 | [全站導覽與台灣象棋資源中心](005-global-menu-and-taiwan-resource-centre.md) | Released | `405cdb2`, `bbe76df` | 2026-07-17 / [正式站](https://xiangqi-recorder.web.app/) | 全站漢堡抽屜、完整功能說明、台灣官方教學／棋規入口與標示查閱日的近期賽程。 |

新增工作包請複製 [TEMPLATE.md](TEMPLATE.md)，檔名使用 `NNN-kebab-case.md`。ID 一旦使用就不要重編，避免舊 commit 與討論失去指向。

## 標準施工流程

1. **建立規格**：先寫 Context、Goals、Non-goals、Requirements、Acceptance Criteria 與風險。
2. **取得確認**：沒有 Accepted 狀態，不把 Proposed 當成已授權需求。
3. **開始施工**：標成 In Progress，記錄影響檔案、資料 migration 與必要決策。
4. **同步更新**：若產品原則或架構改變，同時更新 `docs/SDD.md`。
5. **驗證**：跑相關測試、完整 `npm test`、`npm run build`，並做與風險相稱的實際操作檢查。
6. **記錄證據**：在工作包填入測試結果、已知限制與未執行項目。
7. **收尾 Git**：只 stage 本次檔案，commit 並 push；把 commit hash 寫回後續交接紀錄。
8. **預設發布**：已確認的功能／介面施工在 commit、push 後直接 deploy 並驗證正式站；當次明確要求不部署時才略過。成功後把狀態改為 Released。

## 交接最低資訊

每份已開始的工作包至少要讓下一位知道：

- 為什麼要做、明確不做什麼。
- 哪些決策已定案，哪些仍待確認。
- 目前做到哪裡、變更了哪些檔案與 schema。
- 如何重現、測試、回滾。
- 是否已 commit、push、deploy，以及對應證據。

不要把密碼、PIN 明文、API Token、未匿名棋手個資或本機資料樣本寫進 SDD。
