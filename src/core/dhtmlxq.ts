// 東萍象棋(dpxq.com)DhtmlXQ UBB 格式:中文棋界最通行的網頁分享格式。
//   [DhtmlXQ_binit] 64 碼 = 32 子 × (x,y),固定順序,99 = 不在場
//   [DhtmlXQ_movelist] 每 4 碼 = fromX fromY toX toY
//   座標:x = 我們的 file(0..8),y = 9 − rank(紅在下、左上角為 (0,0))
import { emptyBoard, sq, type Board, type PieceType, type Position, type Side } from './board'
import { formatFen, parseFen, START_FEN } from './fen'
import { legalMoves } from './movegen'
import type { GameMeta, GameResult } from './pgn'
import { addMove, mainline, newRoot } from './tree'
import type { ImportedGame } from './pgnImport'

// 紅:車馬相仕帥仕相馬車 炮炮 兵兵兵兵兵(黑同型)。
// 此順序左右對稱,所以就算來源用相反的 x 方向排列,每個槽位的「種類」仍然相同。
const SLOT_TYPES: PieceType[] = [
  'R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R',
  'C', 'C',
  'P', 'P', 'P', 'P', 'P',
]

/** 標準開局時各槽位的內部座標(匯出時用來挑槽) */
const SLOT_HOME: Record<Side, number[]> = {
  red: [
    sq(0, 0), sq(0, 1), sq(0, 2), sq(0, 3), sq(0, 4), sq(0, 5), sq(0, 6), sq(0, 7), sq(0, 8),
    sq(2, 1), sq(2, 7),
    sq(3, 0), sq(3, 2), sq(3, 4), sq(3, 6), sq(3, 8),
  ],
  black: [
    sq(9, 0), sq(9, 1), sq(9, 2), sq(9, 3), sq(9, 4), sq(9, 5), sq(9, 6), sq(9, 7), sq(9, 8),
    sq(7, 1), sq(7, 7),
    sq(6, 0), sq(6, 2), sq(6, 4), sq(6, 6), sq(6, 8),
  ],
}

const toXY = (s: number): [number, number] => [s % 9, 9 - Math.floor(s / 9)]
const fromXY = (x: number, y: number): number => (9 - y) * 9 + x

export function isDhtmlXq(text: string): boolean {
  return /\[DhtmlXQ(_\w+)?\]/i.test(text)
}

function field(text: string, name: string): string | null {
  const re = new RegExp(`\\[DhtmlXQ_${name}\\]([\\s\\S]*?)\\[/DhtmlXQ_${name}\\]`, 'i')
  const m = re.exec(text)
  return m ? m[1].trim() : null
}

function boardFromBinit(binit: string): Board {
  const digits = binit.replace(/\D/g, '')
  if (digits.length !== 64) throw new Error(`binit 應為 64 碼,實得 ${digits.length}`)
  const board = emptyBoard()
  for (let i = 0; i < 32; i++) {
    const x = Number(digits[i * 2])
    const y = Number(digits[i * 2 + 1])
    if (x === 9 && y === 9) continue // 不在場
    if (x > 8 || y > 9) throw new Error(`binit 第 ${i + 1} 子座標超出範圍`)
    const side: Side = i < 16 ? 'red' : 'black'
    board[fromXY(x, y)] = { side, type: SLOT_TYPES[i % 16] }
  }
  return board
}

export function parseDhtmlXq(text: string): ImportedGame {
  const binit = field(text, 'binit')
  const board = binit ? boardFromBinit(binit) : parseFen(START_FEN).board
  const pos: Position = { board, turn: 'red' }
  const fen = formatFen(pos)
  const root = newRoot(fen)

  const movelist = (field(text, 'movelist') ?? '').replace(/\D/g, '')
  const warnings: string[] = []
  let current = root
  let count = 0
  for (let i = 0; i + 3 < movelist.length; i += 4) {
    const from = fromXY(Number(movelist[i]), Number(movelist[i + 1]))
    const to = fromXY(Number(movelist[i + 2]), Number(movelist[i + 3]))
    const p = parseFen(current.fenAfter)
    if (!legalMoves(p).some((m) => m.from === from && m.to === to)) {
      warnings.push(`第 ${count + 1} 著不合法,後續著法已略過`)
      break
    }
    current = addMove(current, { from, to }).node
    count++
  }

  const resultText = field(text, 'result') ?? ''
  const result: GameResult = resultText.includes('红胜') || resultText.includes('紅勝')
    ? 'red'
    : resultText.includes('黑胜') || resultText.includes('黑勝')
      ? 'black'
      : resultText.includes('和')
        ? 'draw'
        : '*'

  const meta: GameMeta = {
    red: field(text, 'red') || '紅方',
    black: field(text, 'black') || '黑方',
    startedAt: parseDpxqDate(field(text, 'date')) ?? Date.now(),
    result,
    event: field(text, 'event') || field(text, 'title') || undefined,
  }
  return { meta, root, moveCount: count, warnings }
}

function parseDpxqDate(v: string | null): number | null {
  if (!v) return null
  const m = /(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/.exec(v)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime()
}

/** 匯出 DhtmlXQ(貼到東萍/論壇即可播放) */
export function formatDhtmlXq(meta: GameMeta, root: ReturnType<typeof newRoot>): string {
  const pos = parseFen(root.fenAfter)
  const digits: string[] = []
  for (const side of ['red', 'black'] as Side[]) {
    // 依槽位種類分配:同種類的子照「離本位近」的順序填,空槽填 99
    const used = new Set<number>()
    for (let slot = 0; slot < 16; slot++) {
      const type = SLOT_TYPES[slot]
      const home = SLOT_HOME[side][slot]
      let best = -1
      let bestD = Infinity
      for (let s = 0; s < 90; s++) {
        const p = pos.board[s]
        if (!p || p.side !== side || p.type !== type || used.has(s)) continue
        const d = Math.abs(Math.floor(s / 9) - Math.floor(home / 9)) + Math.abs((s % 9) - (home % 9))
        if (d < bestD) {
          bestD = d
          best = s
        }
      }
      if (best < 0) {
        digits.push('9', '9')
      } else {
        used.add(best)
        const [x, y] = toXY(best)
        digits.push(String(x), String(y))
      }
    }
  }
  const moves = mainline(root)
    .map((n) => {
      const [fx, fy] = toXY(n.move!.from)
      const [tx, ty] = toXY(n.move!.to)
      return `${fx}${fy}${tx}${ty}`
    })
    .join('')
  const resultZh: Record<GameResult, string> = { red: '红胜', black: '黑胜', draw: '和棋', '*': '未终局' }
  const d = new Date(meta.startedAt)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return [
    '[DhtmlXQ]',
    `[DhtmlXQ_title]${meta.event ?? '對局紀錄'}[/DhtmlXQ_title]`,
    `[DhtmlXQ_red]${meta.red}[/DhtmlXQ_red]`,
    `[DhtmlXQ_black]${meta.black}[/DhtmlXQ_black]`,
    `[DhtmlXQ_date]${date}[/DhtmlXQ_date]`,
    `[DhtmlXQ_result]${resultZh[meta.result]}[/DhtmlXQ_result]`,
    `[DhtmlXQ_binit]${digits.join('')}[/DhtmlXQ_binit]`,
    `[DhtmlXQ_movelist]${moves}[/DhtmlXQ_movelist]`,
    '[/DhtmlXQ]',
  ].join('\n')
}
