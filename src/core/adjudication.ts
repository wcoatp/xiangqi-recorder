import { positionKey, type Move } from './board'
import { parseFen } from './fen'

/**
 * 協會 113 年版循環盤面比較所使用的三種分類。
 * 這裡只比較已由棋友／裁判完成的分類，不自動判定某著是否構成「捉」。
 */
export type CycleConduct = 'long-check' | 'long-chase' | 'none'

export type CycleRuling = 'draw' | 'red-loses' | 'black-loses'

const CONDUCT_SEVERITY: Record<CycleConduct, number> = {
  'long-check': 2,
  'long-chase': 1,
  none: 0,
}

/**
 * 雙方犯例程度相同時作和；程度不同時，較嚴重的一方不變作負。
 * 長將 > 長捉 > 未犯例。
 */
export function judgeCycle(red: CycleConduct, black: CycleConduct): CycleRuling {
  const redSeverity = CONDUCT_SEVERITY[red]
  const blackSeverity = CONDUCT_SEVERITY[black]
  if (redSeverity === blackSeverity) return 'draw'
  return redSeverity > blackSeverity ? 'red-loses' : 'black-loses'
}

/** 計算最後一個局面（含輪走方）在目前路徑中出現幾次。 */
export function countCurrentPositionOccurrences(fens: readonly string[]): number {
  const currentFen = fens[fens.length - 1]
  if (!currentFen) return 0
  const currentKey = positionKey(parseFen(currentFen))
  return fens.reduce(
    (count, fen) => count + (positionKey(parseFen(fen)) === currentKey ? 1 : 0),
    0,
  )
}

export interface AdjudicationPathNode {
  move: Move | null
  fenAfter: string
}

/**
 * 從目前路徑尾端往前等價地計算「連續未吃子著數」。
 * 以前一局面的目的格是否有棋子判斷吃子；任何吃子都會把計數歸零。
 */
export function countConsecutiveNonCapturePlies(
  initialFen: string,
  path: readonly AdjudicationPathNode[],
): number {
  let previous = parseFen(initialFen)
  let count = 0

  for (const node of path) {
    if (!node.move) {
      previous = parseFen(node.fenAfter)
      continue
    }
    count = previous.board[node.move.to] ? 0 : count + 1
    previous = parseFen(node.fenAfter)
  }

  return count
}
