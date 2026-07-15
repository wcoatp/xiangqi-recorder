// 每個交叉點分類成 空 / 紅 / 黑 —— 不做文字辨識。
// 認出「這是什麼子」需要 OCR;但只要知道「有沒有子、是紅是黑」,
// 再配合「上一個局面的合法著法」就足以鎖定走了哪一步(候選集 <50)。
//
// 主判準是「取樣圓的中位色 vs 附近棋盤底色」:棋子是一片與棋盤不同色的圓面,
// 格線再多也不會改變中位色。墨水量只當輔助,而且要先扣掉「這個交叉點本來就該有幾條線」
// ——否則九宮中心(4 線交會)會被誤判成棋子。
import { CELL, rectX, rectY, type ImageLike } from './types'

export interface SquareScore {
  empty: number
  red: number
  black: number
}

export type Observation = SquareScore[] // 90 格,索引 = r * 9 + f

const SAMPLE_R = Math.round(CELL * 0.38)

interface Feature {
  ink: number
  red: number
  delta: number
}

const lum = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b

/** 紅色墨水:用色相 + 飽和度判,才不會把黃棕色的木頭格線當成紅色 */
function isRedInk(R: number, G: number, B: number): boolean {
  const mx = Math.max(R, G, B)
  const mn = Math.min(R, G, B)
  if (mx < 50 || R !== mx) return false
  const sat = (mx - mn) / mx
  if (sat < 0.45) return false
  const hue = mx === mn ? 0 : (60 * (G - B)) / (mx - mn) // R 最大 → 色相 = 60·(G−B)/(mx−mn)
  return hue >= -30 && hue <= 22 // 紅~偏橘;木頭約 25°~40° 會被排除
}

export function otsu(values: number[]): number {
  const n = values.length
  if (n === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[n - 1]
  if (max - min < 1e-6) return max
  const BINS = 64
  const hist = new Array<number>(BINS).fill(0)
  for (const v of values) hist[Math.min(BINS - 1, Math.floor(((v - min) / (max - min)) * BINS))]++
  let total = 0
  for (let i = 0; i < BINS; i++) total += hist[i] * i
  let sumB = 0
  let wB = 0
  let best = 0
  let bestVar = -1
  for (let i = 0; i < BINS; i++) {
    wB += hist[i]
    if (wB === 0) continue
    const wF = n - wB
    if (wF === 0) break
    sumB += hist[i] * i
    const mB = sumB / wB
    const mF = (total - sumB) / wF
    const v = wB * wF * (mB - mF) * (mB - mF)
    if (v > bestVar) {
      bestVar = v
      best = i
    }
  }
  return min + ((best + 0.5) / BINS) * (max - min)
}

/** 一個格子(左下角 = (cr,cf))的中心是否會被線/字蓋住——這是棋盤的固定幾何:
 * 九宮四格的中心正好被斜線穿過,河界那一排則印著「楚河漢界」。 */
const isDirtyCell = (cr: number, cf: number): boolean =>
  cr === 4 || ((cf === 3 || cf === 4) && (cr <= 1 || cr >= 7))

/** 各格子中心的色調(格中心離所有格線最遠,是最乾淨的棋盤底色樣本) */
function cellSamples(rect: ImageLike): Array<{ cr: number; cf: number; v: number }> {
  const out: Array<{ cr: number; cf: number; v: number }> = []
  for (let cr = 0; cr < 9; cr++) {
    for (let cf = 0; cf < 8; cf++) {
      if (isDirtyCell(cr, cf)) continue
      const cx = Math.round(rectX(cf) + CELL / 2)
      const cy = Math.round(rectY(cr) - CELL / 2)
      const vals: number[] = []
      for (let y = cy - 4; y <= cy + 4; y++) {
        for (let x = cx - 4; x <= cx + 4; x++) {
          if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) continue
          const i = (y * rect.width + x) * 4
          vals.push(lum(rect.data[i], rect.data[i + 1], rect.data[i + 2]))
        }
      }
      if (vals.length === 0) continue
      vals.sort((a, b) => a - b)
      out.push({ cr, cf, v: vals[Math.floor(vals.length / 2)] })
    }
  }
  return out
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? 128 : s[Math.floor(s.length / 2)]
}

/** 交叉點附近的棋盤底色:取鄰近兩格內的乾淨格子中心中位數(可吸收光線不均) */
function backgroundField(rect: ImageLike): number[] {
  const cells = cellSamples(rect)
  const global = median(cells.map((c) => c.v))
  const field: number[] = []
  for (let r = 0; r < 10; r++) {
    for (let f = 0; f < 9; f++) {
      const near = cells.filter((c) => Math.abs(c.cr + 0.5 - r) <= 2 && Math.abs(c.cf + 0.5 - f) <= 2)
      field.push(near.length >= 3 ? median(near.map((c) => c.v)) : global)
    }
  }
  return field
}

/** 這個交叉點「本來就該有」多少條線經過(等效條數,斜線較粗 ×1.41) */
export function expectedLines(r: number, f: number): number {
  let n = f === 0 || f === 8 ? 0.5 : 1 // 橫線(邊界上只有半條弦)
  if (r === 0 || r === 9) n += 0.5 // 直線(底線上只有半條弦)
  else if ((r === 4 || r === 5) && f >= 1 && f <= 7) n += 0.5 // 河界:中間七條直線在此中斷
  else n += 1
  const palaceCorner = (f === 3 || f === 5) && (r === 0 || r === 2 || r === 7 || r === 9)
  const palaceCenter = f === 4 && (r === 1 || r === 8)
  if (palaceCenter) n += 2 * 1.41
  else if (palaceCorner) n += 0.5 * 1.41
  return n
}

function featureAt(rect: ImageLike, cx: number, cy: number, bg: number): Feature {
  let n = 0
  let ink = 0
  let red = 0
  const lums: number[] = []
  const r2 = SAMPLE_R * SAMPLE_R
  for (let dy = -SAMPLE_R; dy <= SAMPLE_R; dy++) {
    for (let dx = -SAMPLE_R; dx <= SAMPLE_R; dx++) {
      if (dx * dx + dy * dy > r2) continue
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) continue
      const i = (y * rect.width + x) * 4
      const R = rect.data[i]
      const G = rect.data[i + 1]
      const B = rect.data[i + 2]
      const L = lum(R, G, B)
      lums.push(L)
      n++
      if (L < bg - 45) ink++
      if (isRedInk(R, G, B)) red++
    }
  }
  if (n === 0) return { ink: 0, red: 0, delta: 0 }
  lums.sort((a, b) => a - b)
  const med = lums[Math.floor(lums.length / 2)]
  return { ink: ink / n, red: red / n, delta: Math.abs(med - bg) / 255 }
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** 校正後的棋盤影像 → 90 格的軟性分數 */
export function classifyBoard(rect: ImageLike): Observation {
  const bg = backgroundField(rect)
  const feats: Feature[] = []
  const nLines: number[] = []
  for (let r = 0; r < 10; r++) {
    for (let f = 0; f < 9; f++) {
      feats.push(featureAt(rect, rectX(f), rectY(r), bg[r * 9 + f]))
      nLines.push(expectedLines(r, f))
    }
  }

  // 每條格線平均貢獻多少墨水:由「只有兩條線經過」的交叉點自行估(自適應線寬)
  const plain = feats.filter((_, i) => nLines[i] > 1.9 && nLines[i] < 2.1).map((f) => f.ink / 2)
  plain.sort((a, b) => a - b)
  const perLine = plain.length > 0 ? plain[Math.floor(plain.length / 2)] : 0.05

  // 有子與否:以「與底色的色差」為主,扣掉格線後的多餘墨水為輔
  const occ = feats.map((f, i) => 3 * f.delta + 0.7 * Math.max(0, f.ink - perLine * nLines[i]))
  const thr = otsu(occ)

  // 機率校準:用「空」與「有子」兩群的平均值當兩極,logistic 內插。
  // (直接拿 Otsu 門檻當中心會失準:門檻常緊貼其中一群,那群就只剩 0.5 的把握。)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const lo = occ.filter((v) => v < thr)
  const hi = occ.filter((v) => v >= thr)
  const mE = lo.length > 0 ? mean(lo) : thr - 0.05
  const mP = hi.length > 0 ? mean(hi) : thr + 0.05
  const mid = (mE + mP) / 2
  // 兩群靠太近 = 看不出有無棋子 → 分數自然趨近 0.5,上層會判「看不清楚」
  const scale = Math.max(0.03, (mP - mE) / 6)

  const obs: Observation = []
  for (let i = 0; i < 90; i++) {
    const piece = 1 / (1 + Math.exp(-(occ[i] - mid) / scale))
    const redness = clamp01((feats[i].red - 0.015) / 0.045)
    const pEmpty = Math.max(0.02, 1 - piece)
    const pRed = Math.max(0.02, piece * redness)
    const pBlack = Math.max(0.02, piece * (1 - redness))
    const sum = pEmpty + pRed + pBlack
    obs.push({ empty: pEmpty / sum, red: pRed / sum, black: pBlack / sum })
  }
  return obs
}
