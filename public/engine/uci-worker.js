/* global Stockfish */
// 在獨立 worker 內執行 fairy-stockfish(pthread WASM 版),UCI 文字協定。
// 主執行緒協定:
//   收 {type:'init', nnueUrl}  → 回 {type:'progress', step} 數次,最後 {type:'ready'} 或 {type:'error', message}
//   收 {type:'cmd', cmd}       → 轉送引擎
//   引擎每行輸出                → 回 {type:'line', line}
importScripts("./stockfish.js");

let sf = null;
const progress = (step) => self.postMessage({ type: "progress", step });

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type === "init") {
    try {
      progress("factory-start");
      // 在巢狀 worker 內執行時,pthread worker 需要主腳本 URL 才能自我載入
      sf = await Stockfish({
        mainScriptUrlOrBlob: new URL("./stockfish.js", self.location.href).href,
      });
      progress("factory-done");
      sf.addMessageListener((line) => self.postMessage({ type: "line", line }));
      if (msg.nnueUrl) {
        const resp = await fetch(msg.nnueUrl);
        if (!resp.ok) throw new Error("NNUE 下載失敗:HTTP " + resp.status);
        const buf = new Uint8Array(await resp.arrayBuffer());
        progress("nnue-fetched");
        sf.FS.writeFile("/xiangqi.nnue", buf);
      }
      self.postMessage({ type: "ready" });
    } catch (e) {
      self.postMessage({
        type: "error",
        message: String((e && e.stack) || e),
      });
    }
  } else if (msg.type === "cmd" && sf) {
    sf.postMessage(msg.cmd);
  }
};
