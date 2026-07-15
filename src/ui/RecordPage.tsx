import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../App";
import {
  findKing,
  positionKey,
  type Move,
  type Position,
  type Side,
} from "../core/board";
import { parseFen } from "../core/fen";
import { gameStatus, legalMovesFrom } from "../core/movegen";
import type { GameResult } from "../core/pgn";
import {
  buildMoveIndex,
  parseMoveVoice,
  type MoveIndexEntry,
  type ScoredCandidate,
} from "../core/parse";
import {
  addMove,
  findNode,
  findParent,
  mainline,
  pathTo,
  type GameNode,
} from "../core/tree";
import {
  detectSpeechMode,
  listenOnce,
  speak,
  type SpeechMode,
} from "../speech/speech";
import { db, type GameRow } from "../store/db";
import Board from "./Board";
import PhotoDialog from "./PhotoDialog";

const SIDE_ZH: Record<Side, string> = { red: "紅", black: "黑" };

export default function RecordPage({ gameId }: { gameId: number }) {
  const { go, settings } = useApp();
  const [game, setGame] = useState<GameRow | null>(null);
  const [currentId, setCurrentId] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [flash, setFlash] = useState("");
  const [keypadFor, setKeypadFor] = useState<Side | null>(null);
  const [endDialog, setEndDialog] = useState<{
    result: GameResult;
    reason: string;
  } | null>(null);
  const [speechMode, setSpeechMode] = useState<SpeechMode>(() =>
    detectSpeechMode(),
  );
  const [autoListen, setAutoListen] = useState(false);
  const [photoFor, setPhotoFor] = useState<Side | null>(null);
  const flashTimer = useRef<number>(0);

  useEffect(() => {
    void db.games.get(gameId).then((g) => {
      if (!g) return;
      setGame(g);
      const line = mainline(g.tree);
      setCurrentId(line.length > 0 ? line[line.length - 1].id : g.tree.id);
    });
  }, [gameId]);

  const current: GameNode | null = useMemo(
    () => (game && currentId ? findNode(game.tree, currentId) : null),
    [game, currentId],
  );
  const fen = current?.fenAfter ?? game?.initialFen ?? "";
  const pos = useMemo(() => (fen ? parseFen(fen) : null), [fen]);
  const index: MoveIndexEntry[] = useMemo(
    () => (pos ? buildMoveIndex(pos) : []),
    [pos],
  );
  const status = useMemo(() => (pos ? gameStatus(pos) : null), [pos]);
  const turn = pos?.turn ?? "red";

  // 三次重複局面提醒
  const repetition = useMemo(() => {
    if (!game || !pos || !current) return false;
    const path = pathTo(game.tree, current.id) ?? [];
    const keys = [game.tree.fenAfter, ...path.map((n) => n.fenAfter)].map((f) =>
      positionKey(parseFen(f)),
    );
    const nowKey = positionKey(pos);
    return keys.filter((k) => k === nowKey).length >= 3;
  }, [game, pos, current]);

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

  /** 套用一或多著。必須整串在同一回合內走完:
   * setState 是非同步的,若對每一著分開呼叫,第二著會拿到還沒更新的 current,
   * 變成掛在第一著旁邊的分支(而且走子方也會算錯)。 */
  const doMoves = useCallback(
    (moves: Move[]) => {
      if (!game || !current || !pos || moves.length === 0) return;
      let node = current;
      let p = pos;
      const said: string[] = [];
      let mover = p.turn;
      for (const m of moves) {
        mover = p.turn;
        node = addMove(node, m, Date.now() - game.startedAt).node;
        said.push(`${SIDE_ZH[mover]},${node.zh}`);
        p = parseFen(node.fenAfter);
      }
      setCurrentId(node.id);
      setSelected(null);
      setKeypadFor(null);
      setPhotoFor(null);
      setGame({ ...game });
      persist(game);
      const st = gameStatus(p);
      let read = said.join(";");
      if (st.over) {
        const reason = st.reason === "checkmate" ? "絕殺" : "困斃";
        read += `,${reason}`;
        setEndDialog({ result: st.winner as GameResult, reason });
      } else if (st.inCheck) {
        read += ",將軍";
      }
      showFlash(
        `${SIDE_ZH[mover]}方 ${node.zh}(${node.wxf})${st.inCheck ? " 將軍!" : ""}`,
      );
      if (settings.ttsReadback) speak(read, settings.voiceLang);
      if (settings.autoRelisten && speechMode === "webspeech" && !st.over)
        setAutoListen(true);
    },
    [game, current, pos, persist, settings, speechMode],
  );

  const doMove = useCallback((m: Move) => doMoves([m]), [doMoves]);

  const undo = useCallback(() => {
    if (!game || !current || !current.move) return;
    const parent = findParent(game.tree, current.id);
    if (!parent) return;
    parent.children = parent.children.filter((c) => c.id !== current.id);
    setCurrentId(parent.id);
    setSelected(null);
    setGame({ ...game });
    persist(game);
    showFlash("已悔棋一著");
  }, [game, current, persist]);

  const onTap = useCallback(
    (s: number) => {
      if (!pos || status?.over) return;
      const p = pos.board[s];
      if (selected != null) {
        const legal = legalMovesFrom(pos, selected).some((m) => m.to === s);
        if (legal) {
          doMove({ from: selected, to: s });
          return;
        }
      }
      if (p && p.side === turn) setSelected(s === selected ? null : s);
      else setSelected(null);
    },
    [pos, selected, turn, status, doMove],
  );

  const saveResult = async (result: GameResult, reason: string) => {
    if (!game) return;
    game.result = result;
    game.resultReason = reason;
    persist(game);
    await db.games.put(game);
    go({ name: "replay", gameId });
  };

  if (!game || !pos || !current) return <div className="page">載入中…</div>;

  const targets =
    selected != null ? legalMovesFrom(pos, selected).map((m) => m.to) : [];
  const checkSq = status?.inCheck ? findKing(pos.board, turn) : null;
  const lastMove = current.move ?? null;
  const over = status?.over ?? false;

  const zone = (side: Side) => {
    const active = turn === side && !over;
    const flipped = settings.tabletop && side === "black";
    return (
      <div
        className={`player-zone ${flipped ? "flipped" : ""} ${active ? "active" : ""}`}
      >
        <div className="who">
          <span className="turn-dot" />
          <b style={{ color: side === "red" ? "var(--red)" : "inherit" }}>
            {SIDE_ZH[side]}.{side === "red" ? game.redName : game.blackName}
          </b>
          <span className="muted grow">
            {over
              ? "對局結束"
              : active
                ? status?.inCheck
                  ? "被將軍!"
                  : "輪到走棋"
                : "等待對方"}
          </span>
          <button onClick={undo} disabled={!current.move} title="悔棋">
            ↩
          </button>
          <button
            onClick={() => setPhotoFor(side)}
            disabled={!active}
            title="拍照記譜"
          >
            📷
          </button>
          <button
            onClick={() => setKeypadFor(keypadFor === side ? null : side)}
            disabled={!active}
          >
            ⌨️
          </button>
        </div>
        <VoiceControl
          side={side}
          active={active}
          pos={pos}
          index={index}
          mode={speechMode}
          lang={settings.voiceLang}
          autoStart={autoListen && turn === side}
          onAutoStarted={() => setAutoListen(false)}
          onMove={doMove}
          onDowngrade={() => setSpeechMode("dictation")}
        />
        {keypadFor === side && active && (
          <PieceKeypad side={side} index={index} onMove={doMove} />
        )}
      </div>
    );
  };

  return (
    <div className="record-page">
      {zone("black")}
      <div className="board-wrap">
        <Board
          fen={fen}
          bottom="red"
          tabletop={settings.tabletop}
          lastMove={lastMove}
          selected={selected}
          targets={targets}
          checkSq={checkSq}
          onTap={onTap}
        />
      </div>
      <div className="banner">
        {flash ? (
          <b>{flash}</b>
        ) : over ? (
          <b className="check-flash">
            {status?.reason === "checkmate" ? "絕殺!" : "困斃!"}
            {SIDE_ZH[status?.winner ?? "red"]}方勝
          </b>
        ) : repetition ? (
          <b className="check-flash">三次重複局面(注意長打禁着)</b>
        ) : status?.inCheck ? (
          <b className="check-flash">將軍!</b>
        ) : (
          `第 ${mainline(game.tree).length + 1} 著.輪到${SIDE_ZH[turn]}方`
        )}
      </div>
      {zone("red")}
      <div className="fab-row">
        <button onClick={() => go({ name: "home" })}>🏠 返回(自動儲存)</button>
        <button
          className="primary"
          onClick={() => setEndDialog({ result: "draw", reason: "協議和" })}
        >
          結束對局
        </button>
      </div>

      {photoFor && (
        <PhotoDialog
          pos={pos}
          onApply={doMoves}
          onClose={() => setPhotoFor(null)}
        />
      )}

      {endDialog && (
        <EndDialog
          initial={endDialog}
          onCancel={() => setEndDialog(null)}
          onSave={(r, reason) => void saveResult(r, reason)}
        />
      )}
    </div>
  );
}

// ---------------- 語音輸入 ----------------
interface VoiceProps {
  side: Side;
  active: boolean;
  pos: Position;
  index: MoveIndexEntry[];
  mode: SpeechMode;
  lang: string;
  autoStart: boolean;
  onAutoStarted: () => void;
  onMove: (m: Move) => void;
  onDowngrade: () => void;
}

function VoiceControl(props: VoiceProps) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [candidates, setCandidates] = useState<ScoredCandidate[]>([]);
  const [message, setMessage] = useState("");
  const [text, setText] = useState("");
  const cancelRef = useRef<() => void>(() => {});
  const debounceRef = useRef<number>(0);

  useEffect(() => {
    // 換手時重置
    setCandidates([]);
    setMessage("");
    setInterim("");
    setText("");
    cancelRef.current();
    setListening(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.active, props.index]);

  const handleResult = useCallback(
    (alts: string[]) => {
      const r = parseMoveVoice(props.pos, alts, props.index);
      if (r.kind === "exact" || r.kind === "auto") {
        setCandidates([]);
        setMessage("");
        props.onMove(r.move);
      } else if (r.kind === "ambiguous") {
        setCandidates(r.candidates);
        setMessage("是哪一著?點選確認:");
      } else {
        setCandidates([]);
        setMessage("沒聽出著法,請再說一次(例:馬二進三)");
      }
    },
    [props],
  );

  const start = useCallback(() => {
    if (listening || !props.active) return;
    setListening(true);
    setMessage("");
    setInterim("");
    const session = listenOnce(props.lang);
    cancelRef.current = session.cancel;
    session.onInterim(setInterim);
    session.promise
      .then((alts) => {
        setListening(false);
        setInterim("");
        handleResult(alts);
      })
      .catch((e: Error) => {
        setListening(false);
        setInterim("");
        if (e.message === "cancelled") return;
        if (
          e.message === "service-not-allowed" ||
          e.message === "not-allowed"
        ) {
          setMessage("此環境不支援即時語音,已切換為鍵盤聽寫模式");
          props.onDowngrade();
        } else if (e.message === "no-speech") {
          setMessage("沒聽到聲音,請再試一次");
        } else if (e.message === "network") {
          setMessage("語音辨識需要網路連線");
        } else {
          setMessage(`語音錯誤:${e.message}`);
        }
      });
  }, [listening, props, handleResult]);

  // 連續語音:輪到本方時自動開始
  useEffect(() => {
    if (
      props.autoStart &&
      props.active &&
      props.mode === "webspeech" &&
      !listening
    ) {
      props.onAutoStarted();
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoStart, props.active]);

  if (!props.active) return null;

  if (props.mode === "dictation") {
    const parseText = (t: string) => {
      if (t.trim().length < 2) return;
      handleResult([t]);
    };
    return (
      <div>
        <input
          className="dictation-input"
          placeholder="點此,再按鍵盤上的 🎤 聽寫著法(例:馬二進三)"
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            window.clearTimeout(debounceRef.current);
            debounceRef.current = window.setTimeout(() => {
              parseText(v);
              setText("");
            }, 800);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              window.clearTimeout(debounceRef.current);
              parseText(text);
              setText("");
            }
          }}
        />
        <Chips
          candidates={candidates}
          message={message}
          onMove={props.onMove}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="row">
        <button
          className={`mic-btn ${listening ? "listening" : ""}`}
          onClick={() => (listening ? cancelRef.current() : start())}
        >
          {listening ? "🎙️ 聆聽中…點擊取消" : "🎤 語音記譜"}
        </button>
        <span className="muted grow">{interim || message}</span>
      </div>
      <Chips
        candidates={candidates}
        message={candidates.length ? message : ""}
        onMove={props.onMove}
      />
    </div>
  );
}

function Chips({
  candidates,
  message,
  onMove,
}: {
  candidates: ScoredCandidate[];
  message: string;
  onMove: (m: Move) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <div>
      {message && <div className="muted">{message}</div>}
      <div className="chips">
        {candidates.map((c, i) => (
          <button key={i} className="chip" onClick={() => onMove(c.move)}>
            {c.zh}({c.wxf})
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- WXF 點按鍵盤 ----------------
const PIECE_KEYS: Record<Side, Array<[string, string]>> = {
  red: [
    ["車", "R"],
    ["馬", "H"],
    ["炮", "C"],
    ["兵", "P"],
    ["仕", "A"],
    ["相", "E"],
    ["帥", "K"],
  ],
  black: [
    ["車", "R"],
    ["馬", "H"],
    ["炮", "C"],
    ["卒", "P"],
    ["士", "A"],
    ["象", "E"],
    ["將", "K"],
  ],
};

const DIR_KEYS: Array<[string, string]> = [
  ["進/前", "+"],
  ["退/後", "-"],
  ["平", "="],
  ["中", "."],
];

function PieceKeypad({
  side,
  index,
  onMove,
}: {
  side: Side;
  index: MoveIndexEntry[];
  onMove: (m: Move) => void;
}) {
  const [buf, setBuf] = useState("");

  useEffect(() => setBuf(""), [index]);

  const prefixed = index.filter((e) => e.wxf.startsWith(buf));
  const nextChars = new Set(
    prefixed.map((e) => e.wxf[buf.length]).filter(Boolean),
  );

  const press = (ch: string) => {
    const nb = buf + ch;
    const hit = index.find((e) => e.wxf === nb);
    if (hit) {
      setBuf("");
      onMove(hit.move);
      return;
    }
    if (index.some((e) => e.wxf.startsWith(nb))) setBuf(nb);
  };

  const zhPreview = (buf ? prefixed : []).slice(0, 4);

  return (
    <div className="keypad">
      <div className="kbuf">
        {buf || <span className="muted">點按組合著法(如 H2+3)</span>}
      </div>
      <div className="krow">
        {PIECE_KEYS[side].map(([zh, ch]) => (
          <button
            key={ch}
            disabled={!nextChars.has(ch)}
            onClick={() => press(ch)}
          >
            {zh}
            <small>{ch}</small>
          </button>
        ))}
      </div>
      <div className="krow">
        {Array.from({ length: 9 }, (_, i) => String(i + 1)).map((d) => (
          <button key={d} disabled={!nextChars.has(d)} onClick={() => press(d)}>
            {d}
          </button>
        ))}
      </div>
      <div className="krow">
        {DIR_KEYS.map(([label, ch]) => (
          <button
            key={ch}
            disabled={!nextChars.has(ch)}
            onClick={() => press(ch)}
          >
            {label}
          </button>
        ))}
        <button onClick={() => setBuf(buf.slice(0, -1))} disabled={!buf}>
          ⌫
        </button>
      </div>
      {zhPreview.length > 0 && (
        <div className="chips">
          {zhPreview.map((e, i) => (
            <button key={i} className="chip" onClick={() => onMove(e.move)}>
              {e.zh}({e.wxf})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- 結束對局 ----------------
function EndDialog({
  initial,
  onSave,
  onCancel,
}: {
  initial: { result: GameResult; reason: string };
  onSave: (r: GameResult, reason: string) => void;
  onCancel: () => void;
}) {
  const [result, setResult] = useState<GameResult>(initial.result);
  const [reason, setReason] = useState(initial.reason);
  const reasons = [
    "絕殺",
    "困斃",
    "認輸",
    "超時",
    "協議和",
    "長打判負",
    "其他",
  ];
  return (
    <div className="overlay">
      <div className="dialog">
        <h3>結束對局</h3>
        <div className="seg">
          {(["red", "black", "draw"] as GameResult[]).map((r) => (
            <button
              key={r}
              className={result === r ? "on" : ""}
              onClick={() => setResult(r)}
            >
              {r === "red" ? "紅勝" : r === "black" ? "黑勝" : "和棋"}
            </button>
          ))}
        </div>
        <div>
          <div className="muted">原因</div>
          <div className="chips">
            {reasons.map((x) => (
              <button
                key={x}
                className="chip"
                style={
                  reason === x
                    ? { outline: "2px solid var(--accent)" }
                    : undefined
                }
                onClick={() => setReason(x)}
              >
                {x}
              </button>
            ))}
          </div>
        </div>
        <div className="fab-row">
          <button onClick={onCancel}>繼續記錄</button>
          <button className="primary" onClick={() => onSave(result, reason)}>
            儲存結果
          </button>
        </div>
      </div>
    </div>
  );
}
