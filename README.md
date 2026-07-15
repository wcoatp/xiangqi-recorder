# 象棋記譜(Xiangqi Recorder)

面對面實體象棋對局的**記譜 PWA**:語音/點按即時記譜、復盤播放與變着編輯、本機引擎解棋、殘局擺盤解析。iPhone / Android / 平板皆可「加入主畫面」安裝,**核心功能完全離線**,不需要任何 API Token。

## 功能

- **開始紀錄**:紅黑方姓名(玩家名冊)、先手選擇、日期時間自動記錄。
  - **面對面棋盤**:手機平放桌面,黑方棋子與控制列旋轉 180°,雙方看到的都是正向。
  - **三種輸入**:
    1. 🎤 **語音**(中文口令,例:「馬二進三」「炮8平5」)— 用內建語音辨識,同音字(碼/馬、士/四、相/象)由「當前局面合法著法 + 模糊拼音比對」自動消解,聽不清時列出候選讓你點選;
    2. ⌨️ **WXF 代號鍵盤**(例 `H2+3` = 馬2進3),按鍵智慧過濾,只剩合法組合可按;
    3. 👆 **直接點棋盤走子**(點起點、點終點)。
  - 合法著法驗證、悔棋、將軍/絕殺/困斃自動偵測、三次重複局面提醒、語音覆誦確認(可關)。
- **復盤紀錄**:自動播放(快/中/慢)、單步、進度拖曳;**變着**(復盤中直接走子即開分支、升為主線)、每著註解、刪除;匯出**中文棋譜** / **PGN**(象棋橋、象棋巫師可讀)/ 系統分享。
- **解棋**:本機 WASM 引擎逐著分析整局 → 評分曲線、紅黑準確度、**漏着/錯着/敗着**標記、關鍵著法跳轉、每著建議變化。
- **殘局解析**:擺盤編輯器(含棋子數量/位置/將帥對臉合法性檢查)→ 引擎三變化拆解 + 最佳著法箭頭 + 試走跟隨分析。

## 語音輸入的平台現況(2026-07 查證)

| 環境 | 語音方式 |
|---|---|
| Android Chrome(含已安裝 PWA) | 🎤 即時語音(Web Speech API,需網路) |
| iOS Safari 分頁 | 🎤 即時語音(Siri 引擎) |
| iOS「加入主畫面」PWA | ⌨️ 點輸入框後按鍵盤上的聽寫鍵(WebKit bug 225298 封鎖了 SpeechRecognition;鍵盤聽寫可離線)|

App 會執行期自動偵測並降級;若未來 WebKit 修復,自動恢復即時語音。

## 技術

- **零後端**:React + TypeScript + Vite;IndexedDB(Dexie)本機儲存;`vite-plugin-pwa` 離線快取。
- **規則核心**:純 TS 走法產生(perft d3 = 79666 驗證)、中文縱線/WXF/ICCS/UCI 四種記譜法互轉(依 xqbase《中國象棋電腦應用規範》,含疊子前後中、多兵跨路序數)。
- **引擎**:[fairy-stockfish-nnue.wasm](https://www.npmjs.com/package/fairy-stockfish-nnue.wasm)(UCI,`UCI_Variant xiangqi`)+ xiangqi NNUE 網路(Pikafish 團隊訓練,+914 Elo),在 Web Worker 內執行,遠超人類頂尖水準。
- 棋力檔(`public/engine/xiangqi.nnue`,10.7MB)首次使用時由 Service Worker 永久快取。

## 開發

```bash
npm install        # 會自動把引擎檔複製到 public/engine/
npm test           # 規則核心單元測試(perft + 記譜黃金範例 + 語音解析)
npm run dev        # 開發伺服器(已內建 COOP/COEP 標頭)
npm run build      # 產出 dist/
```

## 部署(重要:必須 HTTPS + COOP/COEP)

**線上版:<https://xiangqi-recorder.web.app>**(Firebase Hosting,專案 `xiangqi-recorder`)。手機開啟網址 → 分享/選單 →「加入主畫面」即可安裝成 App。

更新部署:

```bash
npm run build && firebase deploy --only hosting
```

引擎的多執行緒需要 `SharedArrayBuffer`,瀏覽器要求整個網站送出:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

[`firebase.json`](firebase.json) 已設定以上標頭(並對 sw.js/index.html 設 no-cache、wasm/nnue 設一週快取)。若改用 Netlify / Cloudflare Pages,repo 內 [`public/_headers`](public/_headers) 也已備好;GitHub Pages 無法自訂標頭,不建議。

沒有這些標頭時,記譜/復盤照常運作,只有引擎分析功能會停用並提示。

## 授權

GPL-3.0-or-later(因內含 GPL-3.0 的 Fairy-Stockfish WASM 引擎與其衍生 NNUE 網路)。

致謝:[Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish).[Pikafish](https://github.com/official-pikafish/Pikafish)(NNUE 網路).[xqbase 中國象棋電腦應用規範](https://www.xqbase.com/protocol/cchess_intro.htm).[WXF 記譜規範](https://www.wxf-xiangqi.org/)

## Roadmap(v2 候選)

- 對手統計(對某人勝率、先後手拆分、開局習慣)
- ECCO 開局自動分類
- 每著計時/棋鐘
- XQF / 東萍 DhtmlXQ 匯入
- AI 白話講解(引擎變化 → 自然語言,選配 API Token)
- 全離線語音(sherpa-onnx WASM 中文模型)
