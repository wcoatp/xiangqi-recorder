import Dexie, { type EntityTable } from 'dexie'
import type { GameResult } from '../core/pgn'
import type { GameNode } from '../core/tree'
import type { GameReview } from '../engine/analysis'

export interface GameRow {
  id: number
  redName: string
  blackName: string
  /** 'record'(預設)= 實體對局記譜;'play' = 在 App 內人機對弈 */
  mode?: 'record' | 'play'
  /** 對弈:使用者執哪邊 */
  playerSide?: 'red' | 'black'
  /** 對弈:難度等級(PLAY_LEVELS 索引) */
  level?: number
  startedAt: number
  updatedAt: number
  result: GameResult
  resultReason?: string
  initialFen: string
  tree: GameNode
  moveCount: number
  review?: GameReview | null
  reviewedAt?: number
}

export interface PlayerRow {
  id: number
  name: string
  createdAt: number
}

export interface SettingRow {
  key: string
  value: unknown
}

export const db = new Dexie('xiangqi-recorder') as Dexie & {
  games: EntityTable<GameRow, 'id'>
  players: EntityTable<PlayerRow, 'id'>
  settings: EntityTable<SettingRow, 'key'>
}

db.version(1).stores({
  games: '++id, startedAt, updatedAt, redName, blackName, result',
  players: '++id, &name',
  settings: 'key',
})

// ---------- 設定 ----------
export interface AppSettings {
  /** 語音辨識語系 */
  voiceLang: 'zh-TW' | 'zh-CN'
  /** 記錄後語音覆誦著法 */
  ttsReadback: boolean
  /** 套用著法後自動再次聆聽(連續語音) */
  autoRelisten: boolean
  /** 復盤分析每局面思考時間(ms) */
  analysisMovetimeMs: number
  /** 記譜棋盤:tabletop = 面對面(黑方棋子/控制列旋轉 180°) */
  tabletop: boolean
  /** v2 預留:AI 白話講解 API Token */
  llmToken: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  voiceLang: 'zh-TW',
  ttsReadback: true,
  autoRelisten: false,
  analysisMovetimeMs: 1000,
  tabletop: true,
  llmToken: '',
}

export async function loadSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray()
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return { ...DEFAULT_SETTINGS, ...stored } as AppSettings
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  await db.settings.bulkPut(Object.entries(patch).map(([key, value]) => ({ key, value })))
}

// ---------- 玩家名冊 ----------
export async function rememberPlayer(name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  const existing = await db.players.where('name').equals(trimmed).first()
  if (!existing) await db.players.add({ name: trimmed, createdAt: Date.now() } as PlayerRow)
}

export async function playerNames(): Promise<string[]> {
  const rows = await db.players.orderBy('createdAt').reverse().toArray()
  return rows.map((r) => r.name)
}
