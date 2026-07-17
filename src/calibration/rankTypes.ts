import type { GameNode } from '../core/tree'
import type { PvLine } from '../engine/engineClient'
import type { HumanMoveDecisionV1 } from './humanMove'
import type { Phase2AnchorProtocolV1 } from './phase2Protocol'

export const RANK_CALIBRATION_GATE_SCHEMA_VERSION = 1 as const
export const RANK_CALIBRATION_EXPORT_SCHEMA_V1 = 1 as const
export const RANK_CALIBRATION_EXPORT_SCHEMA_V2 = 2 as const
export const CALIBRATION_GAME_SCHEMA_V1 = 1 as const
export const CALIBRATION_GAME_SCHEMA_V2 = 2 as const
export const CALIBRATION_COLLECTION_PROTOCOL_V1 = 'pin-gated-local-match-v1' as const
/** @deprecated 僅供既有 v1 fixture／reader 相容；gate、archive 與 game 新程式必須使用各自常數。 */
export const RANK_CALIBRATION_SCHEMA_VERSION = CALIBRATION_GAME_SCHEMA_V1
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
  schemaVersion: typeof RANK_CALIBRATION_GATE_SCHEMA_VERSION
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

export interface CalibrationGameV1 {
  id: string
  schemaVersion: typeof CALIBRATION_GAME_SCHEMA_V1
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

export interface CalibrationSideAssignmentV1 {
  version: 'balanced-alternation-v1'
  /**
   * Stable zero-based sequence across the same profile revision + anchor config + collection protocol.
   * Even indices assign the human red; odd indices assign the human black.
   */
  sequenceIndex: number
}

export interface CalibrationAnalyzeSnapshotV1 {
  nodes: number
  multipv: number
  lines: PvLine[]
  bestmove: string
  completedDepth: number
  completeCandidateBatch: boolean
  anomalies: string[]
}

export interface CalibrationEngineMoveRecordV1 {
  schemaVersion: 1
  ply: number
  fenBefore: string
  selectedUci: string
  playedAt: number
  analysis: CalibrationAnalyzeSnapshotV1
  decision: HumanMoveDecisionV1
}

interface CalibrationGameV2Base {
  id: string
  schemaVersion: typeof CALIBRATION_GAME_SCHEMA_V2
  sessionId: string
  /** Runtime collection activation is versioned separately from the immutable WP009 anchor snapshot. */
  collectionProtocolVersion: typeof CALIBRATION_COLLECTION_PROTOCOL_V1
  profileId: string
  profileRevision: number
  profileSnapshot: CalibratorProfile
  anchorId: AnchorId
  anchorConfigVersion: string
  movePolicyVersion: string
  anchorSnapshot: Phase2AnchorProtocolV1
  randomSeed: string
  playerSide: 'red' | 'black'
  sideAssignment: CalibrationSideAssignmentV1
  startedAt: number
  updatedAt: number
  initialFen: string
  currentPly: number
  gameSnapshot: GameNode
  engineMoves: CalibrationEngineMoveRecordV1[]
  appVersion: string
}

export type CalibrationGameV2 = CalibrationGameV2Base &
  (
    | {
        status: 'in-progress'
        result?: undefined
        resultReason?: undefined
        endedAt?: undefined
      }
    | {
        status: 'completed'
        result: 'red' | 'black' | 'draw'
        resultReason?: string
        endedAt: number
      }
    | {
        status: 'aborted'
        result?: undefined
        resultReason: string
        endedAt: number
      }
  )

export type CalibrationGame = CalibrationGameV1 | CalibrationGameV2

export interface RankCalibrationExportV1 {
  format: typeof RANK_CALIBRATION_FORMAT
  schemaVersion: typeof RANK_CALIBRATION_EXPORT_SCHEMA_V1
  exportedAt: number
  appVersion: string
  anchorSetVersion: string
  anchors: AnchorDefinition[]
  profiles: CalibratorProfile[]
  games: CalibrationGameV1[]
}

export interface RankCalibrationExportV2 {
  format: typeof RANK_CALIBRATION_FORMAT
  schemaVersion: typeof RANK_CALIBRATION_EXPORT_SCHEMA_V2
  exportedAt: number
  appVersion: string
  /** Legacy registry remains available for archived schema-v1 games. */
  anchorSetVersion: string
  anchors: AnchorDefinition[]
  phase2ConfigVersion: Phase2AnchorProtocolV1['configVersion']
  phase2Anchors: Phase2AnchorProtocolV1[]
  profiles: CalibratorProfile[]
  games: CalibrationGame[]
}

export type RankCalibrationExport = RankCalibrationExportV1 | RankCalibrationExportV2

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
