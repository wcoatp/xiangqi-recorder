# SDD 009：可重現的實驗性校準選著協定 v1

> Status：Released（已由產品負責人於 2026-07-17「繼續完成後續所有施工」授權）<br>
> Owner：Codex<br>
> Created：2026-07-17<br>
> Updated：2026-07-17<br>
> Target branch：`main`<br>
> Related decisions：`D-001`, `D-004`, `D-005`, `D-006`, `D-007`, `D-008`, `D-012`<br>
> Depends on：工作包 002 Phase 1、工作包 008 已發布<br>
> Supersedes：無；既有 `2026.07-v1` Phase 1 錨點永久保留

## 1. Context

段級校準 Phase 1 已有 PIN 隱藏入口、10 個固定錨點與本機資料骨架，但既有錨點仍使用 `UCI_Elo`／movetime 弱化，而且 `movePolicyVersion` 明確是 `not-active-phase1`。這些設定受硬體速度與引擎內建隨機弱化影響，不能作為可重播的真人校準選著資料。

目前也沒有真人棋手可協助校準。因此本工作包只建立工程上可重現、可稽核的選著協定與引擎專用搜尋 API；不開放校準對弈、不寫 IndexedDB，也不把合成測試結果宣稱為真人棋風或台灣段級。

## 2. Goals

- 建立 inactive 的 `2026.07-phase2-v1` A01～A10 協定，不改寫 Phase 1 錨點。
- 校準搜尋固定 Threads、nodes、Hash、MultiPV 與完整引擎資產身分，避免硬體速度與內建 Elo 隨機弱化。
- 給定相同候選、FEN、game seed、ply 與 policy，產生位元可稽核的相同選著紀錄。
- 記錄全部候選、分數、PV、損失、資格、整數權重、亂數值、fallback 與異常。
- 校準搜尋結束、失敗或取消後，恢復一般對弈／提示／解棋所需的預設引擎設定。
- 以純函式與 fake Worker 測試證明可重現性、合法性、錨點參數單調及引擎命令隔離。

## 3. Non-goals

- 不新增或開放校準對弈 UI，不修改 `RankCalibrationPage` 或 `PlayPage`。
- 不寫入 `rankCalibrationGames`，不調高任何 Dexie／校準／備份 schema version。
- 不實作校準 JSON 匯入、統計、profile revision 或現場 session。
- 不修改公開 `PLAY_LEVELS`，不發布 A01～A10 與台灣級／段的映射。
- 不宣稱 `seeded-multipv-v1` 已經像真人；本包只能稱為實驗性的 bounded candidate policy。
- 不修改 `public/engine/uci-worker.js` 或引擎二進位資產。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 009-D01 | 新協定只以 exported core 存在，不接 UI／DB | 先驗證資料生成器，避免未定型資料污染正式校準表 | Accepted |
| 009-D02 | 校準搜尋固定 `Threads=1`, `Hash=32`, `nodes=40000`, `MultiPV=8` | nodes 不受裝置每秒速度影響；單執行緒與 fresh hash 降低非決定性 | Accepted |
| 009-D03 | 強制 `Skill Level=20`, `UCI_LimitStrength=false`, 每著 `ucinewgame`＋`Clear Hash` | 不使用引擎內建弱化亂數，強弱只由可稽核 policy 控制 | Accepted |
| 009-D04 | seed 使用 FNV-1a 32，抽樣使用 Mulberry32；權重使用整數 bounded-quadratic 公式 | 無全域亂數、無 `Math.exp` 跨引擎邊界；決策可精確重播 | Accepted |
| 009-D05 | 同步候選取「最深的完整 MultiPV batch」；不足時明確標 anomaly | 不把不同 depth 的候選拼成看似完整的決策 | Accepted |
| 009-D06 | 固定 npm／engine commit／WASM／NNUE 與 worker hashes | 相同 policy 不代表不同引擎資產仍可合併 | Accepted |
| 009-D07 | 校準 API 與一般 `analyze` 共用 queue，所有完成路徑恢復 default Threads 與全力設定 | 避免校準單執行緒或弱化狀態污染一般功能，也避免手機同時載入第二個 WASM | Accepted |
| 009-D08 | A01～A10 使用相同 engine search，只單調收窄 policy | 第一批工程比較聚焦在可解釋的候選容錯，不混入硬體與搜尋預算差異 | Accepted |
| 009-D09 | package 版本升為 `0.5.0` | 新增版本化引擎協定與可重播選著 API，雖未公開 UI，仍是可供後續工作包使用的新能力 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 009-FR01 | `PHASE2_ANCHORS` 固定 A01～A10、ID／順序／config version 唯一，legacy anchors 完全不變 | Must | snapshot／deep-freeze tests |
| 009-FR02 | 專用 API 只接受 fixed nodes＋MultiPV，不接受 movetime／Elo | Must | TypeScript API 與 fake Worker commands |
| 009-FR03 | 候選依 side-to-move score 與 UCI tie-break canonicalize，輸入順序不影響 decision | Must | permutation tests |
| 009-FR04 | illegal／duplicate／超過 max-loss／超過 topK 候選不得被選；有非敗著時不選 losing mate | Must | policy boundary tests |
| 009-FR05 | 相同輸入產生完全相同 seed hash、random uint、weights 與 selected move | Must | golden decision tests |
| 009-FR06 | decision verifier 可重播；任意改 selected move、weight、sample 或候選後驗證失敗 | Must | tamper tests |
| 009-FR07 | 候選不足時只可 fallback 到合法 bestmove 並標 anomaly；全部無效時拒絕 | Must | fallback/error tests |
| 009-FR08 | 校準搜尋 success／abort／error 後恢復 default Threads、MultiPV 1 與全力設定 | Must | fake Worker sequence tests |
| 009-FR09 | abort 在 queue 中不送 stop；搜尋中 abort 只中止自己的 request | Must | queued／active abort tests |
| 009-FR10 | 一般 movetime／depth 分析行為保持相容，校準後弱棋與全力分析仍明確重設 | Must | regression command tests |
| 009-NFR01 | 無新網路、IndexedDB、UI 或背景收集 | Must | diff／browser network inspection |
| 009-NFR02 | 所有 decision 數值有限、JSON-safe、schema／policy／asset version 明確 | Must | validator／serialization tests |

## 6. UX flow

本包沒有新使用者入口。段級實驗室仍維持 Phase 1 儀表板與「尚未開始對弈」狀態；公開 App 不顯示新協定。唯一可觀察變更是 App 版本更新，且一般對弈、提示、解棋與殘局必須維持原行為。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `src/calibration/phase2Protocol.ts` | engine asset snapshot、搜尋 profile、10 個 inactive policy anchors | `AnchorId` |
| `src/calibration/humanMove.ts` | canonical candidates、seeded weighted selection、decision verifier | `PvLine`, `scoreToCp` |
| `src/engine/engineClient.ts` | `analyzeCalibration`、完整 batch、request abort、設定恢復、test injection | Worker/UCI |
| 三份對應 tests | policy、protocol、fake Worker command/queue/restore | Vitest |
| `src/calibration/anchors.test.ts` | legacy `2026.07-v1` snapshot 防回歸 | Phase 1 anchors |
| SDD／索引／package version | 施工、驗證與發布紀錄 | 工作包 002／007 |

本包不修改 `rankTypes.ts`、Dexie、backup、`RankCalibrationPage`、`PlayPage` 或 worker／WASM／NNUE 資產。

### 7.2 Data model and migration

- 沒有 Dexie migration，也沒有正式校準資料寫入。
- 新型別是下一包 schema v2 的候選契約，不得先塞進既有 `CalibrationGame` v1。
- `PHASE2_ANCHORS` 與 decision DTO 都要 deep-freeze／明確 schema version，未來若改公式或參數必須建立新 policy／config version。

### 7.3 Engine protocol

```ts
interface CalibrationAnalyzeOptions {
  nodes: number
  multipv: number
  signal?: AbortSignal
}

interface CalibrationAnalyzeResult extends AnalyzeResult {
  completedDepth: number
  completeCandidateBatch: boolean
  anomalies: string[]
}
```

固定命令順序：初始化 → `Threads 1` → `Hash 32` → `MultiPV N` → `Skill Level 20` → `UCI_LimitStrength false` → `ucinewgame` → `Clear Hash` → `isready` → `position fen` → `go nodes N`。完成或取消後，先收斂本次 `bestmove`，再恢復初始化時保存的 default Threads、`MultiPV 1`、`Skill Level 20`、`UCI_LimitStrength false` 並等待 `readyok`，才釋放 queue。

info lines 依 depth 分桶；優先選最深且包含 `multipv 1..N` 的完整 batch。若合法著數不足，只回傳同一 depth 最長的連續 batch，並設定 `completeCandidateBatch=false`。`bestmove` 與第一候選不一致也要記入 anomaly。

### 7.4 Human move policy

`seeded-multipv-v1` 的 seed material 固定為：

```text
seeded-multipv-v1\0<gameSeed>\0<ply>\0<trimmed-and-space-normalized-FEN>
```

先用 FNV-1a 32 產生 8 位 hex `decisionSeedHash`，再以 Mulberry32 產生第一個 unsigned 32-bit sample。選擇門檻使用 BigInt 整數除法計算，避免浮點邊界改變落點。

候選按 normalized score 由高到低，再以 UCI 升冪 tie-break；mate 轉換沿用 `scoreToCp`。資格依合法性、唯一性、topK、maxLoss、forced-mate protection 與 losing-mate protection 決定。每個合格候選的整數權重：

```text
floor(1_000_000 * temperatureCp² / (temperatureCp + lossCp)²)
```

loss 0 固定為 1,000,000；所有中間值保持 safe integer。decision 記錄 raw score、normalized cp、loss、PV、eligible、weight、seed hash、random uint/unit、threshold、selected UCI、quality 與 anomaly。verifier 以原輸入重算完整 decision 後比較，不信任檔內衍生值。

錨點 policy 單調由弱到強：

| Anchor | topK | temperatureCp | maxLossCp | preserveForcedMate |
|---|---:|---:|---:|---|
| A01 | 8 | 260 | 700 | true |
| A02 | 8 | 220 | 600 | true |
| A03 | 7 | 190 | 520 | true |
| A04 | 6 | 160 | 440 | true |
| A05 | 5 | 130 | 360 | true |
| A06 | 5 | 105 | 280 | true |
| A07 | 4 | 80 | 210 | true |
| A08 | 3 | 55 | 140 | true |
| A09 | 2 | 30 | 70 | true |
| A10 | 1 | 1 | 0 | true |

這些只是初始工程參數；沒有真人資料前不得解讀為實際段級間距。

### 7.5 Asset identity, offline, privacy, licensing

- npm：`fairy-stockfish-nnue.wasm@1.1.11`；engine commit `5589ea54`（WASM 內嵌 metadata）。
- `uci-worker.js` SHA-256：`ce39d54d9e157849c45229d7a90e27097a008595c0bf8c3ea451deb9f52db0f6`。
- `stockfish.js` SHA-256：`86f07a252c46e02760562d8bf6d32beb5f4fc5746c5f8233566a7ca3db6a8af4`。
- `stockfish.wasm` SHA-256：`91f78f226169ae0e08be3854e0b4de8f5461844d38f08eaae8e3f8ee0833831d`。
- pthread worker SHA-256：`067be484ac62f728b0dad28496997e5862f3c61f9091f59bb35d9d1b1ed14573`。
- NNUE SHA-256：`c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11`。
- 所有運算本機執行，沒有上傳或新 runtime dependency；既有 GPL-3.0 授權邊界不變。

## 8. Acceptance criteria

- [x] legacy anchors 的 snapshot 完全不變，新 10 錨點唯一、deep-frozen 且參數單調。
- [x] 相同輸入產生 byte-equivalent decision；候選順序不影響結果。
- [x] illegal／duplicate／loss／mate／fallback／tamper 邊界都有測試。
- [x] 固定合成候選與 seed grid 顯示 A01→A10 的平均選著損失非遞增；這不等於真人校準。
- [x] fake Worker 證明 fixed nodes、fresh hash、同步 batch、abort 與設定恢復。
- [x] 一般 movetime／depth、弱棋、提示／解棋命令沒有退化。
- [x] 真實本機 WASM 對固定 FEN 重跑兩次得到相同候選 batch 與 decision。
- [x] `npm test` 與 `npm run build` 通過，沒有新增 warning／syntax error。
- [x] 正式站 v0.5.0、COOP／COEP、引擎載入與既有一般流程完成 smoke test。
- [x] Master SDD、SDD 002、索引與施工紀錄同步更新。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit／policy | seed golden、candidate permutation、非法／重複、cp／mate、topK／loss、fallback、tamper | 完全可重播或明確拒絕 |
| Unit／protocol | 10 anchors、單調性、deep freeze、legacy snapshot、asset hashes | 版本與資產不可漂移 |
| Unit／engine | Fake Worker handshake、nodes commands、完整 batch、active／queued abort、restore、一般 analyze regression | queue 不死鎖且設定不污染 |
| Browser／WASM | 本機真實 worker＋NNUE、固定 FEN 重跑、abort 後一般分析 | 相同 batch／decision，一般引擎仍可用 |
| Regression | 完整 `npm test`, `npm run build` | 公開功能不退化 |

## 10. Rollout and rollback

- 新協定保持 inactive；部署只讓後續工作包可引用，沒有新入口或資料 migration。
- rollback implementation commit 即可停用；既有校準資料與公開對局不受影響。
- 若真實 WASM 無法穩定重現，保持本包未發布並修正 protocol version，不可降低驗收門檻。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 40,000 nodes／MultiPV 8 在目標手機的現場耗時是否可接受？ | 產品負責人＋實機資料 | WP011 開放對弈前 | 本包只驗證決定性；現場實測後若改值，建立新 config version。 |
| 初始 policy 是否真的有真人感、錨點間距是否合理？ | 真人棋手＋資料審查 | 任何段級映射前 | 無真人資料時保持 Open，不能由合成測試回答。 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-17
- 完成日期：2026-07-17（程式、本機驗證與正式發布完成）
- 實際變更檔案：`src/calibration/phase2Protocol.ts`、`src/calibration/humanMove.ts`、`src/engine/engineClient.ts` 與三份新測試；`anchors.test.ts` 補 legacy snapshot；同步更新 package 版本、Master SDD、SDD 002 與工作包索引。
- 與原規格的差異：稽核後把 `anomalies` 從 optional 收緊為型別與 runtime 都必填；mate distance 明確限制為非 0 且絕對值不超過 29,999；初始化失敗 Worker 加上 generation identity guard、detach 與 terminate。三項皆強化原驗收目的，沒有擴大 UI／DB 範圍。

### Verification evidence

- `npm test`：20 個 test files／154 tests 全數通過；其中 engine 14、human policy 12、protocol 4、legacy anchors 3。
- `npm run build`：通過；production assets 為 `index-Q8MVlobO.js`、`index-1qa1uhg1.css`。僅保留既有 `tree.ts` 動態／靜態 import 提示，沒有新增 build error。
- Browser／WASM：在 `crossOriginIsolated=true`、SharedArrayBuffer 可用的本機 Vite origin，以真實 worker／NNUE 對固定 FEN 執行兩次 40,000 nodes／MultiPV 8；兩次皆為 depth 8、8 候選、`bestmove c4c5`、完整 batch、無 anomaly，原始結果 byte-equivalent。兩次結果直接送入 A05 selector，decision 亦 byte-equivalent（seed hash `bf796b81`、選著 `g4g5`），所有候選均為 App 規則核心合法著。
- 中止／隔離 smoke：50,000,000 nodes 搜尋於執行中取消後得到 `AbortError`，隨後一般弱化分析與全力分析皆成功；fake Worker 另覆蓋 queued／active abort、timeout、runtime error、restore failure 與舊 Worker 延遲事件不得污染新 generation。
- 資產身分：測試逐一核對 worker、JS、WASM、pthread、NNUE SHA-256 與 package lock；另以 WASM metadata 確認 engine commit `5589ea54`。
- 獨立稽核：0 個發布 blocker；確認 production scope 未碰 UI、Dexie、`PlayPage`、`RankCalibrationPage` 或引擎資產。
- 已知限制：無真人校準資料；本包只證明工程可重現性，不能證明像真人、不能發布台灣段級映射。40,000 nodes／MultiPV 8 的目標手機耗時仍須 WP011 現場實測。

### Git and release

- Commit：`66dad94`（`feat: add reproducible calibration move policy`）。
- Push：`main` 已推送至 `origin`。
- Deploy：2026-07-17 已發布至 Firebase Hosting；Hosting URL 為 `https://xiangqi-recorder.web.app/`。
- 正式環境驗證：帶 release query 的正式頁 HTTP 200，COOP=`same-origin`、COEP=`require-corp`；HTML 載入 `index-Q8MVlobO.js` 與 `index-1qa1uhg1.css`。Chrome 設定頁顯示 v0.5.0，Fairy-Stockfish xiangqi NNUE 顯示就緒，console error 為 0；校準協定仍無公開新入口。
