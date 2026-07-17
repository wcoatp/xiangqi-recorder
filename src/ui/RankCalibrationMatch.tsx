import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  countConsecutiveNonCapturePlies,
  countCurrentPositionOccurrences,
  judgeCycle,
  type CycleConduct,
} from '../core/adjudication'
import { findKing, opposite, type Move, type Side } from '../core/board'
import { parseFen } from '../core/fen'
import { gameStatus, legalMoves, legalMovesFrom } from '../core/movegen'
import { chineseMove, uciMove } from '../core/notation'
import { mainline } from '../core/tree'
import { engine } from '../engine/engineClient'
import type { CalibrationGameV2 } from '../calibration/rankTypes'
import {
  abortCalibrationMatch,
  calibrationMatchToken,
  CalibrationMatchConflictError,
  CalibrationMatchTerminalError,
  CalibrationMatchVersionError,
  commitCalibrationEngineMove,
  commitCalibrationHumanMove,
  completeCalibrationMatch,
  getCalibrationMatch,
} from '../store/rankCalibrationMatch'
import { APP_VERSION } from '../version'
import Board from './Board'

const SIDE_LABEL: Record<Side, string> = { red: '紅', black: '黑' }

const RESULT_LABEL = {
  red: '紅方勝',
  black: '黑方勝',
  draw: '和棋',
} as const

const REASON_LABEL: Record<string, string> = {
  checkmate: '絕殺',
  stalemate: '困斃',
  'human-resigned': '協助者認輸',
  'agreed-draw': '雙方議和',
  'cycle-ruling': '循環裁定',
  'natural-limit-ruling': '自然限著裁定',
  'referee-ruling': '裁判裁定',
  'operator-aborted': '操作人員中止',
  'participant-withdrew': '協助者退出',
  'engine-unavailable': '引擎無法使用',
  'invalid-setup': '局面設定無效',
  'app-version-changed': 'App 版本已變更',
  'other-invalid': '其他無效局',
}

const CONDUCT_OPTIONS: ReadonlyArray<{ value: CycleConduct; label: string }> = [
  { value: 'long-check', label: '長將' },
  { value: 'long-chase', label: '長捉' },
  { value: 'none', label: '未犯例' },
]

type ManualResult = 'red' | 'black' | 'draw'
type CompletionReason =
  | 'human-resigned'
  | 'agreed-draw'
  | 'cycle-ruling'
  | 'natural-limit-ruling'
  | 'referee-ruling'
type AbortReason =
  | 'operator-aborted'
  | 'participant-withdrew'
  | 'engine-unavailable'
  | 'invalid-setup'
  | 'other-invalid'

const ABORT_REASONS: ReadonlyArray<{ value: AbortReason; label: string }> = [
  { value: 'operator-aborted', label: '操作人員決定中止' },
  { value: 'participant-withdrew', label: '協助者退出' },
  { value: 'engine-unavailable', label: '引擎無法使用' },
  { value: 'invalid-setup', label: '局面設定無效' },
  { value: 'other-invalid', label: '其他無效局' },
]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未預期的錯誤'
}

function latestMatchFromError(error: unknown): CalibrationGameV2 | undefined {
  if (
    error instanceof CalibrationMatchConflictError ||
    error instanceof CalibrationMatchTerminalError ||
    error instanceof CalibrationMatchVersionError
  ) return error.latest
  return undefined
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export interface RankCalibrationMatchProps {
  gameId: string
  onLeave: (sessionId?: string) => void
}

/**
 * PIN 解鎖子樹專用的現場校準棋盤。離頁與 unmount 只取消正在執行的引擎請求，
 * 不會把仍可接續的棋局誤標成中止。
 */
export default function RankCalibrationMatch({ gameId, onLeave }: RankCalibrationMatchProps) {
  const [game, setGame] = useState<Awaited<ReturnType<typeof getCalibrationMatch>>>(undefined)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const [keyboardMove, setKeyboardMove] = useState('')
  const [pending, setPending] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState('')
  const [engineAttempt, setEngineAttempt] = useState(0)
  const [redConduct, setRedConduct] = useState<CycleConduct>('none')
  const [blackConduct, setBlackConduct] = useState<CycleConduct>('none')
  const [abortReason, setAbortReason] = useState<AbortReason>('operator-aborted')
  const engineAbort = useRef<AbortController | null>(null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    setGame(undefined)
    setLoading(true)
    setError('')
    setSelected(null)
    setKeyboardMove('')
    void getCalibrationMatch(gameId)
      .then((next) => {
        if (!cancelled) setGame(next)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(`無法載入校準棋局：${errorMessage(cause)}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      mounted.current = false
      engineAbort.current?.abort()
      engineAbort.current = null
    }
  }, [gameId])

  const line = useMemo(() => (game ? mainline(game.gameSnapshot) : []), [game])
  const current = game ? (line[line.length - 1] ?? game.gameSnapshot) : null
  const fen = current?.fenAfter ?? ''
  const position = useMemo(() => (fen ? parseFen(fen) : null), [fen])
  const boardStatus = useMemo(() => (position ? gameStatus(position) : null), [position])
  const versionMismatch = !!game && game.appVersion !== APP_VERSION
  const engineSide = game ? opposite(game.playerSide) : 'black'
  const writable = !!game && game.status === 'in-progress' && !versionMismatch
  const humanTurn = writable && !!position && position.turn === game.playerSide
  const legalHumanMoves = useMemo(
    () => (humanTurn && position ? legalMoves(position) : []),
    [humanTurn, position],
  )
  const targets = useMemo(
    () =>
      selected !== null && humanTurn && position
        ? legalMovesFrom(position, selected).map((move) => move.to)
        : [],
    [humanTurn, position, selected],
  )
  const checkSq =
    position && boardStatus?.inCheck ? findKing(position.board, position.turn) : null
  const repetitionCount = useMemo(
    () =>
      game
        ? countCurrentPositionOccurrences([
            game.gameSnapshot.fenAfter,
            ...line.map((node) => node.fenAfter),
          ])
        : 0,
    [game, line],
  )
  const nonCapturePlies = useMemo(
    () =>
      game
        ? countConsecutiveNonCapturePlies(
            game.initialFen,
            line.map((node) => ({ move: node.move, fenAfter: node.fenAfter })),
          )
        : 0,
    [game, line],
  )
  const cycleRuling = useMemo(
    () => judgeCycle(redConduct, blackConduct),
    [redConduct, blackConduct],
  )
  const cycleResult: ManualResult =
    cycleRuling === 'draw' ? 'draw' : cycleRuling === 'red-loses' ? 'black' : 'red'

  useEffect(() => {
    setSelected(null)
    setKeyboardMove('')
  }, [game?.currentPly])

  // 引擎分析永遠在 transaction 外進行；只有完整結果才交由 store 以 CAS 提交。
  useEffect(() => {
    if (!game || !position || !writable || position.turn !== engineSide) return
    if (!engine.supported()) {
      setError('此環境無法啟動本機校準引擎；棋局仍保留為進行中，可稍後接續或明確中止。')
      return
    }

    const controller = new AbortController()
    engineAbort.current?.abort()
    engineAbort.current = controller
    const token = calibrationMatchToken(game)
    setThinking(true)
    setError('')

    void engine
      .analyzeCalibration(fen, {
        nodes: game.anchorSnapshot.search.nodes,
        multipv: game.anchorSnapshot.search.multipv,
        signal: controller.signal,
      })
      .then(async (analysis) => {
        if (controller.signal.aborted) return
        const saved = await commitCalibrationEngineMove(token, {
          nodes: game.anchorSnapshot.search.nodes,
          multipv: game.anchorSnapshot.search.multipv,
          ...analysis,
        })
        if (!controller.signal.aborted && mounted.current) setGame(saved)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || isAbortError(cause)) return
        if (mounted.current) {
          const latest = latestMatchFromError(cause)
          if (latest) setGame(latest)
          setError(`引擎未能完成或保存這一著：${errorMessage(cause)}`)
        }
      })
      .finally(() => {
        if (engineAbort.current === controller) engineAbort.current = null
        if (mounted.current && !controller.signal.aborted) setThinking(false)
      })

    return () => {
      controller.abort()
      if (engineAbort.current === controller) engineAbort.current = null
    }
  }, [engineAttempt, engineSide, fen, game, position, writable])

  const commitHumanMove = useCallback(
    async (move: Move) => {
      if (!game || !humanTurn || pending || thinking) return
      setPending(true)
      setSelected(null)
      setKeyboardMove('')
      setError('')
      try {
        const saved = await commitCalibrationHumanMove(calibrationMatchToken(game), move)
        if (mounted.current) setGame(saved)
      } catch (cause) {
        if (mounted.current) {
          const latest = latestMatchFromError(cause)
          if (latest) setGame(latest)
          setError(`這一著未能保存：${errorMessage(cause)}`)
        }
      } finally {
        if (mounted.current) setPending(false)
      }
    },
    [game, humanTurn, pending, thinking],
  )

  const onTap = useCallback(
    (square: number) => {
      if (!position || !game || !humanTurn || pending || thinking) return
      if (
        selected !== null &&
        legalMovesFrom(position, selected).some((move) => move.to === square)
      ) {
        void commitHumanMove({ from: selected, to: square })
        return
      }
      const piece = position.board[square]
      setSelected(piece?.side === game.playerSide ? (selected === square ? null : square) : null)
    },
    [commitHumanMove, game, humanTurn, pending, position, selected, thinking],
  )

  const finish = useCallback(
    async (result: ManualResult, reason: CompletionReason, confirmation: string) => {
      if (!game || !writable || pending || !window.confirm(confirmation)) return
      engineAbort.current?.abort()
      setThinking(false)
      setPending(true)
      setError('')
      try {
        const saved = await completeCalibrationMatch(calibrationMatchToken(game), result, reason)
        if (mounted.current) setGame(saved)
      } catch (cause) {
        if (mounted.current) {
          const latest = latestMatchFromError(cause)
          if (latest) setGame(latest)
          setError(`裁定未能保存：${errorMessage(cause)}`)
        }
      } finally {
        if (mounted.current) setPending(false)
      }
    },
    [game, pending, writable],
  )

  const abort = useCallback(
    async (reason: AbortReason | 'app-version-changed') => {
      if (!game || game.status !== 'in-progress' || pending) return
      const label = REASON_LABEL[reason]
      if (!window.confirm(`確定將這局標示為「${label}」？中止後不能接續。`)) return
      engineAbort.current?.abort()
      setThinking(false)
      setPending(true)
      setError('')
      try {
        const saved = await abortCalibrationMatch(calibrationMatchToken(game), reason)
        if (mounted.current) setGame(saved)
      } catch (cause) {
        if (mounted.current) {
          const latest = latestMatchFromError(cause)
          if (latest) setGame(latest)
          setError(`中止狀態未能保存：${errorMessage(cause)}`)
        }
      } finally {
        if (mounted.current) setPending(false)
      }
    },
    [game, pending],
  )

  const leave = () => {
    engineAbort.current?.abort()
    onLeave(game?.appVersion === APP_VERSION ? game.sessionId : undefined)
  }

  if (loading) return <div className="page" aria-live="polite">載入校準棋局…</div>
  if (!game) {
    return (
      <div className="page">
        <div className="topbar">
          <button type="button" onClick={() => onLeave()}>← 返回校準儀表板</button>
          <div className="title">找不到校準棋局</div>
        </div>
        {error && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
      </div>
    )
  }
  if (!position || !current) return <div className="page">棋局資料無法顯示。</div>

  const statusText = game.status === 'completed'
    ? `${RESULT_LABEL[game.result]}・${REASON_LABEL[game.resultReason ?? ''] ?? game.resultReason ?? '已完成'}`
    : game.status === 'aborted'
      ? `已中止・${REASON_LABEL[game.resultReason] ?? game.resultReason}`
      : versionMismatch
        ? `此局由 v${game.appVersion} 建立；目前 v${APP_VERSION} 僅能唯讀或明確中止。`
        : thinking
          ? '本機引擎以固定節點思考中…'
          : pending
            ? '正在保存完整棋局 checkpoint…'
            : position.turn === game.playerSide
              ? `輪到協助者走（第 ${game.currentPly + 1} 著）`
              : '輪到本機引擎'

  return (
    <div className="page" style={{ gap: 10 }}>
      <div className="topbar">
        <button type="button" onClick={leave}>← 暫離</button>
        <div className="title">
          現場級段校準
          <span className="muted" style={{ fontWeight: 400 }}>
            ・{game.profileSnapshot.alias}・{game.anchorId}・協助者執{SIDE_LABEL[game.playerSide]}
          </span>
        </div>
      </div>

      <div className="board-wrap" style={{ maxHeight: '58vh' }}>
        <Board
          fen={fen}
          bottom={game.playerSide}
          lastMove={current.move}
          selected={selected}
          targets={targets}
          checkSq={checkSq}
          onTap={humanTurn && !pending && !thinking ? onTap : undefined}
        />
      </div>

      <div className="banner" role="status" aria-live="polite">
        <b>{statusText}</b>
      </div>
      {error && (
        <div className="card" role="alert" style={{ color: 'var(--bad)' }}>
          {error}
          {writable && position.turn === engineSide && (
            <button
              type="button"
              onClick={() => {
                setError('')
                setEngineAttempt((attempt) => attempt + 1)
              }}
              disabled={thinking || pending}
              style={{ marginInlineStart: 8 }}
            >
              重試引擎這一著
            </button>
          )}
        </div>
      )}

      {(repetitionCount >= 3 || nonCapturePlies >= 100) && (
        <aside className="card" role="status" aria-live="polite">
          <b>棋規提醒（不會自動結束）</b>
          {repetitionCount >= 3 && <p>目前局面已出現 {repetitionCount} 次，請確認雙方是否長將或長捉。</p>}
          {nonCapturePlies >= 100 && <p>已連續 {nonCapturePlies} 著未吃子，請由雙方或裁判確認自然限著。</p>}
        </aside>
      )}

      {humanTurn && (
        <section className="card" aria-labelledby="keyboard-move-title">
          <b id="keyboard-move-title">鍵盤等價走子</b>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <label style={{ flex: '1 1 220px' }}>
              <span className="muted">合法著法</span>
              <select
                value={keyboardMove}
                onChange={(event) => setKeyboardMove(event.target.value)}
                disabled={pending || thinking}
                style={{ width: '100%' }}
              >
                <option value="">請選擇一著</option>
                {legalHumanMoves.map((move) => {
                  const uci = uciMove(move)
                  return <option key={uci} value={uci}>{chineseMove(position, move)}（{uci}）</option>
                })}
              </select>
            </label>
            <button
              type="button"
              disabled={!keyboardMove || pending || thinking}
              onClick={() => {
                const move = legalHumanMoves.find((candidate) => uciMove(candidate) === keyboardMove)
                if (move) void commitHumanMove(move)
              }}
            >
              確認走子
            </button>
          </div>
        </section>
      )}

      {game.status === 'in-progress' && !versionMismatch && (
        <section className="card" aria-labelledby="match-ruling-title">
          <h2 id="match-ruling-title" style={{ marginTop: 0 }}>人工結果與中止</h2>
          <div className="fab-row" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={pending}
              onClick={() => void finish(engineSide, 'human-resigned', '確定記錄為協助者認輸？')}
            >
              認輸
            </button>
            <button type="button" disabled={pending} onClick={() => void finish('draw', 'agreed-draw', '確定記錄為雙方議和？')}>
              雙方議和
            </button>
            <button type="button" disabled={pending} onClick={() => void finish('red', 'referee-ruling', '確定由裁判判定紅方勝？')}>
              裁判判紅勝
            </button>
            <button type="button" disabled={pending} onClick={() => void finish('black', 'referee-ruling', '確定由裁判判定黑方勝？')}>
              裁判判黑勝
            </button>
            <button type="button" disabled={pending} onClick={() => void finish('draw', 'referee-ruling', '確定由裁判判定和棋？')}>
              裁判判和
            </button>
            <button
              type="button"
              disabled={pending || nonCapturePlies < 100}
              title={nonCapturePlies < 100 ? '尚未達連續 100 著未吃子' : undefined}
              onClick={() => void finish('draw', 'natural-limit-ruling', '確定依自然限著判和？')}
            >
              自然限著和棋
            </button>
          </div>

          <details style={{ marginTop: 12 }}>
            <summary>循環盤面裁定</summary>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <label>
                紅方行為
                <select value={redConduct} onChange={(event) => setRedConduct(event.target.value as CycleConduct)}>
                  {CONDUCT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>
                黑方行為
                <select value={blackConduct} onChange={(event) => setBlackConduct(event.target.value as CycleConduct)}>
                  {CONDUCT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <output aria-live="polite">判定：{RESULT_LABEL[cycleResult]}</output>
              {repetitionCount < 3 && <span className="muted">目前局面尚未出現三次，不能保存循環裁定。</span>}
              <button
                type="button"
                disabled={pending || repetitionCount < 3}
                onClick={() => void finish(cycleResult, 'cycle-ruling', `確認循環分類並記錄為${RESULT_LABEL[cycleResult]}？`)}
              >
                確認循環裁定
              </button>
            </div>
          </details>

          <details style={{ marginTop: 12 }}>
            <summary>中止無效局</summary>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <label style={{ flex: '1 1 220px' }}>
                固定中止原因
                <select value={abortReason} onChange={(event) => setAbortReason(event.target.value as AbortReason)} style={{ width: '100%' }}>
                  {ABORT_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <button type="button" disabled={pending} onClick={() => void abort(abortReason)}>
                確認中止
              </button>
            </div>
          </details>
        </section>
      )}

      {game.status === 'in-progress' && versionMismatch && (
        <section className="card" role="note">
          <p>為避免同一局混用不同程式與引擎資產，此版本不允許接續落子。</p>
          <button type="button" disabled={pending} onClick={() => void abort('app-version-changed')}>
            以「App 版本已變更」中止此局
          </button>
        </section>
      )}

      <p className="muted" style={{ textAlign: 'center' }}>
        本機逐著保存・第 {game.currentPly} 著・相同局面 {repetitionCount} 次・連續未吃子 {nonCapturePlies} 著
      </p>
    </div>
  )
}
