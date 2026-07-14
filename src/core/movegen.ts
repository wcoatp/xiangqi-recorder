import type { Board, Move, Position, Side } from './board'
import {
  applyMove,
  crossedRiver,
  fileOf,
  findKing,
  forwardDir,
  inOwnHalf,
  inPalace,
  onBoard,
  opposite,
  rankOf,
  sq,
} from './board'

// [df, dr]
const N_OFFS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
]
const B_OFFS: ReadonlyArray<readonly [number, number]> = [
  [2, 2],
  [2, -2],
  [-2, 2],
  [-2, -2],
]
const A_OFFS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]
const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/** 某方的王是否被攻擊(含雙將對臉:對方將帥在同一路無遮擋) */
export function inCheck(board: Board, side: Side): boolean {
  const ks = findKing(board, side)
  if (ks < 0) return false
  const kr = rankOf(ks)
  const kf = fileOf(ks)
  const enemy = opposite(side)

  // 車 / 對臉將帥(射線第一子)、炮(射線第二子)
  for (const [df, dr] of ORTHO) {
    let f = kf + df
    let r = kr + dr
    let firstFound = false
    while (onBoard(r, f)) {
      const p = board[sq(r, f)]
      if (p) {
        if (!firstFound) {
          if (p.side === enemy && (p.type === 'R' || p.type === 'K')) return true
          firstFound = true
        } else {
          if (p.side === enemy && p.type === 'C') return true
          break
        }
      }
      f += df
      r += dr
    }
  }

  // 馬(檢查馬腳:馬自己那側的腿)
  for (const [df, dr] of N_OFFS) {
    const hf = kf + df
    const hr = kr + dr
    if (!onBoard(hr, hf)) continue
    const p = board[sq(hr, hf)]
    if (!p || p.side !== enemy || p.type !== 'N') continue
    const legF = hf + Math.trunc(-df / 2)
    const legR = hr + Math.trunc(-dr / 2)
    if (!board[sq(legR, legF)]) return true
  }

  // 兵/卒:正前方一格;過河後左右一格
  const efwd = forwardDir(enemy)
  {
    const pr = kr - efwd
    if (onBoard(pr, kf)) {
      const p = board[sq(pr, kf)]
      if (p && p.side === enemy && p.type === 'P') return true
    }
    for (const df of [-1, 1]) {
      const pf = kf + df
      if (onBoard(kr, pf)) {
        const p = board[sq(kr, pf)]
        if (p && p.side === enemy && p.type === 'P' && crossedRiver(enemy, kr)) return true
      }
    }
  }

  return false
}

/** 產生某格棋子的偽合法著法(不檢查己方被將) */
export function pseudoMovesFrom(pos: Position, from: number): Move[] {
  const { board } = pos
  const piece = board[from]
  if (!piece) return []
  const side = piece.side
  const r0 = rankOf(from)
  const f0 = fileOf(from)
  const out: Move[] = []
  const push = (r: number, f: number) => {
    if (!onBoard(r, f)) return
    const t = board[sq(r, f)]
    if (t && t.side === side) return
    out.push({ from, to: sq(r, f) })
  }

  switch (piece.type) {
    case 'K':
      for (const [df, dr] of ORTHO) {
        const r = r0 + dr
        const f = f0 + df
        if (inPalace(side, r, f)) push(r, f)
      }
      break
    case 'A':
      for (const [df, dr] of A_OFFS) {
        const r = r0 + dr
        const f = f0 + df
        if (inPalace(side, r, f)) push(r, f)
      }
      break
    case 'B':
      for (const [df, dr] of B_OFFS) {
        const r = r0 + dr
        const f = f0 + df
        if (!onBoard(r, f) || !inOwnHalf(side, r)) continue
        const eyeR = r0 + dr / 2
        const eyeF = f0 + df / 2
        if (board[sq(eyeR, eyeF)]) continue // 塞象眼
        push(r, f)
      }
      break
    case 'N':
      for (const [df, dr] of N_OFFS) {
        const r = r0 + dr
        const f = f0 + df
        if (!onBoard(r, f)) continue
        const legR = r0 + Math.trunc(dr / 2)
        const legF = f0 + Math.trunc(df / 2)
        if (board[sq(legR, legF)]) continue // 蹩馬腿
        push(r, f)
      }
      break
    case 'R':
      for (const [df, dr] of ORTHO) {
        let r = r0 + dr
        let f = f0 + df
        while (onBoard(r, f)) {
          const t = board[sq(r, f)]
          if (!t) {
            out.push({ from, to: sq(r, f) })
          } else {
            if (t.side !== side) out.push({ from, to: sq(r, f) })
            break
          }
          r += dr
          f += df
        }
      }
      break
    case 'C':
      for (const [df, dr] of ORTHO) {
        let r = r0 + dr
        let f = f0 + df
        let screened = false
        while (onBoard(r, f)) {
          const t = board[sq(r, f)]
          if (!screened) {
            if (!t) {
              out.push({ from, to: sq(r, f) })
            } else {
              screened = true // 炮架
            }
          } else if (t) {
            if (t.side !== side) out.push({ from, to: sq(r, f) }) // 隔子吃
            break
          }
          r += dr
          f += df
        }
      }
      break
    case 'P': {
      const fwd = forwardDir(side)
      push(r0 + fwd, f0)
      if (crossedRiver(side, r0)) {
        push(r0, f0 - 1)
        push(r0, f0 + 1)
      }
      break
    }
  }
  return out
}

export function allPseudoMoves(pos: Position): Move[] {
  const out: Move[] = []
  for (let s = 0; s < 90; s++) {
    const p = pos.board[s]
    if (p && p.side === pos.turn) out.push(...pseudoMovesFrom(pos, s))
  }
  return out
}

/** 走完後己方不被將、將帥不對臉,才是合法著法 */
export function isLegal(pos: Position, m: Move): boolean {
  const p = pos.board[m.from]
  if (!p || p.side !== pos.turn) return false
  const next = applyMove(pos, m)
  return !inCheck(next.board, pos.turn)
}

export function legalMoves(pos: Position): Move[] {
  return allPseudoMoves(pos).filter((m) => isLegal(pos, m))
}

export function legalMovesFrom(pos: Position, from: number): Move[] {
  return pseudoMovesFrom(pos, from).filter((m) => isLegal(pos, m))
}

export interface GameStatus {
  over: boolean
  winner?: Side
  /** checkmate = 絕殺;stalemate = 困斃(象棋規則:無著可走即負,不論是否被將) */
  reason?: 'checkmate' | 'stalemate'
  inCheck: boolean
}

export function gameStatus(pos: Position): GameStatus {
  const checked = inCheck(pos.board, pos.turn)
  if (legalMoves(pos).length === 0) {
    return {
      over: true,
      winner: opposite(pos.turn),
      reason: checked ? 'checkmate' : 'stalemate',
      inCheck: checked,
    }
  }
  return { over: false, inCheck: checked }
}

/** perft:測試走法產生正確性用 */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1
  const moves = legalMoves(pos)
  if (depth === 1) return moves.length
  let total = 0
  for (const m of moves) total += perft(applyMove(pos, m), depth - 1)
  return total
}
