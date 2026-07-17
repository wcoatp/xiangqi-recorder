import { describe, expect, it } from 'vitest'
import { applyMove, sq, type Move, type Position } from './board'
import {
  countConsecutiveNonCapturePlies,
  countCurrentPositionOccurrences,
  judgeCycle,
  type AdjudicationPathNode,
  type CycleConduct,
} from './adjudication'
import { formatFen, parseFen } from './fen'

describe('循環盤面判決矩陣', () => {
  const cases: Array<[CycleConduct, CycleConduct, ReturnType<typeof judgeCycle>]> = [
    ['long-check', 'long-check', 'draw'],
    ['long-check', 'long-chase', 'red-loses'],
    ['long-check', 'none', 'red-loses'],
    ['long-chase', 'long-check', 'black-loses'],
    ['long-chase', 'long-chase', 'draw'],
    ['long-chase', 'none', 'red-loses'],
    ['none', 'long-check', 'black-loses'],
    ['none', 'long-chase', 'black-loses'],
    ['none', 'none', 'draw'],
  ]

  it.each(cases)('紅方 %s、黑方 %s → %s', (red, black, expected) => {
    expect(judgeCycle(red, black)).toBe(expected)
  })
})

describe('棋規提醒計數', () => {
  it('只把盤面與輪走方都相同的局面計為重複', () => {
    const redTurn = '4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1'
    const blackTurn = '4k4/9/9/9/9/9/9/9/4R4/4K4 b - - 0 1'
    expect(countCurrentPositionOccurrences([redTurn, blackTurn, redTurn, redTurn])).toBe(3)
    expect(countCurrentPositionOccurrences([])).toBe(0)
  })

  it('任何吃子都會讓連續未吃子著數歸零', () => {
    const initialFen = '4k4/9/9/9/9/9/p8/9/9/R3K4 w - - 0 1'
    const moves: Move[] = [
      { from: sq(0, 0), to: sq(1, 0) },
      { from: sq(9, 4), to: sq(8, 4) },
      { from: sq(1, 0), to: sq(3, 0) }, // 吃黑卒
      { from: sq(8, 4), to: sq(9, 4) },
    ]
    const path = makePath(initialFen, moves)
    expect(countConsecutiveNonCapturePlies(initialFen, path)).toBe(1)
  })

  it('可準確計到自然限著提醒門檻 100 著', () => {
    const initialFen = 'r3k4/9/9/9/9/9/9/9/9/R3K4 w - - 0 1'
    const moves: Move[] = []
    for (let i = 0; i < 50; i++) {
      moves.push(
        { from: i % 2 === 0 ? sq(0, 0) : sq(0, 1), to: i % 2 === 0 ? sq(0, 1) : sq(0, 0) },
        { from: i % 2 === 0 ? sq(9, 0) : sq(9, 1), to: i % 2 === 0 ? sq(9, 1) : sq(9, 0) },
      )
    }
    const path = makePath(initialFen, moves)
    expect(countConsecutiveNonCapturePlies(initialFen, path)).toBe(100)
  })
})

function makePath(initialFen: string, moves: readonly Move[]): AdjudicationPathNode[] {
  let position: Position = parseFen(initialFen)
  return moves.map((move) => {
    position = applyMove(position, move)
    return { move, fenAfter: formatFen(position) }
  })
}
