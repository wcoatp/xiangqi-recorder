# SDD 010：段級校準資料 v2、安全匯入與版本隔離統計

> Status：Released（產品負責人於 2026-07-17「繼續完成後續所有施工」授權）<br>
> Owner：Codex<br>
> Created：2026-07-17<br>
> Updated：2026-07-17<br>
> Target branch：`main`<br>
> Related decisions：`D-001`, `D-004`, `D-005`, `D-006`, `D-007`, `D-008`, `D-013`, `D-014`, `D-015`<br>
> Depends on：工作包 002 Phase 1、工作包 008、工作包 009 已發布<br>
> Supersedes：無；schema v1 與既有 gate v1 永久保留為相容讀取格式

## 1. Context

工作包 009 已發布可重播的 fixed-nodes／seeded MultiPV 工程核心，但目前 `RANK_CALIBRATION_SCHEMA_VERSION=1` 同時控制 PIN gate、legacy 校準棋局與獨立匯出。若直接把這個常數升為 2，既有瀏覽器保存的 salt／verifier 會被當成無效 gate，反而鎖住實驗室與含校準資料的完整備份。

現有實驗室只有 schema v1 匯出，沒有獨立匯入；統計只有每個錨點的局數。未來作者帶電腦給協會棋手使用前，必須先建立能保存完整引擎決策、可安全搬移、可重複匯入且不把不同協定混在一起的資料鏈。本包只建立資料契約、匯入與描述性統計；不開始校準對弈、不產生合成正式棋局，也不推導台灣段級映射。

## 2. Goals

- 拆開 gate、archive 與 game schema version，確保既有 PIN gate v1 完全可讀。
- 永久保留 rank archive／game v1 reader；新匯出使用 schema v2，並可同時攜帶 legacy v1 與 self-contained v2 games。
- 定義 v2 game 的 profile、anchor、engine/search/policy、session、side assignment、tree 與逐引擎著 decision 快照。
- 讓獨立校準 JSON 與完整備份 v2 共用同一套 v1/v2 normalizer、limits 與 conflict planner。
- 在已解鎖實驗室提供「選檔預覽 → 明確確認 → 原子非破壞合併」，重複匯入可安全略過。
- 由 v2 原始資料以純函式重建版本隔離統計；輸入排列不改變輸出。

## 3. Non-goals

- 不開放校準對弈，不修改一般 `PlayPage`，不在正式 DB 寫入測試或合成 v2 棋局。
- 不新增後端、帳號、雲端同步或自動上傳。
- 不把 v1 棋局自動升級成 v2，也不猜測同 ID 不同 revision 哪一份正確。
- 不發布 A01～A10 對應台灣級／段，不計算 Elo，不宣稱已校準或具真人棋風。
- 不做 profile 編輯／歷史 revision workflow；v2 game 先以自含 snapshot 保留歷史語意。
- 不保存衍生統計 cache；統計永遠可由原始資料重建。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 010-D01 | PIN gate schema 永久維持 v1，archive／game 各自版本化 | 避免 archive 升版讓既有 PIN verifier 失效 | Accepted |
| 010-D02 | schema v1 不就地改寫；同一張 `rankCalibrationGames` 表保存 v1／v2 discriminated union | 索引欄位不變，不需 Dexie migration，歷史資料也不漂移 | Accepted |
| 010-D03 | v2 game 自含 collection protocol、profile、Phase 2 anchor、engine/search/policy 與每個引擎 ply 的完整分析／decision | 匯入後不依賴當前 registry 或 profile current row，才能重播；runtime collection 啟用不改寫 WP009 的 inactive anchor snapshot | Accepted |
| 010-D04 | 新 rank archive 使用 schema v2，保留 legacy anchors 並加入 Phase 2 protocol snapshot；games 可混合 v1／v2 | 一份檔案可完整攜帶既有與後續資料 | Accepted |
| 010-D05 | 完整備份外層仍是 v2；nested `rankCalibration` 依自己的 schemaVersion 接受 v1／v2 | 不因單一子資料集升版重做整個備份格式 | Accepted |
| 010-D06 | 同 ID 同 normalized canonical content 才 skip；同 ID 異內容整包 conflict | 不靜默覆寫、不猜測 revision，也確保重複匯入冪等 | Accepted |
| 010-D07 | standalone 與 full backup 共用 pure merge planner；所有可預見 conflict 完成後才第一筆 write | 避免兩條匯入路徑規則漂移與部分寫入 | Accepted |
| 010-D08 | v2 主統計嚴格依 protocol／engine／search／profile rank／side／App version 分組；v1 只列 legacy 數量 | 工程版本不同的資料不可合併成看似可信的棋力結論 | Accepted |
| 010-D09 | 匯入只放在已解鎖實驗室；不再次要求 PIN | 頁面本身已受 PIN 與 auto-lock 保護，避免重複門禁 UX | Accepted |
| 010-D10 | App 版本升為 `0.6.0` | 新增可見的 schema v2 匯入與統計能力 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 010-FR01 | gate v1 在 archive/game v2 上線後仍可載入、驗 PIN、解鎖與保護完整備份 | Must | gate regression／integration tests |
| 010-FR02 | standalone rank JSON v1 可驗證與匯入；新 v2 可 round-trip 並混合 game v1/v2 | Must | golden fixtures／round-trip tests |
| 010-FR03 | v2 game 必須自含不可變 profile、anchor/protocol、session、side assignment、狀態、tree 與 engine move records | Must | exact validator／fixture tests |
| 010-FR04 | 每筆 engine move 保存 FEN、ply、fixed search result、anomalies 與 `HumanMoveDecisionV1`，可重播且等於棋譜實際著法 | Must | tamper／tree-link tests |
| 010-FR05 | future schema、未知欄位、duplicate ID、壞 reference、未知 protocol/asset、decision tamper 全部在 write 前拒絕 | Must | negative validator／zero-write tests |
| 010-FR06 | 匯入先顯示 schema／profile／v1 game／v2 game／狀態摘要，使用者確認後才寫入 | Must | UI/browser flow |
| 010-FR07 | standalone 匯入以 profiles＋games 單一 transaction 完成；完整備份仍以既有五表 transaction 完成 | Must | forced late-failure rollback tests |
| 010-FR08 | 重複匯入回報 added=0/skipped=N；同 ID 異內容回報 conflict 且零部分寫入 | Must | integration tests |
| 010-FR09 | full backup v2 可嵌入 nested rank v1 或 v2，PIN／salt／verifier／gate 永不匯出 | Must | backup round-trip／secret scan |
| 010-FR10 | 純統計輸出 deterministic，並分列 completed、win/draw/loss、aborted、in-progress、profiles、sessions、decision anomalies | Must | permutation／dimension tests |
| 010-FR11 | v1 不進 v2 主勝率；aborted/in-progress 不進 completed 勝率 denominator | Must | stats boundary tests |
| 010-NFR01 | 所有 JSON 限制沿用 UTF-8 50 MiB、exact allowlist、有限數值、字串／陣列／節點上限 | Must | boundary tests |
| 010-NFR02 | 全流程本機執行、無新 runtime 網路或第三方依賴 | Must | diff／network inspection |
| 010-NFR03 | 320 px 可完成選檔、預覽、取消、確認並閱讀統計；控制項具 label、焦點與狀態訊息 | Must | responsive／keyboard browser test |

## 6. UX flow

實驗室仍從設定中的隱藏 gate 進入並以 PIN 解鎖。解鎖後：

1. 摘要顯示「schema v2・只存本機」，並分開列出 profiles、legacy v1 games、v2 games 與進行／完成／中止狀態。
2. 「匯出 JSON」下載新 schema v2；文案明確說明未加密、含匿名代號／自報級段／備註／完整棋局與候選著，但不含 PIN。
3. 「匯入校準 JSON」選檔後只解析與預覽，不寫 DB。錯誤顯示具體 path／原因。
4. 預覽卡顯示來源 schema、App version、匯出時間與資料數量；「取消」清除待匯入內容，「確認匯入」才執行 transaction。
5. 成功後顯示 added／skipped，刷新摘要與統計；conflict 時整包不變並說明衝突 ID。
6. 「版本隔離統計」只顯示描述性資料與玩家視角勝和負，不顯示段級映射；無 v2 完成局時顯示誠實空狀態。

本包沒有「開始對弈」按鈕。頁面 auto-lock、visibility lock 與手動上鎖行為維持不變。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `src/calibration/rankTypes.ts` | 拆 gate/export/game versions；定義 v1/v2 union 與 self-contained v2 DTO | WP009 protocol／decision |
| `src/calibration/rankArchive.ts` | v1/v2 dispatcher、exact normalization、decision replay、merge planner、inspect/build | tree validator／canonical JSON |
| `src/calibration/stats.ts` | v2 compatibility grouping 與 deterministic metrics；legacy quarantine | normalized games |
| `src/store/rankCalibration.ts` | schema v2 export、standalone inspect/import transaction | Dexie two-table transaction |
| `src/store/db.ts` | `rankCalibrationGames` typing 改為 v1/v2 union；store/index 不變 | 無 Dexie migration |
| `src/store/backupSchema.ts`, `backup.ts` | full backup v2 nested rank v1/v2、inspection 與共用 merge plan | 工作包 008 |
| `src/ui/RankCalibrationPage.tsx`, `src/styles.css` | 匯入預覽／確認、版本分列摘要、統計空態與群組卡 | 已解鎖 gate |
| 對應 unit／integration tests | schema、transaction、backup、stats、gate regression | fake-indexeddb／Vitest |

### 7.2 Data model and migration

版本常數分開：

```ts
RANK_CALIBRATION_GATE_SCHEMA_VERSION = 1
RANK_CALIBRATION_EXPORT_SCHEMA_V1 = 1
RANK_CALIBRATION_EXPORT_SCHEMA_V2 = 2
CALIBRATION_GAME_SCHEMA_V1 = 1
CALIBRATION_GAME_SCHEMA_V2 = 2
```

legacy `CalibrationGameV1` 原欄位與語意永久保留。`CalibrationGameV2` 至少包含：

schema v1 在正式 App 中只發布過 `2026.07-v1` frozen registry；因匯入只持久化 profiles／games、不另存 registry，v1/v2 archive 的 `anchorSetVersion` 與 legacy `anchors` 必須逐欄等於這份 frozen snapshot，且 v1 game 的 config／policy 必須連回對應 anchor。未知 legacy registry 在 write 前拒絕，避免匯入後無法無損再匯出。

- 共用 index identity：`id`, `profileId`, `anchorId`, `startedAt`。
- `sessionId`, `collectionProtocolVersion`, `randomSeed`, `playerSide` 與版本化 `sideAssignment`。
- 第一版 collection protocol 固定為 `pin-gated-local-match-v1`；它代表日後只在已解鎖本機實驗室啟用，與 WP009 snapshot 上保留的 `active:false` 發布 metadata 分離。
- `balanced-alternation-v1` 的 `sequenceIndex` key 固定為 profile ID＋revision＋anchor ID＋config version＋collection protocol；同 key 的每筆已建立局（含進行中／中止）都消耗序號，建立時在 transaction 取既有最大值＋1。偶數人類執紅、奇數人類執黑；validator 必須核對 `playerSide` 與同 key 序號唯一，不靠未保存的臨時計數猜測。
- immutable `profileSnapshot` 與 `anchorSnapshot`；top-level identity 必須與 snapshot 一致。
- `status` 判別聯集：`in-progress` 無 result／endedAt；`completed` 有 red／black／draw 與 endedAt；`aborted` 有 endedAt／reason、無勝負。
- `updatedAt`, `initialFen`, 線性 `gameSnapshot`, `currentPly`, `engineMoves`, `appVersion`。

`CalibrationEngineMoveRecordV1` 保存 `ply`、`fenBefore`、`playedAt`、實際 `selectedUci`、固定 nodes／MultiPV result（lines、bestmove、completedDepth、complete flag、anomalies）與完整 decision。validator 以 game seed、ply、FEN、anchor policy 重跑 verifier，並核對該 ply 的 tree move。引擎方每個已走 ply 恰有一筆 record；玩家著不得有。

`RankCalibrationExportV2` 保留 v1 的 `anchorSetVersion`／`anchors` 供 legacy games 解讀，另包含 `phase2ConfigVersion`／`phase2Anchors`；`games` 為 v1/v2 union。full backup 外層仍是 v2，nested dispatcher 接受 rank schema v1/v2。

Dexie store 與索引字串不變，因此不升 Dexie version；既有 row 不改寫。若 rollback 到 v0.5.0，而本機已匯入 v2 row，舊版可能無法再匯出該資料；回滾前必須先保留 v0.6 schema v2 JSON，正式回滾應優先重新部署新版而非刪除資料。

### 7.3 Normalization, import and statistics

所有外部資料先走共用流程：UTF-8 size → JSON parse → exact-key schema dispatcher → tree／profile／protocol／decision normalization → 檔內 unique/reference checks。future schema 明確拒絕。

pure merge planner 只比較 validator 重建後的 canonical object：

| 本機／匯入狀態 | 計畫 |
|---|---|
| ID 不存在 | add |
| 同 ID、normalized canonical content 相同 | skip |
| 同 ID、任何內容不同（含 v1/v2） | conflict，整包拒絕 |
| 本機資料不能通過自身 schema | conflict，第一筆 write 前拒絕 |

standalone import 在 `rankCalibrators`＋`rankCalibrationGames` 單一 transaction 內重新讀本機並完成整個 plan，然後才 write。full backup 沿用五表 transaction，但改用同一 rank planner；任何 rank conflict 也必須讓一般棋局、玩家、偏好與棋子範本零變更。

統計只納入 normalized v2 games。compatibility key 使用 canonical structured object，至少包含：game schema、collection protocol、side assignment version、anchor ID/config、完整 policy、engine protocol/commit/asset hashes、search profile、profile claimed rank/rank system、playerSide、appVersion。指標含 total/completed/win/draw/loss/aborted/in-progress、distinct profiles/sessions、decision count、anomalous decision/game count；勝率 denominator 只用 completed。v1 另列 legacyCount，不進 v2 group。

### 7.4 Offline, privacy, security, licensing

- 解析、驗證、匯入與統計全部在本機執行，沒有 runtime fetch 或上傳。
- JSON 未加密，可能含匿名代號、自報級段、備註、完整棋譜、FEN、引擎候選與時間；UI 必須提醒自行保管。
- PIN gate 只防誤入；gate、salt、verifier、unlock state 絕不進 standalone/full backup。
- standalone import 只在已解鎖頁面可用；完整備份仍依工作包 008 當場驗證目的端 PIN。
- 不新增套件或授權資產；GPL-3.0 邊界不變。

## 8. Acceptance criteria

- [x] 舊 gate v1 與 PIN 在升版後仍能解鎖，secret 永不出現在 JSON。
- [x] standalone rank v1 可匯入；v2 可 round-trip 並保存混合 v1/v2 games。
- [x] v2 snapshot／status／tree／decision linkage 任一竄改都會在 write 前拒絕。
- [x] clean merge、non-empty merge、repeat skip、ID conflict、duplicate ID 與 forced late failure 均有 atomic tests。
- [x] full backup v2 分別嵌入 rank v1/v2 都能預覽、PIN 驗證、還原與重複還原。
- [x] 統計所有 compatibility dimensions 都不混版，輸入 permutation 不改輸出。
- [x] UI 完成選檔預覽、取消、確認、成功與 conflict；沒有新增校準對弈入口。
- [x] 320／390／桌面 CSS 邊界、鍵盤 label/live region 與 auto-lock 來源完成稽核；長檔名／appVersion 具斷行保護。
- [x] `npm test` 與 `npm run build` 通過，沒有新增 error。
- [x] 正式站 v0.6.0、COOP／COEP、引擎載入與已解鎖實驗室流程完成 smoke test。
- [x] Master SDD、SDD 002／008、索引、README 與施工紀錄同步更新。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit／archive | v1 golden、v2 exact/future、limits、duplicate/reference、protocol/decision/tree tamper | 正規化或在指定 path 明確拒絕 |
| Unit／stats | 每一分組維度、人類紅黑視角、aborted/in-progress、legacy quarantine、permutation | deterministic 且不混版 |
| Integration／standalone | clean/non-empty/repeat/conflict/late-failure、gate v1 | 原子、冪等、PIN 不失效 |
| Integration／backup | nested v1/v2、混合 games、PIN、五表 rollback、secret scan | 工作包 008 行為不退化 |
| Browser | unlock、v2 匯出、v1/v2 預覽、取消、確認、conflict、auto-lock | 清楚且無部分寫入 |
| Responsive／a11y | 320／390／桌面、鍵盤、label、live status | 無 overflow／焦點陷阱 |
| Regression | 完整 `npm test`, `npm run build`, 正式站 smoke | 公開功能與引擎不退化 |

## 10. Rollout and rollback

- 功能只存在原本隱藏、PIN-gated 的實驗室；公開 drawer 不新增入口。
- v2 game 在 WP011 前只由 validator fixtures 驗證，正式 App 不建立合成 row。
- 施工完成後依 repository 預設 commit、push、deploy；正式站以空資料、legacy v1 fixture 與隔離 origin v2 fixture驗證，不碰使用者現有資料。
- 若 import/validator 有問題，可先隱藏匯入控制但保留 reader/export；不得刪除已匯入 v2 raw data。
- 回滾前先匯出 v2；v0.5.0 不保證讀取 v2 row，因此 production rollback 必須附資料相容性警告。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| profile 未來可編輯時如何保存 revision history？ | 產品負責人＋資料審查 | 開放 profile edit 前 | 本包不開 edit；v2 game 自含 snapshot，ID 異內容匯入先 conflict。 |
| v2 group 何時可跨 App version 合併？ | 資料審查 | 產生任何映射前 | 本包保守分組；有證據證明 appVersion 不影響資料後另開決策。 |
| 每個級段／錨點／紅黑方需要多少完成局？ | 真人棋手＋資料審查 | Phase 3 現場收集前 | Open；本包不設定發布門檻。 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-17
- 完成日期：2026-07-17（程式與本機驗證；正式發布待完成）
- 實際變更檔案：`src/calibration/rankTypes.ts`、`rankArchive.ts`、`stats.ts` 與測試；`src/store/rankCalibration.ts`、`backupSchema.ts`、`backup.ts` 與 integration tests；`src/ui/RankCalibrationPage.tsx`、`src/styles.css`；package version 與 SDD 文件。
- 與原規格的差異：在 WP011 前先凍結 `pin-gated-local-match-v1` 與可稽核的偶紅奇黑收集序號；v1 reader 只接受 App 實際發布過的 `2026.07-v1` frozen registry，避免匯入後遺失 provenance。

### Verification evidence

- `npm test`：通過，23 個 test files／179 tests；含 archive tamper、stats dimensions、standalone 兩表、full backup 五表與 gate v1 regression。
- `npm run build`：通過；101 modules，CSS `index-CBaZ8nuj.css`、JS `index-r8DlHNDA.js`；只有既有 `tree.ts` dynamic/static import chunk 警告。
- 手動／實機檢查：本機真實 IndexedDB／Web Crypto 完成 setup、PIN 建立、Phase 2B dashboard、匿名 profile、schema v2 下載、reload 上鎖、再次 PIN 解鎖與 profile 持久化；console 無 error。另以獨立稽核確認預覽選檔前零寫入、長字串響應式與公開選單無校準入口。
- 已知限制：WP011 前沒有正式 v2 棋局產生器；本包只能以明確測試 fixture 驗證資料鏈。

### Git and release

- Commit：`2324d7e`（`feat: add calibration archive v2 import and stats`）。
- Push：`main` 已推送至 `origin/main`。
- Deploy：2026-07-17 已部署 Firebase Hosting，使用 `2324d7e` 的乾淨 v0.6.0 production build。
- 正式環境驗證：`https://xiangqi-recorder.web.app/?release=20260717-v060-clean` 回傳 HTTP 200、COOP=`same-origin`、COEP=`require-corp`；HTML 載入 `index-r8DlHNDA.js` 與 `index-CBaZ8nuj.css`。Chrome 設定頁顯示 v0.6.0，Fairy-Stockfish xiangqi NNUE 顯示就緒。
