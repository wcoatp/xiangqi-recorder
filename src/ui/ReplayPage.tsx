import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../App";
import type { Side } from "../core/board";
import { formatDhtmlXq } from "../core/dhtmlxq";
import { parseFen } from "../core/fen";
import { gameStatus, legalMovesFrom } from "../core/movegen";
import {
  exportChineseText,
  exportPgn,
  type GameMeta,
  type GameResult,
} from "../core/pgn";
import {
  addMove,
  deleteSubtree,
  findNode,
  findParent,
  mainline,
  pathTo,
  promoteToMainline,
  type GameNode,
} from "../core/tree";
import {
  reviewMainline,
  TAG_LABEL,
  type CancelToken,
  type GameReview,
  type MoveTag,
  type ReviewProgress,
} from "../engine/analysis";
import { engine } from "../engine/engineClient";
import { db, type GameRow } from "../store/db";
import { invalidateGameReview } from "../store/gameReview";
import Board, { type BoardArrow } from "./Board";
import ContinueFromReplayDialog from "./ContinueFromReplayDialog";
import LiveAnalysis, { scoreLabel } from "./LiveAnalysis";

const RESULT_LABEL: Record<string, string> = {
  red: "紅勝",
  black: "黑勝",
  draw: "和棋",
  "*": "進行中",
};

export default function ReplayPage({
  gameId,
  autoAnalyze,
}: {
  gameId: number;
  autoAnalyze?: boolean;
}) {
  const { go, settings } = useApp();
  const [game, setGame] = useState<GameRow | null>(null);
  const [currentId, setCurrentId] = useState("");
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(1000);
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [commentDraft, setCommentDraft] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(!!autoAnalyze);
  const [reviewing, setReviewing] = useState<ReviewProgress | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [liveOn, setLiveOn] = useState(false);
  const [arrows, setArrows] = useState<BoardArrow[]>([]);
  const [showContinue, setShowContinue] = useState(false);
  const cancelRef = useRef<CancelToken>({ cancelled: false });
  const continueButtonRef = useRef<HTMLButtonElement>(null);

  const closeContinue = useCallback(() => {
    setShowContinue(false);
    window.requestAnimationFrame(() => continueButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    void db.games.get(gameId).then((g) => {
      if (!g) return;
      setGame(g);
      setCurrentId(g.tree.id);
    });
  }, [gameId]);

  const root = game?.tree ?? null;
  const current = useMemo(
    () => (root && currentId ? findNode(root, currentId) : null),
    [root, currentId],
  );
  const path = useMemo(
    () => (root && current ? (pathTo(root, current.id) ?? []) : []),
    [root, current],
  );
  const line = useMemo(
    () => (root && current ? [...path, ...mainline(current)] : []),
    [root, current, path],
  );
  const idx = path.length - 1; // -1 = 開局前
  const fen = current?.fenAfter ?? "";
  const pos = useMemo(() => (fen ? parseFen(fen) : null), [fen]);
  const currentStatus = useMemo(() => (pos ? gameStatus(pos) : null), [pos]);

  const goto = useCallback(
    (i: number) => {
      if (!root) return;
      setSelected(null);
      if (i < 0) setCurrentId(root.id);
      else if (i < line.length) setCurrentId(line[i].id);
    },
    [root, line],
  );

  // 自動播放
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      if (idx + 1 >= line.length) setPlaying(false);
      else goto(idx + 1);
    }, speedMs);
    return () => window.clearInterval(t);
  }, [playing, speedMs, idx, line.length, goto]);

  const persist = useCallback((mainlineChanged = false) => {
    if (!game) return;
    if (mainlineChanged && invalidateGameReview(game)) {
      setReviewError("主線已變更，舊分析已清除；需要時請重新解棋。");
    }
    game.updatedAt = Date.now();
    game.moveCount = mainline(game.tree).length;
    void db.games.put(game);
    setGame({ ...game });
  }, [game]);

  // 編輯模式:走子即建立變着
  const onTap = useCallback(
    (s: number) => {
      if (!editMode || !pos || !current || !game) return;
      const p = pos.board[s];
      if (selected != null) {
        const ok = legalMovesFrom(pos, selected).some((m) => m.to === s);
        if (ok) {
          const { node, created } = addMove(current, { from: selected, to: s });
          setCurrentId(node.id);
          setSelected(null);
          if (created) persist(mainline(game.tree).some((entry) => entry.id === node.id));
          return;
        }
      }
      if (p && p.side === pos.turn) setSelected(s === selected ? null : s);
      else setSelected(null);
    },
    [editMode, pos, current, game, selected, persist],
  );

  const isOnVariation = useMemo(() => {
    if (!root) return false;
    let parent = root;
    for (const n of path) {
      if (parent.children[0]?.id !== n.id) return true;
      parent = n;
    }
    return false;
  }, [root, path]);

  const review: GameReview | null = game?.review ?? null;
  const tagByNode = useMemo(() => {
    const m = new Map<string, MoveTag>();
    review?.judgments.forEach((j) => m.set(j.nodeId, j.tag));
    return m;
  }, [review]);

  const runReview = async () => {
    if (!game || !root) return;
    if (!engine.supported()) {
      setReviewError(
        "此環境無法啟動本機引擎:需要 HTTPS 與 COOP/COEP 標頭(部署到 Netlify/Cloudflare Pages 會自動符合;開發模式 npm run dev 已內建)。",
      );
      return;
    }
    setReviewError("");
    cancelRef.current = { cancelled: false };
    setReviewing({ done: 0, total: mainline(root).length + 1 });
    try {
      const r = await reviewMainline(root, {
        movetimeMs: settings.analysisMovetimeMs,
        onProgress: setReviewing,
        cancel: cancelRef.current,
      });
      game.review = r;
      game.reviewedAt = Date.now();
      persist();
    } catch (e) {
      if ((e as Error).message !== "cancelled")
        setReviewError(`分析失敗:${(e as Error).message}`);
    } finally {
      setReviewing(null);
    }
  };

  if (!game || !root || !current || !pos)
    return <div className="page">載入中…</div>;

  const currentJudgment =
    review?.judgments.find((j) => j.nodeId === current.id) ?? null;
  const startTurn = parseFen(root.fenAfter).turn;

  return (
    <div className="page">
      <div className="topbar">
        <button onClick={() => go({ name: "home" })}>← 首頁</button>
        <div className="title">
          <span style={{ color: "var(--red)" }}>{game.redName}</span> vs{" "}
          {game.blackName}
          <span className="result-badge" style={{ marginLeft: 6 }}>
            {RESULT_LABEL[game.result]}
          </span>
        </div>
        <button onClick={() => setShowInfo(true)}>✏️</button>
        <button onClick={() => setShowExport(true)}>📤</button>
      </div>

      {game.continuedFrom && (
        <div className="continuation-note">
          <span className="continuation-badge">接續局</span>
          <span>
            從「{game.continuedFrom.sourceRedName} 對 {game.continuedFrom.sourceBlackName}」
            {game.continuedFrom.sourcePly === 0
              ? "開局局面"
              : `第 ${game.continuedFrom.sourcePly} 著後局面`}
            開始
          </span>
        </div>
      )}

      <div className="board-wrap" style={{ maxHeight: "52vh" }}>
        <Board
          fen={fen}
          bottom="red"
          lastMove={current.move}
          selected={selected}
          targets={
            editMode && selected != null
              ? legalMovesFrom(pos, selected).map((m) => m.to)
              : []
          }
          arrows={arrows}
          onTap={editMode ? onTap : undefined}
        />
      </div>

      <div className="replay-controls">
        <button onClick={() => goto(-1)} disabled={idx < 0}>
          ⏮
        </button>
        <button onClick={() => goto(idx - 1)} disabled={idx < 0}>
          ◀
        </button>
        <button
          className="primary"
          onClick={() => setPlaying(!playing)}
          disabled={line.length === 0}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button onClick={() => goto(idx + 1)} disabled={idx + 1 >= line.length}>
          ▶︎
        </button>
        <button
          onClick={() => goto(line.length - 1)}
          disabled={idx + 1 >= line.length}
        >
          ⏭
        </button>
        <select
          value={speedMs}
          onChange={(e) => setSpeedMs(Number(e.target.value))}
        >
          <option value={500}>快(0.5s)</option>
          <option value={1000}>中(1s)</option>
          <option value={2000}>慢(2s)</option>
        </select>
      </div>
      <input
        type="range"
        min={-1}
        max={line.length - 1}
        value={idx}
        onChange={(e) => goto(Number(e.target.value))}
      />

      {/* 變着選擇 */}
      {current.children.length > 1 && (
        <div className="chips">
          <span className="muted">下一著分支:</span>
          {current.children.map((c, i) => (
            <button
              key={c.id}
              className="chip"
              onClick={() => setCurrentId(c.id)}
            >
              {i === 0 ? "主線 " : `變${i} `}
              {c.zh}
            </button>
          ))}
        </div>
      )}

      <div className="row replay-tools-row">
        <button
          className={editMode ? "primary" : ""}
          onClick={() => setEditMode(!editMode)}
        >
          {editMode ? "✓ 編輯中" : "✎ 編輯/變着"}
        </button>
        <button
          className={liveOn ? "primary" : ""}
          onClick={() => {
            setLiveOn(!liveOn);
            if (liveOn) setArrows([]);
          }}
          disabled={!!reviewing}
        >
          🔍 即時引擎
        </button>
        <button
          className={showAnalysis ? "primary" : ""}
          onClick={() => setShowAnalysis(!showAnalysis)}
        >
          💡 解棋
        </button>
        <button
          ref={continueButtonRef}
          type="button"
          onClick={() => {
            setPlaying(false);
            setShowContinue(true);
          }}
          disabled={!!reviewing || !!currentStatus?.over}
          title={currentStatus?.over ? "此局面已終局，不能再接續走棋" : undefined}
        >
          ↗ 從此局面開新局
        </button>
      </div>

      {currentStatus?.over && (
        <div className="muted continuation-terminal-note">
          此局面已{currentStatus.reason === "checkmate" ? "絕殺" : "困斃"}，不能建立接續局。
        </div>
      )}

      {editMode && (
        <div className="card">
          <div className="muted">
            編輯模式:直接在棋盤走子即可加入變着;主線之外的分支以「變」標示。
          </div>
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => setCommentDraft(current.comment ?? "")}
              disabled={!current.move}
            >
              💬 註解此著
            </button>
            <button
              onClick={() => {
                if (isOnVariation) {
                  promoteToMainline(root, current.id);
                  persist(true);
                }
              }}
              disabled={!isOnVariation}
            >
              ⬆ 升為主線
            </button>
            <button
              className="danger"
              disabled={!current.move}
              onClick={() => {
                if (!current.move) return;
                if (!window.confirm(`刪除「${current.zh}」及其後所有著法?`))
                  return;
                const mainlineChanged = mainline(root).some((entry) => entry.id === current.id);
                const parent = findParent(root, current.id);
                deleteSubtree(root, current.id);
                setCurrentId(parent?.id ?? root.id);
                persist(mainlineChanged);
              }}
            >
              🗑 刪除此著起
            </button>
          </div>
        </div>
      )}

      {liveOn && (
        <div className="card">
          <LiveAnalysis
            fen={fen}
            active={liveOn}
            multipv={2}
            movetimeMs={1500}
            onArrows={setArrows}
          />
        </div>
      )}

      {showAnalysis && (
        <div className="card">
          <div className="row">
            <h3 className="grow">解棋(本機引擎)</h3>
            {review && !reviewing && (
              <span className="muted">
                {new Date(game.reviewedAt ?? 0).toLocaleDateString("zh-TW")}.
                {(review.movetimeMs / 1000).toFixed(1)}s/著
              </span>
            )}
          </div>
          {reviewError && (
            <div style={{ color: "var(--bad)" }}>⚠ {reviewError}</div>
          )}
          {reviewing ? (
            <div>
              <div className="muted">
                分析中… {reviewing.done}/{reviewing.total} 局面
              </div>
              <div className="progressbar">
                <div
                  style={{
                    width: `${(100 * reviewing.done) / reviewing.total}%`,
                  }}
                />
              </div>
              <button
                style={{ marginTop: 8 }}
                onClick={() => {
                  cancelRef.current.cancelled = true;
                  engine.stop();
                }}
              >
                取消
              </button>
            </div>
          ) : review ? (
            <AnalysisSummary
              review={review}
              currentPly={idx + 1}
              onJump={(ply) => goto(ply - 1)}
              onRerun={() => void runReview()}
            />
          ) : (
            <div>
              <div className="muted">
                用手機上的引擎逐著分析整局(約{" "}
                {Math.round(
                  ((mainline(root).length + 1) * settings.analysisMovetimeMs) /
                    1000,
                )}{" "}
                秒),標出錯着/漏着/敗着並給出建議著法。完全離線,不需網路。
              </div>
              <button
                className="primary"
                style={{ marginTop: 8 }}
                onClick={() => void runReview()}
              >
                開始解棋
              </button>
            </div>
          )}
          {currentJudgment && !reviewing && (
            <div className="card" style={{ marginTop: 8 }}>
              <div>
                第 {currentJudgment.ply} 著{" "}
                {currentJudgment.side === "red" ? "紅" : "黑"}.
                <b>{currentJudgment.zh}</b>{" "}
                <span className={`tag ${currentJudgment.tag}`}>
                  {TAG_LABEL[currentJudgment.tag]}
                </span>
                {currentJudgment.loss >= 15 && (
                  <span className="muted">
                    (損失 {(currentJudgment.loss / 100).toFixed(1)})
                  </span>
                )}
              </div>
              {currentJudgment.tag !== "best" && currentJudgment.bestZh && (
                <div style={{ marginTop: 4 }}>
                  建議:<b>{currentJudgment.bestZh}</b>
                  <div className="muted">
                    後續:{currentJudgment.bestLineZh.join(" ")}
                  </div>
                </div>
              )}
              <div className="muted" style={{ marginTop: 4 }}>
                局面評分:{scoreLabel(currentJudgment.scoreRedBefore)} →{" "}
                {scoreLabel(currentJudgment.scoreRedAfter)}
              </div>
            </div>
          )}
        </div>
      )}

      <MoveList
        line={line}
        startTurn={startTurn}
        currentId={current.id}
        tagByNode={tagByNode}
        onPick={(id) => {
          setSelected(null);
          setCurrentId(id);
        }}
      />

      {current.comment && (
        <div className="card">
          <div className="muted">註解</div>
          {current.comment}
        </div>
      )}

      {showExport && (
        <ExportDialog game={game} onClose={() => setShowExport(false)} />
      )}
      {showInfo && (
        <InfoDialog
          game={game}
          onClose={() => setShowInfo(false)}
          onSaved={() => {
            setShowInfo(false);
            persist();
          }}
        />
      )}
      {showContinue && (
        <ContinueFromReplayDialog
          source={game}
          node={current}
          sourcePly={path.length}
          onClose={closeContinue}
        />
      )}
      {commentDraft !== null && (
        <div className="overlay">
          <div className="dialog">
            <h3>註解:{current.zh}</h3>
            <textarea
              rows={4}
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              placeholder="輸入這一著的心得、變化…"
            />
            <div className="fab-row">
              <button onClick={() => setCommentDraft(null)}>取消</button>
              <button
                className="primary"
                onClick={() => {
                  current.comment = commentDraft.trim() || undefined;
                  persist();
                  setCommentDraft(null);
                }}
              >
                儲存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 著法清單 ----------------
function MoveList({
  line,
  startTurn,
  currentId,
  tagByNode,
  onPick,
}: {
  line: GameNode[];
  startTurn: Side;
  currentId: string;
  tagByNode: Map<string, MoveTag>;
  onPick: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector(".current")
      ?.scrollIntoView({ block: "nearest" });
  }, [currentId]);

  const rows: Array<{ no: number; a: GameNode | null; b: GameNode | null }> =
    [];
  let i = 0;
  let no = 1;
  if (startTurn === "black" && line.length > 0) {
    rows.push({ no: no++, a: null, b: line[0] });
    i = 1;
  }
  for (; i < line.length; i += 2, no++) {
    rows.push({ no, a: line[i], b: line[i + 1] ?? null });
  }

  const cell = (n: GameNode | null) =>
    n ? (
      <button
        className={`mv ${n.id === currentId ? "current" : ""}`}
        onClick={() => onPick(n.id)}
      >
        {n.zh}
        {tagByNode.has(n.id) && tagByNode.get(n.id) !== "good" && (
          <span className={`tag ${tagByNode.get(n.id)}`}>
            {TAG_LABEL[tagByNode.get(n.id)!]}
          </span>
        )}
        {n.comment && <span title={n.comment}>💬</span>}
      </button>
    ) : (
      <span className="muted" style={{ padding: "5px 8px" }}>
        ……
      </span>
    );

  return (
    <div className="card">
      <div className="movelist" ref={ref}>
        {rows.length === 0 && <div className="muted">尚無著法</div>}
        {rows.map((r) => (
          <div key={r.no} className="mrow">
            <span className="muted">{r.no}.</span>
            {cell(r.a)}
            {cell(r.b)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- 解棋摘要 ----------------
function AnalysisSummary({
  review,
  currentPly,
  onJump,
  onRerun,
}: {
  review: GameReview;
  currentPly: number;
  onJump: (ply: number) => void;
  onRerun: () => void;
}) {
  const keyMoves = [...review.judgments]
    .filter(
      (j) => j.tag === "mistake" || j.tag === "blunder" || j.tag === "inacc",
    )
    .sort((a, b) => b.loss - a.loss)
    .slice(0, 5);

  return (
    <div>
      <EvalChart review={review} currentPly={currentPly} onJump={onJump} />
      <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <div className="grow">
          <b style={{ color: "var(--red)" }}>
            紅 準確度 {review.accuracy.red}%
          </b>
          <div className="muted">
            漏着 {review.counts.red.inacc}.錯着 {review.counts.red.mistake}.敗着{" "}
            {review.counts.red.blunder}
          </div>
        </div>
        <div className="grow">
          <b>黑 準確度 {review.accuracy.black}%</b>
          <div className="muted">
            漏着 {review.counts.black.inacc}.錯着 {review.counts.black.mistake}
            .敗着 {review.counts.black.blunder}
          </div>
        </div>
        <button onClick={onRerun}>重新分析</button>
      </div>
      {keyMoves.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted">關鍵著法(點擊跳轉):</div>
          <div className="chips">
            {keyMoves.map((j) => (
              <button
                key={j.nodeId}
                className="chip"
                onClick={() => onJump(j.ply)}
              >
                #{j.ply} {j.side === "red" ? "紅" : "黑"} {j.zh}
                <span className={`tag ${j.tag}`}>{TAG_LABEL[j.tag]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EvalChart({
  review,
  currentPly,
  onJump,
}: {
  review: GameReview;
  currentPly: number;
  onJump: (ply: number) => void;
}) {
  const W = 600;
  const H = 110;
  const n = review.plies.length;
  const clamp = (v: number) => Math.max(-800, Math.min(800, v));
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H / 2 - (clamp(v) / 800) * (H / 2 - 6);
  const pts = review.plies.map((p, i) => `${x(i)},${y(p.scoreRed)}`).join(" ");
  const cur = Math.max(0, Math.min(n - 1, currentPly));

  return (
    <svg
      className="evalchart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const i = Math.round(((e.clientX - rect.left) / rect.width) * (n - 1));
        onJump(Math.max(0, Math.min(n - 1, i)));
      }}
    >
      <rect
        x={0}
        y={0}
        width={W}
        height={H / 2}
        fill="var(--red)"
        opacity={0.07}
      />
      <rect
        x={0}
        y={H / 2}
        width={W}
        height={H / 2}
        fill="#000"
        opacity={0.12}
      />
      <line
        x1={0}
        y1={H / 2}
        x2={W}
        y2={H / 2}
        stroke="var(--muted)"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <polyline
        points={pts}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2.5}
      />
      <line
        x1={x(cur)}
        y1={0}
        x2={x(cur)}
        y2={H}
        stroke="var(--good)"
        strokeWidth={2}
      />
    </svg>
  );
}

// ---------------- 匯出 ----------------
function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportDialog({
  game,
  onClose,
}: {
  game: GameRow;
  onClose: () => void;
}) {
  const [msg, setMsg] = useState("");
  const meta: GameMeta = {
    red: game.redName,
    black: game.blackName,
    startedAt: game.startedAt,
    result: game.result,
    resultReason: game.resultReason,
  };
  const stamp = new Date(game.startedAt).toISOString().slice(0, 10);
  const base = `${game.redName}_vs_${game.blackName}_${stamp}`;
  const zhText = () => exportChineseText(meta, game.tree);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>匯出棋譜</h3>
        <button
          onClick={() => {
            void navigator.clipboard
              .writeText(zhText())
              .then(() => setMsg("已複製中文棋譜到剪貼簿"));
          }}
        >
          📋 複製中文棋譜
        </button>
        <button
          onClick={() => download(`${base}.pgn`, exportPgn(meta, game.tree))}
        >
          ⬇️ 下載 PGN(象棋橋/象棋巫師可讀)
        </button>
        <button
          onClick={() => {
            void navigator.clipboard
              .writeText(formatDhtmlXq(meta, game.tree))
              .then(() => setMsg("已複製東萍 DhtmlXQ 代碼"));
          }}
        >
          📋 複製東萍 DhtmlXQ 代碼
        </button>
        <button onClick={() => download(`${base}.txt`, zhText())}>
          ⬇️ 下載中文棋譜 .txt
        </button>
        {"share" in navigator && (
          <button
            onClick={() => {
              void navigator
                .share({ title: base, text: zhText() })
                .catch(() => {});
            }}
          >
            📲 系統分享
          </button>
        )}
        {msg && <div className="muted">{msg}</div>}
        <button onClick={onClose}>關閉</button>
      </div>
    </div>
  );
}

// ---------------- 對局資訊編輯 ----------------
function InfoDialog({
  game,
  onClose,
  onSaved,
}: {
  game: GameRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [red, setRed] = useState(game.redName);
  const [black, setBlack] = useState(game.blackName);
  const [result, setResult] = useState<GameResult>(game.result);
  const [reason, setReason] = useState(game.resultReason ?? "");

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>編輯對局資訊</h3>
        <label>
          <div className="muted">紅方</div>
          <input
            value={red}
            onChange={(e) => setRed(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          <div className="muted">黑方</div>
          <input
            value={black}
            onChange={(e) => setBlack(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <div className="seg">
          {(["red", "black", "draw", "*"] as GameResult[]).map((r) => (
            <button
              key={r}
              className={result === r ? "on" : ""}
              onClick={() => setResult(r)}
            >
              {RESULT_LABEL[r]}
            </button>
          ))}
        </div>
        <input
          placeholder="結果原因(認輸/絕殺…)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="fab-row">
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            onClick={() => {
              game.redName = red.trim() || "紅方";
              game.blackName = black.trim() || "黑方";
              game.result = result;
              game.resultReason = reason.trim() || undefined;
              onSaved();
            }}
          >
            儲存
          </button>
        </div>
      </div>
    </div>
  );
}
