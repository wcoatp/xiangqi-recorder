// 完整本機備份／非破壞還原。所有外部資料先由 backupSchema 完整驗證，再進 Dexie transaction。
import type { CalibrationGame, CalibratorProfile } from '../calibration/rankTypes'
import { verifyCalibrationPin } from '../calibration/pin'
import type { PieceTemplates } from '../vision/templates'
import { APP_VERSION } from '../version'
import { buildRankCalibrationExport, loadRankCalibrationGate } from './rankCalibration'
import {
  BACKUP_FORMAT,
  MAX_BACKUP_TEXT_LENGTH,
  assertBackupTextSize,
  buildBackupFileV2,
  canonicalJson,
  inspectBackup,
  normalizeCalibrationGame,
  normalizeCalibratorProfile,
  normalizeGameRecordForArchive,
  normalizePieceTemplates,
  normalizePlayerRecord,
  parseBackup,
  type BackupInspection,
} from './backupSchema'
import { db, normalizeAppSettings, type GameRow, type PlayerRow } from './db'

export { MAX_BACKUP_TEXT_LENGTH, inspectBackup }
export type { BackupInspection }

const PORTABLE_PREFERENCE_KEYS = [
  'voiceLang',
  'ttsReadback',
  'autoRelisten',
  'analysisMovetimeMs',
  'tabletop',
] as const

const PIECE_CALIBRATION_KEY = 'pieceCalibration'

export interface ExportBackupResult {
  json: string
  summary: BackupInspection
}

export interface MergeCount {
  added: number
  skipped: number
}

export interface RestoreResult {
  sourceVersion: 1 | 2
  games: MergeCount
  players: MergeCount
  profiles: MergeCount
  calibrationGames: MergeCount
  preferencesRestored: boolean
  pieceCalibration: 'not-in-backup' | 'restored' | 'skipped-same' | 'kept-local'
  omittedStaleReviewCount: number
}

export type RankBackupAccessCode = 'pin-required' | 'pin-not-configured' | 'pin-invalid'

export class RankBackupAccessError extends Error {
  readonly code: RankBackupAccessCode

  constructor(code: RankBackupAccessCode, message: string) {
    super(message)
    this.name = 'RankBackupAccessError'
    this.code = code
  }
}

export async function exportBackup(rankPin?: string): Promise<ExportBackupResult> {
  const exportedAt = Date.now()
  const snapshot = await db.transaction(
    'r',
    db.games,
    db.players,
    db.settings,
    db.rankCalibrators,
    db.rankCalibrationGames,
    async () => {
      const [games, players, preferenceRows, pieceRow, profiles, calibrationGames] = await Promise.all([
        db.games.orderBy('startedAt').toArray(),
        db.players.toArray(),
        db.settings.bulkGet([...PORTABLE_PREFERENCE_KEYS]),
        db.settings.get(PIECE_CALIBRATION_KEY),
        db.rankCalibrators.orderBy('createdAt').toArray(),
        db.rankCalibrationGames.orderBy('startedAt').toArray(),
      ])
      return { games, players, preferenceRows, pieceRow, profiles, calibrationGames }
    },
  )

  if (snapshot.profiles.length > 0 || snapshot.calibrationGames.length > 0) {
    await requireRankBackupAccess(rankPin)
  }

  const storedPreferences: Record<string, unknown> = {}
  snapshot.preferenceRows.forEach((row, index) => {
    if (row) storedPreferences[PORTABLE_PREFERENCE_KEYS[index]] = row.value
  })
  const settings = normalizeAppSettings(storedPreferences)
  let omittedStaleReviewCount = 0
  const portableGames = snapshot.games.map((row, index) => {
    const normalized = normalizeGameForExport(row, index)
    if (normalized.reviewOmitted) omittedStaleReviewCount++
    return normalized.record
  })
  const rankCalibration = buildRankCalibrationExport(
    snapshot.profiles,
    snapshot.calibrationGames,
    exportedAt,
    APP_VERSION,
  )
  const file = buildBackupFileV2({
    exportedAt,
    appVersion: APP_VERSION,
    games: portableGames,
    players: snapshot.players
      .map(withoutPlayerId)
      .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name, 'zh-TW')),
    preferences: {
      voiceLang: settings.voiceLang,
      ttsReadback: settings.ttsReadback,
      autoRelisten: settings.autoRelisten,
      analysisMovetimeMs: settings.analysisMovetimeMs,
      tabletop: settings.tabletop,
    },
    pieceCalibration: (snapshot.pieceRow?.value as PieceTemplates | undefined) ?? null,
    rankCalibration,
  })
  const json = JSON.stringify(file)
  assertBackupTextSize(json)
  return {
    json,
    summary: {
      version: 2,
      exportedAt: file.exportedAt,
      appVersion: file.appVersion,
      gameCount: file.games.length,
      playerCount: file.players.length,
      profileCount: file.rankCalibration.profiles.length,
      calibrationGameCount: file.rankCalibration.games.length,
      hasPreferences: true,
      hasPieceCalibration: file.pieceCalibration !== null,
      isLegacyV1: false,
      omittedStaleReviewCount,
    },
  }
}

export function isBackupJson(text: string): boolean {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('{')) return false
  return new RegExp(`"format"\\s*:\\s*"${BACKUP_FORMAT}"`).test(trimmed)
}

export async function restoreBackup(text: string, rankPin?: string): Promise<RestoreResult> {
  const parsed = parseBackup(text)
  if ((parsed.rankCalibration?.profiles.length ?? 0) > 0 || (parsed.rankCalibration?.games.length ?? 0) > 0) {
    await requireRankBackupAccess(rankPin)
  }
  const incomingGames = new Map(parsed.games.map((entry) => [entry.stableId, canonicalJson(entry.record)]))
  const incomingProfiles = new Map(
    (parsed.rankCalibration?.profiles ?? []).map((profile) => [profile.id, canonicalJson(profile)]),
  )
  const incomingCalibrationGames = new Map(
    (parsed.rankCalibration?.games ?? []).map((game) => [game.id, canonicalJson(game)]),
  )

  return db.transaction(
    'rw',
    db.games,
    db.players,
    db.settings,
    db.rankCalibrators,
    db.rankCalibrationGames,
    async () => {
      const [localGames, localPlayers, localPieceRow, localProfiles, localCalibrationGames] = await Promise.all([
        db.games.toArray(),
        db.players.toArray(),
        db.settings.get(PIECE_CALIBRATION_KEY),
        db.rankCalibrators.toArray(),
        db.rankCalibrationGames.toArray(),
      ])

      const localGameMap = new Map<string, string>()
      for (const [index, row] of localGames.entries()) {
        const normalized = normalizeGameRecordForArchive(
          withoutGameId(row),
          `本機 games[${index}]`,
        ).record
        if (localGameMap.has(normalized.tree.id)) {
          throw new Error(`本機已有重複棋局識別 ${normalized.tree.id}，請先另存資料後再處理`)
        }
        localGameMap.set(normalized.tree.id, canonicalJson(normalized))
      }

      const gamesToAdd: Array<Omit<GameRow, 'id'>> = []
      let gamesSkipped = 0
      for (const entry of parsed.games) {
        const local = localGameMap.get(entry.stableId)
        if (local === undefined) {
          gamesToAdd.push(entry.record)
        } else if (local === incomingGames.get(entry.stableId)) {
          gamesSkipped++
        } else {
          throw new Error(`棋局識別 ${entry.stableId} 在本機與備份內容不同；為避免覆寫，整份備份未還原`)
        }
      }

      const playerCandidates = new Map<string, Omit<PlayerRow, 'id'>>()
      for (const player of parsed.players) playerCandidates.set(player.name, player)
      for (const game of parsed.games) {
        for (const name of [game.record.redName, game.record.blackName]) {
          const trimmed = name.trim()
          if (trimmed && !playerCandidates.has(trimmed)) {
            playerCandidates.set(trimmed, normalizePlayerRecord({ name: trimmed, createdAt: game.record.startedAt }, '棋局姓名'))
          }
        }
      }
      const localPlayerNames = new Set(localPlayers.map((player) => player.name.trim()).filter(Boolean))
      const playersToAdd = [...playerCandidates.values()].filter((player) => !localPlayerNames.has(player.name))
      const playersSkipped = playerCandidates.size - playersToAdd.length

      const localProfileMap = normalizedMap(
        localProfiles,
        (value, index) => normalizeCalibratorProfile(value, `本機 rankCalibrators[${index}]`),
        (value) => value.id,
        '本機段級協助者',
      )
      const profilesToAdd: CalibratorProfile[] = []
      let profilesSkipped = 0
      for (const profile of parsed.rankCalibration?.profiles ?? []) {
        const local = localProfileMap.get(profile.id)
        if (local === undefined) profilesToAdd.push(profile)
        else if (local === incomingProfiles.get(profile.id)) profilesSkipped++
        else throw new Error(`段級協助者識別 ${profile.id} 在本機與備份內容不同；整份備份未還原`)
      }

      const localCalibrationGameMap = normalizedMap(
        localCalibrationGames,
        (value, index) => normalizeCalibrationGame(value, `本機 rankCalibrationGames[${index}]`),
        (value) => value.id,
        '本機段級校準對局',
      )
      const calibrationGamesToAdd: CalibrationGame[] = []
      let calibrationGamesSkipped = 0
      for (const game of parsed.rankCalibration?.games ?? []) {
        const local = localCalibrationGameMap.get(game.id)
        if (local === undefined) calibrationGamesToAdd.push(game)
        else if (local === incomingCalibrationGames.get(game.id)) calibrationGamesSkipped++
        else throw new Error(`段級校準對局識別 ${game.id} 在本機與備份內容不同；整份備份未還原`)
      }

      let pieceCalibration: RestoreResult['pieceCalibration'] = 'not-in-backup'
      let pieceToRestore: PieceTemplates | null = null
      if (parsed.version === 2 && parsed.pieceCalibration) {
        if (!localPieceRow) {
          pieceToRestore = parsed.pieceCalibration
          pieceCalibration = 'restored'
        } else {
          const localPiece = normalizePieceTemplates(localPieceRow.value, '本機 pieceCalibration')
          pieceCalibration =
            canonicalJson(localPiece) === canonicalJson(parsed.pieceCalibration) ? 'skipped-same' : 'kept-local'
        }
      }

      // 上述 conflict／validation 全部完成後才開始第一筆 write，避免可預見錯誤造成部分變更。
      if (gamesToAdd.length) await db.games.bulkAdd(gamesToAdd as GameRow[])
      if (playersToAdd.length) await db.players.bulkAdd(playersToAdd as PlayerRow[])

      if (parsed.preferences) {
        const { schemaVersion: _schemaVersion, ...preferences } = parsed.preferences
        void _schemaVersion
        await db.settings.bulkPut(Object.entries(preferences).map(([key, value]) => ({ key, value })))
      }
      if (pieceToRestore) await db.settings.put({ key: PIECE_CALIBRATION_KEY, value: pieceToRestore })
      if (profilesToAdd.length) await db.rankCalibrators.bulkAdd(profilesToAdd)
      if (calibrationGamesToAdd.length) await db.rankCalibrationGames.bulkAdd(calibrationGamesToAdd)

      return {
        sourceVersion: parsed.version,
        games: { added: gamesToAdd.length, skipped: gamesSkipped },
        players: { added: playersToAdd.length, skipped: playersSkipped },
        profiles: { added: profilesToAdd.length, skipped: profilesSkipped },
        calibrationGames: { added: calibrationGamesToAdd.length, skipped: calibrationGamesSkipped },
        preferencesRestored: parsed.preferences !== null,
        pieceCalibration,
        omittedStaleReviewCount: parsed.omittedStaleReviewCount,
      }
    },
  )
}

async function requireRankBackupAccess(pin: string | undefined): Promise<void> {
  const gate = await loadRankCalibrationGate()
  if (!gate.pinSalt || !gate.pinVerifier) {
    throw new RankBackupAccessError(
      'pin-not-configured',
      '這份備份含段級校準資料；請先用 setup 入口啟用實驗室並建立本機 PIN',
    )
  }
  if (!pin) {
    throw new RankBackupAccessError('pin-required', '這份備份含段級校準資料，請輸入本機段級 PIN')
  }
  if (!(await verifyCalibrationPin(gate, pin))) {
    throw new RankBackupAccessError('pin-invalid', '本機段級 PIN 錯誤，未存取校準資料')
  }
}

function normalizedMap<T>(
  values: T[],
  normalize: (value: T, index: number) => T,
  identity: (value: T) => string,
  label: string,
): Map<string, string> {
  const result = new Map<string, string>()
  values.forEach((value, index) => {
    const normalized = normalize(value, index)
    const id = identity(normalized)
    if (result.has(id)) throw new Error(`${label}有重複識別 ${id}`)
    result.set(id, canonicalJson(normalized))
  })
  return result
}

function withoutGameId(row: GameRow): Omit<GameRow, 'id'> {
  const { id: _id, ...record } = row
  void _id
  return record
}

function normalizeGameForExport(
  row: GameRow,
  index: number,
): { record: Omit<GameRow, 'id'>; reviewOmitted: boolean } {
  const path = `本機 games[${index}]`
  const normalized = normalizeGameRecordForArchive(withoutGameId(row), path)
  return { record: normalized.record, reviewOmitted: normalized.staleReviewOmitted }
}

function withoutPlayerId(row: PlayerRow): Omit<PlayerRow, 'id'> {
  const { id: _id, ...record } = row
  void _id
  return record
}
