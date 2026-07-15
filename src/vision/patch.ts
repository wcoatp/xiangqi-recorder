// 棋子取樣塊:給範本比對(A)與 CNN(B)共用的「墨水圖」表示。
//
// 表示法:darkness = 255 − min(G,B)。紅墨(G、B 都低)與黑墨都會變亮,
// 木頭底色與棋子面(米白)都偏暗——也就是說紅字與黑字在這個空間裡「長一樣」,
// 類型分類不必管顏色(顏色已由 classify 層判定)。
// 正規化:圓盤內減中位數(去掉棋子面亮度)→ 負值歸零 → RMS 標準化(抗光線強弱)。
// ⚠ Python 訓練資料產生器 mirror 了同一條轉換(training/gen_data.py),兩邊必須一致。
import { CELL } from './types'
import type { ImageLike } from './types'

export const PATCH = 48
export const PATCH_RADIUS = Math.round(CELL * 0.42) // 取樣半徑(校正圖像素)
export const INK_CAP = 8 // 正規化後的極值上限

const C = (PATCH - 1) / 2

/** 圓盤遮罩的索引(patch 內圓半徑 = PATCH/2) */
export const MASK_IDX: number[] = (() => {
  const out: number[] = []
  const R2 = (PATCH / 2) * (PATCH / 2)
  for (let v = 0; v < PATCH; v++) {
    for (let u = 0; u < PATCH; u++) {
      const dx = u - C
      const dy = v - C
      if (dx * dx + dy * dy <= R2) out.push(v * PATCH + u)
    }
  }
  return out
})()

function bilinearDarkness(img: ImageLike, x: number, y: number): number {
  if (x < 0 || y < 0 || x > img.width - 1 || y > img.height - 1) return 0
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, img.width - 1)
  const y1 = Math.min(y0 + 1, img.height - 1)
  const fx = x - x0
  const fy = y - y0
  const d = (yy: number, xx: number) => {
    const i = (yy * img.width + xx) * 4
    return 255 - Math.min(img.data[i + 1], img.data[i + 2])
  }
  return (
    d(y0, x0) * (1 - fx) * (1 - fy) +
    d(y0, x1) * fx * (1 - fy) +
    d(y1, x0) * (1 - fx) * fy +
    d(y1, x1) * fx * fy
  )
}

/** 以 (cx,cy) 為中心、radius 為半徑、旋轉 angle 取樣一塊 48×48 的正規化墨水圖 */
export function extractPatch(
  img: ImageLike,
  cx: number,
  cy: number,
  radius: number = PATCH_RADIUS,
  angle = 0,
): Float32Array {
  const out = new Float32Array(PATCH * PATCH)
  const scale = (2 * radius) / PATCH
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  for (const i of MASK_IDX) {
    const u = (i % PATCH) - C
    const v = Math.floor(i / PATCH) - C
    const dx = (u * cos - v * sin) * scale
    const dy = (u * sin + v * cos) * scale
    out[i] = bilinearDarkness(img, cx + dx, cy + dy)
  }
  return normalizeInk(out)
}

/** 就地正規化(export 給 Python-parity 測試與 CNN 前處理共用) */
export function normalizeInk(patch: Float32Array): Float32Array {
  const vals = MASK_IDX.map((i) => patch[i]).sort((a, b) => a - b)
  const med = vals[Math.floor(vals.length / 2)]
  let sumSq = 0
  for (const i of MASK_IDX) {
    const v = Math.max(0, patch[i] - med)
    patch[i] = v
    sumSq += v * v
  }
  const rms = Math.sqrt(sumSq / MASK_IDX.length)
  if (rms < 1e-3) {
    patch.fill(0)
    return patch
  }
  for (const i of MASK_IDX) patch[i] = Math.min(INK_CAP, patch[i] / rms)
  // 圓盤外保持 0
  return patch
}

/** 正規化互相關(兩塊都已 normalizeInk;值域約 0..1,越高越像) */
export function nccScore(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (const i of MASK_IDX) s += a[i] * b[i]
  return s / MASK_IDX.length
}

/** 一次取出候選子在多個旋轉角的 patch(範本比對用) */
export function extractRotations(
  img: ImageLike,
  cx: number,
  cy: number,
  radius: number = PATCH_RADIUS,
  nAngles = 24,
): Float32Array[] {
  const out: Float32Array[] = []
  for (let k = 0; k < nAngles; k++) {
    out.push(extractPatch(img, cx, cy, radius, (2 * Math.PI * k) / nAngles))
  }
  return out
}
