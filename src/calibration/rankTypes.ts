import type { GameNode } from '../core/tree'

export const RANK_CALIBRATION_SCHEMA_VERSION = 1 as const
export const RANK_CALIBRATION_FORMAT = 'xiangqi-recorder-rank-calibration' as const

export type AnchorId = 'A01' | 'A02' | 'A03' | 'A04' | 'A05' | 'A06' | 'A07' | 'A08' | 'A09' | 'A10'

export interface AnchorEngineConfig {
  limitStrength: boolean
  /** 內部引擎參數，只用於可重現性；不得直接顯示為中國象棋級段。 */
  uciElo?: number
  skillLevel: number
  movetimeMs: number
  multiPv: number
}

export interface AnchorDefinition {
  id: AnchorId
  configVersion: string
  order: number
  engineConfig: AnchorEngineConfig
  movePolicyVersion: string
}

export interface PinKdfConfig {
  name: 'PBKDF2'
  hash: 'SHA-256'
  iterations: number
}

/** 此物件只存本機 settings，不得放進校準資料匯出檔。 */
export interface RankCalibrationGate {
  schemaVersion: typeof RANK_CALIBRATION_SCHEMA_VERSION
  enabled: boolean
  pinSalt?: string
  pinVerifier?: string
  kdf: PinKdfConfig
  autoLockMinutes: number
  updatedAt: number
}

export interface CalibratorProfile {
  id: string
  revision: number
  alias: string
  claimedRank: string
  rankSystem: string
  consentedAt: number
  createdAt: number
  notes?: string
}

export interface CalibrationGame {
  id: string
  schemaVersion: typeof RANK_CALIBRATION_SCHEMA_VERSION
  profileId: string
  profileRevision: number
  anchorId: AnchorId
  anchorConfigVersion: string
  movePolicyVersion: string
  randomSeed: string
  playerSide: 'red' | 'black'
  result: 'red' | 'black' | 'draw' | 'aborted'
  resultReason?: string
  startedAt: number
  endedAt?: number
  gameSnapshot: GameNode
  appVersion: string
  engineVersion: string
}

export interface RankCalibrationExport {
  format: typeof RANK_CALIBRATION_FORMAT
  schemaVersion: typeof RANK_CALIBRATION_SCHEMA_VERSION
  exportedAt: number
  appVersion: string
  anchorSetVersion: string
  anchors: AnchorDefinition[]
  profiles: CalibratorProfile[]
  games: CalibrationGame[]
}

export const TAIWAN_RANK_OPTIONS = [
  '10級',
  '9級',
  '8級',
  '7級',
  '6級',
  '5級',
  '4級',
  '3級',
  '2級',
  '1級',
  '1段',
  '2段',
  '3段',
  '4段',
  '5段',
  '6段',
  '7段',
  '8段',
  '9段',
] as const

export const RANK_SYSTEM_OPTIONS = ['協會／棋會登記', '比賽組別', '棋友自評', '其他'] as const
