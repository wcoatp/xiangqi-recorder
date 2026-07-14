// 象棋 FEN(UCCI / Fairy-Stockfish 慣例):
//   由黑方底線(rank 9)往紅方底線(rank 0)逐行,每行由 file 0 → 8
//   大寫 = 紅,小寫 = 黑;字母 K A B N R C P(相容 E≡B、H≡N)
//   輪走方 w = 紅(相容 xiangqi.js 的 'r'),b = 黑
import type { Board, Piece, PieceType, Position, Side } from './board'
import { emptyBoard, sq } from './board'

export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

const LETTER_TO_TYPE: Record<string, PieceType> = {
  K: 'K',
  A: 'A',
  B: 'B',
  E: 'B', // WXF 方言:E = 象
  N: 'N',
  H: 'N', // WXF 方言:H = 馬
  R: 'R',
  C: 'C',
  P: 'P',
}

export function parseFen(fen: string): Position {
  const parts = fen.trim().split(/\s+/)
  const rows = parts[0].split('/')
  if (rows.length !== 10) throw new Error(`FEN 需要 10 行:${fen}`)
  const board: Board = emptyBoard()
  for (let i = 0; i < 10; i++) {
    const r = 9 - i
    let f = 0
    for (const ch of rows[i]) {
      if (/[1-9]/.test(ch)) {
        f += parseInt(ch, 10)
      } else {
        const upper = ch.toUpperCase()
        const type = LETTER_TO_TYPE[upper]
        if (!type) throw new Error(`FEN 不明棋子字母「${ch}」:${fen}`)
        if (f >= 9) throw new Error(`FEN 行超過 9 格:${rows[i]}`)
        const side: Side = ch === upper ? 'red' : 'black'
        board[sq(r, f)] = { side, type } satisfies Piece
        f++
      }
    }
    if (f !== 9) throw new Error(`FEN 行長度錯誤(${f}):${rows[i]}`)
  }
  const turnToken = (parts[1] ?? 'w').toLowerCase()
  const turn: Side = turnToken === 'b' ? 'black' : 'red' // 'w' 與 'r' 都視為紅
  return { board, turn }
}

export function formatFen(pos: Position, fullmove = 1): string {
  const rows: string[] = []
  for (let r = 9; r >= 0; r--) {
    let row = ''
    let empties = 0
    for (let f = 0; f < 9; f++) {
      const p = pos.board[sq(r, f)]
      if (!p) {
        empties++
      } else {
        if (empties > 0) {
          row += String(empties)
          empties = 0
        }
        row += p.side === 'red' ? p.type : p.type.toLowerCase()
      }
    }
    if (empties > 0) row += String(empties)
    rows.push(row)
  }
  return `${rows.join('/')} ${pos.turn === 'red' ? 'w' : 'b'} - - 0 ${fullmove}`
}
