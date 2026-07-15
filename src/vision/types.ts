/** 影像處理層只認這個結構(= canvas 的 ImageData),測試可直接餵合成像素 */
export interface ImageLike {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface Pt {
  x: number
  y: number
}

/** 校正後棋盤的尺寸:格距 64,外緣留白 32 */
export const CELL = 64
export const MARGIN = 32
export const RECT_W = MARGIN * 2 + CELL * 8 // 576
export const RECT_H = MARGIN * 2 + CELL * 9 // 640

/** 校正後座標:內部 (r,f) → 像素中心 */
export const rectX = (f: number): number => MARGIN + CELL * f
export const rectY = (r: number): number => MARGIN + CELL * (9 - r)

/** 校正後影像四角(= 棋盤格線的四個角交叉點),順序 = 左上、右上、右下、左下 */
export const RECT_CORNERS: Pt[] = [
  { x: MARGIN, y: MARGIN },
  { x: RECT_W - MARGIN, y: MARGIN },
  { x: RECT_W - MARGIN, y: RECT_H - MARGIN },
  { x: MARGIN, y: RECT_H - MARGIN },
]
