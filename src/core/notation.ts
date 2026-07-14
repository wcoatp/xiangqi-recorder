// 記譜法(單一內部表示 → 各種記法的純函式):
//   中文縱線:炮二平五 / 馬8進7(紅用中文數字、黑用阿拉伯數字,路數從己方右手邊數 1..9)
//   WXF:C2=5 / H8+7(+ 進 − 退 = 平;同線疊子在字母後加 +/−;多兵用「序數+路數」)
//   ICCS:H2-E2(a..i 從紅方左手邊、rank 0..9 紅底線為 0)
//   UCI(Fairy-Stockfish):h3e3(rank 1..10)
import type { Move, PieceType, Position, Side } from './board'
import { fileOf, forwardDir, rankOf } from './board'

export const ZH_PIECE: Record<Side, Record<PieceType, string>> = {
  red: { K: '帥', A: '仕', B: '相', N: '馬', R: '車', C: '炮', P: '兵' },
  black: { K: '將', A: '士', B: '象', N: '馬', R: '車', C: '炮', P: '卒' },
}
export const ZH_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
export const WXF_LETTER: Record<PieceType, string> = {
  K: 'K',
  A: 'A',
  B: 'E',
  N: 'H',
  R: 'R',
  C: 'C',
  P: 'P',
}

/** 己方視角的路數 1..9(從自己右手邊數起) */
export const relFile = (side: Side, f: number): number => (side === 'red' ? 9 - f : f + 1)
/** 己方視角的前進量(正 = 進) */
export const relForward = (side: Side, dr: number): number => (side === 'red' ? dr : -dr)

const zhNum = (side: Side, n: number): string => (side === 'red' ? ZH_NUM[n - 1] : String(n))

/** 前 = 靠近敵方。回傳排序值,越小越前。 */
const frontOrder = (side: Side, r: number): number => (side === 'red' ? -r : r)

interface MoveParts {
  side: Side
  type: PieceType
  fromRel: number
  dir: 1 | 0 | -1
  /** 進退平的參數:斜走子(馬象士)與平移 = 目的路數;直走子進退 = 格數 */
  argIsFile: boolean
  arg: number
  /** 疊子標記:'front' | 'mid' | 'rear' | 序數(1 = 最前) | null */
  tandem: 'front' | 'mid' | 'rear' | number | null
  /** 多兵序數模式時仍需路數(WXF 用) */
  keepFileDigit: boolean
}

function analyzeMove(pos: Position, m: Move): MoveParts {
  const p = pos.board[m.from]
  if (!p) throw new Error('起點無棋子')
  const side = p.side
  const fr = rankOf(m.from)
  const ff = fileOf(m.from)
  const tr = rankOf(m.to)
  const tf = fileOf(m.to)
  const dr = tr - fr
  const fwd = relForward(side, dr)
  const dir: 1 | 0 | -1 = fwd > 0 ? 1 : fwd < 0 ? -1 : 0
  const diagonal = p.type === 'N' || p.type === 'B' || p.type === 'A'
  const argIsFile = diagonal || dir === 0
  const arg = argIsFile ? relFile(side, tf) : Math.abs(dr)

  let tandem: MoveParts['tandem'] = null
  let keepFileDigit = false

  if (p.type !== 'A' && p.type !== 'B') {
    // 同路同種己方棋子(由前到後排序)
    const group: number[] = []
    for (let s = 0; s < 90; s++) {
      const q = pos.board[s]
      if (q && q.side === side && q.type === p.type && fileOf(s) === ff) group.push(s)
    }
    group.sort((a, b) => frontOrder(side, rankOf(a)) - frontOrder(side, rankOf(b)))

    if (p.type === 'P') {
      // 兵的特殊規則:一路 ≥2 兵才進入疊子邏輯;兩路以上各有 ≥2 兵 → 跨路序數
      const fileCount = new Map<number, number[]>()
      for (let s = 0; s < 90; s++) {
        const q = pos.board[s]
        if (q && q.side === side && q.type === 'P') {
          const list = fileCount.get(fileOf(s)) ?? []
          list.push(s)
          fileCount.set(fileOf(s), list)
        }
      }
      const multiFiles = [...fileCount.entries()].filter(([, list]) => list.length >= 2)
      if (group.length >= 2) {
        if (multiFiles.length >= 2) {
          // 跨路序數:各路(右路優先)內由前到後,全部編 一~五
          multiFiles.sort((a, b) => relFile(side, a[0]) - relFile(side, b[0]))
          const ordered: number[] = []
          for (const [, list] of multiFiles) {
            list.sort((a, b) => frontOrder(side, rankOf(a)) - frontOrder(side, rankOf(b)))
            ordered.push(...list)
          }
          tandem = ordered.indexOf(m.from) + 1
          keepFileDigit = true
        } else if (group.length === 2) {
          tandem = group[0] === m.from ? 'front' : 'rear'
        } else if (group.length === 3) {
          const i = group.indexOf(m.from)
          tandem = i === 0 ? 'front' : i === 1 ? 'mid' : 'rear'
        } else {
          tandem = group.indexOf(m.from) + 1
          keepFileDigit = true
        }
      }
    } else if (group.length >= 2) {
      tandem = group[0] === m.from ? 'front' : 'rear'
    }
  }

  return { side, type: p.type, fromRel: relFile(side, ff), dir, argIsFile, arg, tandem, keepFileDigit }
}

/** 中文縱線記譜,如 炮二平五、馬8進7、前車進三、一兵平五 */
export function chineseMove(pos: Position, m: Move): string {
  const x = analyzeMove(pos, m)
  const piece = ZH_PIECE[x.side][x.type]
  const dirCh = x.dir > 0 ? '進' : x.dir < 0 ? '退' : '平'
  const argCh = zhNum(x.side, x.arg)
  if (x.tandem === null) return `${piece}${zhNum(x.side, x.fromRel)}${dirCh}${argCh}`
  if (typeof x.tandem === 'number') return `${ZH_NUM[x.tandem - 1]}${piece}${dirCh}${argCh}` // 序數兩方都用中文
  const t = x.tandem === 'front' ? '前' : x.tandem === 'mid' ? '中' : '後'
  return `${t}${piece}${dirCh}${argCh}`
}

/** WXF 記譜,如 C2=5、H8+7、C+-2(前炮退二)、14=5(多兵序數) */
export function wxfMove(pos: Position, m: Move): string {
  const x = analyzeMove(pos, m)
  const letter = WXF_LETTER[x.type]
  const dirSym = x.dir > 0 ? '+' : x.dir < 0 ? '-' : '='
  if (x.tandem === null) return `${letter}${x.fromRel}${dirSym}${x.arg}`
  if (typeof x.tandem === 'number') return `${x.tandem}${x.fromRel}${dirSym}${x.arg}`
  const t = x.tandem === 'front' ? '+' : x.tandem === 'mid' ? '.' : '-'
  return `${letter}${t}${dirSym}${x.arg}`
}

const ICCS_FILE = 'ABCDEFGHI'

/** ICCS 座標記譜,如 H2-E2 */
export function iccsMove(m: Move): string {
  return `${ICCS_FILE[fileOf(m.from)]}${rankOf(m.from)}-${ICCS_FILE[fileOf(m.to)]}${rankOf(m.to)}`
}

/** Fairy-Stockfish UCI 座標(rank 1..10),如 h3e3、h10g8 */
export function uciMove(m: Move): string {
  const l = (f: number) => String.fromCharCode(97 + f)
  return `${l(fileOf(m.from))}${rankOf(m.from) + 1}${l(fileOf(m.to))}${rankOf(m.to) + 1}`
}

export function parseUciMove(s: string): Move | null {
  const mm = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/.exec(s.trim())
  if (!mm) return null
  const from = (parseInt(mm[2], 10) - 1) * 9 + (mm[1].charCodeAt(0) - 97)
  const to = (parseInt(mm[4], 10) - 1) * 9 + (mm[3].charCodeAt(0) - 97)
  return { from, to }
}

export function parseIccsMove(s: string): Move | null {
  const mm = /^([A-Ia-i])([0-9])[-.]?([A-Ia-i])([0-9])$/.exec(s.trim())
  if (!mm) return null
  const from = parseInt(mm[2], 10) * 9 + (mm[1].toUpperCase().charCodeAt(0) - 65)
  const to = parseInt(mm[4], 10) * 9 + (mm[3].toUpperCase().charCodeAt(0) - 65)
  return { from, to }
}

/** 給 UI 用:著法的雙記法 */
export function moveNotations(pos: Position, m: Move): { zh: string; wxf: string } {
  return { zh: chineseMove(pos, m), wxf: wxfMove(pos, m) }
}
