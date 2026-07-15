// 拍照擺盤:拍下任意殘局 → 自動判 空/紅/黑 + 類型(範本/CNN/規則)→
// 沒把握的子亮「?」讓你點選(合法類型選單)→ 套用到殘局編輯器。
import { useMemo, useState } from "react";
import type { Board, PieceType, Side } from "../core/board";
import { possibleTypes } from "../core/placement";
import { loadCnn } from "../vision/cnn";
import { recognizeSetup, setupToBoard, type SetupPiece, type SetupResult } from "../vision/setup";
import { loadTemplates } from "../vision/templates";
import { PickPhotoButton, QuadCanvas, useBoardPhoto } from "./photoCapture";

const LABEL: Record<Side, Record<PieceType, string>> = {
  red: { K: "帥", A: "仕", B: "相", N: "馬", R: "車", C: "炮", P: "兵" },
  black: { K: "將", A: "士", B: "象", N: "馬", R: "車", C: "炮", P: "卒" },
};

export default function PhotoSetupDialog({
  onApply,
  onClose,
}: {
  onApply: (board: Board) => void;
  onClose: () => void;
}) {
  const cap = useBoardPhoto();
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [pieces, setPieces] = useState<SetupPiece[]>([]);
  const [picking, setPicking] = useState<number | null>(null); // 正在指定類型的 s
  const [error, setError] = useState("");

  const runRecognize = () => {
    if (!cap.photo) return;
    setWorking(true);
    setError("");
    window.setTimeout(async () => {
      try {
        const [templates, cnn] = await Promise.all([loadTemplates(), loadCnn()]);
        const res = recognizeSetup(cap.photo!.img, cap.quad, { templates, cnn });
        setResult(res);
        setPieces(res.pieces);
      } catch (e) {
        setError(`辨識失敗:${(e as Error).message}`);
      } finally {
        setWorking(false);
      }
    }, 30);
  };

  const flip180 = () => {
    setPieces((ps) => ps.map((p) => ({ ...p, s: 89 - p.s })));
  };

  const unknowns = pieces.filter((p) => !p.type).length;
  const board = useMemo(() => (unknowns === 0 ? setupToBoard(pieces) : null), [pieces, unknowns]);
  const pickingPiece = picking !== null ? (pieces.find((p) => p.s === picking) ?? null) : null;

  return (
    <div className="overlay">
      <div className="dialog" style={{ maxWidth: 520 }}>
        <div className="row">
          <h3 className="grow">📷 拍照擺盤</h3>
          <button onClick={onClose}>關閉</button>
        </div>

        {!cap.photo && (
          <>
            <div className="muted">
              拍下桌上的殘局(整個棋盤入鏡)。App 會自動判每個位置「空/紅/黑」;
              棋子種類由你在設定頁校準過的範本與內建模型辨識,沒把握的會亮「?」讓你點選。
            </div>
            <PickPhotoButton onFile={(f) => void cap.onFile(f)} label="📸 拍照 / 選照片" />
            {cap.loading && <div className="muted">處理中…</div>}
            {cap.error && <div style={{ color: "var(--bad)" }}>{cap.error}</div>}
          </>
        )}

        {cap.photo && !result && (
          <>
            <QuadCanvas photo={cap.photo} quad={cap.quad} setQuad={cap.setQuad} />
            <div className="muted">
              {cap.autoFound ? "已自動找到棋盤格線。" : "沒自動找到棋盤,請手動拖曳。"}
              拖曳綠點對準最外圈格線的四個交角。
            </div>
            {error && <div style={{ color: "var(--bad)" }}>{error}</div>}
            <div className="fab-row">
              <button onClick={cap.reset}>重拍</button>
              <button className="primary" onClick={runRecognize} disabled={working}>
                {working ? "辨識中…" : "辨識擺盤"}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <SetupBoardView pieces={pieces} onTap={(s) => setPicking(s)} />
            <div className="muted">
              偵測到 {pieces.length} 顆子
              {unknowns > 0 ? `,還有 ${unknowns} 顆需要你點選種類(亮「?」者)` : ",全部已定"}
              ·佔位判讀 {(result.occupancyQuality * 100).toFixed(0)}%
              {!result.scorers.templates && "·尚未校準你的棋子(設定頁可校準,會更準)"}
            </div>
            {result.warnings.map((w, i) => (
              <div key={i} className="muted" style={{ color: "var(--warn)" }}>
                ⚠ {w}
              </div>
            ))}
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button onClick={flip180}>⟲ 轉 180°</button>
              <button onClick={() => setResult(null)}>調整框線</button>
              <button
                onClick={() => {
                  setResult(null);
                  cap.reset();
                }}
              >
                重拍
              </button>
              <button className="primary grow" disabled={!board} onClick={() => board && onApply(board)}>
                套用到擺盤
              </button>
            </div>
          </>
        )}

        {pickingPiece && (
          <TypePicker
            piece={pickingPiece}
            onPick={(t) => {
              setPieces((ps) => ps.map((p) => (p.s === pickingPiece.s ? { ...p, type: t, margin: 1 } : p)));
              setPicking(null);
            }}
            onRemove={() => {
              setPieces((ps) => ps.filter((p) => p.s !== pickingPiece.s));
              setPicking(null);
            }}
            onClose={() => setPicking(null)}
          />
        )}
      </div>
    </div>
  );
}

/** 輕量盤面預覽:已定型畫字、未定畫「?」;點子改型 */
function SetupBoardView({ pieces, onTap }: { pieces: SetupPiece[]; onTap: (s: number) => void }) {
  const X = (f: number) => 20 + f * 40;
  const Y = (r: number) => 20 + (9 - r) * 40;
  return (
    <svg viewBox="0 0 360 400" style={{ width: "100%", background: "var(--board-bg)", borderRadius: 8 }}>
      {Array.from({ length: 10 }, (_, r) => (
        <line key={`h${r}`} x1={X(0)} y1={Y(r)} x2={X(8)} y2={Y(r)} stroke="var(--board-line)" strokeWidth={1} />
      ))}
      {Array.from({ length: 9 }, (_, f) =>
        f === 0 || f === 8 ? (
          <line key={`v${f}`} x1={X(f)} y1={Y(0)} x2={X(f)} y2={Y(9)} stroke="var(--board-line)" strokeWidth={1} />
        ) : (
          <g key={`v${f}`}>
            <line x1={X(f)} y1={Y(0)} x2={X(f)} y2={Y(4)} stroke="var(--board-line)" strokeWidth={1} />
            <line x1={X(f)} y1={Y(5)} x2={X(f)} y2={Y(9)} stroke="var(--board-line)" strokeWidth={1} />
          </g>
        ),
      )}
      {[
        [3, 0, 5, 2],
        [5, 0, 3, 2],
        [3, 9, 5, 7],
        [5, 9, 3, 7],
      ].map(([a, b, c, d], i) => (
        <line key={`p${i}`} x1={X(a)} y1={Y(b)} x2={X(c)} y2={Y(d)} stroke="var(--board-line)" strokeWidth={1} />
      ))}
      {pieces.map((p) => {
        const f = p.s % 9;
        const r = Math.floor(p.s / 9);
        const color = p.side === "red" ? "var(--red)" : "var(--black-piece, #222)";
        const uncertain = !p.type;
        return (
          <g key={p.s} onClick={() => onTap(p.s)} style={{ cursor: "pointer" }}>
            <circle
              cx={X(f)}
              cy={Y(r)}
              r={17}
              fill="var(--piece-bg)"
              stroke={uncertain ? "var(--warn)" : color}
              strokeWidth={uncertain ? 3 : 2}
              strokeDasharray={uncertain ? "4 3" : undefined}
            />
            <text
              x={X(f)}
              y={Y(r) + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={uncertain ? 18 : 19}
              fontWeight={700}
              fill={uncertain ? "var(--warn)" : color}
            >
              {p.type ? LABEL[p.side][p.type] : "?"}
            </text>
            {p.type && p.margin < 0.15 && p.margin !== 1 && (
              <circle cx={X(f) + 13} cy={Y(r) - 13} r={4} fill="var(--warn)" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function TypePicker({
  piece,
  onPick,
  onRemove,
  onClose,
}: {
  piece: SetupPiece;
  onPick: (t: PieceType) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const legal = possibleTypes(piece.side, piece.s);
  const sorted = [...legal].sort((a, b) => (piece.scores[b] ?? 0) - (piece.scores[a] ?? 0));
  const f = (piece.s % 9) + 1;
  return (
    <div className="card">
      <div className="row">
        <b className="grow">
          這顆{piece.side === "red" ? "紅" : "黑"}子({f} 路)是:
        </b>
        <button onClick={onClose}>×</button>
      </div>
      <div className="chips" style={{ marginTop: 6 }}>
        {sorted.map((t) => (
          <button key={t} className="chip" style={{ fontSize: 18 }} onClick={() => onPick(t)}>
            {LABEL[piece.side][t]}
            {piece.scores[t] !== undefined && piece.scores[t]! > 0 && (
              <small className="muted"> {(piece.scores[t]! * 100).toFixed(0)}%</small>
            )}
          </button>
        ))}
        <button className="chip danger" onClick={onRemove}>
          🗑 這裡沒有子
        </button>
      </div>
    </div>
  );
}
