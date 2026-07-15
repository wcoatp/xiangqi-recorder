// 測試專用:渲染帶「可區分圖樣」的合成棋盤照片。
// 每類棋子一種圖樣,且設計成旋轉搜尋下仍互不混淆
// (例:車=雙豎槓+端蓋、炮=雙豎槓+中點 —— 旋轉 90° 也不會變成彼此)。
// 只驗證幾何/比對/指派邏輯;真實字形的準確度由 CNN 訓練與實機驗證負責。
import type { Board, PieceType, Position } from '../core/board'
import { sq } from '../core/board'
import { applyH, homography, sampleBilinear } from './geometry'
import { CELL, RECT_H, RECT_W, rectX, rectY, type ImageLike, type Pt } from './types'

const WOOD = [216, 184, 120]
const LINE = [90, 58, 32]
const FACE = [242, 230, 200]
const RED_INK = [179, 49, 44]
const BLACK_INK = [34, 32, 28]
const TABLE = [70, 70, 78]

export function blank(w: number, h: number, rgb: number[]): ImageLike {
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
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t
    for (let dx = -(w >> 1); dx <= w >> 1; dx++)
      for (let dy = -(w >> 1); dy <= w >> 1; dy++) px(img, x + dx, y + dy, rgb)
  }
}

function disc(img: ImageLike, cx: number, cy: number, r: number, rgb: number[]) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) px(img, cx + dx, cy + dy, rgb)
    }
  }
}

/** 每類棋子的圖樣(以 angle 旋轉);筆畫端點以極座標定義後旋轉 */
function drawGlyph(img: ImageLike, cx: number, cy: number, type: PieceType, ink: number[], angle: number) {
  const rot = (x: number, y: number): [number, number] => [
    cx + x * Math.cos(angle) - y * Math.sin(angle),
    cy + x * Math.sin(angle) + y * Math.cos(angle),
  ]
  const seg = (x0: number, y0: number, x1: number, y1: number, w = 4) => {
    const a = rot(x0, y0)
    const b = rot(x1, y1)
    line(img, a[0], a[1], b[0], b[1], ink, w)
  }
  const dot = (x: number, y: number, r = 4) => {
    const p = rot(x, y)
    disc(img, p[0], p[1], r, ink)
  }
  switch (type) {
    case 'K': // 密格:三橫一豎
      seg(-13, -10, 13, -10)
      seg(-13, 0, 13, 0)
      seg(-13, 10, 13, 10)
      seg(0, -14, 0, 14)
      break
    case 'A': // 斜十字
      seg(-12, -12, 12, 12)
      seg(-12, 12, 12, -12)
      break
    case 'B': {
      // 圓環
      for (let a = 0; a < 32; a++) {
        const t0 = (a / 32) * 2 * Math.PI
        const t1 = ((a + 1) / 32) * 2 * Math.PI
        seg(12 * Math.cos(t0), 12 * Math.sin(t0), 12 * Math.cos(t1), 12 * Math.sin(t1), 4)
      }
      break
    }
    case 'N': // L 形(不對稱)
      seg(-8, -13, -8, 12)
      seg(-8, 12, 12, 12)
      break
    case 'R': // 雙豎槓 + 頂端蓋
      seg(-7, -12, -7, 13)
      seg(7, -12, 7, 13)
      seg(-7, -12, 7, -12)
      break
    case 'C': // 雙豎槓 + 中點
      seg(-9, -12, -9, 13)
      seg(9, -12, 9, 13)
      dot(0, 0, 4)
      break
    case 'P': // 三點
      dot(0, -10, 5)
      dot(-9, 8, 5)
      dot(9, 8, 5)
      break
  }
}

/** 渲染校正視角的棋盤(含實體外框);glyphAngle(s) 決定每顆子的圖樣旋轉 */
export function renderBoardG(pos: Position, glyphAngle: (s: number) => number = () => 0): ImageLike {
  const img = blank(RECT_W, RECT_H, [196, 160, 100])
  for (let y = 10; y < RECT_H - 10; y++) for (let x = 10; x < RECT_W - 10; x++) px(img, x, y, WOOD)
  line(img, 10, 10, RECT_W - 10, 10, [60, 40, 20], 3)
  line(img, 10, RECT_H - 10, RECT_W - 10, RECT_H - 10, [60, 40, 20], 3)
  line(img, 10, 10, 10, RECT_H - 10, [60, 40, 20], 3)
  line(img, RECT_W - 10, 10, RECT_W - 10, RECT_H - 10, [60, 40, 20], 3)
  for (let r = 0; r < 10; r++) line(img, rectX(0), rectY(r), rectX(8), rectY(r), LINE, 2)
  for (let f = 0; f < 9; f++) {
    if (f === 0 || f === 8) line(img, rectX(f), rectY(0), rectX(f), rectY(9), LINE, 2)
    else {
      line(img, rectX(f), rectY(0), rectX(f), rectY(4), LINE, 2)
      line(img, rectX(f), rectY(5), rectX(f), rectY(9), LINE, 2)
    }
  }
  line(img, rectX(3), rectY(0), rectX(5), rectY(2), LINE, 2)
  line(img, rectX(5), rectY(0), rectX(3), rectY(2), LINE, 2)
  line(img, rectX(3), rectY(9), rectX(5), rectY(7), LINE, 2)
  line(img, rectX(5), rectY(9), rectX(3), rectY(7), LINE, 2)
  for (let r = 0; r < 10; r++) {
    for (let f = 0; f < 9; f++) {
      const p = pos.board[sq(r, f)]
      if (!p) continue
      const cx = rectX(f)
      const cy = rectY(r)
      disc(img, cx, cy, Math.round(CELL * 0.44), FACE)
      drawGlyph(img, cx, cy, p.type, p.side === 'red' ? RED_INK : BLACK_INK, glyphAngle(sq(r, f)))
    }
  }
  return img
}

/** 把校正視角棋盤投影成帶透視的「照片」(雙線性,模擬光學模糊) */
export function photographG(board: ImageLike, W: number, H: number, quadInPhoto: Pt[]): ImageLike {
  const photo = blank(W, H, TABLE)
  const corners: Pt[] = [
    { x: 0, y: 0 },
    { x: board.width - 1, y: 0 },
    { x: board.width - 1, y: board.height - 1 },
    { x: 0, y: board.height - 1 },
  ]
  const toBoard = homography(quadInPhoto, corners)
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

/** 照片中「整張校正圖」的四角 → 格線四角 */
export function gridCornersG(quadInPhoto: Pt[]): Pt[] {
  const corners: Pt[] = [
    { x: 0, y: 0 },
    { x: RECT_W - 1, y: 0 },
    { x: RECT_W - 1, y: RECT_H - 1 },
    { x: 0, y: RECT_H - 1 },
  ]
  const H = homography(corners, quadInPhoto)
  return [
    { x: 32, y: 32 },
    { x: RECT_W - 32, y: 32 },
    { x: RECT_W - 32, y: RECT_H - 32 },
    { x: 32, y: RECT_H - 32 },
  ].map((p) => applyH(H, p))
}

/** 由 [sq, side, type] 列表組 Board */
export function boardOf(items: Array<[number, 'red' | 'black', PieceType]>): Board {
  const b: Board = new Array(90).fill(null)
  for (const [s, side, type] of items) b[s] = { side, type }
  return b
}
