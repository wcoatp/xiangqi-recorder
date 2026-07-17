import type { AnchorId } from './rankTypes'

export const PHASE2_CONFIG_VERSION = '2026.07-phase2-v1' as const
export const HUMAN_MOVE_POLICY_VERSION = 'seeded-multipv-v1' as const

export interface CalibrationEngineArtifactV1 {
  readonly protocolVersion: 'calibration-engine-v1'
  readonly package: 'fairy-stockfish-nnue.wasm@1.1.11'
  readonly engineCommit: '5589ea54'
  readonly uciWorkerSha256: string
  readonly javascriptSha256: string
  readonly wasmSha256: string
  readonly pthreadWorkerSha256: string
  readonly nnueSha256: string
}

export interface CalibrationSearchProfileV1 {
  readonly nodes: 40000
  readonly multipv: 8
  readonly threads: 1
  readonly hashMb: 32
  readonly skillLevel: 20
  readonly limitStrength: false
  readonly freshHashEveryMove: true
}

export interface HumanMovePolicyV1 {
  readonly version: typeof HUMAN_MOVE_POLICY_VERSION
  readonly topK: number
  readonly temperatureCp: number
  readonly maxLossCp: number
  readonly preserveForcedMate: true
}

export interface Phase2AnchorProtocolV1 {
  readonly schemaVersion: 1
  readonly id: AnchorId
  readonly order: number
  readonly configVersion: typeof PHASE2_CONFIG_VERSION
  /** Work package 009 only publishes the protocol core; it does not activate a calibration game flow. */
  readonly active: false
  readonly engine: CalibrationEngineArtifactV1
  readonly search: CalibrationSearchProfileV1
  readonly policy: HumanMovePolicyV1
}

export const CALIBRATION_ENGINE_ARTIFACT_V1: CalibrationEngineArtifactV1 = Object.freeze({
  protocolVersion: 'calibration-engine-v1',
  package: 'fairy-stockfish-nnue.wasm@1.1.11',
  engineCommit: '5589ea54',
  uciWorkerSha256: 'ce39d54d9e157849c45229d7a90e27097a008595c0bf8c3ea451deb9f52db0f6',
  javascriptSha256: '86f07a252c46e02760562d8bf6d32beb5f4fc5746c5f8233566a7ca3db6a8af4',
  wasmSha256: '91f78f226169ae0e08be3854e0b4de8f5461844d38f08eaae8e3f8ee0833831d',
  pthreadWorkerSha256: '067be484ac62f728b0dad28496997e5862f3c61f9091f59bb35d9d1b1ed14573',
  nnueSha256: 'c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11',
})

export const CALIBRATION_SEARCH_PROFILE_V1: CalibrationSearchProfileV1 = Object.freeze({
  nodes: 40000,
  multipv: 8,
  threads: 1,
  hashMb: 32,
  skillLevel: 20,
  limitStrength: false,
  freshHashEveryMove: true,
})

const policy = (
  topK: number,
  temperatureCp: number,
  maxLossCp: number,
): HumanMovePolicyV1 =>
  Object.freeze({
    version: HUMAN_MOVE_POLICY_VERSION,
    topK,
    temperatureCp,
    maxLossCp,
    preserveForcedMate: true,
  })

const anchor = (
  id: AnchorId,
  order: number,
  topK: number,
  temperatureCp: number,
  maxLossCp: number,
): Phase2AnchorProtocolV1 =>
  Object.freeze({
    schemaVersion: 1,
    id,
    order,
    configVersion: PHASE2_CONFIG_VERSION,
    active: false,
    engine: CALIBRATION_ENGINE_ARTIFACT_V1,
    search: CALIBRATION_SEARCH_PROFILE_V1,
    policy: policy(topK, temperatureCp, maxLossCp),
  })

/**
 * Inactive Phase 2 engineering anchors. Their relative policy parameters are not Taiwan rank claims.
 * Any engine, search or policy change requires a new config/policy version rather than mutating this set.
 */
const definitions: Phase2AnchorProtocolV1[] = [
  anchor('A01', 1, 8, 260, 700),
  anchor('A02', 2, 8, 220, 600),
  anchor('A03', 3, 7, 190, 520),
  anchor('A04', 4, 6, 160, 440),
  anchor('A05', 5, 5, 130, 360),
  anchor('A06', 6, 5, 105, 280),
  anchor('A07', 7, 4, 80, 210),
  anchor('A08', 8, 3, 55, 140),
  anchor('A09', 9, 2, 30, 70),
  anchor('A10', 10, 1, 1, 0),
]

export const PHASE2_ANCHORS: readonly Phase2AnchorProtocolV1[] = Object.freeze(definitions)

export const phase2AnchorById = (id: AnchorId): Phase2AnchorProtocolV1 => {
  const found = PHASE2_ANCHORS.find((entry) => entry.id === id)
  if (!found) throw new Error(`未知 Phase 2 校準錨點：${id}`)
  return found
}
