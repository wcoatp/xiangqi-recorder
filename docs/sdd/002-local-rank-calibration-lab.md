# SDD 002：本機段級校準實驗室

> Status：Released（Phase 1、Phase 2A 工程核心、Phase 2B 資料鏈）；Phase 2C 由工作包 011 Verified／待發布；其餘 Phase 3+ Deferred<br>
> Owner：專案作者<br>
> Created：2026-07-16<br>
> Updated：2026-07-17<br>
> Related decisions：`D-001`, `D-004`, `D-005`, `D-006`, `D-007`<br>
> Depends on：無（Phase 1）；可協助校準的台灣象棋棋手（Phase 3）<br>
> Implementation：Phase 1 已於 2026-07-16 完成、驗證並正式發布

完整校準實驗室仍採分階段施工。產品負責人已於 2026-07-16 核准並發布 Phase 1；2026-07-17 以「繼續完成後續所有施工」授權並發布 Phase 2A 工作包 009 與 Phase 2B 工作包 010，建立可重播的選著／引擎搜尋協定，以及 schema v2 安全匯入與版本隔離統計。Phase 2C 工作包 011 的現場對弈已完成本機驗證、待正式發布；公開段級映射仍須依後續獨立工作包驗收，不得把未審查資料直接改寫公開難度。

### 1.1 Phase 1 已核准範圍

- 以 `?rank-calibration=setup` 作為明確、可交接的本機 feature gate 啟用入口；新安裝預設完全不顯示。
- 啟用後只在設定頁顯示「段級校準實驗室」，每次仍需 PIN。
- PIN 使用 Web Crypto PBKDF2／SHA-256 保存 salt 與 verifier，不保存明文；重新整理與閒置 15 分鐘後上鎖。
- 建立 Dexie v2 的協助者與校準棋局資料表，保留未來完整原始資料欄位。
- 凍結 `A01`～`A10` 的 `2026.07-v1` 引擎設定；UI 只顯示錨點 ID 與相對順序，不顯示底層尺度。
- 可建立匿名協助者 profile，記錄自報級／段、制度來源分類與本機同意時間。
- 可匯出 schema v1 JSON；包含錨點、profiles、games，不含 PIN、salt、verifier 或 unlock 狀態。
- 可關閉 feature gate 並保留資料；重新使用 setup URL 可再次開啟。

### 1.2 Phase 1 延後項目的目前拆分

- 不開始校準對弈，不把一般 `PlayPage` 棋局算入校準資料。
- 工作包 009：只實作 `seeded-multipv-v1` 工程核心、seed／候選 decision 與專用 fixed-nodes 引擎 API；保持 inactive，不接 UI／DB。
- 工作包 010（已發布）：校準 schema v2、JSON 匯入／合併與版本隔離純統計。
- 工作包 011（已驗證、待發布）：獨立現場校準 match controller；一般 `PlayPage` 棋局仍不可算入校準資料。
- 不發布 A01～A10 對應的台灣段級，也不修改公開 `PLAY_LEVELS`。

## 1. Context

目前 App 用 `業餘10級` 到 `業餘9段` 呈現相對難度，底層限制棋力參數只保證大致單調變強，沒有經過台灣中國象棋棋手校準。現在也沒有人類棋手可立即提供大量標註。

未來作者可攜帶自己的電腦到象棋協會，請棋手先輸入自己的級／段，再與固定引擎節點對弈。App 收集結果後帶回本機分析，不需要先建立帳號、伺服器或公開入口。

## 2. Goals

- 建立預設隱藏、PIN 解鎖的段級校準入口。
- 先校準 10 個可版本化、可重現的固定錨點。
- 讓協助者輸入自己在台灣使用的級／段，完成正常對弈即可留下資料。
- 原始對局、引擎設定、選著過程與結果都可稽核、重新計算。
- 所有資料先存在目前電腦的目前瀏覽器，支援版本化匯出／匯入。
- 校準資料不足時不影響公開難度表，也不誤導使用者。

## 3. Non-goals

- 不建立雲端帳號、後台或即時跨裝置同步。
- 不讓一般使用者從首頁看見校準實驗室。
- 不把 PIN 描述為強加密、DRM 或真正的管理員權限。
- 不在第一版自動宣布任何人取得段位。
- 不在資料不足時自動覆寫 `PLAY_LEVELS`。
- 不直接以內部西洋棋 Elo 當作中國象棋段級證據。
- 不把協會名稱或認證關係寫進 UI，除非取得明確授權。

## 4. Product decisions

| ID | 決策 | 狀態 | 說明 |
|---|---|---|---|
| 002-D01 | 校準入口預設完全隱藏。 | Accepted | 不放首頁；只能從受控入口開啟。 |
| 002-D02 | 由本機 PIN 解鎖。 | Accepted | 防止平常誤觸；不宣稱可抵禦有裝置控制權的人。 |
| 002-D03 | 資料先只存本機。 | Accepted | 不做後端；每個 origin／browser profile 各自獨立。 |
| 002-D04 | 先做 10 個固定錨點。 | Accepted | 內部 ID 使用 `A01`～`A10`；顯示段級可後續映射。 |
| 002-D05 | 原始資料與公開映射分離。 | Accepted | 收到新棋局不立即改變一般使用者難度。 |
| 002-D06 | 引擎加入版本化的實驗性選著。 | Accepted；工程 v1 見 SDD 009 | `seeded-multipv-v1` 必須記錄 seed、候選與分數；尚未經真人驗證，不得直接稱為真人棋風。 |
| 002-D07 | 校準資料以匯出檔搬移。 | Accepted | 不自動同步；匯入需處理重複與 schema version。 |
| 002-D08 | PIN 忘記時可重設門禁。 | Phase 1 deferred | 第一階段可關閉／重開入口但不可繞過既有 PIN；正式重設流程留待後續，且預設應保留資料。 |
| 002-D09 | Phase 1 入口以 URL gate 明確啟用。 | Accepted | 使用 `?rank-calibration=setup`，避免首頁入口與不可交接的連點彩蛋。 |
| 002-D10 | Phase 1 不建立校準棋局。 | Accepted | humanized policy 尚未完成前不收可能污染分析的資料。 |

## 5. User stories

### 5.1 作者準備校準

1. 作者在自己的電腦打開受控入口。
2. 輸入 PIN 解鎖本次校準 session。
3. 確認目前 App、引擎、錨點與人類化策略版本。
4. 建立或選擇協助者 profile。

### 5.2 協助者進行對弈

1. 輸入顯示名稱或匿名代號。
2. 選擇自己宣稱的級／段與制度來源。
3. 閱讀資料只存本機的短說明並同意本次收集。
4. App 指派錨點與紅／黑方，操作方式與一般人機對弈一致。
5. 棋局結束後記錄結果、原因與完整棋譜。
6. 顯示「已收集」，不立即顯示對方相當於哪一段，也不評定協助者段位。

### 5.3 作者帶回資料

1. 在校準實驗室查看每個錨點的棋局數與基本分布。
2. 匯出版本化 JSON，另存備份或帶到開發環境分析。
3. 匯入其他合法來源的資料時，依 stable ID 去重並重新計算統計。
4. 只有經人工檢查與明確發布流程，才能產生新的公開難度映射版本。

## 6. Functional requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 002-FR01 | 功能預設 disabled 且無首頁入口。 | Must | 新安裝找不到校準入口；一般操作不載入校準 UI。 |
| 002-FR02 | 受控方式開啟後仍需 PIN。 | Must | 未解鎖不能看 profile、資料或開始校準局。 |
| 002-FR03 | PIN 只保存 salted derived key／hash，不存明文。 | Must | IndexedDB／匯出檔沒有 PIN 明文。 |
| 002-FR04 | 解鎖狀態只存在記憶體。 | Must | 重新整理、關閉頁面或逾時後重新上鎖。 |
| 002-FR05 | 協助者需填自報級段與制度來源。 | Must | 每場校準局可追溯到 profile revision。 |
| 002-FR06 | 10 個錨點有 stable ID 與 immutable config version。 | Must | 同版本 `A01` 的引擎設定完全一致。 |
| 002-FR07 | 人類化選著記錄 policy version、seed、候選與實際選擇。 | Must | 給定相同局面與紀錄可解釋實際著法。 |
| 002-FR08 | 紅黑方需平衡或明確記錄分派原因；Phase 2B 起 `balanced-alternation-v1` 以同 profile revision＋anchor config＋collection protocol 收集序號偶紅奇黑。 | Must | validator 核對分派序號唯一及 playerSide，統計拆分先後手。 |
| 002-FR09 | 原始校準棋局不可被聚合結果覆蓋。 | Must | 聚合資料可由原始棋局重新建立。 |
| 002-FR10 | 完成一局後本機統計立即更新。 | Must | 同一瀏覽器重新進入可看到新增棋局。 |
| 002-FR11 | 不同電腦不會自動更新彼此資料。 | Must | 無後端網路請求；文件與 UI 明確說明。 |
| 002-FR12 | 支援 JSON 匯出、匯入、去重與 schema version。 | Must | round trip 後原始資料與聚合一致。 |
| 002-FR13 | 校準資料不自動改寫一般 `PLAY_LEVELS`。 | Must | 新資料只影響實驗室；發布映射需獨立步驟。 |
| 002-FR14 | UI 不顯示底層西洋棋 Elo。 | Must | 畫面與匯出給棋手的摘要只顯示錨點／台灣級段。 |
| 002-FR15 | 可停用實驗室而保留資料。 | Should | 關閉 feature gate 後一般 App 不受影響。 |

## 7. UX design

### 7.1 入口

Phase 1 使用正式網址加上 `?rank-calibration=setup` 明確啟用目前 origin／browser profile 的 feature gate。啟用完成後會移除網址參數，並在設定頁顯示「段級校準實驗室」。不使用首頁入口或連點彩蛋。

Feature gate 與 PIN 是兩層：

1. `rankCalibrationEnabled = false`：完全不顯示入口。
2. enabled 後：顯示入口，但每次 session 仍要 PIN 解鎖。

Phase 1 PIN 規則為 4～12 位數字、PBKDF2／SHA-256、150,000 iterations、16-byte 隨機 salt；unlock flag 只存在 React memory，閒置 15 分鐘上鎖。這些參數屬門禁版本 v1，不代表強加密保證。

### 7.2 主要畫面

- **鎖定畫面**：PIN、剩餘等待時間、重設／離開。
- **儀表板**：錨點版本、資料筆數、匯出、匯入、上鎖。
- **協助者資料**：匿名代號、級／段、制度來源、備註與同意狀態。
- **對弈準備**：指派錨點、先後手、必要的休息／退出。
- **正常對弈**：重用 `PlayPage` 與棋盤體驗，但顯示這是校準局且禁用會污染結果的功能。
- **結束確認**：結果、終局原因、異常註記；不顯示推測段位。

### 7.3 失敗與中斷

- PIN 錯誤：不透露資料是否存在；連續錯誤要短暫延遲。
- 引擎不可用：不得開始校準局，保留已收資料。
- 對局中斷：保存為 `aborted`，不計入主要勝負統計，但保留稽核。
- 匯入版本過新：拒絕寫入並保留原檔，不做部分靜默匯入。
- 重複資料：依 stable game ID 跳過並回報數量。

## 8. Proposed technical design

### 8.1 模組分界

建議新增：

| 模組 | 責任 |
|---|---|
| `src/calibration/rankTypes.ts` | schema、versioned IDs、純型別。 |
| `src/calibration/anchors.ts` | 10 個錨點與 config version，不含 UI 文案。 |
| `src/calibration/humanMove.ts` | 人類化候選與選著，輸入 seed 並輸出完整 decision record。 |
| `src/calibration/stats.ts` | 從原始棋局純函式重建聚合。 |
| `src/store/rankCalibration.ts` | Dexie 存取、匯出、匯入、去重與 migration。 |
| `src/ui/RankCalibrationLab.tsx` | 儀表板與 workflow。 |
| `src/ui/RankCalibrationUnlock.tsx` | PIN 設定、驗證、逾時與上鎖。 |

不要覆用現有 `CalibrateDialog.tsx`；它專門做棋子照片範本校準。

### 8.2 Proposed Dexie schema（version 2）

實作前要再次檢查 Dexie migration；下列只是資料分界，不是最終索引語法。

```ts
interface RankCalibrationSettings {
  schemaVersion: number
  enabled: boolean
  pinSalt: string
  pinVerifier: string
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number }
  autoLockMinutes: number
}

interface CalibratorProfile {
  id: string
  revision: number
  alias: string
  claimedRank: string
  rankSystem: string
  consentedAt: number
  createdAt: number
}

interface AnchorDefinition {
  id: `A${string}`
  configVersion: string
  engineConfig: Record<string, unknown>
  movePolicyVersion: string
}

interface CalibrationGame {
  id: string
  schemaVersion: number
  profileId: string
  profileRevision: number
  anchorId: string
  anchorConfigVersion: string
  movePolicyVersion: string
  randomSeed: string
  playerSide: 'red' | 'black'
  result: 'red' | 'black' | 'draw' | 'aborted'
  resultReason?: string
  startedAt: number
  endedAt?: number
  gameSnapshot: unknown
  appVersion: string
  engineVersion: string
}
```

建議使用獨立 tables：

- `rankCalibrators`
- `rankCalibrationGames`
- `rankCalibrationSettings` 或既有 settings 的單一 versioned object

聚合結果優先在讀取時由純函式計算；若效能需要 cache，cache 必須可刪除並重建，不能是唯一資料來源。

### 8.3 本機與跨裝置行為

「每一局完成就更新」只發生在目前 origin 的目前瀏覽器資料庫：

- 同一台電腦、同一瀏覽器、同一正式網址：會持續累積。
- 同一台電腦但 localhost 與正式站：不共享。
- 換 Chrome profile、Safari、另一台電腦：不共享。
- 需要帶走時：匯出校準 JSON。
- 需要合併時：在目標電腦匯入，依 stable IDs 去重後重算。

第一版不得偷偷加入 Firebase、Google Drive 或其他同步。

### 8.4 PIN security boundary

- 建議使用 Web Crypto PBKDF2 + SHA-256 與隨機 salt 保存 verifier。
- PIN 不得出現在匯出資料、診斷資訊、console 或 Git。
- 解鎖 flag 只存在 React memory，不寫 localStorage。
- refresh、關頁、閒置逾時立即上鎖。
- 連續失敗增加等待時間，避免孩童或現場誤按。
- 前端 PIN 無法阻止懂 DevTools、能讀 IndexedDB 或能改程式的人；UI 必須誠實說明。

### 8.5 Fixed anchors

- 第一版只建立內部 `A01`～`A10`，ID 與 config 不因顯示名稱改變。
- 每個 anchor 保存完整引擎設定、思考時間、人類化 policy version 與資產版本。
- 10 個錨點對應哪些台灣級／段 **尚未定案**；不可先把名稱硬寫進資料 key。
- 修改任何會影響棋力的參數都建立新 config version，不覆寫舊版本。

### 8.6 Humanized move selection

工程協定 v1 由 [SDD 009](009-reproducible-calibration-move-policy.md) 定義；仍須真人資料驗證，但必須滿足：

- 引擎先產生多個候選及分數，不總是固定走第一名。
- 選擇分布依 anchor 強度調整；不得在所有局面使用相同隨機率。
- 避免明顯非法、立即送將或與目標強度不符的極端著法，除非 policy 明確允許。
- 對開局、戰術局面、安靜局面可採不同容錯。
- 每一步記錄候選、分數、policy version、seed 與最後選擇。
- 給定相同 decision record 能解釋原選擇；統計分析不依賴無法重現的全域亂數。

## 9. Calibration methodology

### 9.1 收集單位

一筆可用資料至少包含：協助者自報級段、制度來源、anchor version、先後手、完整棋譜、結果與中斷狀態。

### 9.2 對弈安排

- 每個協助者盡量對多個相鄰錨點下棋。
- 紅黑方數量盡量平衡。
- 不把提示、分析或任意悔棋局納入主要統計；特殊狀況另做 flag。
- 連續多局要允許休息並記錄 session，降低疲勞偏差。

### 9.3 發布門檻

目前不先寫死局數門檻。未來至少要檢查：

- 每個錨點的有效棋局數。
- 不同級段與不同棋手的人數，而非只有同一位反覆對局。
- 紅黑方拆分。
- 勝／和／負與不確定區間。
- 不同 app、engine、anchor、policy version 是否可合併。
- 異常局與中斷局比例。

只有人工審查後，才產出獨立的 `publicRankMappingVersion`。這個發布動作應另開 SDD 或 release record。

## 10. Export format

建議最外層：

```ts
interface RankCalibrationExport {
  format: 'xiangqi-recorder-rank-calibration'
  schemaVersion: number
  exportedAt: number
  appVersion: string
  anchors: AnchorDefinition[]
  profiles: CalibratorProfile[]
  games: CalibrationGame[]
}
```

要求：

- 不含 PIN verifier、salt、內部 unlock 狀態。
- 匯出前明確列出 profile 與棋局數。
- 支援匿名 alias，不要求真名。
- 預設不包含不必要的裝置指紋。
- 匯入先完整驗證，再以 transaction 寫入。
- 未知欄位可保留或忽略，但不能破壞已知資料；不支援的 schema 要整批拒絕。

## 11. Acceptance criteria

- [x] 新安裝與一般使用者看不到校準實驗室。（Phase 1）
- [x] feature gate 開啟後，未輸入正確 PIN 仍不能進入。（Phase 1）
- [x] PIN 不以明文保存、匯出或記錄。（Phase 1）
- [x] refresh 與閒置逾時會上鎖。（Phase 1）
- [x] 可建立帶級段與制度來源的匿名協助者 profile。（Phase 1）
- [ ] A01～A10 的 config 與 version 可在校準局中完整追溯。
- [ ] 每一著的人類化選擇有 policy version 與 seed 紀錄。
- [ ] 完成、和棋、認輸、中斷都能正確分類。
- [ ] 原始棋局保存後可重建相同聚合統計。
- [ ] 同一匯出檔重複匯入不會產生重複棋局。
- [ ] 匯出再匯入另一個乾淨資料庫後內容一致。
- [x] 沒有校準資料的網路請求。（Phase 1）
- [x] 新資料不會自動改變公開 `PLAY_LEVELS`。（Phase 1）
- [x] UI 與協助者摘要不顯示底層西洋棋 Elo。（Phase 1）
- [x] 舊 Dexie v1 使用者升級後原有 games／players／settings 完整保留。（Phase 1）
- [x] `npm test` 與 `npm run build` 通過。（Phase 1）

Phase 1 另已驗證：`A01`～`A10` 與完整 engine config 會進入 schema v1 技術匯出、匯出不含 PIN；校準局、人類化選著、統計重建與匯入去重仍屬未勾選的後續驗收項目。

## 12. Test plan

| 層級 | 必測項目 |
|---|---|
| Unit | anchor config snapshot、seed 重現、人類化 policy 邊界、聚合重建、去重、schema validation。 |
| Store integration | Dexie v1 → v2 migration、transaction rollback、匯出／匯入 round trip。 |
| UI | feature gate、正確／錯誤 PIN、auto-lock、profile、對弈中斷、結果確認。 |
| Regression | 一般人機對弈、棋譜清單、備份、Settings、照片「棋子校準」不受影響。 |
| Browser／device | 真正支援 IndexedDB、Web Crypto、Worker、SharedArrayBuffer 的目標瀏覽器。 |
| Data quality | 先以合成結果驗證統計，不把合成資料混入真實校準 export。 |

## 13. Rollout

1. **Phase 0 — 規格凍結**：回答 Open Questions，確認資料與同意界線。
2. **Phase 1 — 本機骨架**：Dexie migration、feature gate、PIN、profile、10 個 config registry 與 JSON 匯出。
3. **Phase 2A／工作包 009 — 可重現選著核心**：fixed nodes、單執行緒、fresh hash、資產 snapshot、seed／候選 decision；inactive，不接 UI／DB。
4. **Phase 2B／工作包 010 — 資料鏈（已發布）**：schema v2、版本化匯入／去重、原始資料與純統計重建。
5. **Phase 2C／工作包 011 — 現場對弈（已驗證、待發布）**：獨立 match controller、紅黑平衡、中斷續存與結果分類。
6. **Phase 3 — 現場收集**：作者帶電腦給棋手使用，只收資料不發布段位。
7. **Phase 4 — 分析與映射**：檢查樣本與偏差，產生候選 mapping version。
8. **Phase 5 — 公開發布**：另行核准、更新免責文案、回歸測試與正式部署。

任何 phase 都可關閉 feature gate；原始資料不應因關閉入口被刪除。

## 14. Open questions

| 問題 | 為何會阻擋 | 決策 |
|---|---|---|
| 台灣採用哪套正式級／段名稱與制度來源？ | 決定 profile 欄位與 UI 選項。 | Phase 1 使用通用 10級～9段與四種來源分類；正式制度映射仍 Open。 |
| A01～A10 的初始引擎 config 是什麼？ | 決定第一批可重現錨點。 | Phase 1 已凍結 `2026.07-v1`；Phase 2 加入 humanized policy 時必須建立新 config version。 |
| experimental policy v1 如何依局面選候選？ | 直接影響棋力與可信度。 | 工作包 009 先固定 `seeded-multipv-v1` 作工程基準；真人感與參數仍 Open，取得真人資料前不得視為已校準。 |
| 每位棋手／錨點至少要下幾局？ | 決定現場時間與發布門檻。 | Open |
| 忘記 PIN 時，重設門禁是否保留資料？ | 影響安全說明與恢復 UX。 | Phase 1 deferred；目前不可繞過既有 PIN，未來預設應保留資料。 |
| 匯出檔是否保留制度／協會自由文字？ | 涉及個資、命名一致與資料清理。 | Phase 1 只存四種來源分類；備註限制 200 字。 |
| 是否允許使用真名？ | 涉及同意、隱私與未來公開資料。 | Phase 1 不要求真名並明確建議匿名代號；未做真名偵測。 |
| 哪些異常局可以排除，誰有權標記？ | 影響統計稽核。 | Open |

## 15. Construction record

### Phase 1 implementation

- 日期：2026-07-16。
- Dexie：新增 version 2、`rankCalibrators`、`rankCalibrationGames`，既有 tables 不改寫。
- 門禁：`?rank-calibration=setup` 啟用 feature gate；PBKDF2／SHA-256、150,000 iterations、16-byte salt；4～12 位數字 PIN；15 分鐘閒置與離頁上鎖。
- 錨點：`A01`～`A10`、config `2026.07-v1`；UI 不顯示底層尺度，Phase 1 不開始對弈。
- 資料：匿名 profile、本機同意時間、schema v1 JSON 匯出；PIN gate 明確排除於匯出格式。
- UI：設定頁條件式入口、鎖定／設定 PIN、資料摘要、錨點表、profile 表單、上鎖與隱藏入口。

### Phase 1 verification

- Unit：錨點 snapshot／ID、PIN 規則與 verifier、匯出格式不含 PIN。
- `npm test`：10 個 test files、78 tests 全部通過。
- `npm run build`：成功；只有既有 `tree.ts` 動態／靜態 import chunk 提示。
- Browser：在真實 IndexedDB／Web Crypto 環境驗證預設隱藏、setup 啟用且移除 query、PIN 不一致阻擋、設定 PIN、refresh 重新上鎖、正確 PIN 解鎖、profile 持久化、JSON 下載、手動上鎖。
- Responsive：320 × 568、390 × 844、640 × 900 鎖定頁無水平溢出；640px 儀表板主要區塊正常。
- 已知限制：未等待 15 分鐘做實時 timeout 測試，但相同 timer 路徑與手動／離頁 lock 已驗證；尚未做多款實體手機測試。

### Git and release

- Commit：`dba28db`（`feat: add local rank calibration lab phase one`）。
- Push：已推送 `main` 至 `origin`。
- Deploy：2026-07-16 22:44（Asia/Taipei）部署至 Firebase Hosting；正式網址 https://xiangqi-recorder.web.app/ 。
- 正式環境驗證：HTML 載入 `assets/index-BmV_hqit.js` 與 `assets/index-CfamfCCt.css`；回應含 `Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Embedder-Policy: require-corp`；一般設定頁仍預設隱藏實驗室。為避免改動作者正式 origin 的 PIN／資料，setup→PIN→profile→匯出完整流程使用本機同版 production code 驗證。
