// 全部對局的備份 / 還原(換手機、備份用)。
import { db, rememberPlayer, type GameRow } from './db'

const FORMAT = 'xiangqi-recorder-backup'

export interface BackupFile {
  format: typeof FORMAT
  version: number
  exportedAt: number
  games: Omit<GameRow, 'id'>[]
}

export async function exportBackup(): Promise<string> {
  const games = await db.games.orderBy('startedAt').toArray()
  const payload: BackupFile = {
    format: FORMAT,
    version: 1,
    exportedAt: Date.now(),
    games: games.map(({ id: _id, ...rest }) => rest),
  }
  return JSON.stringify(payload)
}

export function isBackupJson(text: string): boolean {
  const t = text.trimStart()
  if (!t.startsWith('{')) return false
  try {
    return (JSON.parse(t) as { format?: string }).format === FORMAT
  } catch {
    return false
  }
}

export interface RestoreResult {
  added: number
  skipped: number
}

/** 還原:同「開始時間 + 雙方姓名」視為同一局,略過不重複匯入 */
export async function restoreBackup(text: string): Promise<RestoreResult> {
  const data = JSON.parse(text) as BackupFile
  if (data.format !== FORMAT) throw new Error('不是本 App 的備份檔')
  if (!Array.isArray(data.games)) throw new Error('備份檔內容損壞:缺少 games')

  const existing = await db.games.toArray()
  const key = (g: { startedAt: number; redName: string; blackName: string }) =>
    `${g.startedAt}|${g.redName}|${g.blackName}`
  const seen = new Set(existing.map(key))

  let added = 0
  let skipped = 0
  for (const g of data.games) {
    if (!g || typeof g.startedAt !== 'number' || !g.tree) {
      skipped++
      continue
    }
    if (seen.has(key(g))) {
      skipped++
      continue
    }
    seen.add(key(g))
    await db.games.add(g as GameRow)
    await rememberPlayer(g.redName)
    await rememberPlayer(g.blackName)
    added++
  }
  return { added, skipped }
}
