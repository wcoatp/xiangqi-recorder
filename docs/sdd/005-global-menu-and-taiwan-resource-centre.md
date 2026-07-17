# SDD 005：全站導覽與台灣象棋資源中心

> Status：Implemented<br>
> Owner：專案作者<br>
> Created：2026-07-17<br>
> Updated：2026-07-17<br>
> Target branch：`main`<br>
> Related decisions：`D-001`, `D-002`, `D-003`, `D-004`, `D-006`, `D-008`, `D-009`, `D-010`<br>
> Depends on：[中華民國象棋文化協會](https://www.cccs.org.tw/)、[比賽／研習活動](https://www.cccs.org.tw/Message?itemid=3&mid=2)、[113 年修訂版象棋規則](https://www.cccs.org.tw/Page?itemid=18&mid=35&IsShowRight=True)<br>
> Supersedes：無

## 1. Context

App 已有開始紀錄、對弈、復盤、解棋、殘局、棋規、設定與回饋等功能，但入口分散在首頁及各頁返回按鈕。進入記譜或分析後，使用者必須先回首頁才看得到其他功能，也沒有一處能完整理解三種輸入方式、資料保存邊界、各工具差異與建議使用順序。

產品負責人於 2026-07-17 要求把所有公開功能收進左側或上方可收納的漢堡選單，加入完整說明、台灣教學資源、比賽規則及近期賽程。賽程會變動，而 App 目前是本機優先、無後端架構，因此不可把建置時的靜態資料描述成即時同步；必須標示查閱日期、主辦來源與「以最新公告為準」。

## 2. Goals

- 在每一個 App 頁面提供一致的上方漢堡按鈕與左側抽屜，能直接前往所有公開功能。
- 新增可離線閱讀的「功能與資源」中心，完整說明各工具、三種等權輸入方式、本機資料與隱藏校準界線。
- 收錄經查核的台灣官方教學、棋規、活動及報名連結。
- 顯示 2026-07-17 查閱時仍在近期的官方賽程快照，清楚區分固定快照與外部最新公告。

## 3. Non-goals

- 不新增後端、帳號、賽程 API、背景同步、推播或自動爬蟲。
- 不保證外部活動尚有名額，也不代替主辦單位辦理報名。
- 不在公開選單暴露段級校準實驗室；它仍維持本機、PIN 門禁及預設隱藏。
- 不宣稱列出的教學資源是台灣全部資源或 App 的商業合作夥伴。
- 不在本工作包實作「從復盤任一步接續記錄／對弈」；該需求另開後續 SDD。

## 4. Product decisions

| ID | 決策 | 理由 | 狀態 |
|---|---|---|---|
| 005-D01 | 全站保留一列精簡品牌列，漢堡按鈕開啟左側 modal drawer | 手機單手可達，同時讓目前頁面名稱常駐可辨識 | Accepted |
| 005-D02 | 抽屜包含首頁、開始紀錄、對弈、復盤、解棋、殘局、棋規、功能與資源、設定、回饋 | 公開功能不再依賴先回首頁尋找 | Accepted |
| 005-D03 | 「開始紀錄／對弈／回饋」由抽屜回到首頁並直接開啟既有對話框 | 沿用既有建立與資料保存流程，避免重複實作 | Accepted |
| 005-D04 | 完整產品說明隨 App shell 打包；外部連結才需要網路 | 符合離線與本機優先原則 | Accepted |
| 005-D05 | 賽程以人工查核快照呈現，標示查閱日、來源與非即時聲明 | 無後端時仍能提供價值且不誤導 | Accepted |
| 005-D06 | 台灣資源第一版只收錄可確認的官方協會頁面 | 降低過期、授權與推薦責任風險，未來再擴充其他可信來源 | Accepted |
| 005-D07 | 公開選單不列出段級校準，只在功能說明交代其本機與隱藏狀態 | 保持 SDD 002 的 PIN 隱藏入口界線 | Accepted |

## 5. Requirements

| ID | 需求 | 優先級 | 驗收方式 |
|---|---|---|---|
| 005-FR01 | 所有 App view 頂部皆顯示漢堡按鈕、品牌及目前頁面名稱 | Must | 逐頁瀏覽器檢查 |
| 005-FR02 | 抽屜列出全部公開功能，按下後關閉抽屜並到正確功能 | Must | 手機、鍵盤實際操作 |
| 005-FR03 | 抽屜可由遮罩、關閉按鈕及 Escape 關閉，開啟時管理焦點與背景捲動 | Must | 鍵盤與 DOM 檢查 |
| 005-FR04 | 功能中心說明開始紀錄、三種輸入、對弈、復盤、解棋、殘局、棋規、設定／備份、回饋及校準界線 | Must | 文案與現有功能逐項核對 |
| 005-FR05 | 教學資源含課程介紹、最新課程／體驗、棋譜棋評等台灣官方連結 | Must | 檢查 href 與外部開啟屬性 |
| 005-FR06 | 比賽規則同時提供 App 內棋規入口與協會 113 年修訂版全文入口 | Must | 點擊流程與來源檢查 |
| 005-FR07 | 近期賽程至少涵蓋 7/19、7/26、8/16／8/23、8/30／9/6 官方活動 | Must | 與 2026-07-17 官方活動頁核對 |
| 005-FR08 | 賽程顯示查閱日期、非即時聲明、官方活動總表及報名頁 | Must | 文案審查 |
| 005-NFR01 | 不新增 IndexedDB schema、外部 runtime fetch、遙測或資料上傳 | Must | code／network 檢查 |
| 005-NFR02 | 公開 UI 使用台灣繁中、中國象棋品牌，不出現西洋棋圖示或 Elo | Must | 視覺與文案審查 |
| 005-NFR03 | 320、390、640 px 無水平溢出；抽屜與資源卡可觸控及鍵盤操作 | Must | 瀏覽器響應式檢查 |
| 005-NFR04 | 外部連結使用新分頁與安全 rel，並以外連符號區分 | Must | DOM 檢查 |

## 6. UX flow

1. 使用者在任一頁按上方「開啟功能選單」。
2. 左側抽屜滑入；頂部說明資料留在本機，下方依「開始使用／棋譜工具／學習與支援」分組列出功能名稱與一句用途。
3. 選擇一般 view 後立即切換並關閉抽屜；選擇開始紀錄、對弈或回饋時回首頁直接開啟相對應對話框。
4. 「功能與資源」先提供 App 功能地圖，再提供台灣教學資源、比賽規則與近期賽程。
5. 內部功能按鈕留在同一 App；外部協會頁以新分頁開啟。若離線，內建說明仍可閱讀，但外部網站由瀏覽器顯示連線失敗。
6. 使用者可按遮罩、關閉按鈕或 Escape 回到原頁；鍵盤焦點回到漢堡按鈕。

## 7. Technical design

### 7.1 Affected modules

| 檔案／模組 | 預計變更 | 相依性 |
|---|---|---|
| `src/App.tsx` | 新增 guide view、首頁 action 及全站 shell | React state |
| `src/ui/AppMenu.tsx` | 全站品牌列、抽屜、焦點與 navigation mapping | App `View` |
| `src/ui/GuidePage.tsx` | 功能說明、資源、規則與賽程 UI | guide content |
| `src/content/guide.ts` | 版本化功能、官方連結及賽程快照 | 無 runtime network |
| `src/content/guide.test.ts` | 完整性、日期排序、HTTPS 與來源測試 | Vitest |
| `src/ui/HomePage.tsx` | 接受抽屜觸發的初始對話框 action | App view |
| `src/styles.css` | App shell、抽屜與資源中心響應式樣式 | 現有 tokens |
| `README.md` | 補充全站導覽與資源中心使用方式 | 使用者文件 |
| `docs/SDD.md` | 導覽／外部資源架構與品質基準 | Master SDD |

### 7.2 Data model and migration

- 不變更 Dexie schema，也不讀寫使用者賽程偏好。
- 功能說明、資源與賽程是 TypeScript 常數，隨版本發佈；`checkedAt` 固定為 `2026-07-17`。
- 已保存棋局、設定、棋子照片範本與段級校準資料皆不遷移。

### 7.3 Algorithms or interfaces

```ts
type HomeAction = 'record' | 'play' | 'feedback'
type View =
  | { name: 'home'; action?: HomeAction }
  | existingViews
  | { name: 'guide' }

interface ScheduleItem {
  dates: string[]
  title: string
  detail: string
  location: string
  url: string
}
```

`AppMenu` 只呼叫既有 `go(view)`，不自己建立棋局。Home action 在對話框關閉後清除，確保再次從抽屜選擇仍能開啟。賽程依第一個 ISO 日期排序，單元測試防止資料缺漏與非 HTTPS 來源。

### 7.4 Offline, privacy, security, licensing

- 抽屜與完整說明離線可用；App 不主動抓取外部頁面。
- 只有使用者點擊外部資源時才由瀏覽器連至協會網站，App 不傳送本機棋局或識別資料。
- 外部連結皆使用 `target="_blank" rel="noreferrer"`。
- 協會名稱、活動標題與日期用於來源標示及導覽；不複製完整課程或賽事內容。
- PIN 校準入口與資料邊界不變；drawer 不提供繞過門禁的方法。

## 8. Acceptance criteria

- [ ] 任一頁都可開啟／關閉全站抽屜並前往全部公開功能。
- [ ] 開始紀錄、對弈及回饋從抽屜可直接開啟既有流程。
- [x] 功能與資源中心可離線閱讀完整 App 使用說明。
- [x] 教學、棋規、活動與報名連結皆指向已查核的台灣官方頁面。
- [x] 近期賽程與 2026-07-17 官方資料相符，且不被描述為即時同步。
- [x] 段級校準仍不出現在公開 drawer，PIN／本機資料界線不變。
- [x] 不新增 schema、runtime fetch、遙測或資料上傳。
- [x] `npm test` 通過。
- [x] `npm run build` 通過，沒有新增 warning／syntax error。
- [ ] 320、390、640 px 與鍵盤操作完成實際瀏覽器檢查。
- [x] Master SDD、工作包索引與 README 同步更新。

## 9. Test plan

| 層級 | 測試 | 預期 |
|---|---|---|
| Unit | 公開功能清單 | 必要功能唯一且完整，隱藏校準不在 drawer |
| Unit | 官方資源 URL | 全部為 HTTPS 且含來源名稱 |
| Unit | 賽程快照 | 4 組近期活動、日期有效且遞增、查閱日固定 |
| Browser | 任一頁 → drawer → 各 view | drawer 關閉，目的頁正確 |
| Browser | drawer → 開始紀錄／對弈／回饋 | 首頁直接開啟相對應 dialog |
| Browser | drawer／資源中心鍵盤流程 | Escape、Tab 邊界、焦點返回及外連屬性正確 |
| Responsive | 320／390／640 px | 無水平捲動，抽屜與卡片不截斷 |
| Regression | `npm test`, `npm run build` | 現有記譜、棋規、校準及 PWA 不退化 |

## 10. Rollout and rollback

- 公開導覽不設 feature gate；部署後所有 view 共用 App shell。
- rollback 可移除 shell、guide view 與靜態內容，不影響 IndexedDB 或任何既有棋局。
- 賽程過期時以後續文件／資料 commit 更新，不需要資料 migration。
- 若外部來源改址，App 內建功能說明仍可用；只需修正對應常數並重新發佈。

## 11. Open questions

| 問題 | 決策者 | 截止／阻擋點 | 結果 |
|---|---|---|---|
| 未來是否以後端或排程自動同步賽程？ | 產品負責人 | 另開網路服務 SDD 前 | 本階段維持人工版本快照 |
| 是否擴充其他縣市協會與民間教學頻道？ | 產品負責人／棋友 | 有可持續查核清單時 | 第一版只收錄官方且可追溯來源 |
| 復盤任一步接續記錄／對弈如何保存分支來源？ | 產品負責人 | 後續接續棋局 SDD | 不納入本工作包 |

## 12. Construction record

### Implementation

- 開始日期：2026-07-17。
- 完成日期：2026-07-17（程式完成；正式站瀏覽器驗證待部署後執行）。
- 實際變更檔案：`src/App.tsx`、`src/ui/AppMenu.tsx`、`src/ui/GuidePage.tsx`、`src/ui/HomePage.tsx`、`src/content/guide.ts`、`src/content/guide.test.ts`、`src/styles.css`、`README.md`、`docs/SDD.md`、`docs/sdd/README.md`、本文件與 TypeScript build info。
- 與原規格的差異：本機 `127.0.0.1` 頁面被內建瀏覽器安全政策阻擋，故響應式與逐頁點擊改至部署後在正式 HTTPS 站完成；功能範圍不變。

### Verification evidence

- `npm test`：通過；12 個 test files、94 tests，新增 4 個公開功能／官方資源／賽程快照測試。
- `npm run build`：通過；產出 `assets/index-DVSRN7RG.js`、`assets/index-DBmsiZkg.css`。只有既有 `tree.ts` 動態／靜態 import chunk warning，未新增錯誤。
- 手動／實機檢查：本機 Vite 成功啟動，但內建瀏覽器依安全政策拒絕操作 `http://127.0.0.1:5173/`；未改用繞過方式。正式 HTTPS 部署後待驗證 drawer、Escape／焦點、全部入口及 320／390／640 px。
- 已知限制：賽程為 2026-07-17 人工查核快照，不是即時同步；外部頁面離線時不可開啟；沒有後端自動汰除已過期活動。

### Git and release

- Commit：未建立。
- Push：未執行。
- Deploy：依 repository 預設在 implementation commit／push 後執行；尚未執行。
- 正式環境驗證：未執行。
