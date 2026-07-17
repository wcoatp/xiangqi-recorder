# SDD 006：從復盤局面接續記錄或對弈

> Status：Verified<br>
> Owner：專案作者<br>
> Created：2026-07-17<br>
> Updated：2026-07-17<br>
> Target branch：`main`<br>
> Related decisions：`D-001`, `D-002`, `D-008`, `D-009`, `D-011`<br>
> Depends on：既有復盤節點、實體記譜及人機對弈流程<br>
> Supersedes：無

## 1. Context

產品負責人先前提出：能否在復盤紀錄中點選任一步，直接把該局面帶入「開始紀錄」或「對弈」繼續下棋。2026-07-17 已再次授權繼續後續施工。

現行 `ReplayPage` 能精確選到主線或變著節點，但 `RecordPage`、`PlayPage` 載入既有 `gameId` 時都會移到該棋譜主線末端，且悔棋會刪除目前節點。直接把來源棋局交給兩頁會修改原棋譜，也會把來源棋手、舊時間戳與後續引擎著法混成一局。

本工作包採「從此局面建立獨立新局」：來源棋譜保持不變；新局以選中節點的 FEN 為起始盤面、空白棋譜樹與新的開始時間，並保存可跨備份閱讀的來源快照。

## 2. Goals

- 從復盤目前選中的開局、主線或變著局面建立一筆獨立棋局。
- 同一入口可選擇實體記譜或人機對弈，建立後沿用既有完整流程。
- 保存來源棋局、節點、第幾著、雙方姓名與起始局面的自含快照。
- 明確告知新局的計著、重複局面與自然限著統計會重新開始。
- 保持本機優先，不新增後端、網路請求或 Dexie migration。

## 3. Non-goals

- 不在來源棋譜樹上直接追加後續著法。
- 不複製來源 root 到選中節點的完整歷史、註解、分析、時間戳或循環計數。
- 不把來源 Dexie 自增 ID 當作跨裝置永久外鍵，也不提供可能失效的來源跳轉。
- 不允許從已絕殺或困斃的終局局面建立可走棋新局。
- 不改變一般備份格式版本；現有整筆 `GameRow` 備份會保留 optional 來源快照，完整備份 v2 另開工作包。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 006-D01 | UI 使用「從此局面開新局」並標示「獨立棋局」 | 避免誤以為會改寫或正式延續原局 | Accepted |
| 006-D02 | 新局 `initialFen` 為選中節點 `fenAfter`，棋譜樹由該 FEN 建立空 root | 不混用來源身分、時間與分析 node ID | Accepted |
| 006-D03 | 來源資料採 schema v1 自含快照 | 即使來源被刪除或跨裝置還原，仍看得懂接續來源 | Accepted |
| 006-D04 | 實體記譜預填來源雙方姓名；輪走方完全由 FEN 決定 | 降低輸入成本且不製造錯誤先手 | Accepted |
| 006-D05 | 人機對弈預設使用者執目前輪走方，也可改選另一方 | 預設能立即走棋；改選時引擎自然先走 | Accepted |
| 006-D06 | 「再來一局」保留來源快照與同一 initial FEN | 避免接續來源在 rematch 後無聲遺失 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 006-FR01 | 復盤目前節點提供「從此局面開新局」入口 | Must | 主線、變著與 root 實際點擊 |
| 006-FR02 | Dialog 顯示來源著數、輪走方、獨立棋局與統計重置說明 | Must | 文案與 FEN 核對 |
| 006-FR03 | 實體記譜建立 `mode=record` 新局並導向既有 RecordPage | Must | DB 與流程檢查 |
| 006-FR04 | 人機對弈建立 `mode=play` 新局，保留級段、玩家方位並導向既有 PlayPage | Must | 紅／黑方與引擎先走檢查 |
| 006-FR05 | 新局保存 schema v1 來源快照，來源樹建立前後完全一致 | Must | Unit／DB 檢查 |
| 006-FR06 | 找不到節點、非法局面、絕殺或困斃時拒絕建立 | Must | Unit 測試 |
| 006-FR07 | 建立遊戲與玩家名冊在同一 Dexie transaction 完成 | Must | Code review／錯誤流程 |
| 006-FR08 | 防止重複提交；寫入失敗留在 dialog 並顯示台灣繁中錯誤 | Must | UI 操作 |
| 006-FR09 | 接續局在對局清單及復盤顯示「接續局」與來源摘要 | Should | UI 檢查 |
| 006-NFR01 | 不新增 schema version、後端、runtime fetch 或資料上傳 | Must | Diff／network 檢查 |
| 006-NFR02 | 320、390、640 px 無水平溢出且 dialog 可鍵盤關閉 | Must | 正式站瀏覽器檢查 |

## 6. UX flow

1. 使用者在復盤拖曳時間軸、點著法或選變著，停在想接續的局面。
2. 按「從此局面開新局」。若該局面已絕殺／困斃，入口停用並說明原因。
3. Dialog 顯示「開局局面」或「第 N 著後」、目前輪走方及獨立新局說明。
4. 選擇「實體記譜」：確認紅黑姓名後建立新局。
5. 或選擇「人機對弈」：填姓名、執紅／執黑及 App 級段後建立新局。
6. App 導向既有 RecordPage／PlayPage；來源棋譜不變。新局在清單與日後復盤標示來源摘要。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 變更 | 相依性 |
|---|---|---|
| `src/store/db.ts` | `GameRow` 新增 optional `continuedFrom` schema v1 | 無 Dexie index 變更 |
| `src/store/gameContinuation.ts` | 純 row factory、驗證、transaction 建立 | tree／FEN／DB |
| `src/store/gameContinuation.test.ts` | root、主線、變著、終局、來源不變測試 | Vitest |
| `src/ui/ContinueFromReplayDialog.tsx` | 兩種接續方式與防重送／錯誤 UX | players／級段 |
| `src/ui/ReplayPage.tsx` | 目前局面入口與來源摘要 | current node／path |
| `src/ui/GamesPage.tsx` | 接續局 badge | GameRow |
| `src/ui/PlayPage.tsx` | rematch 保留來源快照 | GameRow |
| `src/styles.css` | 接續 dialog／摘要的響應式樣式 | 現有 tokens |

### 7.2 Data contract

```ts
interface GameContinuationSource {
  schemaVersion: 1
  sourceGameIdAtCreation: number
  sourceRootId: string
  sourceNodeId: string
  sourcePly: number
  sourceStartedAt: number
  sourceRedName: string
  sourceBlackName: string
  sourceFen: string
  sourceNodeLabel?: string
}
```

`sourceGameIdAtCreation` 只作本機稽核提示，不是永久外鍵。跨裝置可讀性由姓名、日期、root／node ID、ply 與 FEN 快照提供。新欄位不建索引，所以 Dexie 維持 version 2。

### 7.3 Creation rules

- 以 `findNode` 找精確節點，`pathTo` 計算來源 ply。
- `parseFen` 後以 `validatePosition` 驗證棋子與輪走方，再以 `gameStatus` 拒絕終局。
- 新局固定 `result='*'`、`moveCount=0`、`review` 空白、`tree=newRoot(sourceFen)`。
- 不複製來源 children、註解、`tMs`、result、reason 或 review。
- `createContinuationGame` 以 `db.transaction('rw', db.games, db.players, ...)` 原子寫入遊戲與去重後玩家名冊。

### 7.4 Offline, privacy and rollback

- 所有動作只讀寫目前 origin 的 IndexedDB；不新增網路。
- 來源快照只含既有棋譜中已存在的姓名與局面，不新增裝置指紋。
- rollback 可移除 optional 欄位、factory 與 UI；既有接續局仍是合法的普通 GameRow，只會失去來源 badge。

## 8. Acceptance criteria

- [x] root、主線及變著目前節點都能建立正確 initial FEN 的獨立新局。
- [x] 實體記譜與人機對弈皆能從新局繼續合法走棋。
- [x] 新局悔棋、終局及刪除不修改來源棋譜。
- [x] 來源快照保存節點、ply、姓名、日期與 FEN，且不把數字 ID 當永久外鍵。
- [x] 已絕殺、困斃、非法或不存在的節點不會建立資料。
- [x] 建立失敗不導頁、不留下半套玩家／棋局資料，重複點擊只建立一局。
- [x] 清單與復盤能辨識接續局；rematch 保留來源摘要。
- [x] 文案清楚說明計著、重複局面與自然限著從新局重新開始。
- [x] `npm test`、`npm run build` 通過。
- [x] 320、390、640 px 與 Escape 完成本機瀏覽器檢查。
- [ ] 正式 HTTPS 站完成實體記譜、人機對弈、引擎先走與來源不變檢查。
- [ ] SDD、README、commit、push、deploy 與 live verification 完成。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit | root／主線／變著 factory | 精確 FEN／ply，空白新樹 |
| Unit | record／play config | 姓名、mode、side、level 正確 |
| Unit | immutable source | factory 前後來源 JSON 完全相同 |
| Unit | validation | missing node、invalid FEN、checkmate／stalemate 拒絕 |
| Unit | provenance | JSON round trip 保留 schema v1 快照 |
| Browser | 兩種接續方式 | 新局可走棋且來源仍可復盤 |
| Browser | play 執非輪走方 | 引擎先走且只新增一局 |
| Responsive | 320／390／640 px | dialog、表單、級段滑桿無溢出 |
| Regression | `npm test`, `npm run build` | 原記譜、對弈、復盤、備份不退化 |

## 10. Rollout and rollback

- 不設公開 feature gate；功能放在既有復盤頁。
- 若建立失敗，只顯示錯誤並保留來源頁，不做部分重試。
- 回滾不需資料 migration；接續局仍能以一般自訂 FEN 棋局開啟。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 是否日後需要「保留前段棋譜與棋規累計」的另存分支模式？ | 產品負責人 | 另開分支複製 SDD 前 | 本版只做獨立新局，避免混用身分／時間／分析 |
| 是否讓來源摘要可點回原棋局？ | 產品負責人 | 建立 durable game UUID 後 | 目前不以 Dexie ID 建不可靠連結 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-17。
- 完成日期：2026-07-17（程式與本機驗證完成；待正式發布）。
- 實際變更檔案：`src/store/db.ts`、`src/store/gameContinuation.ts`、`src/store/gameContinuation.test.ts`、`src/ui/ContinueFromReplayDialog.tsx`、`src/ui/ReplayPage.tsx`、`src/ui/GamesPage.tsx`、`src/ui/PlayPage.tsx`、`src/content/guide.ts`、`src/styles.css`、`README.md`、`docs/SDD.md`、`docs/sdd/README.md`、本文件與 TypeScript build info。
- 與原規格的差異：無；來源關係依規格採自含快照，數字 ID 只供建立當下稽核。

### Verification evidence

- Baseline `npm test`：12 個 test files、94 tests 通過；施工後為 13 個 test files、99 tests 通過。
- Baseline `npm run build`：通過；只有既有 `tree.ts` 動態／靜態 import warning。
- 施工後 `npm run build`：通過；產出 `assets/index-DA_uI2BL.js`、`assets/index-BqP7AsxT.css`，只有同一個既有 chunk warning。
- Browser：從來源第 1 著後建立實體接續局，新局 0 著且輪黑方，來源仍為 8 著；清單顯示「接續局」，新局復盤顯示來源雙方與第 1 著快照。
- Browser：從黑方輪走局面建立玩家執紅的人機接續局，畫面先提示「引擎會先走」，引擎實際完成黑炮 2 平 5，新局正常進入既有 PlayPage。
- Browser：320、390、640 px 的 document 與 dialog `clientWidth === scrollWidth`；Escape 關閉後焦點回到「從此局面開新局」按鈕。
- Browser：初次檢查發現既有 `playerNames()` 對未索引的 `createdAt` 使用 Dexie `orderBy`；改為讀取後在記憶體排序。全新分頁重跑 dialog 與建立流程後 console 無錯誤。

### Git and release

- Commit：未建立。
- Push：未執行。
- Deploy：未執行。
- 正式環境驗證：未執行。
