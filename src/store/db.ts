import Dexie, { type EntityTable } from 'dexie'
import type { GameResult } from '../core/pgn'
import type { GameNode } from '../core/tree'
import type { GameReview } from '../engine/analysis'
import type { CalibrationGame, CalibratorProfile } from '../calibration/rankTypes'

export interface GameContinuationSource {
  schemaVersion: 1
  /** 建立當下的本機 Dexie ID，只供稽核提示，不可當跨裝置永久外鍵。 */
  sourceGameIdAtCreation: number
  sourceRootId: string
  sourceNodeId: string
  sourcePly: number
  sourceStartedAt: number
  sourceRedName: string
  sourceBlackName: string
  sourceFen: string
  sourceNodeLabel?: string
}

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
  /** 從復盤某局面另開新局時保存的自含來源快照。 */
  continuedFrom?: GameContinuationSource
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
  rankCalibrators: EntityTable<CalibratorProfile, 'id'>
  rankCalibrationGames: EntityTable<CalibrationGame, 'id'>
}

db.version(1).stores({
  games: '++id, startedAt, updatedAt, redName, blackName, result',
  players: '++id, &name',
  settings: 'key',
})

db.version(2).stores({
  games: '++id, startedAt, updatedAt, redName, blackName, result',
  players: '++id, &name',
  settings: 'key',
  rankCalibrators: '&id, alias, claimedRank, createdAt',
  rankCalibrationGames: '&id, profileId, anchorId, startedAt, result',
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

const APP_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>

/** 只接受 App 公開定義的設定 key 與型別；PIN gate／棋子範本等 settings rows 不會混進 React context。 */
export function normalizeAppSettings(stored: Record<string, unknown>): AppSettings {
  return {
    voiceLang: stored.voiceLang === 'zh-CN' || stored.voiceLang === 'zh-TW' ? stored.voiceLang : DEFAULT_SETTINGS.voiceLang,
    ttsReadback: typeof stored.ttsReadback === 'boolean' ? stored.ttsReadback : DEFAULT_SETTINGS.ttsReadback,
    autoRelisten: typeof stored.autoRelisten === 'boolean' ? stored.autoRelisten : DEFAULT_SETTINGS.autoRelisten,
    analysisMovetimeMs:
      typeof stored.analysisMovetimeMs === 'number' &&
      [500, 1_000, 2_000].includes(stored.analysisMovetimeMs)
        ? stored.analysisMovetimeMs
        : DEFAULT_SETTINGS.analysisMovetimeMs,
    tabletop: typeof stored.tabletop === 'boolean' ? stored.tabletop : DEFAULT_SETTINGS.tabletop,
    llmToken: typeof stored.llmToken === 'string' ? stored.llmToken : DEFAULT_SETTINGS.llmToken,
  }
}

export async function loadSettings(): Promise<AppSettings> {
  const rows = await db.settings.bulkGet(APP_SETTING_KEYS)
  const stored: Record<string, unknown> = {}
  rows.forEach((row, index) => {
    if (row) stored[APP_SETTING_KEYS[index]] = row.value
  })
  return normalizeAppSettings(stored)
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
  // createdAt 不是 IndexedDB index；先讀出再排序，避免 Dexie SchemaError。
  const rows = await db.players.toArray()
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return rows.map((r) => r.name)
}
