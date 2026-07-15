// 合成棋盤照片測試:渲染 → 加透視 → 偵測 → 校正 → 分類 → 比對。
// 驗證的是幾何與比對邏輯;真實照片的門檻調校要靠實機。
import { describe, expect, it } from 'vitest'
import { applyMove, sq, type Move, type Position } from '../core/board'
import { parseFen, START_FEN } from '../core/fen'
import { classifyBoard } from './classify'
import { detectBoardQuad, refineQuad } from './detect'
import { applyH, homography, sampleBilinear } from './geometry'
import { matchObservation } from './match'
import { recognize, verdictOf, warpBoard } from './recognize'
import { CELL, MARGIN, RECT_H, RECT_W, rectX, rectY, type ImageLike, type Pt } from './types'

// ---------- 合成渲染 ----------
const WOOD = [216, 184, 120]
const LINE = [90, 58, 32]
const PIECE_FACE = [242, 230, 200]
const RED_INK = [179, 49, 44]
const BLACK_INK = [34, 32, 28]
const TABLE = [70, 70, 78]

function blank(w: number, h: number, rgb: number[]): ImageLike {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0]
    data[i * 4 + 1] = rgb[1]
    data[i * 4 + 2] = rgb[2]
    data[i * 4 + 3] = 255
  }
  return { data, width: w, height: h }
}

function px(img: ImageLike, x: number, y: number, rgb: number[]) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  const i = (Math.round(y) * img.width + Math.round(x)) * 4
  img.data[i] = rgb[0]
  img.data[i + 1] = rgb[1]
  img.data[i + 2] = rgb[2]
}

function line(img: ImageLike, x0: number, y0: number, x1: number, y1: number, rgb: number[], w = 2) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t
    for (let dx = -(w >> 1); dx <= w >> 1; dx++) for (let dy = -(w >> 1); dy <= w >> 1; dy++) px(img, x + dx, y + dy, rgb)
  }
}

function disc(img: ImageLike, cx: number, cy: number, r: number, rgb: number[]) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) px(img, cx + dx, cy + dy, rgb)
    }
  }
}

/** 畫一個「字」:用幾道粗筆畫模擬,墨水覆蓋約 25% 圓面積 */
function glyph(img: ImageLike, cx: number, cy: number, rgb: number[]) {
  for (let dy = -12; dy <= 12; dy += 6) line(img, cx - 12, cy + dy, cx + 12, cy + dy, rgb, 3)
  line(img, cx, cy - 13, cx, cy + 13, rgb, 3)
}

/** 渲染校正視角的棋盤(含實體外框:刻意讓最外圈的強邊不是格線,測試精修) */
function renderBoard(pos: Position, withBorder = true): ImageLike {
  const img = blank(RECT_W, RECT_H, withBorder ? [196, 160, 100] : WOOD)
  if (withBorder) {
    // 內部棋盤面(比格線範圍大一點),外圈留下不同色的實體邊框
    for (let y = 10; y < RECT_H - 10; y++) {
      for (let x = 10; x < RECT_W - 10; x++) px(img, x, y, WOOD)
    }
    // 實體邊框的強邊線
    line(img, 10, 10, RECT_W - 10, 10, [60, 40, 20], 3)
    line(img, 10, RECT_H - 10, RECT_W - 10, RECT_H - 10, [60, 40, 20], 3)
    line(img, 10, 10, 10, RECT_H - 10, [60, 40, 20], 3)
    line(img, RECT_W - 10, 10, RECT_W - 10, RECT_H - 10, [60, 40, 20], 3)
  }
  // 10 條橫線
  for (let r = 0; r < 10; r++) line(img, rectX(0), rectY(r), rectX(8), rectY(r), LINE, 2)
  // 9 條直線(中間 7 條在河界斷開)
  for (let f = 0; f < 9; f++) {
    if (f === 0 || f === 8) line(img, rectX(f), rectY(0), rectX(f), rectY(9), LINE, 2)
    else {
      line(img, rectX(f), rectY(0), rectX(f), rectY(4), LINE, 2)
      line(img, rectX(f), rectY(5), rectX(f), rectY(9), LINE, 2)
    }
  }
  // 九宮斜線
  line(img, rectX(3), rectY(0), rectX(5), rectY(2), LINE, 2)
  line(img, rectX(5), rectY(0), rectX(3), rectY(2), LINE, 2)
  line(img, rectX(3), rectY(9), rectX(5), rectY(7), LINE, 2)
  line(img, rectX(5), rectY(9), rectX(3), rectY(7), LINE, 2)
  // 棋子
  for (let r = 0; r < 10; r++) {
    for (let f = 0; f < 9; f++) {
      const p = pos.board[sq(r, f)]
      if (!p) continue
      const cx = rectX(f)
      const cy = rectY(r)
      disc(img, cx, cy, Math.round(CELL * 0.44), PIECE_FACE)
      disc(img, cx, cy, Math.round(CELL * 0.44), PIECE_FACE)
      glyph(img, cx, cy, p.side === 'red' ? RED_INK : BLACK_INK)
    }
  }
  return img
}

/** 把校正視角的棋盤投影成一張「照片」(帶透視 + 桌面背景) */
function photograph(board: ImageLike, W: number, H: number, quadInPhoto: Pt[]): ImageLike {
  const photo = blank(W, H, TABLE)
  const boardCorners: Pt[] = [
    { x: 0, y: 0 },
    { x: board.width - 1, y: 0 },
    { x: board.width - 1, y: board.height - 1 },
    { x: 0, y: board.height - 1 },
  ]
  const toBoard = homography(quadInPhoto, boardCorners)
  const rgb = [0, 0, 0]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = applyH(toBoard, { x, y })
      if (p.x < 0 || p.y < 0 || p.x > board.width - 1 || p.y > board.height - 1) continue
      sampleBilinear(board, p.x, p.y, rgb)
      const o = (y * W + x) * 4
      photo.data[o] = rgb[0]
      photo.data[o + 1] = rgb[1]
      photo.data[o + 2] = rgb[2]
      photo.data[o + 3] = 255
    }
  }
  return photo
}

/** 照片中「棋盤外框影像」的四角 → 對應的格線四角(ground truth) */
function gridCornersInPhoto(quadInPhoto: Pt[]): Pt[] {
  const boardCorners: Pt[] = [
    { x: 0, y: 0 },
    { x: RECT_W - 1, y: 0 },
    { x: RECT_W - 1, y: RECT_H - 1 },
    { x: 0, y: RECT_H - 1 },
  ]
  const H = homography(boardCorners, quadInPhoto)
  return [
    { x: MARGIN, y: MARGIN },
    { x: RECT_W - MARGIN, y: MARGIN },
    { x: RECT_W - MARGIN, y: RECT_H - MARGIN },
    { x: MARGIN, y: RECT_H - MARGIN },
  ].map((p) => applyH(H, p))
}

const maxCornerErr = (a: Pt[], b: Pt[]): number =>
  Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)))

// ---------- 測試 ----------
const start = parseFen(START_FEN)
const C25: Move = { from: sq(2, 7), to: sq(2, 4) } // 炮二平五
const H87: Move = { from: sq(9, 7), to: sq(7, 6) } // 馬8進7

describe('幾何', () => {
  it('單應矩陣往返', () => {
    const src: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ]
    const dst: Pt[] = [
      { x: 3, y: 1 },
      { x: 90, y: 12 },
      { x: 80, y: 77 },
      { x: 8, y: 60 },
    ]
    const H = homography(src, dst)
    for (let i = 0; i < 4; i++) {
      const p = applyH(H, src[i])
      expect(p.x).toBeCloseTo(dst[i].x, 6)
      expect(p.y).toBeCloseTo(dst[i].y, 6)
    }
  })
})

describe('分類(校正視角)', () => {
  it('起始局面:32 子的位置與紅黑全對', () => {
    const rect = renderBoard(start)
    const obs = classifyBoard(rect)
    let wrong = 0
    for (let i = 0; i < 90; i++) {
      const p = start.board[i]
      const o = obs[i]
      const pick = o.empty >= o.red && o.empty >= o.black ? 'empty' : o.red > o.black ? 'red' : 'black'
      const truth = !p ? 'empty' : p.side
      if (pick !== truth) wrong++
    }
    expect(wrong).toBe(0)
  })
})

describe('偵測(含透視與實體外框)', () => {
  const cases: Array<[string, Pt[]]> = [
    [
      '正面俯視',
      [
        { x: 60, y: 40 },
        { x: 580, y: 40 },
        { x: 580, y: 620 },
        { x: 60, y: 620 },
      ],
    ],
    [
      '斜角透視',
      [
        { x: 110, y: 70 },
        { x: 545, y: 45 },
        { x: 600, y: 600 },
        { x: 40, y: 630 },
      ],
    ],
  ]
  for (const [name, quad] of cases) {
    // 12px:取樣圓半徑 24、棋子半徑 28,角點差十來個像素仍然穩穩落在棋子上;
    // 真正的驗收是下面的端到端辨識。
    it(`${name}:找到的四角誤差 < 12px`, () => {
      const photo = photograph(renderBoard(start), 640, 680, quad)
      const det = detectBoardQuad(photo)
      expect(det, '應偵測到棋盤').not.toBeNull()
      const truth = gridCornersInPhoto(quad)
      expect(maxCornerErr(det!.quad, truth)).toBeLessThan(12)
    })
  }

  it('精修會從「實體外框」修正到真正的格線', () => {
    const quad: Pt[] = [
      { x: 60, y: 40 },
      { x: 580, y: 40 },
      { x: 580, y: 620 },
      { x: 60, y: 620 },
    ]
    const photo = photograph(renderBoard(start), 640, 680, quad)
    // 故意餵整個棋盤外緣(不是格線)當粗四邊形
    const refined = refineQuad(photo, quad)
    expect(refined).not.toBeNull()
    expect(maxCornerErr(refined!.quad, gridCornersInPhoto(quad))).toBeLessThan(12)
  })
})

describe('比對著法', () => {
  const obsOf = (pos: Position) => classifyBoard(renderBoard(pos))

  it('盤面沒動 → 0 步(與紀錄相符)', () => {
    const r = matchObservation(start, obsOf(start), 2)
    expect(r.best!.moves).toHaveLength(0)
    expect(r.quality).toBeGreaterThan(0.8)
  })

  it('走了一步 → 認出炮二平五', () => {
    const after = applyMove(start, C25)
    const r = matchObservation(start, obsOf(after), 2)
    expect(r.best!.zh).toEqual(['炮二平五'])
    expect(r.margin).toBeGreaterThan(2.5)
  })

  it('走了兩步(一來一回)→ 認出炮二平五、馬8進7', () => {
    const after = applyMove(applyMove(start, C25), H87)
    const r = matchObservation(start, obsOf(after), 2)
    expect(r.best!.zh).toEqual(['炮二平五', '馬8進7'])
  })

  it('吃子也能認(只靠有子/紅黑,不需認字)', () => {
    // 紅炮八平五後,黑馬被紅車吃:用一個實際吃子局面
    const pos = parseFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1')
    const capture: Move = { from: sq(2, 7), to: sq(9, 7) } // 炮二進七:隔黑炮打死黑馬
    const after = applyMove(pos, capture)
    const r = matchObservation(pos, obsOf(after), 1)
    expect(r.best!.zh).toEqual(['炮二進七'])
  })
})

describe('端到端:照片 → 著法', () => {
  const quad: Pt[] = [
    { x: 100, y: 60 },
    { x: 560, y: 50 },
    { x: 600, y: 610 },
    { x: 55, y: 625 },
  ]

  it('自動偵測 + 辨識出走了哪一步', () => {
    const after = applyMove(start, C25)
    const photo = photograph(renderBoard(after), 640, 680, quad)
    const det = detectBoardQuad(photo)
    expect(det).not.toBeNull()
    const r = recognize(photo, det!.quad, start, 2)
    expect(verdictOf(r)).toEqual({ kind: 'moves', confident: true })
    expect(r.best!.zh).toEqual(['炮二平五'])
  })

  it('從黑方那側拍(棋盤上下顛倒)也認得', () => {
    const after = applyMove(start, C25)
    const photo = photograph(renderBoard(after), 640, 680, quad)
    const det = detectBoardQuad(photo)
    // 把四角順序轉 180°:模擬從對面拍
    const flipped = [det!.quad[2], det!.quad[3], det!.quad[0], det!.quad[1]]
    const r = recognize(photo, flipped, start, 2)
    expect(r.best!.zh).toEqual(['炮二平五'])
  })

  it('框線亂給 → 判定看不清楚,不亂套用', () => {
    const photo = photograph(renderBoard(start), 640, 680, quad)
    const bogus: Pt[] = [
      { x: 200, y: 200 },
      { x: 400, y: 190 },
      { x: 420, y: 400 },
      { x: 190, y: 410 },
    ]
    const r = recognize(photo, bogus, start, 1)
    expect(verdictOf(r).kind).toBe('unclear')
  })

  it('校正後影像尺寸正確', () => {
    const photo = photograph(renderBoard(start), 640, 680, quad)
    const rect = warpBoard(photo, gridCornersInPhoto(quad))
    expect(rect.width).toBe(RECT_W)
    expect(rect.height).toBe(RECT_H)
    const obs = classifyBoard(rect)
    expect(obs).toHaveLength(90)
  })
})
