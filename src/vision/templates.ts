// 選項 A:用「你自己的棋子」當範本。
// 拍一張標準開局照 —— 那一刻每顆子的身分是定義上已知的,等於 32 張完美標註的樣本。
// 之後辨識就是對同一批實體物件做 NCC 比對(24 個旋轉角取最大),不是泛用文字辨識。
import type { PieceType, Side } from '../core/board'
import { parseFen, START_FEN } from '../core/fen'
import { db } from '../store/db'
import { classifyBoard } from './classify'
import { rotateQuad } from './geometry'
import { nccScore, extractPatch, PATCH_RADIUS } from './patch'
import { warpBoard } from './recognize'
import { rectX, rectY, type ImageLike, type Pt } from './types'

export interface PieceTemplates {
  createdAt: number
  patch: number
  samples: Record<Side, Array<{ type: PieceType; data: Float32Array }>>
}

const KEY = 'pieceCalibration'

export async function loadTemplates(): Promise<PieceTemplates | null> {
  const row = await db.settings.get(KEY)
  return (row?.value as PieceTemplates | undefined) ?? null
}

export async function saveTemplates(t: PieceTemplates | null): Promise<void> {
  if (t === null) await db.settings.delete(KEY)
  else await db.settings.put({ key: KEY, value: t })
}

export interface CalibrationResult {
  templates: PieceTemplates
  rotation: number
  quality: number
}

/** 從開局照建範本。找不到像開局的擺法時丟出說明性錯誤。 */
export function calibrateFromPhoto(img: ImageLike, quad: Pt[]): CalibrationResult {
  const start = parseFen(START_FEN)
  let best: { rot: number; rect: ImageLike; score: number } | null = null
  for (let rot = 0; rot < 4; rot++) {
    const rect = warpBoard(img, rotateQuad(quad, rot))
    const obs = classifyBoard(rect)
    let s = 0
    for (let i = 0; i < 90; i++) {
      const p = start.board[i]
      const o = obs[i]
      const pr = !p ? o.empty : p.side === 'red' ? o.red : o.black
      s += Math.log(Math.max(pr, 1e-3))
    }
    if (!best || s > best.score) best = { rot, rect, score: s }
  }
  const quality = Math.exp(best!.score / 90)
  if (quality < 0.55) {
    throw new Error(
      `這張照片看起來不是標準開局擺法(吻合度 ${(quality * 100).toFixed(0)}%)。請把 32 顆棋子全部擺回起始位置、對準框線後再拍。`,
    )
  }
  const samples: PieceTemplates['samples'] = { red: [], black: [] }
  for (let s = 0; s < 90; s++) {
    const p = start.board[s]
    if (!p) continue
    const data = extractPatch(best!.rect, rectX(s % 9), rectY(Math.floor(s / 9)), PATCH_RADIUS, 0)
    samples[p.side].push({ type: p.type, data })
  }
  return {
    templates: { createdAt: Date.now(), patch: PATCH_RADIUS, samples },
    rotation: best!.rot,
    quality,
  }
}

/** 候選子(已取好多旋轉角)對某一側全部範本的各類型最高 NCC */
export function templateScores(
  t: PieceTemplates,
  side: Side,
  rotations: Float32Array[],
): Partial<Record<PieceType, number>> {
  const out: Partial<Record<PieceType, number>> = {}
  for (const s of t.samples[side]) {
    let best = 0
    for (const rot of rotations) {
      const v = nccScore(s.data, rot)
      if (v > best) best = v
    }
    if (best > (out[s.type] ?? 0)) out[s.type] = best
  }
  return out
}
