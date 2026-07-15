// 把觀察結果比對到「上一個局面的合法著法」:最大概似挑一步(或兩步)。
// 這是整個拍照功能能成立的關鍵——候選只有幾十個,不必認出棋子文字。
import { applyMove, type Board, type Move, type Position } from '../core/board'
import { legalMoves } from '../core/movegen'
import { chineseMove } from '../core/notation'
import type { Observation } from './classify'

export interface Hypothesis {
  moves: Move[]
  zh: string[]
  score: number
}

export interface MatchResult {
  best: Hypothesis | null
  alts: Hypothesis[]
  /** 0..1:最佳假設每格的平均概似(≈0.9 = 吻合;<0.6 = 看不清楚) */
  quality: number
  /** 最佳與次佳的對數差:越大越確定 */
  margin: number
}

const FLOOR = 1e-3
const PLY_PENALTY = 0.8 // 同樣吻合時偏好步數少的解釋

function scoreBoard(board: Board, obs: Observation): number {
  let s = 0
  for (let i = 0; i < 90; i++) {
    const p = board[i]
    const o = obs[i]
    const pr = !p ? o.empty : p.side === 'red' ? o.red : o.black
    s += Math.log(Math.max(pr, FLOOR))
  }
  return s
}

export function matchObservation(pos: Position, obs: Observation, maxPly = 2): MatchResult {
  const raw: { moves: Move[]; score: number; adj: number }[] = []
  const s0 = scoreBoard(pos.board, obs)
  raw.push({ moves: [], score: s0, adj: s0 })

  for (const m1 of legalMoves(pos)) {
    const p1 = applyMove(pos, m1)
    const s1 = scoreBoard(p1.board, obs)
    raw.push({ moves: [m1], score: s1, adj: s1 - PLY_PENALTY })
    if (maxPly >= 2) {
      for (const m2 of legalMoves(p1)) {
        const s2 = scoreBoard(applyMove(p1, m2).board, obs)
        raw.push({ moves: [m1, m2], score: s2, adj: s2 - 2 * PLY_PENALTY })
      }
    }
  }
  raw.sort((a, b) => b.adj - a.adj)
  if (raw.length === 0) return { best: null, alts: [], quality: 0, margin: 0 }

  const toHyp = (x: { moves: Move[]; score: number }): Hypothesis => {
    const zh: string[] = []
    let p = pos
    for (const m of x.moves) {
      zh.push(chineseMove(p, m))
      p = applyMove(p, m)
    }
    return { moves: x.moves, zh, score: x.score }
  }
  const best = toHyp(raw[0])
  const alts = raw.slice(1, 4).map(toHyp)
  return {
    best,
    alts,
    // 每格平均概似:框線沒對準時觀察會整片模稜兩可,分數自然掉下來
    quality: Math.exp(raw[0].score / 90),
    margin: raw.length > 1 ? raw[0].adj - raw[1].adj : Infinity,
  }
}
