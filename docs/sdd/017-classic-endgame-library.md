# SDD 017：經典殘局題庫與局面練習

> Status：Verified<br>
> Owner：Codex／產品負責人<br>
> Created：2026-07-18<br>
> Updated：2026-07-18<br>
> Target branch：`main`<br>
> Related decisions：`D-001`, `D-004`, `D-008`, `D-009`, `D-011`, `D-017`, `D-018`, `D-019`, `D-021`<br>
> Depends on：[SDD 006](006-continue-from-replay-position.md)、[SDD 013](013-ipad-full-viewport-layout.md)、[SDD 014](014-ipad-play-board-first-layout.md)、[SDD 015](015-responsive-analysis-workspace.md)<br>
> Supersedes：無<br>
> Authorization：產品負責人於 2026-07-18 確認「加入、統整並開始施工」。

## 1. Context

目前「殘局解析」只能由使用者手動擺盤或拍照帶入。棋友還不能從 App 內挑選經典殘局、按難度練習，也不能把同一局面直接交給實體棋盤記錄、人機對弈或自由分析。另一方面，網路上的現代殘局圖、講解、題庫編排與程式資料未必可再散布；「越多越好」必須建立在可追溯來源與逐包驗證上，不能直接抓取來源不明的現代題庫。

本工作包把古譜公版原作轉為 App 自行整理的結構化局面資料，保留來源帳與版本，先交付可驗證的首批內容和可擴充管線。題庫難度先使用 App 五級相對階梯；在沒有真人協助校準前，不把題目硬映射成台灣協會級段。

## 2. Goals

- 在殘局頁提供可搜尋、依五級難度與來源篩選的經典殘局題庫。
- 內建涵蓋五階難度的小型離線包，並讓使用者明確下載較大題包；下載後無網路仍可使用。
- 每題提供四條互不混淆的路徑：「解題練習」、「開始記錄」、「人機對弈」、「自由分析」。
- 「開始記錄」建立雙方由真人／實體棋盤走子的獨立棋局；「人機對弈」建立一方由本機引擎控制的獨立棋局。
- 從題庫或復盤局面建立新局時共用任意合法 FEN 建局核心，來源棋譜／題目不可被新局修改，計著與循環統計重新起算。
- 題包保留作品年代、原題序、來源網址、權利判斷與 App 自寫內容聲明；不散布現代掃描頁、現代註解或來源不明解答。
- 練習次數、解出狀態與提示次數只保存在目前瀏覽器。

## 3. Non-goals

- 本輪不宣稱已收錄所有古譜，也不承諾一次匯入網路上所有殘局。
- 本輪不複製現代出版社的棋圖、註解、解說影片、題目編排或授權不明 PGN 解答。
- 本輪不把 App 五級難度標示成中華民國象棋協會認證級／段；真人校準需延續 SDD 002 另行驗證。
- 本輪不新增帳號、雲端同步、後端題庫或跨裝置進度。
- 本輪解題以本機引擎應手與終局結果判定，不自動處理需裁判判定的複雜長捉／循環勝負。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 017-D01 | 首批內容採「內建五階離線包＋使用者主動下載的公版精選包」。 | 首次安裝即可在每一階選題，也避免所有題目增加主程式體積。 | Accepted |
| 017-D02 | 難度顯示一至五級 App 題庫難度，明示不是協會級段。 | 目前沒有人類專家可校準，不能製造虛假的段級精度。 | Accepted |
| 017-D03 | 一題固定提供解題、記錄、人機、分析四個動作。 | 四種使用意圖不同，入口名稱要直接表達誰在走棋。 | Accepted |
| 017-D04 | 題包只採公版古籍原局面；App 自行重排、標記難度與撰寫提示文案。 | 單一局面事實與古籍原作的權利風險較低，但現代選編與解說仍可能受保護。 | Accepted |
| 017-D05 | 題包 JSON 下載後經 runtime schema 與棋規核心驗證，再存入現有 IndexedDB `settings` 表。 | 不增加後端或 Dexie schema migration，且可真正離線使用；損壞檔案不得部分安裝。 | Accepted |
| 017-D06 | 題庫新局與復盤接續共用任意局面建局核心，另存自含題目來源快照。 | 避免兩套建局規則分歧，並保證刪除題包後舊棋局仍可追溯。 | Accepted |
| 017-D07 | 解題模式不直接顯示古譜解答；提示由全強度本機引擎即時計算。 | 避免複製授權不明的現代解答，也保留探索感。 | Accepted |
| 017-D08 | 進度與下載包是本機資料；本輪不納入完整備份 v2。 | 先避免擴張既有備份契約；重裝或清除網站資料會遺失，介面必須說明。 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 017-FR01 | 殘局頁可瀏覽內建題目、搜尋題名並依難度／來源篩選。 | Must | 單元測試與瀏覽器操作。 |
| 017-FR02 | 可明確下載、驗證、安裝與刪除額外題包；離線重開後仍可讀取已安裝內容。 | Must | IndexedDB integration test 與 browser offline check。 |
| 017-FR03 | 每題顯示題名、輪到哪方、目標、五級難度、主題、古譜來源與權利說明。 | Must | UI／資料 validator 測試。 |
| 017-FR04 | 從題目可建立記錄或人機獨立新局，保留初始 FEN 與題目來源快照並重新起算計著。 | Must | store tests 與兩條 browser flow。 |
| 017-FR05 | 解題模式由使用者控制題目方、引擎防守；可提示、重來並保存本機進度。 | Must | engine mock test／browser smoke。 |
| 017-FR06 | 自由分析可把題目 FEN 帶入既有響應式分析工作台。 | Must | browser flow。 |
| 017-FR07 | 不合法、已結束、schema 不符或重複 ID 衝突的題包整包拒絕。 | Must | validator tests。 |
| 017-NFR01 | 所有棋譜、進度與下載內容預設不離開裝置；只有主動下載題包時讀取同站靜態 JSON。 | Must | Network／code inspection。 |
| 017-NFR02 | 320px 手機與 iPad 直／橫向無水平溢位；棋盤不因資訊面板變高而縮成不可用。 | Must | responsive browser matrix。 |
| 017-NFR03 | 題庫文案為台灣繁中，不出現西洋棋 Elo 或協會認證暗示。 | Must | copy review／tests。 |

## 6. UX flow

1. 使用者由首頁或漢堡選單進入「殘局解析」。預設看到「經典題庫」，也能切到既有的「自行擺盤」。
2. 未下載的題包顯示題數、來源與下載大小；按「下載到這台裝置」後才讀取同站 JSON。失敗時保留原狀並顯示可重試訊息。
3. 點題目顯示棋盤預覽與四個動作：
   - **解題練習**：題目方由使用者走，引擎防守；答案不先顯示，可主動索取提示。
   - **開始記錄**：帶入開始記錄流程，紅黑雙方都由真人／實體棋盤走。
   - **人機對弈**：帶入對弈設定，使用者選執紅或執黑，另一方交給引擎。
   - **自由分析**：帶入既有分析工作台，可試走與查看多主變。
4. 記錄／人機沿用復盤「從此局面另開新局」的姓名與方別設定，不修改題庫資料。
5. 題庫頁顯示已練習／已解出；清除瀏覽器網站資料會刪除下載包與進度。
6. 螢幕閱讀器可讀出題名、難度、輪到哪方及按鈕用途；按鈕具明確文字，不只依靠圖示或顏色。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `src/endgames/` | 題包型別、runtime validator、內建題包、catalog 與權利來源資料。 | `src/core/fen.ts`, `src/core/placement.ts` |
| `public/endgames/` | 版本化可下載 JSON 題包。 | Firebase Hosting 靜態檔案 |
| `src/store/endgameLibrary.ts` | 以 `settings` 表原子保存題包與練習進度。 | Dexie v2，不升 schema |
| `src/store/positionGame.ts` | 從任意合法 FEN 建立記錄／人機局的共用工廠。 | `games`, `players`, `GameNode` |
| `src/store/gameContinuation.ts` | 改由共用工廠建立復盤接續局。 | SDD 006 行為不變 |
| `src/store/db.ts`, backup validator | 加入自含 `endgameSource` 可攜來源快照。 | full backup v2 |
| `src/ui/EndgamePage.tsx` | 題庫／擺盤切換、篩選、預覽、下載與四入口。 | Board、App view |
| `src/ui/PlayPage.tsx` | 在既有對弈棋盤加入解題模式、全力引擎應手、提示、重來與進度。 | EngineClient、規則核心 |
| `src/ui/StartFromEndgameDialog.tsx` | 記錄／人機建局設定。 | position game factory |
| `src/App.tsx`, `src/styles.css` | 新 view 與手機／iPad 響應式版面。 | App shell |
| `README.md`, `docs/SDD.md` | 使用方式、權利邊界、架構與交接。 | 本 SDD |

### 7.2 Data model and migration

- Dexie 維持 schema v2，不新增 table/index。
- 安裝包使用 `settings.id = endgame.pack.<packId>`；值包含完整、驗證後的 pack JSON。
- 進度使用 `settings.id = endgame.progress.<puzzleId>`；記錄 attempts、solved、bestHints、lastPlayedAt。
- `GameRow` 新增 optional `endgameSource` 自含快照：schemaVersion、packId、puzzleId、title、sourceWork、sourceOrdinal、sourceFen。
- full backup v2 只需 allowlist 接受／保存 `GameRow.endgameSource`；題包快取與彙總進度本輪不加入備份。舊資料完全相容，不需 migration。
- 題包安裝先在記憶體完成 JSON/schema/FEN/ID 全驗證，再以單筆 `settings.put` 寫入；失敗不留下部分內容。

### 7.3 Algorithms or interfaces

- `validateEndgamePack(unknown) -> EndgamePack`：驗證 schemaVersion、pack/version/id、權利帳、每題欄位、唯一 ID、FEN、輪到方與非終局狀態。
- `createPositionGame(fen, setup, provenance)`：合法性／終局檢查、建立空 root、重設 halfmove／循環計數語意、保存玩家與來源快照。
- 題目 difficulty 為 `1 | 2 | 3 | 4 | 5`；本版依 App 編輯評估的局面複雜度、候選分支與預期解題長度分層，將來只能透過 pack version 調整。
- 解題模式使用目前本機全強度引擎；不套用人機相對級段限制。提示回傳當前第一建議著；使用者走完後引擎走對手方最佳應手。
- App 只在規則核心回報將死／困斃時自動判定完成；需長捉、自然限著或其他裁判判決的題目不列入首批自動解題包。

### 7.4 Offline, privacy, security, licensing

- 內建十二題涵蓋全部五階並隨 App 預快取；額外題包第一次下載需要網路，驗證並存入 IndexedDB 後離線可用。
- 題包下載只連到目前正式站的 `/endgames/*.json`；不傳送棋譜、進度、照片或裝置識別資訊。
- 首批作品來源為明代公版古譜《適情雅趣》（1570）。App 不重新散布古籍掃描檔，只連結可查證的公版館藏頁；FEN、標籤、難度、權利說明與 UI 文案由本專案自行整理。
- 每一題保存原題序；pack manifest 保存原作、年代、館藏 URL、rights status、審查日期與限制。若來源無法確認，題目不得進 production pack。
- 「公版原作」不等於任何現代翻印、OCR、解答或選編都可自由複製。後續擴充仍須逐包建立來源帳。

## 8. Acceptance criteria

- [x] 內建題包首次離線即可瀏覽，下載包安裝後離線重開仍可用。
- [x] 搜尋、五級難度、來源與進度篩選正常，空狀態與下載失敗可理解。
- [x] 每題四個入口名稱與實際控制方一致。
- [x] 題庫建立的新局不改動題目或其他棋譜，計著／循環資料從局面重新起算。
- [x] 解題提示不預先洩漏，練習與完成進度只存本機。
- [x] pack validator 拒絕不合法／重複／權利資料不足內容，安裝無部分寫入。
- [x] 不破壞 Master SDD 的本機優先、棋規、段級與響應式界線。
- [x] `npm test` 通過。
- [x] `npm run build` 通過，沒有新增 syntax error；保留既有單一 JS chunk 大於 500 kB 提示。
- [x] 320／390／640 px、iPad Air 直向／橫向與桌面完成檢查。
- [x] SDD、README、題包來源帳與正式站流程同步更新；正式站證據待發布後回填。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit | pack runtime validator、ID/FEN/rights/difficulty | 合法包可正規化；任一錯誤整包拒絕。 |
| Unit | 任意局面 GameRow 工廠 | record/play 欄位、root、玩家、來源與錯誤契約正確。 |
| Integration | IndexedDB 安裝／覆蓋同版本／刪除／進度更新 | 原子、可重開、不同題目不互相覆蓋。 |
| Integration | backup v2 endgameSource round trip | 來源快照被安全保留；舊備份仍相容。 |
| UI | 題庫篩選、下載狀態與四入口 | 可鍵盤／觸控完成，文案對應實際模式。 |
| Engine | 解題方走子、提示與引擎防守 | engine lifecycle 可取消，離頁不殘留走子。 |
| Browser／device | 320～1366 px、iPad 直／橫向、安裝後離線 | 無水平 overflow，棋盤與主操作保持可見。 |
| Regression | `npm test`, `npm run build` | 既有記譜、復盤接續、人機、分析與 PWA 更新不退步。 |

## 10. Rollout and rollback

- 題庫入口直接放在既有殘局頁，不另設隱藏 gate；下載包需使用者主動安裝。
- 可下載 JSON 使用 immutable pack id/version；錯誤包可從 catalog 下架，不影響已內建題包。
- UI／程式失敗可回滾 release commit；已建立的普通 GameRow 仍是自含資料，不依賴題包存在。
- 使用者可從題庫移除下載包；進度保留，重新安裝後可接續。清除網站資料會移除全部本機內容。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 五級難度何時映射到台灣級段？ | 產品負責人＋未來協會協助者 | 收集足夠真人盲測資料後另開 SDD | 本輪只用 App 題庫五級。 |
| 下一批古譜優先《橘中祕》或擴充《適情雅趣》？ | 產品負責人 | 首批使用數據與來源逐頁核對後 | 不阻擋本輪；保留版本化擴充管線。 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-18
- 完成日期：2026-07-18（功能驗證完成，待發布）。
- 實際變更：
  - 新增 `src/endgames/` runtime schema、來源／權利帳、12 題五階離線包與下載 catalog；新增 `public/endgames/shiqing-yaqu-selection-v1.json` 48 題包，合計 60 題且 ID 唯一。
  - 新增 `src/store/endgameLibrary.ts` 的同站下載、2 MB 上限、整包驗證、跨包 ID 防衝突、IndexedDB 安裝／移除與本機進度；下載內容不經背景 API。
  - 新增 `src/store/positionGame.ts` 任意合法 FEN 建局工廠，並讓復盤接續沿用；`GameRow.endgameSource` 與 full backup v2 allowlist 保存自含來源快照。
  - 新增題庫搜尋／篩選／棋盤預覽／來源說明與四入口；記錄／人機使用共用設定 dialog，自由分析沿用響應式工作台。
  - 解題沿用 `PlayPage` 穩定棋盤與存檔流程，題目方由使用者控制、防守與提示使用本機全力引擎，保存 attempts／solved／bestHints。
  - App／首頁／漢堡／功能指南／復盤清單／來源標記、README、Master SDD 與版本同步為 v0.9.0。
- 與原規格的差異：沒有另建 `EndgamePracticePage`，而是把解題狀態整合進已驗證的 `PlayPage`，以共用棋盤、引擎生命週期與逐著保存；產品行為不變。內建十二題進一步調整為五階皆有題，而非只有入門階。

### Verification evidence

- 施工前基準 `npm test`：27 個 test files／216 tests 通過。
- 施工前基準 `npm run build`：通過；只有既有 mixed import 與大 chunk 提示。
- 題包資料驗證：內建 12 題＋下載 48 題，共 60 個唯一 ID；五階皆有題，全部通過 schema、合法局面、非終局、輪走方、來源與權利帳檢查；下載包 11,428 bytes。
- 施工後 `npm test`：30 個 test files／227 tests 全部通過；新增題包、跨包衝突／同站限制、IndexedDB 安裝與進度、任意局面建局及 backup round trip 測試。
- 施工後 `npm run build`：v0.9.0 production build 通過；115 modules，PWA precache 16 entries；只有既有單一 JS chunk 大於 500 kB 提示，沒有新增 syntax／type error。
- 瀏覽器 production preview：
  - 首次顯示 12 題，五階篩選可在未下載狀態找到內建五階題；主動下載後顯示 60 題，重新載入仍保留。
  - 停止本機伺服器後由 Service Worker 重開，首頁、60 題與「已下載・離線可用」仍正常，確認題包與 App shell 可離線使用。
  - 解題實際建立 `🧩 解題` 局並由本機引擎提示「車一進五」；實體記錄、人機對弈與自由分析都從同一 FEN 進入正確畫面，復盤清單顯示「殘局解題／殘局開局」來源。
  - 320×568、390×844、640×960、820×1180、1180×820、1366×900 全部水平 overflow 0；iPad Air 直→橫→直棋盤尺寸穩定且操作列可見；console error 0。
- 已知限制：題庫難度未經真人協會棋手校準；複雜長捉／循環題不列入自動完成判定；下載包與進度本輪不隨完整備份移轉。

### Git and release

- Commit：未建立。
- Push：未執行。
- Deploy：依 repository 預設在 implementation commit／push 後執行；待發布。
- 正式環境驗證：待發布後回填。

只有在驗證完成後才能標為 Verified；只有在正式部署並驗證後才能標為 Released。
