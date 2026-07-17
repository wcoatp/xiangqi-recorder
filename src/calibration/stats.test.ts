import { describe, expect, it } from 'vitest'
import { START_FEN } from '../core/fen'
import type { GameNode } from '../core/tree'
import type { CalibrationEngineMoveRecordV1, CalibrationGameV1, CalibrationGameV2, CalibratorProfile } from './rankTypes'
import { phase2AnchorById } from './phase2Protocol'
import { buildCalibrationStats } from './stats'

const profile = (id: string, claimedRank = '1級', rankSystem = '棋友自評'): CalibratorProfile => ({
  id,
  revision: 1,
  alias: `協助者-${id}`,
  claimedRank,
  rankSystem,
  consentedAt: 100,
  createdAt: 100,
})

const root = (id: string): GameNode => ({
  id: `root-${id}`,
  move: null,
  fenAfter: START_FEN,
  children: [],
})

type RecordAnomaly = 'clean' | 'analysis-code' | 'decision-code' | 'quality' | 'incomplete-batch'

const engineMove = (ply: number, anomaly: RecordAnomaly = 'clean'): CalibrationEngineMoveRecordV1 => ({
  schemaVersion: 1,
  ply,
  fenBefore: START_FEN,
  selectedUci: 'a1a2',
  playedAt: 200 + ply,
  analysis: {
    nodes: 40000,
    multipv: 8,
    lines: [],
    bestmove: 'a1a2',
    completedDepth: 8,
    completeCandidateBatch: anomaly !== 'incomplete-batch',
    anomalies: anomaly === 'analysis-code' ? ['incomplete-multipv-batch'] : [],
  },
  decision: {
    schemaVersion: 1,
    policyVersion: 'seeded-multipv-v1',
    scorePerspective: 'side-to-move',
    decisionSeedHash: '1234abcd',
    randomAlgorithm: 'fnv1a32-mulberry32-v1',
    randomUint: 1,
    randomUnit: 1 / 0x1_0000_0000,
    totalWeight: 1_000_000,
    threshold: 0,
    candidates: [],
    selectedUci: 'a1a2',
    quality: anomaly === 'quality' ? 'anomalous-candidate-selection' : 'complete',
    anomalies: anomaly === 'decision-code' ? ['bestmove-mismatch'] : [],
  },
})

interface GameOptions {
  profile?: CalibratorProfile
  sessionId?: string
  playerSide?: 'red' | 'black'
  status?: 'completed' | 'aborted' | 'in-progress'
  result?: 'red' | 'black' | 'draw'
  engineMoves?: CalibrationEngineMoveRecordV1[]
}

const v2Game = (id: string, options: GameOptions = {}): CalibrationGameV2 => {
  const gameProfile = options.profile ?? profile('p1')
  const status = options.status ?? 'completed'
  const game: Record<string, unknown> = {
    id,
    schemaVersion: 2,
    sessionId: options.sessionId ?? 'session-1',
    collectionProtocolVersion: 'pin-gated-local-match-v1',
    profileId: gameProfile.id,
    profileRevision: gameProfile.revision,
    profileSnapshot: { ...gameProfile },
    anchorId: 'A05',
    anchorConfigVersion: '2026.07-phase2-v1',
    movePolicyVersion: 'seeded-multipv-v1',
    anchorSnapshot: structuredClone(phase2AnchorById('A05')),
    randomSeed: `seed-${id}`,
    playerSide: options.playerSide ?? 'red',
    sideAssignment: {
      version: 'balanced-alternation-v1',
      sequenceIndex: options.playerSide === 'black' ? 1 : 0,
    },
    startedAt: 100,
    updatedAt: 200,
    initialFen: START_FEN,
    currentPly: 0,
    gameSnapshot: root(id),
    engineMoves: options.engineMoves ?? [],
    appVersion: '0.6.0',
    status,
  }
  if (status === 'completed') {
    game.result = options.result ?? 'red'
    game.endedAt = 200
  } else if (status === 'aborted') {
    game.resultReason = '協助者中止'
    game.endedAt = 200
  }
  return game as unknown as CalibrationGameV2
}

const v1Game = (id: string): CalibrationGameV1 => ({
  id,
  schemaVersion: 1,
  profileId: 'legacy-profile',
  profileRevision: 1,
  anchorId: 'A01',
  anchorConfigVersion: '2026.07-v1',
  movePolicyVersion: 'not-implemented',
  randomSeed: 'legacy-seed',
  playerSide: 'red',
  result: 'red',
  startedAt: 1,
  endedAt: 2,
  gameSnapshot: root(id),
  appVersion: '0.4.0',
  engineVersion: 'legacy',
})

describe('版本隔離校準統計', () => {
  it('schema v1 只回 legacy 數量，不會進入 v2 組', () => {
    expect(buildCalibrationStats([], [])).toEqual({ legacyGameCount: 0, groups: [] })
    expect(buildCalibrationStats([profile('legacy-profile')], [v1Game('old-1'), v1Game('old-2')])).toEqual({
      legacyGameCount: 2,
      groups: [],
    })
  })

  it('completed 依人類執棋方計勝和負，中止與進行中不進 completed denominator', () => {
    const first = profile('p1')
    const second = profile('p2')
    const games: CalibrationGameV2[] = [
      v2Game('win', {
        profile: first,
        sessionId: 's1',
        result: 'red',
        engineMoves: [engineMove(1), engineMove(3, 'analysis-code')],
      }),
      v2Game('draw', { profile: first, sessionId: 's1', result: 'draw', engineMoves: [engineMove(1)] }),
      v2Game('loss', {
        profile: second,
        sessionId: 's2',
        result: 'black',
        engineMoves: [engineMove(1, 'decision-code')],
      }),
      v2Game('aborted', {
        profile: second,
        sessionId: 's3',
        status: 'aborted',
        engineMoves: [engineMove(1, 'incomplete-batch')],
      }),
      v2Game('in-progress', { profile: first, sessionId: 's3', status: 'in-progress' }),
    ]

    const stats = buildCalibrationStats([first, second], games)
    expect(stats.legacyGameCount).toBe(0)
    expect(stats.groups).toHaveLength(1)
    expect(stats.groups[0]).toMatchObject({
      total: 5,
      completed: 3,
      wins: 1,
      draws: 1,
      losses: 1,
      aborted: 1,
      inProgress: 1,
      distinctProfiles: 2,
      distinctSessions: 3,
      decisionCount: 5,
      anomalousDecisionCount: 3,
      anomalousGameCount: 3,
    })
    expect(stats.groups[0].wins + stats.groups[0].draws + stats.groups[0].losses).toBe(
      stats.groups[0].completed,
    )
  })

  it('黑方協助者的黑勝算勝、紅勝算負，並與紅方資料隔離', () => {
    const blackWins = v2Game('black-win', { playerSide: 'black', result: 'black' })
    const blackLoses = v2Game('black-loss', { playerSide: 'black', result: 'red' })
    const redWins = v2Game('red-win', { playerSide: 'red', result: 'red' })
    const groups = buildCalibrationStats([], [blackWins, redWins, blackLoses]).groups
    expect(groups).toHaveLength(2)
    expect(groups.find((group) => group.playerSide === 'black')).toMatchObject({
      completed: 2,
      wins: 1,
      losses: 1,
    })
    expect(groups.find((group) => group.playerSide === 'red')).toMatchObject({
      completed: 1,
      wins: 1,
      losses: 0,
    })
  })

  it('任一 compatibility dimension 改變都建立獨立組', () => {
    const dimensions: Array<[string, (game: any) => void]> = [
      ['collection protocol', (game) => { game.collectionProtocolVersion = 'controller-next' }],
      ['side assignment', (game) => { game.sideAssignment.version = 'assignment-next' }],
      ['anchor id', (game) => { game.anchorId = 'A06'; game.anchorSnapshot.id = 'A06' }],
      ['anchor config', (game) => { game.anchorConfigVersion = 'config-next'; game.anchorSnapshot.configVersion = 'config-next' }],
      ['policy version', (game) => { game.movePolicyVersion = 'policy-next'; game.anchorSnapshot.policy.version = 'policy-next' }],
      ['policy topK', (game) => { game.anchorSnapshot.policy.topK = 4 }],
      ['policy temperature', (game) => { game.anchorSnapshot.policy.temperatureCp = 129 }],
      ['policy max loss', (game) => { game.anchorSnapshot.policy.maxLossCp = 359 }],
      ['policy forced mate', (game) => { game.anchorSnapshot.policy.preserveForcedMate = false }],
      ['engine protocol', (game) => { game.anchorSnapshot.engine.protocolVersion = 'protocol-next' }],
      ['engine package', (game) => { game.anchorSnapshot.engine.package = 'package-next' }],
      ['engine commit', (game) => { game.anchorSnapshot.engine.engineCommit = 'commit-next' }],
      ['uci worker hash', (game) => { game.anchorSnapshot.engine.uciWorkerSha256 = 'hash-next' }],
      ['javascript hash', (game) => { game.anchorSnapshot.engine.javascriptSha256 = 'hash-next' }],
      ['wasm hash', (game) => { game.anchorSnapshot.engine.wasmSha256 = 'hash-next' }],
      ['pthread hash', (game) => { game.anchorSnapshot.engine.pthreadWorkerSha256 = 'hash-next' }],
      ['nnue hash', (game) => { game.anchorSnapshot.engine.nnueSha256 = 'hash-next' }],
      ['search nodes', (game) => { game.anchorSnapshot.search.nodes = 40001 }],
      ['search multipv', (game) => { game.anchorSnapshot.search.multipv = 7 }],
      ['search threads', (game) => { game.anchorSnapshot.search.threads = 2 }],
      ['search hash', (game) => { game.anchorSnapshot.search.hashMb = 64 }],
      ['search skill', (game) => { game.anchorSnapshot.search.skillLevel = 19 }],
      ['search limit strength', (game) => { game.anchorSnapshot.search.limitStrength = true }],
      ['search fresh hash', (game) => { game.anchorSnapshot.search.freshHashEveryMove = false }],
      ['claimed rank', (game) => { game.profileSnapshot.claimedRank = '2級' }],
      ['rank system', (game) => { game.profileSnapshot.rankSystem = '比賽組別' }],
      ['player side', (game) => { game.playerSide = 'black'; game.sideAssignment.sequenceIndex = 1; game.result = 'black' }],
      ['app version', (game) => { game.appVersion = '0.6.1' }],
    ]
    const games = [v2Game('base')]
    for (const [label, mutate] of dimensions) {
      const game = structuredClone(v2Game(`variant-${label}`)) as any
      mutate(game)
      games.push(game)
    }

    const groups = buildCalibrationStats([], games).groups
    expect(groups).toHaveLength(dimensions.length + 1)
    expect(new Set(groups.map((group) => group.key)).size).toBe(dimensions.length + 1)
    expect(groups.every((group) => group.total === 1)).toBe(true)
    expect(JSON.parse(groups[0].key)).toEqual(groups[0].dimensions)
  })

  it('輸入 games／profiles 排列不改變 byte-equivalent 輸出與穩定 group order', () => {
    const profiles = [profile('p1'), profile('p2', '2級')]
    const games = [
      v1Game('legacy'),
      v2Game('base-1'),
      v2Game('base-2', { sessionId: 's2' }),
      v2Game('other-rank', { profile: profiles[1] }),
      v2Game('other-side', { playerSide: 'black', result: 'draw' }),
    ]
    const expected = buildCalibrationStats(profiles, games)
    const reversed = buildCalibrationStats([...profiles].reverse(), [...games].reverse())
    const shuffled = buildCalibrationStats(profiles, [games[3], games[0], games[4], games[2], games[1]])

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(expected))
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(expected))
    expect(expected.groups.map((group) => group.key)).toEqual(
      [...expected.groups.map((group) => group.key)].sort(),
    )
  })
})
