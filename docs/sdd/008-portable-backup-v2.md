# SDD 008：完整本機備份 v2 與安全還原

> Status：Verified（待發布）<br>
> Owner：Codex<br>
> Created：2026-07-17<br>
> Updated：2026-07-17<br>
> Target branch：`main`<br>
> Related decisions：`D-001`, `D-006`, `D-008`, `D-012`, `D-013`<br>
> Depends on：工作包 007 已發布<br>
> Supersedes：備份格式 v1 的「只含 games」能力；v1 還原相容性保留

## 1. Context

目前備份格式 v1 只包含棋局。換電腦、瀏覽器或網站 origin 時，玩家名冊、五項一般偏好、棋子照片校準衍生範本與段級校準原始資料都無法一起搬移。現有還原還有四個資料安全問題：未拒絕未知版本、遇到壞棋局會靜默略過、逐局寫入可能留下半套資料、只用開始時間＋雙方姓名去重。

完整備份本身也有隱私邊界：備份檔可以包含棋譜、棋手姓名、匿名校準代號／自報級段與棋子衍生特徵，但絕不能包含尚未啟用的 API Token、段級校準 PIN、salt／verifier、門禁開關或記憶體 unlock 狀態。

## 2. Goals

- 建立可版本化的 backup schema v2，完整攜帶可安全搬移的本機資料。
- 保留 v1 games-only 備份的還原能力。
- 所有內容在寫入前完整解析與驗證；任一重要衝突或寫入失敗都不得留下部分資料。
- 以棋局 root node ID 作為既有資料已具備的 portable stable identity，避免 Dexie migration。
- 明確編碼／解碼 `Float32Array` 棋子範本，還原後仍可供本機辨識使用。
- 選檔後只顯示預覽；使用者按下「確認還原備份」才寫入。
- 即使 0 局，只要有一般偏好、玩家名冊、棋子或段級校準資料，仍可下載完整備份。
- 只要匯出或還原內容含段級協助者／校準對局，就以目前瀏覽器的本機段級 PIN 當場授權，維持隱藏實驗室的門禁邊界。

## 3. Non-goals

- 不建立雲端同步、帳號、後端或自動上傳。
- 不加密備份檔，也不宣稱 JSON 是安全保管庫；UI 必須提醒檔案未加密。
- 不備份 `llmToken`、`rankCalibrationGate`、PIN、salt／verifier、unlock 狀態或原始照片。
- 不清空目的端資料、不提供「整庫覆蓋」或刪除式還原。
- 不完成 SDD 002 Phase 2 的獨立校準 JSON 匯入 UI，也不提高 `RANK_CALIBRATION_SCHEMA_VERSION`。
- 不改 Dexie schema version、表 index 或棋局建立流程。
- 不在本工作包處理不同棋子範本間的人工選擇；目的端已有不同範本時保留本機版本並回報。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 008-D01 | v2 只備份五項 allowlist 偏好 | `voiceLang`, `ttsReadback`, `autoRelisten`, `analysisMovetimeMs`, `tabletop` 可攜；Token／gate 不可攜 | Accepted |
| 008-D02 | 棋局 stable ID 使用 `record.tree.id`，匯出欄位另存 `stableId` 並驗證兩者相等 | root ID 已被所有現行建立、編輯與 v1 備份流程保存，不需 migration 或改動五種建立路徑 | Accepted |
| 008-D03 | 還原採 merge、永不刪除；同 stable ID 同內容略過，不同內容整包中止 | 無法安全猜測哪份棋譜／校準原始資料才是正確版本 | Accepted |
| 008-D04 | 五項偏好由備份值覆蓋；`pieceCalibration:null` 不刪除目的端，不同範本保留目的端 | 偏好是明確可攜設定；照片範本與棋具／裝置相關，非破壞性優先 | Accepted |
| 008-D05 | v2 內嵌現有校準 schema v1 匯出快照，但只還原 profiles／games | 保留錨點技術語意，不把 PIN gate 混入原始研究資料，也不誤稱完成 Phase 2 匯入功能 | Accepted |
| 008-D06 | 新增 `fake-indexeddb` 6.2.5 僅供測試 | 資料安全工作包需要自動驗證真 Dexie transaction rollback；套件無 runtime dependency | Accepted |
| 008-D07 | 本功能版本升為 `0.4.0` | 完整備份是新的可攜資料能力，匯出 `appVersion` 必須能與工作包 007 的 `0.3.0` 區分 | Accepted |
| 008-D08 | 只要 archive 含 profiles 或 calibration games，匯出與還原都必須驗證目的 origin 現有段級 PIN | 完整備份入口是公開功能，若不驗證會繞過使用者要求的隱藏／PIN gate；PIN 不保存、不進檔案，新電腦先由 setup 入口建立本機 PIN | Accepted |
| 008-D09 | 主線變更立即清除舊 review；歷史上已錯置的衍生 review 在匯出時略過並明確計數 | 分析可重新產生，不能讓 App 舊版自己形成的 stale review 卡住整份資料備份，也不能把錯置分析當成有效資料搬移 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 008-FR01 | v2 含 games、players、五項 preferences、piece calibration、rank calibration、appVersion／exportedAt | Must | schema 單元測試與 round trip |
| 008-FR02 | 匯出字串不得出現 Token／PIN gate 欄位或其 sentinel 值 | Must | 整合測試直接搜尋 JSON |
| 008-FR03 | v1 可還原，且不改設定、棋子範本或段級校準表 | Must | 整合測試 |
| 008-FR04 | 未知／較新版本、壞 FEN／tree／typed array／校準引用在寫入前整包拒絕 | Must | validator 與 DB snapshot 測試 |
| 008-FR05 | v2 寫入同一 Dexie transaction 涵蓋五張表 | Must | failure injection rollback 測試 |
| 008-FR06 | 重複匯入冪等；同 ID 異內容不覆寫 | Must | 兩次還原與 conflict 測試 |
| 008-FR07 | 匯入先預覽，明確確認後才寫入；0 局也可備份 | Must | 瀏覽器流程 |
| 008-FR08 | 還原五項偏好後 React context 立即重新載入 | Must | 瀏覽器設定流程 |
| 008-FR09 | 含段級 profiles／games 時，missing／wrong PIN 不得序列化、下載或寫入這些資料；不含時不得多一道門禁 | Must | PIN missing／wrong／correct 整合與瀏覽器測試 |
| 008-FR10 | 記譜、對弈或復盤操作只要改變主線，就清除舊 review；既有 stale review 不得阻塞其他可攜資料 | Must | pure helper、匯出 recovery 與瀏覽器流程 |
| 008-NFR01 | schema validation 有檔案／節點／字串上限與清楚 path 錯誤 | Must | 惡意／損壞 fixture |
| 008-NFR02 | 匯出／還原完全本機，不新增網路請求 | Must | 程式差異與瀏覽器檢查 |
| 008-NFR03 | 棋譜樹 children 順序、註解、tMs、review、continuedFrom 不得改變 | Must | round trip fixture |

## 6. UX flow

### 6.1 匯出

1. 使用者在「復盤紀錄」按「完整備份」。
2. App 在同一個 read transaction 取得一致快照；若含段級 profiles／games，先顯示 PIN 對話框，正確後才驗證並下載 `.json`。不含段級原始資料時可直接下載。
3. 畫面顯示棋局、棋手、段級協助者／校準局與棋子範本摘要；若略過與目前主線不一致的歷史舊分析，顯示略過數量與「可重新解棋」。
4. 按鈕旁持續說明：JSON 未加密，可能含姓名、匿名代號、自報級段與校準備註；不含 API Token 或段級 PIN。

### 6.2 還原

1. 使用者在「匯入棋譜」選擇或貼上備份 JSON。
2. App 只解析預覽，顯示備份版本、來源 App、匯出時間與各類資料數量；此時不得寫 DB。
3. v1 顯示「只含棋局」警告；v2 說明 merge、不刪除、五項偏好會套用、不同本機棋子範本會保留。
4. 若檔案含段級 profiles／games，預覽內顯示本機段級 PIN 欄位；換電腦時要先用 setup 入口建立該 origin 的 PIN。正確 PIN 不保存，只授權當次動作。
5. 使用者按「確認還原備份」後才執行 transaction。
6. 成功後顯示各類 added／skipped 與設定／棋子結果，並刷新棋局和 App settings；若資料已 commit 但 settings context 刷新失敗，要明說「已還原、請重新整理」，不可誤報整包失敗。
7. 損壞、future version、錯誤 PIN、stable-ID conflict 或 transaction 失敗時停留在 dialog，顯示繁中錯誤，目的端資料不變。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 實際變更 | 相依性 |
|---|---|---|
| `src/store/backupSchema.ts` | v1/v2 DTO、runtime validators、tree／review／校準驗證、Float32 LE base64 codec、preview | 純 TypeScript core/store types |
| `src/store/backup.ts` | 一致匯出快照、merge planner、單一 transaction、結果摘要 | Dexie 五張表 |
| `src/store/db.ts` | App settings runtime allowlist、context 安全載入 | Dexie settings |
| `src/store/gameReview.ts` | 主線變更時統一失效舊 review | `GameRow` |
| `src/ui/ImportDialog.tsx` | 備份預覽與明確確認、結果／錯誤 UX | backup APIs |
| `src/ui/GamesPage.tsx` | 0 局完整備份、隱私提示、完整摘要 | backup APIs |
| `src/ui/RecordPage.tsx`, `PlayPage.tsx`, `ReplayPage.tsx` | 記譜、對弈、復盤改變主線時清除舊 review | `gameReview.ts` |
| `src/App.tsx` | `reloadSettings()` context API | settings store |
| `src/store/backup.test.ts` | schema／codec 純函式測試 | Vitest |
| `src/store/backup.integration.test.ts` | v1/v2 round trip、冪等、secret、rollback | Dexie + fake-indexeddb |

### 7.2 Data model and migration

backup v2 外部格式：

```ts
interface BackupFileV2 {
  format: 'xiangqi-recorder-backup'
  version: 2
  exportedAt: number
  appVersion: string
  games: Array<{ stableId: string; record: Omit<GameRow, 'id'> }>
  players: Array<{ name: string; createdAt: number }>
  preferences: {
    schemaVersion: 1
    voiceLang: 'zh-TW' | 'zh-CN'
    ttsReadback: boolean
    autoRelisten: boolean
    analysisMovetimeMs: number
    tabletop: boolean
  }
  pieceCalibration: EncodedPieceTemplatesV1 | null
  rankCalibration: RankCalibrationExport
}
```

- Dexie 保持 version 2；`stableId` 只存在 portable DTO，必須等於 `tree.id`。
- v1 正規化成內部 restore plan，games stable identity 同樣取 root ID；玩家名冊由棋局姓名重建。
- 目的端資料永不清空。players 依 trim 後 exact name 去重；profiles／calibration games 依既有 stable ID 比對。
- 同 stable ID 的 normalized 內容相同即 skipped；內容不同是不可安全合併的 conflict，第一筆寫入前中止。

### 7.3 Validators and codec

- 檔案上限 50 MiB；tree 使用 iterative traversal，限制總節點與深度，避免 stack／DoS。
- `GameNode` 驗證 root move null、child move 0–89、完整象棋合法著法、單樹 node ID 唯一、同 parent 不重複 move、FEN turn token、parent move 後 board＋turn 與 child FEN 一致；children order 原樣保存。
- `moveCount` 必須等於主線長度；continuedFrom 依 schema 重建已知欄位。GameReview 先嚴格驗證結構，再驗 plies／FEN、judgment node／side／score、主變與 counts 對應目前主線；歷史 stale review 只略過可重新產生的 review／reviewedAt 並回報數量，棋局本體仍可匯出或還原。
- 棋子範本使用 `float32-le-base64`；每 sample 2304 floats／9216 bytes、值有限且在 `0..INK_CAP`，每側分布固定 K1/A2/B2/N2/R2/C2/P5。解碼必須建立真正 `Float32Array`。
- rank export 維持 schema version 1；PIN gate 使用同一常數的現況不變，不可因 backup v2 調高。
- deterministic normalized DTO 直接 `JSON.stringify` 比對；不使用有碰撞風險且需要 async digest 的 hash。
- export 與 import 共用同一個 UTF-8 50 MiB byte-limit 檢查；匯出不得產生 App 自己無法還原的超限檔。

### 7.4 Transaction order

1. transaction 外 parse、validate、base64 decode、normalize 與 canonicalize。
2. `rw` transaction 內先讀目的端五張表與 piece setting，完成所有 stable-ID conflict 判斷。
3. 沒有 conflict 才依序 bulk add games／players、bulk put五項 preferences／可接受的 piece template、bulk add profiles／calibration games。
4. 任一寫入 reject 由 Dexie rollback 整包。

### 7.5 Offline, privacy, security, licensing

- 全程本機，沒有 fetch／upload。
- JSON 未加密；可含棋譜、棋手姓名、匿名代號、自報級段、notes 與衍生棋子特徵，UI 提醒使用者自行安全保管。
- 不含原始照片、`llmToken`、`rankCalibrationGate`、PIN、salt／verifier、enabled／auto-lock 或 unlock 狀態。
- PIN gate 不是加密；它只防止公開備份 UI 繞過隱藏實驗室。含 profiles／games 的匯出與還原皆驗證目前 origin 的 verifier，PIN 只存在當次元件 state。
- `fake-indexeddb` 6.2.5 為 Apache-2.0、0 dependencies，只在 devDependencies 與 Node tests 使用，不進 production bundle。

## 8. Acceptance criteria

- [x] v2 完整 round trip 後所有可攜資料一致，Float32Array 型別保留。
- [x] v1 備份可還原且不改目的端設定／校準。
- [x] 兩次匯入冪等；stable-ID 異內容不覆寫。
- [x] future／損壞檔與注入式中途失敗都維持五張表原狀。
- [x] Token／PIN／gate 欄位和值不出現在備份 JSON，還原後目的端 secrets 不變。
- [x] 含段級資料時 missing／wrong PIN 不得序列化、下載或寫入，correct PIN 才匯出或還原；無段級資料時不要求 PIN。
- [x] 0 局仍可下載完整備份；選檔只預覽，確認後才寫入。
- [x] 主線變動會清除舊 review；既有 stale review 只略過衍生分析並清楚提示，不阻塞其他資料。
- [x] UI 清楚說明未加密、資料範圍、merge 與排除項目。
- [x] `npm test` 通過。
- [x] `npm run build` 通過，沒有新增 warning／syntax error。
- [x] 桌面瀏覽器的鍵盤／取消與核心匯出、還原流程完成檢查。
- [x] 320、390、640 px 響應式流程完成檢查。
- [ ] 正式站匯出／預覽／還原／重複匯入完成無敏感資料的測試資料驗證。
- [x] Master SDD、README、索引與施工紀錄同步更新。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit | v1/v2 parse、tree/review/rank validator、future/corrupt cases | 正確 normalized 或 path 錯誤，無 DB 寫入 |
| Unit | Float32 LE base64 round trip、錯長度／NaN／錯棋種分布 | bit-preserving Float32Array；壞資料拒絕 |
| Integration | 完整 DB v2 round trip、v1、兩次匯入、非空 merge | 內容一致、added/skipped 正確 |
| Integration | sentinel Token／PIN gate 與 forced late write failure | secret 永不匯出／覆寫；五表 rollback |
| Integration | PIN missing／wrong／correct、profile conflict、piece conflict、stale review | 門禁有效、第一筆 write 前中止、非破壞合併、歷史衍生資料可恢復 |
| Browser | 0 局匯出、v2 預覽／取消／確認／重複、future error | 先預覽後寫入，錯誤可恢復 |
| Responsive | 320／390／640 px dialog 與摘要 | 無水平 overflow、主要按鈕可操作 |
| Regression | `npm test`, `npm run build` | 現有記譜、復盤、棋規、PWA、校準不退化 |

## 10. Rollout and rollback

- 本工作包發布後，v2 成為新匯出格式；v1 只保留 import compatibility。
- 無 Dexie migration；rollback implementation commit 不改本機資料 schema。
- 已由 v2 還原進 DB 的新增資料不自動刪除；需使用者在 UI 手動刪除棋局，校準資料則保留供下一版本處理。
- 正式站 smoke test 只使用無個資測試 fixture，完成後刪除新增棋局／profile。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 目的端已有不同棋子範本時是否要提供「以備份覆蓋」選項？ | 產品負責人 | 未來使用者實際遇到跨裝置衝突時 | v2 先保留目的端並回報，不阻擋本包 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-17
- 完成日期：2026-07-17（程式與本機驗證完成，尚待發布）
- 實際變更檔案：`package.json`, `package-lock.json`, `src/App.tsx`, `src/store/backup.ts`, `src/store/backupSchema.ts`, `src/store/db.ts`, `src/store/gameReview.ts`, 三份 store tests、`src/ui/GamesPage.tsx`, `ImportDialog.tsx`, `RecordPage.tsx`, `PlayPage.tsx`, `ReplayPage.tsx`, `src/styles.css`，以及 README／SDD 文件。
- 與原規格的差異：因完整備份入口位於公開對局清單，新增含 profiles／calibration games 時的當次本機 PIN 驗證（008-D08）；為相容舊版 App 已可能形成的錯置 review，新增主線變更即失效 review 與 archive 略過／計數策略（008-D09）；匯出與匯入共用 UTF-8 50 MiB 上限，避免產生 App 自己無法還原的檔案。

### Verification evidence

- `npm test`：通過；17 個 test files、123 tests 全部通過。
- `npm run build`：通過；TypeScript 與 Vite production build 完成，沒有新增編譯／syntax error。
- `git diff --check`：通過。
- 自動驗證：v1／v2 round trip、Float32 LE codec、UTF-8 byte limit、完整象棋合法著法與 review 關聯、敏感欄位排除、PIN missing／wrong／correct、piece/profile/game conflict、stale review recovery、冪等還原與 forced late-write rollback 均有測試。
- 本機瀏覽器（桌面 viewport）：完整備份下載、選檔後先預覽且不立即寫入、Escape／取消、確認還原、added／skipped 結果與重複匯入流程已驗證；含段級資料的 PIN 欄位與 legacy stale-review 提示均能在預覽流程呈現。
- 響應式檢查：320、390、640 px 的 document／dialog `scrollWidth === clientWidth`，主要按鈕皆可見；320 px 採單欄按鈕。Escape 與「取消」都能關閉視窗，console 無 warning／error。
- 已知限制：JSON 未加密且上限 50 MiB；目前不自動同步；目的端已有不同棋子範本時固定保留本機版本、沒有覆蓋選項；歷史 stale review 會略過並需重新解棋；PIN 只是本機防誤入門禁，不是檔案加密或真正權限系統。

### Git and release

- Commit：未建立。
- Push：未執行。
- Deploy：待 implementation commit／push 後依 repository 預設執行；尚未部署。
- 正式環境驗證：未執行。
