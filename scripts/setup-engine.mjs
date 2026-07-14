// 把 fairy-stockfish-nnue.wasm 的引擎檔複製到 public/engine/(postinstall 自動執行)。
// NNUE 棋力檔(xiangqi.nnue, ~10.7MB)已直接放在 repo 內;缺失時提示下載來源。
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "fairy-stockfish-nnue.wasm");
const dst = join(root, "public", "engine");

if (!existsSync(src)) {
  console.error("找不到 node_modules/fairy-stockfish-nnue.wasm,請先 npm install");
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
for (const f of ["stockfish.js", "stockfish.wasm", "stockfish.worker.js"]) {
  copyFileSync(join(src, f), join(dst, f));
}
console.log("✓ 引擎檔已複製到 public/engine/");

if (!existsSync(join(dst, "xiangqi.nnue"))) {
  console.warn(
    "⚠ 缺 public/engine/xiangqi.nnue(棋力檔)。請由 https://fairy-stockfish.github.io/nnue/ " +
      "下載 xiangqi-c07e94a5c7cb.nnue 並存為 public/engine/xiangqi.nnue",
  );
}
