import { ANCHOR_SET_VERSION, RANK_ANCHORS } from '../calibration/anchors'
import { PIN_KDF } from '../calibration/pin'
import {
  RANK_CALIBRATION_FORMAT,
  RANK_CALIBRATION_SCHEMA_VERSION,
  RANK_SYSTEM_OPTIONS,
  TAIWAN_RANK_OPTIONS,
  type CalibrationGame,
  type CalibratorProfile,
  type RankCalibrationExport,
  type RankCalibrationGate,
} from '../calibration/rankTypes'
import { db } from './db'

const GATE_KEY = 'rankCalibrationGate'

export const defaultRankCalibrationGate = (): RankCalibrationGate => ({
  schemaVersion: RANK_CALIBRATION_SCHEMA_VERSION,
  enabled: false,
  kdf: PIN_KDF,
  autoLockMinutes: 15,
  updatedAt: Date.now(),
})

function isGate(value: unknown): value is RankCalibrationGate {
  if (!value || typeof value !== 'object') return false
  const gate = value as Partial<RankCalibrationGate>
  return (
    gate.schemaVersion === RANK_CALIBRATION_SCHEMA_VERSION &&
    typeof gate.enabled === 'boolean' &&
    typeof gate.autoLockMinutes === 'number' &&
    gate.autoLockMinutes > 0 &&
    gate.autoLockMinutes <= 120 &&
    !!gate.kdf &&
    gate.kdf.name === 'PBKDF2' &&
    gate.kdf.hash === 'SHA-256' &&
    typeof gate.kdf.iterations === 'number' &&
    gate.kdf.iterations >= 100_000 &&
    (gate.pinSalt === undefined || typeof gate.pinSalt === 'string') &&
    (gate.pinVerifier === undefined || typeof gate.pinVerifier === 'string')
  )
}

export async function loadRankCalibrationGate(): Promise<RankCalibrationGate> {
  const row = await db.settings.get(GATE_KEY)
  return isGate(row?.value) ? row.value : defaultRankCalibrationGate()
}

export async function saveRankCalibrationGate(gate: RankCalibrationGate): Promise<void> {
  await db.settings.put({ key: GATE_KEY, value: { ...gate, updatedAt: Date.now() } })
}

export async function enableRankCalibrationGate(): Promise<RankCalibrationGate> {
  const current = await loadRankCalibrationGate()
  const enabled = { ...current, enabled: true, updatedAt: Date.now() }
  await saveRankCalibrationGate(enabled)
  return enabled
}

export async function disableRankCalibrationGate(): Promise<void> {
  const current = await loadRankCalibrationGate()
  await saveRankCalibrationGate({ ...current, enabled: false, updatedAt: Date.now() })
}

function newStableId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export interface CreateCalibratorInput {
  alias: string
  claimedRank: string
  rankSystem: string
  notes?: string
  consentedAt: number
}

export async function createCalibratorProfile(input: CreateCalibratorInput): Promise<CalibratorProfile> {
  const alias = input.alias.trim()
  const claimedRank = input.claimedRank.trim()
  const rankSystem = input.rankSystem.trim()
  if (!alias) throw new Error('請輸入匿名代號')
  if (!(TAIWAN_RANK_OPTIONS as readonly string[]).includes(claimedRank)) throw new Error('自報級／段不在支援範圍')
  if (!(RANK_SYSTEM_OPTIONS as readonly string[]).includes(rankSystem)) throw new Error('制度來源不在支援範圍')
  if (!Number.isFinite(input.consentedAt) || input.consentedAt <= 0) throw new Error('尚未同意本機資料收集說明')
  const now = Date.now()
  const profile: CalibratorProfile = {
    id: newStableId('calibrator'),
    revision: 1,
    alias: alias.slice(0, 32),
    claimedRank,
    rankSystem,
    consentedAt: input.consentedAt,
    createdAt: now,
    ...(input.notes?.trim() ? { notes: input.notes.trim().slice(0, 200) } : {}),
  }
  await db.rankCalibrators.add(profile)
  return profile
}

export async function listCalibratorProfiles(): Promise<CalibratorProfile[]> {
  return db.rankCalibrators.orderBy('createdAt').reverse().toArray()
}

export async function listCalibrationGames(): Promise<CalibrationGame[]> {
  return db.rankCalibrationGames.orderBy('startedAt').toArray()
}

export function buildRankCalibrationExport(
  profiles: CalibratorProfile[],
  games: CalibrationGame[],
  exportedAt: number,
  appVersion: string,
): RankCalibrationExport {
  return {
    format: RANK_CALIBRATION_FORMAT,
    schemaVersion: RANK_CALIBRATION_SCHEMA_VERSION,
    exportedAt,
    appVersion,
    anchorSetVersion: ANCHOR_SET_VERSION,
    anchors: RANK_ANCHORS.map((entry) => ({ ...entry, engineConfig: { ...entry.engineConfig } })),
    profiles,
    games,
  }
}

export async function exportRankCalibration(appVersion: string): Promise<{
  json: string
  profileCount: number
  gameCount: number
}> {
  const [profiles, games] = await Promise.all([listCalibratorProfiles(), listCalibrationGames()])
  const payload = buildRankCalibrationExport(profiles, games, Date.now(), appVersion)
  return {
    json: JSON.stringify(payload, null, 2),
    profileCount: profiles.length,
    gameCount: games.length,
  }
}
