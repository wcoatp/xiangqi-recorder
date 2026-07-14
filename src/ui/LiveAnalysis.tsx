// 即時引擎分析面板(復盤與殘局共用):對指定 fen 串流顯示多變化。
import { useEffect, useState } from "react";
import { parseFen } from "../core/fen";
import { parseUciMove } from "../core/notation";
import { pvToZh } from "../engine/analysis";
import {
  engine,
  isMateScore,
  scoreToCp,
  type PvLine,
} from "../engine/engineClient";
import type { BoardArrow } from "./Board";

export function scoreLabel(cpRed: number): string {
  if (isMateScore(cpRed)) {
    const n = 30000 - Math.abs(cpRed);
    return cpRed > 0 ? `紅殺 #${n}` : `黑殺 #${n}`;
  }
  const v = (cpRed / 100).toFixed(1);
  return cpRed > 0 ? `紅優 +${v}` : cpRed < 0 ? `黑優 ${v}` : "均勢 0.0";
}

export default function LiveAnalysis({
  fen,
  active,
  multipv = 2,
  movetimeMs = 1500,
  onArrows,
}: {
  fen: string;
  active: boolean;
  multipv?: number;
  movetimeMs?: number;
  onArrows?: (arrows: BoardArrow[]) => void;
}) {
  const [lines, setLines] = useState<PvLine[]>([]);
  const [error, setError] = useState("");
  const [thinking, setThinking] = useState(false);

  useEffect(() => {
    if (!active) {
      onArrows?.([]);
      return;
    }
    if (!engine.supported()) {
      setError(
        "此環境不支援本機引擎(需要 HTTPS 與 COOP/COEP 標頭;請確認部署設定)",
      );
      return;
    }
    let stale = false;
    setLines([]);
    setThinking(true);
    setError("");
    const push = (ls: PvLine[]) => {
      if (stale) return;
      setLines(ls);
      const pos = parseFen(fen);
      const arrows: BoardArrow[] = [];
      ls.forEach((l, i) => {
        const m = parseUciMove(l.pv[0] ?? "");
        if (m) arrows.push({ ...m, kind: i === 0 ? "best" : "alt" });
        void pos;
      });
      onArrows?.(arrows.slice(0, 2));
    };
    engine
      .analyze(fen, { movetimeMs, multipv, onInfo: push })
      .then((res) => {
        if (!stale) {
          push(res.lines);
          setThinking(false);
        }
      })
      .catch((e: Error) => {
        if (!stale) {
          setError(e.message);
          setThinking(false);
        }
      });
    return () => {
      stale = true;
      engine.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, active, multipv, movetimeMs]);

  if (!active) return null;
  if (error) return <div className="muted">⚠ {error}</div>;

  const pos = parseFen(fen);
  const toRed = (l: PvLine) => {
    const cp = scoreToCp(l);
    return pos.turn === "red" ? cp : -cp;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {lines.length === 0 && (
        <div className="muted">{thinking ? "引擎思考中…" : "無分析結果"}</div>
      )}
      {lines.map((l) => (
        <div key={l.multipv} className="pvline">
          <span
            className="score"
            style={{
              color:
                toRed(l) > 30 ? "var(--red)" : toRed(l) < -30 ? "var(--ink)" : "var(--muted)",
            }}
          >
            {scoreLabel(toRed(l))}
          </span>
          <span className="muted">d{l.depth}</span>
          <span>{pvToZh(pos, l.pv, 6).join(" ")}</span>
        </div>
      ))}
    </div>
  );
}
