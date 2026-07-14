/* global Stockfish */
// 在獨立 worker 內執行 fairy-stockfish(pthread WASM 版),UCI 文字協定。
// 主執行緒協定:
//   收 {type:'init', nnueUrl}  → 回 {type:'ready'} 或 {type:'error', message}
//   收 {type:'cmd', cmd}       → 轉送引擎
//   引擎每行輸出                → 回 {type:'line', line}
importScripts("./stockfish.js");

let sf = null;

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type === "init") {
    try {
      sf = await Stockfish();
      sf.addMessageListener((line) => self.postMessage({ type: "line", line }));
      if (msg.nnueUrl) {
        const resp = await fetch(msg.nnueUrl);
        if (!resp.ok) throw new Error("NNUE 下載失敗:HTTP " + resp.status);
        const buf = new Uint8Array(await resp.arrayBuffer());
        sf.FS.writeFile("/xiangqi.nnue", buf);
      }
      self.postMessage({ type: "ready" });
    } catch (e) {
      self.postMessage({ type: "error", message: String((e && e.message) || e) });
    }
  } else if (msg.type === "cmd" && sf) {
    sf.postMessage(msg.cmd);
  }
};
