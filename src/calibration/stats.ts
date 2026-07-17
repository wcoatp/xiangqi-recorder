import type {
  CalibrationGame,
  CalibrationGameV2,
  CalibratorProfile,
} from './rankTypes'

export interface CalibrationCompatibilityDimensions {
  readonly gameSchemaVersion: 2
  readonly collectionProtocolVersion: CalibrationGameV2['collectionProtocolVersion']
  readonly sideAssignmentVersion: CalibrationGameV2['sideAssignment']['version']
  readonly anchor: {
    readonly id: CalibrationGameV2['anchorId']
    readonly configVersion: string
  }
  readonly policy: {
    readonly version: string
    readonly topK: number
    readonly temperatureCp: number
    readonly maxLossCp: number
    readonly preserveForcedMate: true
  }
  readonly engine: {
    readonly protocolVersion: string
    readonly package: string
    readonly engineCommit: string
    readonly uciWorkerSha256: string
    readonly javascriptSha256: string
    readonly wasmSha256: string
    readonly pthreadWorkerSha256: string
    readonly nnueSha256: string
  }
  readonly search: {
    readonly nodes: number
    readonly multipv: number
    readonly threads: number
    readonly hashMb: number
    readonly skillLevel: number
    readonly limitStrength: boolean
    readonly freshHashEveryMove: boolean
  }
  readonly profile: {
    readonly claimedRank: string
    readonly rankSystem: string
  }
  readonly playerSide: CalibrationGameV2['playerSide']
  readonly appVersion: string
}

export interface CalibrationStatsGroup {
  /** Canonical JSON of `dimensions`; suitable as a stable React/Map key, not as user-facing copy. */
  readonly key: string
  readonly dimensions: CalibrationCompatibilityDimensions
  /** Frequently displayed dimensions are flattened so the UI never needs to parse `key`. */
  readonly anchorId: CalibrationGameV2['anchorId']
  readonly anchorConfigVersion: string
  readonly policyVersion: string
  readonly engineProtocol: string
  readonly engineCommit: string
  readonly searchNodes: number
  readonly searchMultiPv: number
  readonly claimedRank: string
  readonly rankSystem: string
  readonly playerSide: CalibrationGameV2['playerSide']
  readonly appVersion: string
  readonly total: number
  readonly completed: number
  readonly wins: number
  readonly draws: number
  readonly losses: number
  readonly aborted: number
  readonly inProgress: number
  readonly distinctProfiles: number
  readonly distinctSessions: number
  readonly decisionCount: number
  readonly anomalousDecisionCount: number
  readonly anomalousGameCount: number
}

export interface CalibrationStats {
  /** Schema-v1 rows are retained for audit only and never enter a v2 result group. */
  readonly legacyGameCount: number
  readonly groups: readonly CalibrationStatsGroup[]
}

interface MutableGroup {
  dimensions: CalibrationCompatibilityDimensions
  total: number
  completed: number
  wins: number
  draws: number
  losses: number
  aborted: number
  inProgress: number
  profileIds: Set<string>
  sessionIds: Set<string>
  decisionCount: number
  anomalousDecisionCount: number
  anomalousGameCount: number
}

const dimensionsFor = (game: CalibrationGameV2): CalibrationCompatibilityDimensions => {
  const { policy, engine, search } = game.anchorSnapshot
  return {
    gameSchemaVersion: 2,
    collectionProtocolVersion: game.collectionProtocolVersion,
    sideAssignmentVersion: game.sideAssignment.version,
    anchor: {
      id: game.anchorId,
      configVersion: game.anchorConfigVersion,
    },
    policy: {
      version: policy.version,
      topK: policy.topK,
      temperatureCp: policy.temperatureCp,
      maxLossCp: policy.maxLossCp,
      preserveForcedMate: policy.preserveForcedMate,
    },
    engine: {
      protocolVersion: engine.protocolVersion,
      package: engine.package,
      engineCommit: engine.engineCommit,
      uciWorkerSha256: engine.uciWorkerSha256,
      javascriptSha256: engine.javascriptSha256,
      wasmSha256: engine.wasmSha256,
      pthreadWorkerSha256: engine.pthreadWorkerSha256,
      nnueSha256: engine.nnueSha256,
    },
    search: {
      nodes: search.nodes,
      multipv: search.multipv,
      threads: search.threads,
      hashMb: search.hashMb,
      skillLevel: search.skillLevel,
      limitStrength: search.limitStrength,
      freshHashEveryMove: search.freshHashEveryMove,
    },
    profile: {
      claimedRank: game.profileSnapshot.claimedRank,
      rankSystem: game.profileSnapshot.rankSystem,
    },
    playerSide: game.playerSide,
    appVersion: game.appVersion,
  }
}

const isAnomalousDecision = (game: CalibrationGameV2, index: number): boolean => {
  const record = game.engineMoves[index]
  return (
    !record.analysis.completeCandidateBatch ||
    record.analysis.anomalies.length > 0 ||
    record.decision.quality !== 'complete' ||
    record.decision.anomalies.length > 0
  )
}

/**
 * Rebuilds descriptive statistics from normalized raw rows.
 *
 * `profiles` is deliberately not used to reinterpret historical games: every v2 game carries the
 * immutable rank snapshot that defines its compatibility group. Keeping it in the API makes the
 * data-source boundary explicit and lets callers pass the two local calibration tables together.
 */
export function buildCalibrationStats(
  profiles: readonly CalibratorProfile[],
  games: readonly CalibrationGame[],
): CalibrationStats {
  void profiles
  let legacyGameCount = 0
  const mutableGroups = new Map<string, MutableGroup>()

  for (const game of games) {
    if (game.schemaVersion === 1) {
      legacyGameCount += 1
      continue
    }

    const dimensions = dimensionsFor(game)
    const key = JSON.stringify(dimensions)
    let group = mutableGroups.get(key)
    if (!group) {
      group = {
        dimensions,
        total: 0,
        completed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        aborted: 0,
        inProgress: 0,
        profileIds: new Set<string>(),
        sessionIds: new Set<string>(),
        decisionCount: 0,
        anomalousDecisionCount: 0,
        anomalousGameCount: 0,
      }
      mutableGroups.set(key, group)
    }

    group.total += 1
    group.profileIds.add(game.profileId)
    group.sessionIds.add(game.sessionId)

    if (game.status === 'completed') {
      group.completed += 1
      if (game.result === 'draw') group.draws += 1
      else if (game.result === game.playerSide) group.wins += 1
      else group.losses += 1
    } else if (game.status === 'aborted') {
      group.aborted += 1
    } else {
      group.inProgress += 1
    }

    let gameHasAnomaly = false
    group.decisionCount += game.engineMoves.length
    for (let index = 0; index < game.engineMoves.length; index += 1) {
      if (!isAnomalousDecision(game, index)) continue
      group.anomalousDecisionCount += 1
      gameHasAnomaly = true
    }
    if (gameHasAnomaly) group.anomalousGameCount += 1
  }

  const groups = [...mutableGroups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, group]): CalibrationStatsGroup => ({
      key,
      dimensions: group.dimensions,
      anchorId: group.dimensions.anchor.id,
      anchorConfigVersion: group.dimensions.anchor.configVersion,
      policyVersion: group.dimensions.policy.version,
      engineProtocol: group.dimensions.engine.protocolVersion,
      engineCommit: group.dimensions.engine.engineCommit,
      searchNodes: group.dimensions.search.nodes,
      searchMultiPv: group.dimensions.search.multipv,
      claimedRank: group.dimensions.profile.claimedRank,
      rankSystem: group.dimensions.profile.rankSystem,
      playerSide: group.dimensions.playerSide,
      appVersion: group.dimensions.appVersion,
      total: group.total,
      completed: group.completed,
      wins: group.wins,
      draws: group.draws,
      losses: group.losses,
      aborted: group.aborted,
      inProgress: group.inProgress,
      distinctProfiles: group.profileIds.size,
      distinctSessions: group.sessionIds.size,
      decisionCount: group.decisionCount,
      anomalousDecisionCount: group.anomalousDecisionCount,
      anomalousGameCount: group.anomalousGameCount,
    }))

  return { legacyGameCount, groups }
}
