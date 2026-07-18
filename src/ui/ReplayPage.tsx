import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  type MoveJudgment,
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

type AnalysisTab = "current" | "chart" | "key" | "moves";
type AnalysisSize = "compact" | "half" | "full";

const ANALYSIS_TABS: Array<{ id: AnalysisTab; label: string }> = [
  { id: "current", label: "本著" },
  { id: "chart", label: "曲線" },
  { id: "key", label: "關鍵著" },
  { id: "moves", label: "棋譜" },
];

const ANALYSIS_SIZES: Array<{ id: AnalysisSize; label: string }> = [
  { id: "compact", label: "棋盤優先" },
  { id: "half", label: "半開" },
  { id: "full", label: "分析優先" },
];

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
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("current");
  const [analysisSize, setAnalysisSize] = useState<AnalysisSize>("compact");
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
    setAnalysisTab("current");
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
  const pickMove = (id: string) => {
    setSelected(null);
    setCurrentId(id);
  };
  const moveList = (
    <MoveList
      line={line}
      startTurn={startTurn}
      currentId={current.id}
      tagByNode={tagByNode}
      onPick={pickMove}
    />
  );

  return (
    <div
      className={`page replay-page ${showAnalysis ? "replay-page--analysis" : ""}`}
    >
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

      <div className="replay-workspace">
        <section className="replay-board-pane" aria-label="復盤棋盤與控制">
          <div className="board-wrap replay-board-wrap">
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
            <button onClick={() => goto(-1)} disabled={idx < 0} aria-label="回到開局">
              ⏮
            </button>
            <button onClick={() => goto(idx - 1)} disabled={idx < 0} aria-label="上一著">
              ◀
            </button>
            <button
              className="primary"
              onClick={() => setPlaying(!playing)}
              disabled={line.length === 0}
              aria-label={playing ? "暫停播放" : "開始播放"}
            >
              {playing ? "⏸" : "▶"}
            </button>
            <button
              onClick={() => goto(idx + 1)}
              disabled={idx + 1 >= line.length}
              aria-label="下一著"
            >
              ▶︎
            </button>
            <button
              onClick={() => goto(line.length - 1)}
              disabled={idx + 1 >= line.length}
              aria-label="前往最後一著"
            >
              ⏭
            </button>
            <select
              value={speedMs}
              onChange={(e) => setSpeedMs(Number(e.target.value))}
              aria-label="播放速度"
            >
              <option value={500}>快(0.5s)</option>
              <option value={1000}>中(1s)</option>
              <option value={2000}>慢(2s)</option>
            </select>
          </div>
          <input
            className="replay-timeline"
            type="range"
            min={-1}
            max={line.length - 1}
            value={idx}
            onChange={(e) => goto(Number(e.target.value))}
            aria-label="棋譜進度"
          />

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
              onClick={() => {
                const next = !showAnalysis;
                setShowAnalysis(next);
                if (next) setAnalysisTab("current");
              }}
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
                    const mainlineChanged = mainline(root).some(
                      (entry) => entry.id === current.id,
                    );
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

          {!showAnalysis && moveList}

          {current.comment && (
            <div className="card">
              <div className="muted">註解</div>
              {current.comment}
            </div>
          )}
        </section>

        {showAnalysis && (
          <AnalysisDock
            tab={analysisTab}
            size={analysisSize}
            review={review}
            reviewedAt={game.reviewedAt}
            reviewing={reviewing}
            reviewError={reviewError}
            currentJudgment={currentJudgment}
            currentPly={idx + 1}
            estimatedSeconds={Math.round(
              ((mainline(root).length + 1) * settings.analysisMovetimeMs) / 1000,
            )}
            moveList={moveList}
            onTabChange={setAnalysisTab}
            onSizeChange={setAnalysisSize}
            onStart={() => void runReview()}
            onCancel={() => {
              cancelRef.current.cancelled = true;
              engine.stop();
            }}
            onJump={(ply) => goto(ply - 1)}
          />
        )}
      </div>

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
    <div className="card move-list-card">
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

// ---------------- 解棋工作台 ----------------
function AnalysisDock({
  tab,
  size,
  review,
  reviewedAt,
  reviewing,
  reviewError,
  currentJudgment,
  currentPly,
  estimatedSeconds,
  moveList,
  onTabChange,
  onSizeChange,
  onStart,
  onCancel,
  onJump,
}: {
  tab: AnalysisTab;
  size: AnalysisSize;
  review: GameReview | null;
  reviewedAt?: number;
  reviewing: ReviewProgress | null;
  reviewError: string;
  currentJudgment: MoveJudgment | null;
  currentPly: number;
  estimatedSeconds: number;
  moveList: ReactNode;
  onTabChange: (tab: AnalysisTab) => void;
  onSizeChange: (size: AnalysisSize) => void;
  onStart: () => void;
  onCancel: () => void;
  onJump: (ply: number) => void;
}) {
  const keyMoves = [...(review?.judgments ?? [])]
    .filter(
      (j) => j.tag === "mistake" || j.tag === "blunder" || j.tag === "inacc",
    )
    .sort((a, b) => b.loss - a.loss)
    .slice(0, 5);

  let summary: ReactNode = "尚未分析";
  if (reviewing) {
    summary = `分析中 ${reviewing.done}/${reviewing.total}`;
  } else if (currentJudgment) {
    summary = (
      <>
        第 {currentJudgment.ply} 著 · {currentJudgment.side === "red" ? "紅" : "黑"} · {" "}
        <b>{currentJudgment.zh}</b>{" "}
        <span className={`tag ${currentJudgment.tag}`}>
          {TAG_LABEL[currentJudgment.tag]}
        </span>
      </>
    );
  } else if (review && currentPly === 0) {
    summary = "開局局面";
  } else if (review) {
    summary = `第 ${currentPly} 著 · 此分支尚無整局分析`;
  }

  return (
    <section className={`analysis-dock analysis-dock--${size}`} aria-label="解棋工作台">
      <div className="analysis-dock-header">
        <div className="analysis-dock-title">
          <h3>解棋工作台</h3>
          <div className="analysis-current-summary" aria-live="polite">
            {summary}
          </div>
        </div>
        <div className="analysis-size-switch" role="group" aria-label="分析面板大小">
          {ANALYSIS_SIZES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={size === option.id ? "on" : ""}
              aria-pressed={size === option.id}
              onClick={() => onSizeChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="analysis-tabs" role="tablist" aria-label="解棋內容">
        {ANALYSIS_TABS.map((item) => (
          <button
            key={item.id}
            id={`analysis-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="analysis-tabpanel"
            className={tab === item.id ? "on" : ""}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
            {item.id === "key" && keyMoves.length > 0 && (
              <span className="analysis-tab-count">{keyMoves.length}</span>
            )}
          </button>
        ))}
      </div>

      <div
        id="analysis-tabpanel"
        className="analysis-dock-body"
        role="tabpanel"
        aria-labelledby={`analysis-tab-${tab}`}
      >
        {tab === "current" && (
          <div className="analysis-section">
            {reviewError && <div className="analysis-error">⚠ {reviewError}</div>}

            {reviewing ? (
              <div className="analysis-progress">
                <b>正在逐著分析</b>
                <div className="muted">
                  已完成 {reviewing.done}/{reviewing.total} 個局面；可先保留棋盤對照目前進度。
                </div>
                <div
                  className="progressbar"
                  role="progressbar"
                  aria-label="解棋分析進度"
                  aria-valuemin={0}
                  aria-valuemax={reviewing.total}
                  aria-valuenow={reviewing.done}
                >
                  <div
                    style={{
                      width: `${(100 * reviewing.done) / reviewing.total}%`,
                    }}
                  />
                </div>
                <button type="button" onClick={onCancel}>
                  取消分析
                </button>
              </div>
            ) : !review ? (
              <div className="analysis-empty-state">
                <b>這局尚未解棋</b>
                <div className="muted">
                  本機引擎會逐著標出漏著、錯著、敗著與建議走法，預估約 {estimatedSeconds} 秒；資料不會離開裝置。
                </div>
                <button className="primary" type="button" onClick={onStart}>
                  開始解棋
                </button>
              </div>
            ) : (
              <>
                <div className="analysis-meta muted">
                  上次分析：{new Date(reviewedAt ?? 0).toLocaleDateString("zh-TW")} · {" "}
                  {(review.movetimeMs / 1000).toFixed(1)} 秒／著
                </div>
                {currentJudgment ? (
                  <CurrentJudgment judgment={currentJudgment} />
                ) : (
                  <div className="analysis-empty-state analysis-empty-state--compact">
                    <b>{currentPly === 0 ? "開局局面" : "此著不在已分析的主線中"}</b>
                    <div className="muted">
                      {currentPly === 0
                        ? "往前走一著即可查看本著判斷；也可切到曲線或棋譜快速跳轉。"
                        : "目前仍可查看棋盤；若要分析這條變著，需先把它升為主線再重新解棋。"}
                    </div>
                  </div>
                )}
                <button type="button" onClick={onStart}>
                  重新分析整局
                </button>
              </>
            )}
          </div>
        )}

        {tab === "chart" && (
          <div className="analysis-section">
            {review ? (
              <>
                {reviewing && (
                  <div className="analysis-refresh-note">正在重新分析；下方暫時顯示上次結果。</div>
                )}
                <div className="muted">點曲線可把棋盤跳到對應局面。</div>
                <EvalChart review={review} currentPly={currentPly} onJump={onJump} />
                <div className="analysis-accuracy-grid">
                  <div>
                    <b style={{ color: "var(--red)" }}>
                      紅方準確度 {review.accuracy.red}%
                    </b>
                    <div className="muted">
                      漏著 {review.counts.red.inacc} · 錯著 {review.counts.red.mistake} · 敗著 {" "}
                      {review.counts.red.blunder}
                    </div>
                  </div>
                  <div>
                    <b>黑方準確度 {review.accuracy.black}%</b>
                    <div className="muted">
                      漏著 {review.counts.black.inacc} · 錯著 {review.counts.black.mistake} · 敗著 {" "}
                      {review.counts.black.blunder}
                    </div>
                  </div>
                </div>
                {!reviewing && (
                  <button type="button" onClick={onStart}>
                    重新分析整局
                  </button>
                )}
              </>
            ) : (
              <AnalysisNotReady reviewing={reviewing} onStart={onStart} />
            )}
          </div>
        )}

        {tab === "key" && (
          <div className="analysis-section">
            {review ? (
              keyMoves.length > 0 ? (
                <>
                  {reviewing && (
                    <div className="analysis-refresh-note">正在重新分析；下方暫時顯示上次結果。</div>
                  )}
                  <div className="muted">依損失排序，點選即可回到該著。</div>
                  <div className="analysis-key-list">
                    {keyMoves.map((judgment) => (
                      <button
                        key={judgment.nodeId}
                        type="button"
                        className="analysis-key-move"
                        onClick={() => onJump(judgment.ply)}
                      >
                        <span className="analysis-key-index">#{judgment.ply}</span>
                        <span className="grow">
                          {judgment.side === "red" ? "紅" : "黑"} · {judgment.zh}
                        </span>
                        <span className={`tag ${judgment.tag}`}>
                          {TAG_LABEL[judgment.tag]}
                        </span>
                        <span className="muted">
                          −{(judgment.loss / 100).toFixed(1)}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="analysis-empty-state">
                  <b>本局沒有被標記的關鍵失誤</b>
                  <div className="muted">曲線與完整著法仍可在其他分頁查看。</div>
                </div>
              )
            ) : (
              <AnalysisNotReady reviewing={reviewing} onStart={onStart} />
            )}
          </div>
        )}

        {tab === "moves" && moveList}
      </div>
    </section>
  );
}

function CurrentJudgment({ judgment }: { judgment: MoveJudgment }) {
  return (
    <div className="analysis-judgment-card">
      <div className="analysis-judgment-title">
        <span>
          第 {judgment.ply} 著 · {judgment.side === "red" ? "紅" : "黑"} · {" "}
          <b>{judgment.zh}</b>
        </span>
        <span className={`tag ${judgment.tag}`}>{TAG_LABEL[judgment.tag]}</span>
      </div>
      {judgment.loss >= 15 && (
        <div className="muted">局面損失約 {(judgment.loss / 100).toFixed(1)}</div>
      )}
      {judgment.tag !== "best" && judgment.bestZh && (
        <div className="analysis-recommendation">
          建議走 <b>{judgment.bestZh}</b>
          {judgment.bestLineZh.length > 0 && (
            <div className="muted">參考後續：{judgment.bestLineZh.join(" ")}</div>
          )}
        </div>
      )}
      <div className="muted">
        紅方局面評分：{scoreLabel(judgment.scoreRedBefore)} → {" "}
        {scoreLabel(judgment.scoreRedAfter)}
      </div>
    </div>
  );
}

function AnalysisNotReady({
  reviewing,
  onStart,
}: {
  reviewing: ReviewProgress | null;
  onStart: () => void;
}) {
  return (
    <div className="analysis-empty-state">
      <b>{reviewing ? "分析進行中" : "完成分析後即可查看"}</b>
      <div className="muted">
        {reviewing ? "可切回「本著」查看進度。" : "先讓本機引擎逐著分析整局。"}
      </div>
      {!reviewing && (
        <button className="primary" type="button" onClick={onStart}>
          開始解棋
        </button>
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
      role="slider"
      tabIndex={0}
      aria-label="局面評分曲線；左右方向鍵可切換局面"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, n - 1)}
      aria-valuenow={cur}
      onClick={(e) => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const i = Math.round(((e.clientX - rect.left) / rect.width) * (n - 1));
        onJump(Math.max(0, Math.min(n - 1, i)));
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const next = cur + (e.key === "ArrowLeft" ? -1 : 1);
        onJump(Math.max(0, Math.min(n - 1, next)));
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
