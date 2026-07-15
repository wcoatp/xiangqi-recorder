// 平面投影幾何:四點單應矩陣 + 反向取樣校正。
import type { ImageLike, Pt } from './types'

/** 解 A x = b(部分樞軸高斯消去) */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < 1e-9) throw new Error('矩陣退化(四點共線?)')
    ;[M[col], M[piv]] = [M[piv], M[col]]
    const d = M[col][col]
    for (let c = col; c <= n; c++) M[col][c] /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  return M.map((row) => row[n])
}

/** 求把 src 四點映到 dst 四點的單應矩陣(3×3,h8 = 1) */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v])
    b.push(v)
  }
  const h = solveLinear(A, b)
  return [...h, 1]
}

export function applyH(H: number[], p: Pt): Pt {
  const d = H[6] * p.x + H[7] * p.y + H[8]
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / d,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / d,
  }
}

/** 雙線性取樣(超出邊界回傳背景色 0) */
export function sampleBilinear(img: ImageLike, x: number, y: number, out: number[]): void {
  if (x < 0 || y < 0 || x > img.width - 1 || y > img.height - 1) {
    out[0] = out[1] = out[2] = 0
    return
  }
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, img.width - 1)
  const y1 = Math.min(y0 + 1, img.height - 1)
  const fx = x - x0
  const fy = y - y0
  for (let c = 0; c < 3; c++) {
    const p00 = img.data[(y0 * img.width + x0) * 4 + c]
    const p10 = img.data[(y0 * img.width + x1) * 4 + c]
    const p01 = img.data[(y1 * img.width + x0) * 4 + c]
    const p11 = img.data[(y1 * img.width + x1) * 4 + c]
    out[c] = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy
  }
}

/** 把影像中的四邊形校正成 W×H 的矩形;quad 對應到 dstCorners(預設 = 整張輸出) */
export function warpQuad(img: ImageLike, quad: Pt[], W: number, H: number, dstCorners?: Pt[]): ImageLike {
  const dst = dstCorners ?? [
    { x: 0, y: 0 },
    { x: W - 1, y: 0 },
    { x: W - 1, y: H - 1 },
    { x: 0, y: H - 1 },
  ]
  const Hm = homography(dst, quad) // 輸出 → 原圖(反向取樣)
  const data = new Uint8ClampedArray(W * H * 4)
  const rgb = [0, 0, 0]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = applyH(Hm, { x, y })
      sampleBilinear(img, p.x, p.y, rgb)
      const i = (y * W + x) * 4
      data[i] = rgb[0]
      data[i + 1] = rgb[1]
      data[i + 2] = rgb[2]
      data[i + 3] = 255
    }
  }
  return { data, width: W, height: H }
}

export function quadArea(q: Pt[]): number {
  let a = 0
  for (let i = 0; i < q.length; i++) {
    const j = (i + 1) % q.length
    a += q[i].x * q[j].y - q[j].x * q[i].y
  }
  return Math.abs(a) / 2
}

export function isConvex(q: Pt[]): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const c = q[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    const s = Math.sign(cross)
    if (s === 0) return false
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** 依繞質心的角度排成順時針,並讓最靠左上的點當起點 */
export function orderQuad(pts: Pt[]): Pt[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let start = 0
  let bestSum = Infinity
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i].x + sorted[i].y
    if (s < bestSum) {
      bestSum = s
      start = i
    }
  }
  return [...sorted.slice(start), ...sorted.slice(0, start)]
}

/** 四角順序旋轉 n 步(用來試 0/90/180/270 四種擺法) */
export function rotateQuad(q: Pt[], n: number): Pt[] {
  const k = ((n % 4) + 4) % 4
  return [...q.slice(k), ...q.slice(0, k)]
}
