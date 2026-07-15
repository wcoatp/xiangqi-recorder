// 殘局解析:擺盤(手動放子)→ 引擎多變化拆解 + 試走。
import { useCallback, useMemo, useState } from "react";
import { useApp } from "../App";
import {
  applyMove,
  emptyBoard,
  findKing,
  sq,
  type Board as BoardArr,
  type Move,
  type Piece,
  type PieceType,
  type Side,
} from "../core/board";
import { formatFen, parseFen, START_FEN } from "../core/fen";
import { MAX_COUNT, validatePosition } from "../core/placement";
import { gameStatus, inCheck, legalMovesFrom } from "../core/movegen";
import { chineseMove } from "../core/notation";
import Board, { type BoardArrow } from "./Board";
import LiveAnalysis from "./LiveAnalysis";
import PhotoSetupDialog from "./PhotoSetupDialog";

const PIECE_LABEL: Record<Side, Record<PieceType, string>> = {
  red: { K: "帥", A: "仕", B: "相", N: "馬", R: "車", C: "炮", P: "兵" },
  black: { K: "將", A: "士", B: "象", N: "馬", R: "車", C: "炮", P: "卒" },
};

type Palette = { side: Side; type: PieceType } | "erase";

export default function EndgamePage() {
  const { go } = useApp();
  const [board, setBoard] = useState<BoardArr>(() => {
    // 預設一個簡單殘局骨架:雙帥 + 可自行加子
    const b = emptyBoard();
    b[sq(0, 4)] = { side: "red", type: "K" };
    b[sq(9, 4)] = { side: "black", type: "K" };
    return b;
  });
  const [turn, setTurn] = useState<Side>("red");
  const [palette, setPalette] = useState<Palette>("erase");
  const [mode, setMode] = useState<"edit" | "analyze">("edit");
  const [error, setError] = useState("");
  const [explore, setExplore] = useState<string[]>([]); // 試走 fen 堆疊(含起點)
  const [selected, setSelected] = useState<number | null>(null);
  const [arrows, setArrows] = useState<BoardArrow[]>([]);
  const [moveLog, setMoveLog] = useState<string[]>([]);
  const [showPhoto, setShowPhoto] = useState(false);

  const baseFen = useMemo(() => formatFen({ board, turn }), [board, turn]);
  const currentFen =
    mode === "analyze" && explore.length > 0
      ? explore[explore.length - 1]
      : baseFen;
  const currentPos = useMemo(() => parseFen(currentFen), [currentFen]);

  const countOf = (side: Side, type: PieceType) =>
    board.filter((p) => p && p.side === side && p.type === type).length;

  const editTap = useCallback(
    (s: number) => {
      setError("");
      const next = board.slice();
      if (palette === "erase") {
        next[s] = null;
      } else {
        const { side, type } = palette;
        const here = next[s];
        if (here && here.side === side && here.type === type) {
          next[s] = null; // 再點一次同棋子 = 移除
        } else {
          if (countOf(side, type) >= MAX_COUNT[type]) {
            setError(
              `${side === "red" ? "紅" : "黑"}${PIECE_LABEL[side][type]}最多 ${MAX_COUNT[type]} 只`,
            );
            return;
          }
          next[s] = { side, type } satisfies Piece;
        }
      }
      setBoard(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, palette],
  );

  const exploreTap = useCallback(
    (s: number) => {
      const pos = currentPos;
      const p = pos.board[s];
      if (selected != null) {
        const ok = legalMovesFrom(pos, selected).some((m) => m.to === s);
        if (ok) {
          const m: Move = { from: selected, to: s };
          const zh = chineseMove(pos, m);
          const after = applyMove(pos, m);
          setExplore((st) => [...st, formatFen(after)]);
          setMoveLog((lg) => [...lg, zh]);
          setSelected(null);
          return;
        }
      }
      if (p && p.side === pos.turn) setSelected(s === selected ? null : s);
      else setSelected(null);
    },
    [currentPos, selected],
  );

  const startAnalyze = () => {
    const msg = validatePosition(board, turn);
    if (msg) {
      setError(msg);
      return;
    }
    setError("");
    setExplore([baseFen]);
    setMoveLog([]);
    setSelected(null);
    setMode("analyze");
  };

  const status = mode === "analyze" ? gameStatus(currentPos) : null;

  return (
    <div className="page">
      <div className="topbar">
        <button
          onClick={() =>
            mode === "analyze" ? setMode("edit") : go({ name: "home" })
          }
        >
          ← {mode === "analyze" ? "回擺盤" : "首頁"}
        </button>
        <div className="title">殘局解析</div>
        {mode === "edit" && (
          <div className="seg" style={{ width: 130 }}>
            <button
              className={turn === "red" ? "on" : ""}
              onClick={() => setTurn("red")}
            >
              紅先
            </button>
            <button
              className={turn === "black" ? "on" : ""}
              onClick={() => setTurn("black")}
            >
              黑先
            </button>
          </div>
        )}
      </div>

      <div className="board-wrap" style={{ maxHeight: "48vh" }}>
        <Board
          fen={currentFen}
          bottom="red"
          selected={selected}
          targets={
            mode === "analyze" && selected != null
              ? legalMovesFrom(currentPos, selected).map((m) => m.to)
              : []
          }
          checkSq={
            mode === "analyze" && inCheck(currentPos.board, currentPos.turn)
              ? findKing(currentPos.board, currentPos.turn)
              : null
          }
          arrows={mode === "analyze" ? arrows : []}
          onTap={mode === "edit" ? editTap : exploreTap}
        />
      </div>

      {error && (
        <div style={{ color: "var(--bad)", textAlign: "center" }}>{error}</div>
      )}

      {mode === "edit" ? (
        <>
          <div className="palette">
            {(["red", "black"] as Side[]).map((side) =>
              (Object.keys(MAX_COUNT) as PieceType[]).map((t) => (
                <button
                  key={`${side}-${t}`}
                  className={`${side === "red" ? "red-p" : ""} ${
                    palette !== "erase" &&
                    palette.side === side &&
                    palette.type === t
                      ? "sel"
                      : ""
                  }`}
                  onClick={() => setPalette({ side, type: t })}
                >
                  {PIECE_LABEL[side][t]}
                </button>
              )),
            )}
            <button
              className={palette === "erase" ? "sel" : ""}
              onClick={() => setPalette("erase")}
            >
              🧽
            </button>
          </div>
          <div className="muted" style={{ textAlign: "center" }}>
            選棋子後點棋盤放置;點同一子移除;🧽 為清除模式
          </div>
          <div className="fab-row">
            <button
              onClick={() => {
                const b = emptyBoard();
                b[sq(0, 4)] = { side: "red", type: "K" };
                b[sq(9, 4)] = { side: "black", type: "K" };
                setBoard(b);
              }}
            >
              清空
            </button>
            <button onClick={() => setBoard(parseFen(START_FEN).board)}>
              標準開局
            </button>
            <button onClick={() => setShowPhoto(true)}>📷 拍照擺盤</button>
            <button className="primary" onClick={startAnalyze}>
              🔍 開始分析
            </button>
          </div>
        </>
      ) : (
        <>
          {status?.over ? (
            <div className="card" style={{ textAlign: "center" }}>
              <b className="check-flash">
                {status.reason === "checkmate" ? "絕殺!" : "困斃!"}
                {status.winner === "red" ? "紅" : "黑"}方勝
              </b>
            </div>
          ) : (
            <div className="card">
              <LiveAnalysis
                fen={currentFen}
                active={mode === "analyze"}
                multipv={3}
                movetimeMs={2500}
                onArrows={setArrows}
              />
            </div>
          )}
          <div className="row">
            <button
              onClick={() => {
                if (explore.length > 1) {
                  setExplore(explore.slice(0, -1));
                  setMoveLog(moveLog.slice(0, -1));
                }
                setSelected(null);
              }}
              disabled={explore.length <= 1}
            >
              ↩ 退一步
            </button>
            <button
              onClick={() => {
                setExplore([baseFen]);
                setMoveLog([]);
                setSelected(null);
              }}
              disabled={explore.length <= 1}
            >
              ⟲ 回到殘局
            </button>
            <span className="muted grow">
              可直接在棋盤上試走,引擎會跟著分析
            </span>
          </div>
          {moveLog.length > 0 && (
            <div className="card">
              <div className="muted">試走:</div>
              {moveLog.join(" → ")}
            </div>
          )}
        </>
      )}
      {showPhoto && (
        <PhotoSetupDialog
          onApply={(b) => {
            setBoard(b);
            setShowPhoto(false);
            setError("");
          }}
          onClose={() => setShowPhoto(false)}
        />
      )}
    </div>
  );
}
