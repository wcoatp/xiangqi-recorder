// 內部座標系(UCCI frame):
//   file f = 0..8:從紅方左手邊(a 線)到右手邊(i 線)
//   rank r = 0..9:紅方底線 = 0,黑方底線 = 9
//   square = r * 9 + f(0..89)
// 紅方前進 = r 增加;黑方前進 = r 減少。

export type Side = 'red' | 'black'
export type PieceType = 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P'

export interface Piece {
  side: Side
  type: PieceType
}

export type Board = (Piece | null)[] // 長度 90

export interface Position {
  board: Board
  turn: Side
}

export interface Move {
  from: number
  to: number
}

export const FILES = 9
export const RANKS = 10

export const sq = (r: number, f: number): number => r * 9 + f
export const rankOf = (s: number): number => Math.floor(s / 9)
export const fileOf = (s: number): number => s % 9
export const opposite = (s: Side): Side => (s === 'red' ? 'black' : 'red')
export const forwardDir = (s: Side): number => (s === 'red' ? 1 : -1)
export const onBoard = (r: number, f: number): boolean => r >= 0 && r < RANKS && f >= 0 && f < FILES

export const inPalace = (side: Side, r: number, f: number): boolean =>
  f >= 3 && f <= 5 && (side === 'red' ? r <= 2 : r >= 7)

export const inOwnHalf = (side: Side, r: number): boolean => (side === 'red' ? r <= 4 : r >= 5)
export const crossedRiver = (side: Side, r: number): boolean => !inOwnHalf(side, r)

export function emptyBoard(): Board {
  return new Array<Piece | null>(90).fill(null)
}

export function clonePosition(p: Position): Position {
  return { board: p.board.slice(), turn: p.turn }
}

export function findKing(board: Board, side: Side): number {
  for (let s = 0; s < 90; s++) {
    const p = board[s]
    if (p && p.side === side && p.type === 'K') return s
  }
  return -1
}

/** 套用著法,回傳新 Position(不修改原本) */
export function applyMove(pos: Position, m: Move): Position {
  const board = pos.board.slice()
  board[m.to] = board[m.from]
  board[m.from] = null
  return { board, turn: opposite(pos.turn) }
}

export const moveEquals = (a: Move | null | undefined, b: Move | null | undefined): boolean =>
  !!a && !!b && a.from === b.from && a.to === b.to

/** 局面 key(重複局面偵測用):盤面 + 輪走方 */
export function positionKey(pos: Position): string {
  let out = ''
  for (let s = 0; s < 90; s++) {
    const p = pos.board[s]
    if (!p) {
      out += '.'
    } else {
      const ch = p.type
      out += p.side === 'red' ? ch : ch.toLowerCase()
    }
  }
  return out + (pos.turn === 'red' ? 'w' : 'b')
}
