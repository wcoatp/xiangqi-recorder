# SDD 011：PIN 內現場校準對弈控制器

> Status：Verified（待 commit／push／deploy；產品負責人於 2026-07-17「繼續完成後續所有施工」授權）<br>
> Owner：Codex<br>
> Created：2026-07-17<br>
> Updated：2026-07-17<br>
> Target branch：`main`<br>
> Related decisions：`D-001`, `D-004`, `D-005`, `D-006`, `D-007`, `D-008`, `D-013`, `D-014`, `D-015`<br>
> Depends on：工作包 002 Phase 1、工作包 009、工作包 010<br>
> Supersedes：無

## 1. Context

工作包 009 已建立 fixed-nodes／seeded MultiPV 可重播選著，工作包 010 已建立 self-contained game schema v2、原子匯入與版本隔離統計；目前正式 UI 仍不會產生 v2 校準棋局。作者帶電腦給協會棋手協助時，需要一個只在本機 PIN 解鎖後使用、每一步立即保存、可中斷續下且不把一般人機局混入校準資料的獨立對弈流程。

一般 `PlayPage` 使用 Elo 弱化、提示／悔棋與 fire-and-forget 寫入，不符合校準資料完整性。本包必須另做 controller，並讓 tree 與引擎 analysis／decision 在同一筆 CAS transaction 成為不可分割 checkpoint。

## 2. Goals

- 由現場人員選協助者與 A01～A10 錨點，App 依版本化序號自動平衡紅黑方。
- 建局先落盤；人類每著立即保存；引擎 fixed-nodes 分析在 transaction 外執行，再將棋步與完整 decision 原子保存。
- refresh、離頁、上鎖或引擎取消不丟失最後 checkpoint，重新 PIN 解鎖後可續局。
- 正確分類完成、和棋、認輸、規則裁定與技術中止；只自動判絕殺／困斃。
- 產生可由工作包 010 匯出、匯入、重播與統計的真實非零 ply v2 棋局。

## 3. Non-goals

- 不修改一般 `PlayPage`、公開 `games` 表、公開難度、台灣段級映射或 `PHASE2_ANCHORS.active:false` frozen snapshot。
- 不提供提示、悔棋、分析箭頭、任意分支、語音、拍照或公開選單入口。
- 不自動辨識長捉；不把重複盤面或 100 著未吃子直接判和。
- 不新增後端、帳號、雲端同步、跨裝置即時續局或新 Dexie schema。
- 不宣稱錨點已對應協會級段或已具真人棋風。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 011-D01 | Match UI 是 `RankCalibrationPage` 已解鎖子樹的 nested view，不新增全域 route | 保留現有 PIN、15 分鐘閒置、visibility 與手動上鎖，避免入口繞過 | Accepted |
| 011-D02 | `sessionId` 表示一次現場收集時段，可由同一 profile 的多局重用 | 讓 distinct sessions 能表示到訪／疲勞批次，而非退化成每局一個 session | Accepted |
| 011-D03 | sequence key 固定為 profile ID＋revision＋anchor ID/config＋collection protocol；所有 v2 狀態都占序號，max＋1，不補洞 | 與工作包 010 validator 一致，重開／中止不破壞先後手平衡 | Accepted |
| 011-D04 | controller 同時只允許一筆 in-progress 局；已匯入的多筆例外必須逐筆續局或中止後才能建新局 | 降低現場誤開與引擎競爭；原始資料不自動刪除 | Accepted |
| 011-D05 | 每個 checkpoint 完整 normalize 後，在 CAS transaction 內單次 `put`；`updatedAt=max(now, old+1)` | 避免多頁籤 stale callback、同毫秒更新與半筆 engine record | Accepted |
| 011-D06 | 跨 `appVersion` 的 in-progress 局只讀；可明確以版本變更原因中止，不可續下 | 一局只有一個 appVersion，禁止混合不同 code／asset 語意 | Accepted |
| 011-D07 | 自動終局只含絕殺／困斃；認輸、議和、循環與裁判判定由固定 reason code 明確確認 | App 不具完整長捉自動裁判能力 | Accepted |
| 011-D08 | refresh、上鎖、離頁、AbortSignal 或暫離維持 in-progress；只有使用者確認才 aborted | 技術取消不等於無效棋局 | Accepted |
| 011-D09 | App 版本升為 `0.7.0` | 新增 PIN 內可見且會建立真實校準資料的現場流程 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 011-FR01 | 只有正確 PIN 解鎖後可建立、查看或續下校準局；公開 drawer 與一般設定不得直接進棋盤 | Must | browser／guard tests |
| 011-FR02 | 建局 transaction 驗 profile current revision、現有 in-progress、session 相容性與 sequence，先保存 ply 0 再進棋盤 | Must | Dexie integration |
| 011-FR03 | 偶數 sequence 人類執紅、奇數執黑；完成／中止／進行中皆占號，不同 key 各自計數 | Must | sequence tests |
| 011-FR04 | 人類只能在自己的回合走合法著；成功 await DB 後 UI 才前進，不能悔棋或建立分支 | Must | controller／UI tests |
| 011-FR05 | 引擎只用 snapshot 的 `analyzeCalibration(nodes=40000,multipv=8)` 與 `selectHumanMoveV1`；不得呼叫 Elo/movetime analyze | Must | injected engine spy |
| 011-FR06 | 引擎 tree move、analysis、decision、selectedUci、currentPly 與時間同一 transaction 保存 | Must | failure rollback／round-trip |
| 011-FR07 | CAS token 至少核對 id、sessionId、currentPly、updatedAt、status；stale callback 零覆寫並重新讀最新局 | Must | concurrency tests |
| 011-FR08 | PIN 上鎖、reload、unmount 與引擎取消不改 status；重新解鎖後從進行中清單續局 | Must | interruption/browser flow |
| 011-FR09 | completed／aborted immutable；跨 App 版本不得啟動引擎或落子 | Must | terminal/version tests |
| 011-FR10 | 自動保存絕殺／困斃；認輸、和棋、循環判定、裁判結果與中止用穩定 code | Must | termination matrix |
| 011-FR11 | 重複局面與連續未吃子只顯示提醒；長將／長捉由操作者分類後交給既有 `judgeCycle()` | Must | rules tests |
| 011-FR12 | 非零 ply v2 局可 standalone/full backup round-trip，重播 decision，且仍不含 PIN/gate | Must | archive integration |
| 011-NFR01 | 本機離線、無新 runtime fetch／第三方依賴／後端 | Must | diff/network audit |
| 011-NFR02 | 320／390／桌面可完成建局、落子、續局、裁定與中止；狀態與控制具 label/live region | Must | responsive/a11y browser |

## 6. UX flow

1. 使用者依既有隱藏入口進入實驗室並輸入 PIN。
2. 儀表板顯示進行中局；若存在，提供「繼續」或「明確中止」，不允許另開新局。
3. 新局選匿名協助者、A01～A10，以及「建立新收集時段」或該協助者既有時段。錨點只顯示內部代碼與相對順序，不顯示 Elo／段級映射。
4. 確認卡先顯示 profile 自報級段、anchor、session 與 App 自動分派紅黑。建局成功保存後才顯示棋盤。
5. 棋盤人類方朝下；人類回合可點起訖格，引擎回合顯示 fixed-nodes 思考。沒有提示或悔棋。
6. 「暫離」回儀表板但保留 in-progress；「認輸」「裁定結果」「中止無效局」皆需確認。
7. 重複／未吃子門檻只提示。循環裁定要求輸入紅黑雙方 `long-check`／`long-chase`／`none`，顯示 `judgeCycle()` 結果後再次確認。
8. completed／aborted 顯示唯讀摘要；可回儀表板並在同一收集時段開始下一局。

上鎖或頁面隱藏時 match component unmount／取消引擎 request，DB row 保持最後完整 checkpoint。再次解鎖後不自動跳棋盤，由進行中清單明確續局。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 變更 | 相依性 |
|---|---|---|
| `src/calibration/matchController.ts` | 純建立／走子／終局／規則進度／reason code transition | rankArchive、tree、movegen、adjudication |
| `src/store/rankCalibrationMatch.ts` | 建局 sequence transaction、讀取、CAS commit、中止 | Dexie v2 tables |
| `src/ui/RankCalibrationMatch.tsx` | 獨立校準棋盤、engine lifecycle、裁定與中止 UI | Board、engineClient |
| `src/ui/RankCalibrationPage.tsx` | dashboard/match nested view、profile/anchor/session 選擇、續局清單 | 現有 PIN guard |
| `src/styles.css` | 320/390/desktop match layout | 現有 rank lab theme |
| controller/store/archive tests | sequence、CAS、nonzero-ply round-trip、termination | fake-indexeddb／Vitest |

不新增 `App.tsx` route、不修改 `PlayPage` 或 Dexie version/store indexes。

### 7.2 Data and state transitions

建立局時在 `rankCalibrators + rankCalibrationGames` read-write transaction：

- 重新讀 profile 並驗 revision。
- normalize 所有 local games，檢查 in-progress 與 session ownership。
- 依工作包 010 sequence key 找最大值＋1；v1 不參與。
- 建立 random game ID／seed、immutable profile/anchor snapshot、`START_FEN` 線性 root、status in-progress。
- `buildCalibrationGameV2()` 通過後 `add`；成功後 UI 才開棋盤。

每次 transition 接收 `{id, sessionId, currentPly, updatedAt, status:'in-progress'}` token。transaction 內重讀 row，token 或 appVersion 不符即丟 stale/version error；候選完整 normalize 後單次 `put`。completed／aborted 沒有合法後續 transition。

引擎分析必須在 DB transaction 外；AbortError、timeout、worker error 或 cleanup failure 均零寫入。提交引擎著時 transaction 重新核對 FEN／輪走方／CAS，再將 tree 與 engine record 一次保存。

### 7.3 Stable reason codes

`resultReason` 保存穩定 code，UI 另映射繁中：

- completed：`checkmate`, `stalemate`, `human-resigned`, `agreed-draw`, `cycle-ruling`, `natural-limit-ruling`, `referee-ruling`。
- aborted：`operator-aborted`, `participant-withdrew`, `engine-unavailable`, `invalid-setup`, `app-version-changed`, `other-invalid`。

認輸一律 completed、勝方為引擎；暫離／reload／上鎖不是 aborted。循環裁定另外保存於當次 UI confirmation 的可解釋 reason 文案仍受現有 schema 限制，本包不加新欄位；統計只依 result/status，不依自由文案。

### 7.4 Rules progress

由 initial FEN＋mainline 重算：

- 目前局面出現次數。
- 連續未吃子 ply。
- 絕殺／困斃自動結果。

重複與自然限著只產生提示。長捉不能由 App 自動辨識；操作者分類雙方 conduct，再使用 `judgeCycle()` 得出 draw／red loses／black loses。

### 7.5 Offline, privacy, security, licensing

- 所有 profile、棋譜、候選、判定與 session 都只存目前 origin IndexedDB。
- PIN 解鎖 flag 只在 React memory；salt／verifier／PIN 不進 game、匯出或 console。
- JSON 仍未加密，含匿名代號、自報級段、棋譜與完整引擎候選，須自行保管。
- 不新增套件或授權資產；GPL-3.0 邊界不變。

## 8. Acceptance criteria

- [x] PIN 解鎖後可選 profile／anchor／session 建立 ply 0，App 自動分派紅黑。
- [x] 人類紅、黑各至少一局可逐著持久化；引擎著與 decision 原子保存。
- [x] sequence 包含所有狀態、max＋1，並有 concurrency／stale CAS 測試。
- [x] reload／暫離／上鎖／AbortSignal 後可續局且不重複引擎著。
- [x] completed／aborted immutable；跨 appVersion 唯讀＋明確中止。
- [x] 絕殺、困斃、認輸、議和、循環、裁判與中止分類正確。
- [x] 三次重複／自然限著只提醒，長捉不自動臆測。
- [x] 非零 ply standalone/full backup round-trip，decision 可重播且無 PIN/gate。
- [x] UI 沒有提示、悔棋、Elo、公開 mapping 或公開入口。
- [x] `npm test`、`npm run build`、既有 320／390 響應式邊界、桌面與真實 WASM smoke 通過。
- [x] Master SDD、SDD 002／010、索引與施工紀錄同步；正式發布後再更新 README 發布基準。
- [ ] 正式站 v0.7.0、COOP／COEP、資產雜湊、引擎載入與 PIN 入口完成 smoke test。

## 9. Test plan

| 層級 | 必測 | 預期 |
|---|---|---|
| Controller unit | 紅黑回合、非法著、engine replay、terminal、認輸／裁定／中止、規則進度 | 每個輸出完整 normalize |
| Store integration | sequence 0..N、缺口 max＋1、不同 key、parallel create、CAS 競爭、rollback | 不重號、不分支、不部分寫入 |
| Archive integration | ply 1 與 ply 3 v2、anomaly、standalone/full backup、tamper | canonical round-trip 或零寫入拒絕 |
| Engine lifecycle | queued/active abort、timeout、retry、StrictMode、unsupported、snapshot settings spy | 零半筆資料，不使用 Elo/movetime |
| Browser | PIN、建局、紅黑、暫離、reload、續局、上鎖、結果／中止 | 只從解鎖子樹操作 |
| Responsive/a11y | 320、390、桌面、鍵盤、live status | 無 overflow，等價控制可達 |
| Live | HTTPS、COOP/COEP、WASM/NNUE、v0.7.0、console | 正式站真實引擎至少完成紅黑起始流程 |

fake-indexeddb 不能單獨證明跨瀏覽器 connection serialization；正式瀏覽器至少做雙分頁建局／CAS smoke，若 Firebase／瀏覽器限制無法自動化須記錄人工驗證缺口。

## 10. Rollout and rollback

- 只發布在既有 local gate＋PIN 後；一般使用者與公開 drawer 不可見。
- 發布前先匯出現有 schema v2 JSON。工作包 011 不自動建立合成 production row。
- 若 controller 發現 blocker，可隱藏「開始對弈」但保留既有 v2 reader/export；不可刪除已保存 row。
- 回滾至 v0.6.0 前先匯出所有 v2 資料；舊版可保存／匯出 v2，但不提供續局 controller。
- 完工後依 repository 預設 commit、push、Firebase deploy 與正式站驗證。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 每個 profile／anchor／side 需要多少有效局？ | 真人棋手＋資料審查 | Phase 3 收集前 | Open；不阻擋 controller，但不發布 mapping。 |
| 是否需要把循環 conduct 拆成 schema 欄位？ | 資料審查 | 第一批規則裁定資料檢視後 | 本包先用 stable `cycle-ruling`＋勝負；若需分析另升 game schema。 |
| 是否自動安排下一個 anchor？ | 產品負責人 | 現場 pilot 後 | 本包人工選 anchor，避免未驗證排程影響收集。 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-17
- 完成日期：2026-07-17（程式與本機驗證；正式發布待完成）。
- 實際變更檔案：`src/calibration/matchController.ts` 與測試、`src/store/rankCalibrationMatch.ts` 與 integration tests、`src/ui/RankCalibrationMatch.tsx`、`src/ui/RankCalibrationPage.tsx`、`src/store/backup.integration.test.ts`、`src/styles.css`、package 版本與 SDD 文件。
- 與原規格的差異：PIN 子樹 unmount 會以 `AbortSignal` 取消尚未 commit 的 ply 0 建局；跨版本中止後不重用舊 session；手機 select 額外固定 16px，避免 iOS 聚焦縮放。未增加 Dexie schema 或公開 route。

### Verification evidence

- `npm test`：通過，25 個 test files／196 tests；包含偶紅奇黑、引擎先走後人類黑方落子、max＋1／並行建局、CAS 防分叉、取消建局零寫入、terminal／跨版本、非零 ply standalone/full backup 與 secrets 排除。
- `npm run build`：通過；104 modules，CSS `index-DvHZeE5n.css`、JS `index-8Nop4GB3.js`。只有既有 tree dynamic/static import 提示與 500 kB chunk size 提示。
- 手動／實機檢查：本機真實 IndexedDB／Web Crypto 完成 PIN 解鎖、profile／A05 建局、協助者執紅走一著、Fairy-Stockfish fixed-nodes 回一著、暫離與同 ply 續局；v0.7.0 另驗證設定版號、PIN 鎖定入口、解鎖後 Phase 2C、v0.6.0 舊局唯讀／明確中止保護。公開 drawer 沒有校準入口。
- 已知限制：受控 Chrome viewport 本輪固定為桌面，完整校準局未再以 320／390 px 實走；既有鎖定頁窄寬度無溢位、CSS 斷點與棋盤容器已檢查，新增 select 為 16px，仍應在協會現場前用實體手機做一次 pilot。UI engine effect 沒有獨立 React StrictMode component test，但 engine AbortSignal、store CAS/rollback 與真實 WASM 中斷續局已有分層證據。未來若 anchor snapshot 升版需保留歷史 registry；本包不發布段級 mapping，長捉仍由人／裁判分類。

### Git and release

- Commit：待建立。
- Push：待執行。
- Deploy：依 repository 預設在 implementation commit／push 後執行；尚未執行。
- 正式環境驗證：未執行。
