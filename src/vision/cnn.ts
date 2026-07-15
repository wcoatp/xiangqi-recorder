// 選項 B:合成資料訓練的小 CNN,純 TS 前向傳播(無任何執行期依賴)。
// 權重檔 /models/piece-cnn.bin 由 training/train.py 產生:
//   'XQP1' magic(4 bytes)+ 依序 conv1 W/b、conv2 W/b、conv3 W/b、fc W/b(全 float32 LE)
// 架構(與 训练脚本 硬性一致):
//   輸入 48×48×1(normalizeInk 後的墨水圖)
//   conv3×3 p1 → relu → maxpool2  (48→24, 16ch)
//   conv3×3 p1 → relu → maxpool2  (24→12, 32ch)
//   conv3×3 p1 → relu → maxpool2  (12→6, 64ch)
//   flatten(C×H×W 順序,同 torch)→ fc 2304→7 → softmax
// 類別順序 = CNN_TYPES。誠實註記:訓練資料是合成的,真實照片準確度待實機驗證;
// 分數只作為指派的先驗,低邊際一律交回使用者確認。
import type { PieceType } from '../core/board'
import { PATCH } from './patch'

export const CNN_TYPES: PieceType[] = ['K', 'A', 'B', 'N', 'R', 'C', 'P']

interface Conv {
  w: Float32Array // [out][in][3][3]
  b: Float32Array
  inC: number
  outC: number
}

export interface CnnModel {
  forward(patch: Float32Array): Float32Array // 7 個 softmax 機率(CNN_TYPES 順序)
}

const MAGIC = 0x58515031 // 'XQP1'

class Net implements CnnModel {
  constructor(
    private convs: Conv[],
    private fcW: Float32Array,
    private fcB: Float32Array,
  ) {}

  forward(patch: Float32Array): Float32Array {
    let act = patch
    let size = PATCH
    let ch = 1
    for (const c of this.convs) {
      const conv = new Float32Array(c.outC * size * size)
      for (let o = 0; o < c.outC; o++) {
        const wBase = o * c.inC * 9
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            let s = c.b[o]
            for (let ic = 0; ic < c.inC; ic++) {
              const aBase = ic * size * size
              const wB = wBase + ic * 9
              for (let ky = -1; ky <= 1; ky++) {
                const yy = y + ky
                if (yy < 0 || yy >= size) continue
                for (let kx = -1; kx <= 1; kx++) {
                  const xx = x + kx
                  if (xx < 0 || xx >= size) continue
                  s += c.w[wB + (ky + 1) * 3 + (kx + 1)] * act[aBase + yy * size + xx]
                }
              }
            }
            conv[o * size * size + y * size + x] = s > 0 ? s : 0 // relu
          }
        }
      }
      // maxpool 2×2
      const half = size >> 1
      const pooled = new Float32Array(c.outC * half * half)
      for (let o = 0; o < c.outC; o++) {
        for (let y = 0; y < half; y++) {
          for (let x = 0; x < half; x++) {
            const base = o * size * size
            const a = conv[base + 2 * y * size + 2 * x]
            const b2 = conv[base + 2 * y * size + 2 * x + 1]
            const c2 = conv[base + (2 * y + 1) * size + 2 * x]
            const d = conv[base + (2 * y + 1) * size + 2 * x + 1]
            pooled[o * half * half + y * half + x] = Math.max(a, b2, c2, d)
          }
        }
      }
      act = pooled
      size = half
      ch = c.outC
    }
    // fc + softmax
    const n = ch * size * size
    const logits = new Float32Array(7)
    for (let o = 0; o < 7; o++) {
      let s = this.fcB[o]
      const base = o * n
      for (let i = 0; i < n; i++) s += this.fcW[base + i] * act[i]
      logits[o] = s
    }
    let mx = -Infinity
    for (const v of logits) if (v > mx) mx = v
    let sum = 0
    for (let i = 0; i < 7; i++) {
      logits[i] = Math.exp(logits[i] - mx)
      sum += logits[i]
    }
    for (let i = 0; i < 7; i++) logits[i] /= sum
    return logits
  }
}

export function parseCnn(buf: ArrayBuffer): CnnModel {
  const dv = new DataView(buf)
  if (dv.getUint32(0, false) !== MAGIC) throw new Error('權重檔格式錯誤(magic 不符)')
  let off = 4
  const take = (n: number): Float32Array => {
    const a = new Float32Array(buf, off, n)
    off += n * 4
    return a
  }
  const convs: Conv[] = []
  let inC = 1
  for (const outC of [16, 32, 64]) {
    convs.push({ w: take(outC * inC * 9), b: take(outC), inC, outC })
    inC = outC
  }
  const fcW = take(7 * 2304)
  const fcB = take(7)
  if (off !== buf.byteLength) throw new Error(`權重檔長度不符(讀了 ${off},檔案 ${buf.byteLength}`)
  return new Net(convs, fcW, fcB)
}

let cached: CnnModel | null | undefined

/** 載入模型;檔案不存在(尚未訓練/未部署)時回傳 null,功能自動關閉 */
export async function loadCnn(url = '/models/piece-cnn.bin'): Promise<CnnModel | null> {
  if (cached !== undefined) return cached
  try {
    const resp = await fetch(url)
    if (!resp.ok) {
      cached = null
      return null
    }
    cached = parseCnn(await resp.arrayBuffer())
  } catch {
    cached = null
  }
  return cached
}
