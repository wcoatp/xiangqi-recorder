// 整局復盤分析:對主線每個局面跑引擎,產生評分曲線 + 著法評級(錯着/漏着/敗着)。
import { applyMove, type Move, type Position, type Side } from '../core/board'
import { parseFen } from '../core/fen'
import { legalMoves } from '../core/movegen'
import { chineseMove, parseUciMove, uciMove } from '../core/notation'
import type { GameNode } from '../core/tree'
import { mainline } from '../core/tree'
import { engine, scoreToCp, type PvLine } from './engineClient'

export type MoveTag = 'best' | 'good' | 'inacc' | 'mistake' | 'blunder'

export const TAG_LABEL: Record<MoveTag, string> = {
  best: '最佳',
  good: '良着',
  inacc: '漏着',
  mistake: '錯着',
  blunder: '敗着',
}

export interface PlyAnalysis {
  /** 0 = 開局前局面,i = 第 i 著之後 */
  ply: number
  fen: string
  /** 紅方視角評分(cp;mate 已映射為 ±(30000−n)) */
  scoreRed: number
  bestUci: string
  bestZh: string
  /** 引擎主變(中文,最多 6 步) */
  bestLineZh: string[]
  depth: number
}

export interface MoveJudgment {
  nodeId: string
  ply: number // 1-based:第幾著
  side: Side
  zh: string
  tag: MoveTag
  /** 該著損失(cp,以走子方視角,≥0) */
  loss: number
  scoreRedBefore: number
  scoreRedAfter: number
  bestZh: string
  bestLineZh: string[]
}

export interface GameReview {
  plies: PlyAnalysis[]
  judgments: MoveJudgment[]
  counts: Record<Side, Record<'inacc' | 'mistake' | 'blunder', number>>
  accuracy: Record<Side, number>
  movetimeMs: number
}

export interface ReviewProgress {
  done: number
  total: number
}

const winPercent = (cp: number): number => 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1)

/** lichess 準確度公式 */
const moveAccuracy = (wBefore: number, wAfter: number): number => {
  const drop = Math.max(0, wBefore - wAfter)
  return Math.max(0, Math.min(100, 103.17 * Math.exp(-0.04354 * drop) - 3.17))
}

function tagFor(loss: number, playedBest: boolean): MoveTag {
  if (playedBest || loss < 15) return 'best'
  if (loss < 45) return 'good'
  if (loss < 120) return 'inacc'
  if (loss < 300) return 'mistake'
  return 'blunder'
}

/** 把引擎 pv(UCI)轉成中文著法序列 */
function pvToZh(startPos: Position, pv: string[], limit = 6): string[] {
  const out: string[] = []
  let pos = startPos
  for (const u of pv.slice(0, limit)) {
    const m = parseUciMove(u)
    if (!m) break
    if (!legalMoves(pos).some((x) => x.from === m.from && x.to === m.to)) break
    out.push(chineseMove(pos, m))
    pos = applyMove(pos, m)
  }
  return out
}

export interface CancelToken {
  cancelled: boolean
}

/** 對主線做整局分析。會逐局面呼叫引擎(movetimeMs / 局面)。 */
export async function reviewMainline(
  root: GameNode,
  opts: {
    movetimeMs: number
    onProgress?: (p: ReviewProgress) => void
    cancel?: CancelToken
  },
): Promise<GameReview> {
  const nodes = mainline(root)
  const fens = [root.fenAfter, ...nodes.map((n) => n.fenAfter)]
  const total = fens.length
  const plies: PlyAnalysis[] = []

  for (let i = 0; i < fens.length; i++) {
    if (opts.cancel?.cancelled) throw new Error('cancelled')
    const pos = parseFen(fens[i])
    const status = legalMoves(pos).length === 0
    if (status) {
      // 終局局面:被將死/困斃方 = pos.turn
      const mateScore = pos.turn === 'red' ? -30000 : 30000
      plies.push({
        ply: i,
        fen: fens[i],
        scoreRed: mateScore,
        bestUci: '',
        bestZh: '',
        bestLineZh: [],
        depth: 0,
      })
      opts.onProgress?.({ done: i + 1, total })
      continue
    }
    const res = await engine.analyze(fens[i], { movetimeMs: opts.movetimeMs, multipv: 1 })
    const top: PvLine | undefined = res.lines[0]
    const cp = top ? scoreToCp(top) : 0
    const scoreRed = pos.turn === 'red' ? cp : -cp
    const bestUci = res.bestmove && res.bestmove !== '(none)' ? res.bestmove : (top?.pv[0] ?? '')
    const bestMove = bestUci ? parseUciMove(bestUci) : null
    plies.push({
      ply: i,
      fen: fens[i],
      scoreRed,
      bestUci,
      bestZh: bestMove ? safeZh(pos, bestMove) : '',
      bestLineZh: top ? pvToZh(pos, top.pv) : [],
      depth: top?.depth ?? 0,
    })
    opts.onProgress?.({ done: i + 1, total })
  }

  // 著法評級
  const judgments: MoveJudgment[] = []
  const counts: GameReview['counts'] = {
    red: { inacc: 0, mistake: 0, blunder: 0 },
    black: { inacc: 0, mistake: 0, blunder: 0 },
  }
  const accSum: Record<Side, number[]> = { red: [], black: [] }

  for (let i = 0; i < nodes.length; i++) {
    const before = plies[i]
    const after = plies[i + 1]
    const pos = parseFen(before.fen)
    const side = pos.turn
    const playedUci = nodes[i].move ? uciMove(nodes[i].move as Move) : ''
    const playedBest = playedUci !== '' && playedUci === before.bestUci
    const loss =
      side === 'red' ? before.scoreRed - after.scoreRed : after.scoreRed - before.scoreRed
    const tag = tagFor(Math.max(0, loss), playedBest)
    if (tag === 'inacc' || tag === 'mistake' || tag === 'blunder') counts[side][tag]++
    const wBefore = winPercent(side === 'red' ? before.scoreRed : -before.scoreRed)
    const wAfter = winPercent(side === 'red' ? after.scoreRed : -after.scoreRed)
    accSum[side].push(moveAccuracy(wBefore, wAfter))
    judgments.push({
      nodeId: nodes[i].id,
      ply: i + 1,
      side,
      zh: nodes[i].zh ?? '',
      tag,
      loss: Math.max(0, loss),
      scoreRedBefore: before.scoreRed,
      scoreRedAfter: after.scoreRed,
      bestZh: before.bestZh,
      bestLineZh: before.bestLineZh,
    })
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 100)
  return {
    plies,
    judgments,
    counts,
    accuracy: { red: Math.round(avg(accSum.red)), black: Math.round(avg(accSum.black)) },
    movetimeMs: opts.movetimeMs,
  }
}

function safeZh(pos: Position, m: Move): string {
  try {
    return chineseMove(pos, m)
  } catch {
    return ''
  }
}
