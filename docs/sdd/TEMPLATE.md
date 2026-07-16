# SDD NNN：功能名稱

> Status：Proposed<br>
> Owner：TBD<br>
> Created：YYYY-MM-DD<br>
> Updated：YYYY-MM-DD<br>
> Target branch：TBD<br>
> Related decisions：`D-xxx`<br>
> Depends on：無<br>
> Supersedes：無

## 1. Context

說明目前痛點、使用情境、證據與為什麼現在要做。不要直接從解法開始。

## 2. Goals

- 可驗證的目標 1。
- 可驗證的目標 2。

## 3. Non-goals

- 本次明確不做的事項。
- 需要另開 SDD 的延伸事項。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| NNN-D01 |  |  | Accepted／Open |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| NNN-FR01 |  | Must |  |
| NNN-NFR01 |  | Must |  |

## 6. UX flow

描述入口、主要步驟、空狀態、錯誤狀態、返回／取消與無障礙行為。必要時附最小流程圖，不要用視覺稿取代文字規格。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
|  |  |  |

### 7.2 Data model and migration

- 新增／修改的 Dexie schema。
- schema version 與 migration。
- 舊資料、重複匯入、回滾與資料遺失風險。

### 7.3 Algorithms or interfaces

記錄輸入、輸出、錯誤、版本化方式與可重現條件。若使用亂數，必須定義 seed 與記錄策略。

### 7.4 Offline, privacy, security, licensing

- 哪些步驟需要網路。
- 是否有資料離開裝置。
- 權限、PIN／Token 的真實安全界線。
- 第三方套件、模型、資料與授權來源。

## 8. Acceptance criteria

- [ ] 使用者可完成主要 happy path。
- [ ] 空狀態與失敗狀態有清楚提示。
- [ ] 不破壞 Master SDD 的產品界線。
- [ ] 資料 migration／匯出入有測試。
- [ ] `npm test` 通過。
- [ ] `npm run build` 通過，沒有新增 warning／syntax error。
- [ ] 相關手機尺寸與實際瀏覽器能力完成檢查。
- [ ] 文件與使用者文案同步更新。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit |  |  |
| Integration |  |  |
| Browser／device |  |  |
| Regression |  |  |

## 10. Rollout and rollback

- Feature gate／隱藏入口。
- 分階段啟用方式。
- 失敗時如何停用或還原。
- 正式資料是否需要備份。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
|  |  |  |  |

## 12. Construction record

### Implementation

- 開始日期：
- 完成日期：
- 實際變更檔案：
- 與原規格的差異：

### Verification evidence

- `npm test`：未執行。
- `npm run build`：未執行。
- 手動／實機檢查：未執行。
- 已知限制：

### Git and release

- Commit：未建立。
- Push：未執行。
- Deploy：未核准／未執行。
- 正式環境驗證：未執行。

只有在驗證完成後才能標為 Verified；只有在正式部署並驗證後才能標為 Released。
