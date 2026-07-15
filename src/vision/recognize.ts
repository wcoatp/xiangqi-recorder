// 拍照辨識總流程:照片 + 四角 → 校正 → 分類 → 比對合法著法。
// 四角的「哪一角是紅方左下」未知,所以四種旋轉都試,由分數決定
// (紅/黑顏色不對稱,轉 180° 會得到很差的分數 → 自動選對方向)。
import type { Position } from '../core/board'
import { classifyBoard, type Observation } from './classify'
import { rotateQuad, warpQuad } from './geometry'
import { matchObservation, type MatchResult } from './match'
import { RECT_CORNERS, RECT_H, RECT_W, type ImageLike, type Pt } from './types'

export interface RecognizeResult extends MatchResult {
  rotation: number
  quad: Pt[]
  obs: Observation
  rect: ImageLike
}

export function warpBoard(img: ImageLike, quad: Pt[]): ImageLike {
  return warpQuad(img, quad, RECT_W, RECT_H, RECT_CORNERS)
}

export function recognize(img: ImageLike, quad: Pt[], pos: Position, maxPly = 2): RecognizeResult {
  let best: RecognizeResult | null = null
  for (let rot = 0; rot < 4; rot++) {
    const q = rotateQuad(quad, rot)
    const rect = warpBoard(img, q)
    const obs = classifyBoard(rect)
    const m = matchObservation(pos, obs, maxPly)
    const cand: RecognizeResult = { ...m, rotation: rot, quad: q, obs, rect }
    if (!best || cand.quality > best.quality) best = cand
  }
  return best!
}

/** UI 判讀:辨識結果該怎麼呈現 */
export type Verdict =
  | { kind: 'same' } // 盤面與紀錄相符
  | { kind: 'moves'; confident: boolean } // 偵測到 1-2 著
  | { kind: 'unclear' } // 看不清楚:多半是框線沒對準

export function verdictOf(r: RecognizeResult): Verdict {
  if (!r.best || r.quality < 0.6) return { kind: 'unclear' }
  if (r.best.moves.length === 0) return { kind: 'same' }
  return { kind: 'moves', confident: r.margin >= 2.5 }
}
