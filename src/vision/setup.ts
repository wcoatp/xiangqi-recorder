// 拍照擺盤(殘局輸入):照片 → 每個交叉點 空/紅/黑 → 類型指派。
// 類型來源三層,能用哪層用哪層,對每顆子取聯集:
//   規則強制(唯一合法解,例:九宮內只有一顆子 ⟹ 必是將/帥)→ margin = 1
//   範本比對(選項 A,使用者校準過自己的棋子)
//   CNN(選項 B,合成資料訓練)
// 沒把握(邊際小 / 分數低 / 無計分器)⟹ type = null,由 UI 亮「?」讓使用者點選(選項 0)。
import { sq, type Board, type PieceType, type Side } from '../core/board'
import { MAX_COUNT, possibleTypes } from '../core/placement'
import { classifyBoard, type Observation } from './classify'
import { CNN_TYPES, type CnnModel } from './cnn'
import { rotateQuad } from './geometry'
import { extractRotations } from './patch'
import { warpBoard } from './recognize'
import { templateScores, type PieceTemplates } from './templates'
import { rectX, rectY, type ImageLike, type Pt } from './types'

export interface SetupPiece {
  s: number
  side: Side
  /** null = 需要使用者指定 */
  type: PieceType | null
  /** 與次佳合法類型的分數差;規則強制 = 1 */
  margin: number
  /** 各合法類型的綜合分數(給 UI 排序選單用) */
  scores: Partial<Record<PieceType, number>>
}

export interface SetupResult {
  rotation: number
  quad: Pt[]
  pieces: SetupPiece[]
  /** 佔位判讀的銳利度(低 = 框沒對準/照片糊) */
  occupancyQuality: number
  scorers: { templates: boolean; cnn: boolean }
  warnings: string[]
}

const MARGIN_MIN = 0.05
const SCORE_MIN = 0.18

interface RotCand {
  rot: number
  rect: ImageLike
  obs: Observation
  quality: number
  feasible: boolean
}

const inPalaceIdx = (f: number) => f >= 3 && f <= 5

function pickRotation(img: ImageLike, quad: Pt[]): RotCand {
  const cands: RotCand[] = []
  for (let rot = 0; rot < 4; rot++) {
    const rect = warpBoard(img, rotateQuad(quad, rot))
    const obs = classifyBoard(rect)
    let sharp = 0
    let bottomRed = false
    let topBlack = false
    for (let i = 0; i < 90; i++) {
      const o = obs[i]
      sharp += Math.max(o.empty, o.red, o.black)
      const r = Math.floor(i / 9)
      const f = i % 9
      const occ = o.empty < Math.max(o.red, o.black)
      if (occ && inPalaceIdx(f)) {
        if (r <= 2 && o.red > o.black) bottomRed = true
        if (r >= 7 && o.black > o.red) topBlack = true
      }
    }
    // 帥/將被規則釘死在自己的九宮 ⟹ 正確的方向必然「下宮有紅、上宮有黑」
    cands.push({ rot, rect, obs, quality: sharp / 90, feasible: bottomRed && topBlack })
  }
  const pool = cands.some((c) => c.feasible) ? cands.filter((c) => c.feasible) : cands
  return pool.reduce((a, b) => (b.quality > a.quality ? b : a))
}

interface WorkPiece extends SetupPiece {
  legal: PieceType[]
}

function assignSide(pieces: WorkPiece[], hasScorer: boolean, warnings: string[], side: Side) {
  const cap: Record<PieceType, number> = { ...MAX_COUNT }
  const label = side === 'red' ? '紅' : '黑'

  // 規則強制:九宮內唯一的子必是將/帥
  const palace = pieces.filter((p) => p.legal.includes('K'))
  if (palace.length === 0) {
    warnings.push(`${label}方九宮內沒有棋子(找不到${side === 'red' ? '帥' : '將'});請檢查框線或照片`)
  } else if (palace.length === 1) {
    palace[0].type = 'K'
    palace[0].margin = 1
    cap.K = 0
  }

  if (!hasScorer) return // 其餘全部留給使用者點選

  // 貪婪:全部 (子,類型) 依分數排序
  const entries: Array<{ p: WorkPiece; t: PieceType; v: number }> = []
  for (const p of pieces) {
    if (p.type) continue
    for (const t of p.legal) entries.push({ p, t, v: p.scores[t] ?? 0 })
  }
  entries.sort((a, b) => b.v - a.v)
  for (const e of entries) {
    if (e.p.type || cap[e.t] <= 0) continue
    e.p.type = e.t
    cap[e.t]--
  }

  // 確保有王:沒指到 K 時,把九宮內 K 分數最高的子改成 K
  if (cap.K > 0 && palace.length > 0) {
    const best = palace.reduce((a, b) => ((b.scores.K ?? 0) > (a.scores.K ?? 0) ? b : a))
    if (best.type) cap[best.type]++
    best.type = 'K'
    cap.K = 0
  }

  // 局部改善:兩兩交換 / 單子改派,直到沒有改善
  for (let pass = 0; pass < 3; pass++) {
    let improved = false
    for (const p of pieces) {
      if (p.margin === 1 || !p.type) continue
      for (const t of p.legal) {
        if (t === p.type || cap[t] <= 0) continue
        if ((p.scores[t] ?? 0) > (p.scores[p.type] ?? 0) + 1e-9) {
          cap[p.type]++
          cap[t]--
          p.type = t
          improved = true
        }
      }
    }
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i]
        const b = pieces[j]
        if (!a.type || !b.type || a.margin === 1 || b.margin === 1) continue
        if (a.type === b.type) continue
        if (!a.legal.includes(b.type) || !b.legal.includes(a.type)) continue
        const cur = (a.scores[a.type] ?? 0) + (b.scores[b.type] ?? 0)
        const swapped = (a.scores[b.type] ?? 0) + (b.scores[a.type] ?? 0)
        if (swapped > cur + 1e-9) {
          const t = a.type
          a.type = b.type
          b.type = t
          improved = true
        }
      }
    }
    if (!improved) break
  }

  // 邊際:與次佳合法類型的差;太小或絕對分數太低 → 交回使用者
  for (const p of pieces) {
    if (p.margin === 1 || !p.type) continue
    const own = p.scores[p.type] ?? 0
    let alt = 0
    for (const t of p.legal) {
      if (t === p.type) continue
      const v = p.scores[t] ?? 0
      if (v > alt) alt = v
    }
    p.margin = own - alt
    if (p.margin < MARGIN_MIN || own < SCORE_MIN) p.type = null
  }
}

export function recognizeSetup(
  img: ImageLike,
  quad: Pt[],
  opts: { templates?: PieceTemplates | null; cnn?: CnnModel | null } = {},
): SetupResult {
  const warnings: string[] = []
  const best = pickRotation(img, quad)
  const { rect, obs } = best

  const work: Record<Side, WorkPiece[]> = { red: [], black: [] }
  for (let i = 0; i < 90; i++) {
    const o = obs[i]
    if (o.empty >= Math.max(o.red, o.black)) continue
    const side: Side = o.red >= o.black ? 'red' : 'black'
    const r = Math.floor(i / 9)
    const f = i % 9
    const legal = possibleTypes(side, i)
    if (legal.length === 0) {
      warnings.push(`(${r},${f}) 的${side === 'red' ? '紅' : '黑'}子不可能合法存在,已忽略`)
      continue
    }
    const scores: Partial<Record<PieceType, number>> = {}
    if (opts.templates || opts.cnn) {
      const rots = extractRotations(rect, rectX(f), rectY(r))
      const tmpl = opts.templates ? templateScores(opts.templates, side, rots) : null
      const cnnProbs = opts.cnn ? cnnAverage(opts.cnn, rots) : null
      for (const t of legal) {
        const a = tmpl ? (tmpl[t] ?? 0) : null
        const b = cnnProbs ? cnnProbs[CNN_TYPES.indexOf(t)] : null
        scores[t] = a !== null && b !== null ? 0.55 * a + 0.45 * b : (a ?? b ?? 0)
      }
    }
    work[side].push({ s: sq(r, f), side, type: null, margin: 0, scores, legal })
  }

  const total = work.red.length + work.black.length
  if (total < 2) warnings.push('偵測到的棋子太少;請確認框線有對準格線')
  if (work.red.length > 16 || work.black.length > 16) warnings.push('單方棋子超過 16 顆,照片可能誤判')

  const hasScorer = !!(opts.templates || opts.cnn)
  assignSide(work.red, hasScorer, warnings, 'red')
  assignSide(work.black, hasScorer, warnings, 'black')

  return {
    rotation: best.rot,
    quad: rotateQuad(quad, best.rot),
    pieces: [...work.red, ...work.black].map(({ legal: _l, ...p }) => p),
    occupancyQuality: best.quality,
    scorers: { templates: !!opts.templates, cnn: !!opts.cnn },
    warnings,
  }
}

function cnnAverage(cnn: CnnModel, rots: Float32Array[]): number[] {
  // 測試時增強:0/90/180/270 四個角度的平均機率
  const idx = [0, 6, 12, 18].filter((i) => i < rots.length)
  const acc = new Array<number>(7).fill(0)
  for (const i of idx) {
    const p = cnn.forward(rots[i])
    for (let k = 0; k < 7; k++) acc[k] += p[k]
  }
  for (let k = 0; k < 7; k++) acc[k] /= idx.length
  return acc
}

/** 全部類型都確定後,組出棋盤;還有未定的子則回傳 null */
export function setupToBoard(pieces: SetupPiece[]): Board | null {
  const board: Board = new Array(90).fill(null)
  for (const p of pieces) {
    if (!p.type) return null
    board[p.s] = { side: p.side, type: p.type }
  }
  return board
}
