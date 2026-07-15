// 人機對弈:跟內建引擎下棋,每一步(雙方)即時寫進同一套棋譜資料庫,
// 下完就是一筆正常紀錄 —— 可復盤、可解棋、可匯出,與記譜的局完全同等。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../App";
import { findKing, opposite, type Move, type Side } from "../core/board";
import { parseFen } from "../core/fen";
import { gameStatus, legalMoves, legalMovesFrom } from "../core/movegen";
import { chineseMove, parseUciMove } from "../core/notation";
import type { GameResult } from "../core/pgn";
import { addMove, findNode, findParent, mainline, type GameNode } from "../core/tree";
import { engine } from "../engine/engineClient";
import { speak } from "../speech/speech";
import { db, type GameRow } from "../store/db";
import Board, { type BoardArrow } from "./Board";

export interface PlayLevel {
  label: string;
  skill: number;
  movetimeMs: number;
}

export const PLAY_LEVELS: PlayLevel[] = [
  { label: "入門", skill: 0, movetimeMs: 150 },
  { label: "初級", skill: 4, movetimeMs: 250 },
  { label: "中級", skill: 9, movetimeMs: 400 },
  { label: "高級", skill: 14, movetimeMs: 700 },
  { label: "特級", skill: 20, movetimeMs: 1500 },
];

export const levelName = (level: number | undefined): string =>
  `引擎.${PLAY_LEVELS[level ?? 2]?.label ?? "中級"}`;

const SIDE_ZH: Record<Side, string> = { red: "紅", black: "黑" };

export default function PlayPage({ gameId }: { gameId: number }) {
  const { go, settings } = useApp();
  const [game, setGame] = useState<GameRow | null>(null);
  const [currentId, setCurrentId] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<{ arrows: BoardArrow[]; zh: string } | null>(null);
  const [flash, setFlash] = useState("");
  const [engineErr, setEngineErr] = useState("");
  const [ended, setEnded] = useState<{ result: GameResult; reason: string } | null>(null);
  const seqRef = useRef(0);
  const flashTimer = useRef(0);

  // 載入(gameId 變更 = 新的一局,全部重置)
  useEffect(() => {
    seqRef.current++;
    setSelected(null);
    setHint(null);
    setFlash("");
    setEngineErr("");
    setEnded(null);
    setThinking(false);
    void db.games.get(gameId).then((g) => {
      if (!g) return;
      setGame(g);
      const line = mainline(g.tree);
      setCurrentId(line.length > 0 ? line[line.length - 1].id : g.tree.id);
      if (g.result !== "*") setEnded({ result: g.result, reason: g.resultReason ?? "" });
    });
    if (engine.supported()) void engine.init().catch(() => {});
  }, [gameId]);

  const playerSide: Side = game?.playerSide ?? "red";
  const engineSide: Side = opposite(playerSide);
  const level = PLAY_LEVELS[game?.level ?? 2] ?? PLAY_LEVELS[2];

  const current: GameNode | null = useMemo(
    () => (game && currentId ? findNode(game.tree, currentId) : null),
    [game, currentId],
  );
  const fen = current?.fenAfter ?? "";
  const pos = useMemo(() => (fen ? parseFen(fen) : null), [fen]);
  const status = useMemo(() => (pos ? gameStatus(pos) : null), [pos]);
  const over = !!ended || (status?.over ?? false);

  const persist = useCallback((g: GameRow) => {
    g.updatedAt = Date.now();
    g.moveCount = mainline(g.tree).length;
    void db.games.put(g);
  }, []);

  const showFlash = (text: string) => {
    setFlash(text);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(""), 3000);
  };

  const finalize = useCallback(
    (result: GameResult, reason: string) => {
      if (!game) return;
      game.result = result;
      game.resultReason = reason;
      persist(game);
      setGame({ ...game });
      setEnded({ result, reason });
    },
    [game, persist],
  );

  /** 套用一著(人或引擎),回傳新節點 */
  const applyPly = useCallback(
    (m: Move) => {
      if (!game || !current || !pos) return;
      const mover = pos.turn;
      const { node } = addMove(current, m, Date.now() - game.startedAt);
      setCurrentId(node.id);
      setSelected(null);
      setHint(null);
      setGame({ ...game });
      persist(game);
      const after = parseFen(node.fenAfter);
      const st = gameStatus(after);
      let read = `${SIDE_ZH[mover]},${node.zh}`;
      if (st.over) {
        const reason = st.reason === "checkmate" ? "絕殺" : "困斃";
        read += `,${reason}`;
        finalize(st.winner as GameResult, reason);
      } else if (st.inCheck) {
        read += ",將軍";
      }
      showFlash(`${SIDE_ZH[mover]} ${node.zh}(${node.wxf})${st.inCheck ? " 將軍!" : ""}`);
      if (settings.ttsReadback) speak(read, settings.voiceLang);
    },
    [game, current, pos, persist, settings, finalize],
  );

  // 輪到引擎就思考
  useEffect(() => {
    if (!game || !pos || over || thinking) return;
    if (pos.turn !== engineSide) return;
    if (!engine.supported()) {
      setEngineErr("此環境無法啟動引擎(需要 HTTPS + COOP/COEP);對弈功能停用。");
      return;
    }
    const mySeq = ++seqRef.current;
    setThinking(true);
    void engine
      .analyze(fen, { movetimeMs: level.movetimeMs, multipv: 1, skillLevel: level.skill })
      .then((res) => {
        if (seqRef.current !== mySeq) return;
        const m = res.bestmove ? parseUciMove(res.bestmove) : null;
        if (!m || !legalMoves(pos).some((x) => x.from === m.from && x.to === m.to)) {
          setEngineErr(`引擎回了無效著法(${res.bestmove});請按「悔棋」重試`);
          return;
        }
        applyPly(m);
      })
      .catch((e: Error) => {
        if (seqRef.current === mySeq) setEngineErr(`引擎錯誤:${e.message}`);
      })
      .finally(() => {
        if (seqRef.current === mySeq) setThinking(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, fen, over, engineSide]);

  const onTap = useCallback(
    (s: number) => {
      if (!pos || over || thinking || pos.turn !== playerSide) return;
      const p = pos.board[s];
      if (selected != null) {
        const ok = legalMovesFrom(pos, selected).some((m) => m.to === s);
        if (ok) {
          applyPly({ from: selected, to: s });
          return;
        }
      }
      if (p && p.side === playerSide) setSelected(s === selected ? null : s);
      else setSelected(null);
    },
    [pos, over, thinking, playerSide, selected, applyPly],
  );

  /** 悔棋:退回到「輪到你走」為止(通常退兩著) */
  const undo = useCallback(() => {
    if (!game || !current || thinking) return;
    seqRef.current++; // 打斷可能剛排上的引擎思考結果
    let node = current;
    let removed = 0;
    while (node.move && removed < 2) {
      const parent = findParent(game.tree, node.id);
      if (!parent) break;
      parent.children = parent.children.filter((c) => c.id !== node.id);
      node = parent;
      removed++;
      const turnNow = parseFen(node.fenAfter).turn;
      if (turnNow === playerSide) break;
    }
    if (removed === 0) return;
    setCurrentId(node.id);
    setSelected(null);
    setHint(null);
    setEnded(null);
    if (game.result !== "*") {
      game.result = "*";
      game.resultReason = undefined;
    }
    setGame({ ...game });
    persist(game);
    showFlash(`已悔棋 ${removed} 著`);
  }, [game, current, thinking, playerSide, persist]);

  const askHint = useCallback(() => {
    if (!pos || over || thinking || pos.turn !== playerSide || !engine.supported()) return;
    const mySeq = ++seqRef.current;
    setThinking(true);
    void engine
      .analyze(fen, { movetimeMs: 800, multipv: 1 }) // 提示永遠用全力
      .then((res) => {
        if (seqRef.current !== mySeq) return;
        const m = res.bestmove ? parseUciMove(res.bestmove) : null;
        if (!m) return;
        setHint({ arrows: [{ ...m, kind: "best" }], zh: moveZh(fen, m) });
      })
      .finally(() => {
        if (seqRef.current === mySeq) setThinking(false);
      });
  }, [pos, over, thinking, playerSide, fen, current, game]);

  const resign = useCallback(() => {
    if (!game || over) return;
    if (!window.confirm("確定認輸?")) return;
    seqRef.current++;
    setThinking(false);
    finalize(engineSide, "認輸");
  }, [game, over, engineSide, finalize]);

  const rematch = async () => {
    if (!game) return;
    const now = Date.now();
    const { newRoot } = await import("../core/tree");
    const id = await db.games.add({
      redName: game.redName,
      blackName: game.blackName,
      mode: "play",
      playerSide: game.playerSide,
      level: game.level,
      startedAt: now,
      updatedAt: now,
      result: "*",
      initialFen: game.initialFen,
      tree: newRoot(game.initialFen),
      moveCount: 0,
    } as GameRow);
    go({ name: "play", gameId: id as number });
  };

  if (!game || !pos || !current) return <div className="page">載入中…</div>;

  const targets =
    selected != null && pos.turn === playerSide ? legalMovesFrom(pos, selected).map((m) => m.to) : [];
  const checkSq = status?.inCheck ? findKing(pos.board, pos.turn) : null;
  const playerName = playerSide === "red" ? game.redName : game.blackName;

  return (
    <div className="page" style={{ gap: 8 }}>
      <div className="topbar">
        <button onClick={() => go({ name: "home" })}>← 首頁</button>
        <div className="title">
          🤖 對弈.{level.label}
          <span className="muted" style={{ fontWeight: 400 }}>
            .{playerName} 執{SIDE_ZH[playerSide]}
          </span>
        </div>
      </div>

      <div className="board-wrap" style={{ maxHeight: "56vh" }}>
        <Board
          fen={fen}
          bottom={playerSide}
          lastMove={current.move}
          selected={selected}
          targets={targets}
          checkSq={checkSq}
          arrows={hint?.arrows ?? []}
          onTap={onTap}
        />
      </div>

      <div className="banner">
        {engineErr ? (
          <b style={{ color: "var(--bad)" }}>{engineErr}</b>
        ) : ended ? (
          <b className="check-flash">
            {ended.result === "draw"
              ? "和棋"
              : `${SIDE_ZH[ended.result as Side]}方勝(${ended.reason})`}
          </b>
        ) : thinking ? (
          "🤖 引擎思考中…"
        ) : flash ? (
          <b>{flash}</b>
        ) : hint ? (
          <b>💡 建議:{hint.zh}</b>
        ) : pos.turn === playerSide ? (
          `輪到你走(第 ${mainline(game.tree).length + 1} 著)`
        ) : (
          "輪到引擎"
        )}
      </div>

      {!ended ? (
        <div className="fab-row">
          <button onClick={undo} disabled={thinking || !current.move}>
            ↩ 悔棋
          </button>
          <button onClick={askHint} disabled={thinking || pos.turn !== playerSide}>
            💡 提示
          </button>
          <button className="danger" onClick={resign}>
            🏳 認輸
          </button>
        </div>
      ) : (
        <div className="fab-row">
          <button onClick={() => go({ name: "replay", gameId })}>📖 復盤</button>
          <button onClick={() => go({ name: "replay", gameId, analyze: true })}>💡 解棋</button>
          <button className="primary" onClick={() => void rematch()}>
            ⚔ 再來一局
          </button>
        </div>
      )}
      <div className="muted" style={{ textAlign: "center" }}>
        對弈全程自動記譜:結束後這一局會出現在「復盤紀錄」,可播放、解棋、匯出。
      </div>
    </div>
  );
}

function moveZh(fen: string, m: Move): string {
  try {
    return chineseMove(parseFen(fen), m);
  } catch {
    return "";
  }
}
