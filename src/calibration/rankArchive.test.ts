import { describe, expect, it } from 'vitest'
import { RANK_ANCHORS, ANCHOR_SET_VERSION } from './anchors'
import { selectHumanMoveV1 } from './humanMove'
import {
  PHASE2_ANCHORS,
  PHASE2_CONFIG_VERSION,
  type Phase2AnchorProtocolV1,
} from './phase2Protocol'
import {
  RANK_CALIBRATION_EXPORT_SCHEMA_V1,
  RANK_CALIBRATION_FORMAT,
  type CalibrationGameV1,
  type CalibrationGameV2,
  type CalibratorProfile,
  type RankCalibrationExportV1,
  type RankCalibrationExportV2,
} from './rankTypes'
import { applyMove } from '../core/board'
import { formatFen, parseFen, START_FEN } from '../core/fen'
import { parseUciMove } from '../core/notation'
import type { PvLine } from '../engine/engineClient'
import {
  assertRankCalibrationTextSize,
  buildCalibrationGameV2,
  buildRankCalibrationExportV2,
  inspectRankCalibrationExport,
  normalizeCalibrationGame,
  normalizeRankCalibrationExport,
  parseRankCalibrationExport,
  planRankCalibrationMerge,
  serializeRankCalibrationExport,
} from './rankArchive'

const NOW = 1_750_000_000_000

const profile = (id = 'profile-1'): CalibratorProfile => ({
  id,
  revision: 1,
  alias: '測試棋友',
  claimedRank: '3段',
  rankSystem: '棋友自評',
  consentedAt: NOW,
  createdAt: NOW,
  notes: '本機測試資料',
})

const cloneLegacyAnchors = () =>
  RANK_ANCHORS.map((anchor) => ({ ...anchor, engineConfig: { ...anchor.engineConfig } }))

const clonePhase2Anchors = () =>
  PHASE2_ANCHORS.map((anchor) => ({
    ...anchor,
    engine: { ...anchor.engine },
    search: { ...anchor.search },
    policy: { ...anchor.policy },
  }))

const legacyGame = (owner = profile()): CalibrationGameV1 => ({
  id: 'legacy-game-1',
  schemaVersion: 1,
  profileId: owner.id,
  profileRevision: owner.revision,
  anchorId: 'A01',
  anchorConfigVersion: RANK_ANCHORS[0].configVersion,
  movePolicyVersion: RANK_ANCHORS[0].movePolicyVersion,
  randomSeed: 'legacy-seed',
  playerSide: 'red',
  result: 'draw',
  startedAt: NOW + 10,
  endedAt: NOW + 20,
  gameSnapshot: { id: 'legacy-root', move: null, fenAfter: START_FEN, children: [] },
  appVersion: '0.3.0',
  engineVersion: 'legacy-engine',
})

const legacyArchive = (): RankCalibrationExportV1 => {
  const owner = profile()
  return {
    format: RANK_CALIBRATION_FORMAT,
    schemaVersion: RANK_CALIBRATION_EXPORT_SCHEMA_V1,
    exportedAt: NOW + 100,
    appVersion: '0.5.0',
    anchorSetVersion: ANCHOR_SET_VERSION,
    anchors: cloneLegacyAnchors(),
    profiles: [owner],
    games: [legacyGame(owner)],
  }
}

const candidateLines = (): PvLine[] => [
  { multipv: 1, depth: 18, scoreCp: 120, pv: ['a1a2'] },
  { multipv: 2, depth: 18, scoreCp: 80, pv: ['c4c5'] },
  { multipv: 3, depth: 18, scoreCp: 20, pv: ['e4e5'] },
]

const v2Game = (owner = profile(), anchor: Phase2AnchorProtocolV1 = PHASE2_ANCHORS[4]): CalibrationGameV2 => {
  const lines = candidateLines()
  const anomalies = ['incomplete-multipv-batch:3/8']
  const decision = selectHumanMoveV1({
    lines,
    bestmove: 'a1a2',
    fen: START_FEN,
    gameSeed: 'v2-seed-1',
    ply: 1,
    policy: anchor.policy,
    anomalies,
  })
  const move = parseUciMove(decision.selectedUci)!
  const fenAfter = formatFen(applyMove(parseFen(START_FEN), move))
  const startedAt = NOW + 200
  const updatedAt = NOW + 400
  return {
    id: 'v2-game-1',
    schemaVersion: 2,
    sessionId: 'session-1',
    collectionProtocolVersion: 'pin-gated-local-match-v1',
    profileId: owner.id,
    profileRevision: owner.revision,
    profileSnapshot: { ...owner },
    anchorId: anchor.id,
    anchorConfigVersion: anchor.configVersion,
    movePolicyVersion: anchor.policy.version,
    anchorSnapshot: JSON.parse(JSON.stringify(anchor)) as Phase2AnchorProtocolV1,
    randomSeed: 'v2-seed-1',
    playerSide: 'black',
    sideAssignment: { version: 'balanced-alternation-v1', sequenceIndex: 1 },
    status: 'completed',
    result: 'red',
    resultReason: '測試完成',
    startedAt,
    updatedAt,
    endedAt: updatedAt,
    initialFen: START_FEN,
    currentPly: 1,
    gameSnapshot: {
      id: 'v2-root',
      move: null,
      fenAfter: START_FEN,
      children: [{ id: 'v2-ply-1', move, fenAfter, children: [] }],
    },
    engineMoves: [{
      schemaVersion: 1,
      ply: 1,
      fenBefore: START_FEN,
      selectedUci: decision.selectedUci,
      playedAt: NOW + 300,
      analysis: {
        nodes: anchor.search.nodes,
        multipv: anchor.search.multipv,
        lines,
        bestmove: 'a1a2',
        completedDepth: 18,
        completeCandidateBatch: false,
        anomalies,
      },
      decision,
    }],
    appVersion: '0.6.0',
  }
}

const v2Archive = (): RankCalibrationExportV2 => {
  const owner = profile()
  return {
    format: RANK_CALIBRATION_FORMAT,
    schemaVersion: 2,
    exportedAt: NOW + 500,
    appVersion: '0.6.0',
    anchorSetVersion: ANCHOR_SET_VERSION,
    anchors: cloneLegacyAnchors(),
    phase2ConfigVersion: PHASE2_CONFIG_VERSION,
    phase2Anchors: clonePhase2Anchors(),
    profiles: [owner],
    games: [legacyGame(owner), v2Game(owner)],
  }
}

const mutable = <T>(value: T): any => JSON.parse(JSON.stringify(value))

describe('段級 archive v1/v2 共用 validator', () => {
  it('保留 v1 exact reader 與 historical game 語意', () => {
    const parsed = parseRankCalibrationExport(JSON.stringify(legacyArchive()))
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.games).toHaveLength(1)
    expect(parsed.games[0]).toMatchObject({
      schemaVersion: 1,
      anchorConfigVersion: RANK_ANCHORS[0].configVersion,
      movePolicyVersion: RANK_ANCHORS[0].movePolicyVersion,
    })

    const extra = mutable(legacyArchive())
    extra.pinVerifier = 'never-allowed'
    expect(() => normalizeRankCalibrationExport(extra)).toThrow(/pinVerifier：不支援的欄位/)
    expect(() => normalizeRankCalibrationExport({ ...legacyArchive(), schemaVersion: 99 })).toThrow(/較新/)

    const unknownRegistry = mutable(legacyArchive())
    unknownRegistry.anchorSetVersion = 'unknown-legacy-registry'
    expect(() => normalizeRankCalibrationExport(unknownRegistry)).toThrow(/不支援的 legacy 錨點版本/)

    const tamperedRegistry = mutable(legacyArchive())
    tamperedRegistry.anchors[0].engineConfig.skillLevel += 1
    expect(() => normalizeRankCalibrationExport(tamperedRegistry)).toThrow(/frozen snapshot/)
  })

  it('v2 可 round-trip 混合 v1/v2 games，inspect 分列狀態', () => {
    const text = serializeRankCalibrationExport(v2Archive())
    expect(parseRankCalibrationExport(text)).toEqual(normalizeRankCalibrationExport(v2Archive()))
    expect(inspectRankCalibrationExport(text)).toEqual({
      schemaVersion: 2,
      exportedAt: NOW + 500,
      appVersion: '0.6.0',
      profileCount: 1,
      legacyGameCount: 1,
      v2GameCount: 1,
      completedCount: 1,
      abortedCount: 0,
      inProgressCount: 0,
    })
  })

  it('build helpers 會走同一套 exact normalizer', () => {
    const game = v2Game()
    const gameInput = mutable(game)
    delete gameInput.schemaVersion
    const builtGame = buildCalibrationGameV2(gameInput as Omit<CalibrationGameV2, 'schemaVersion'>)
    expect(builtGame).toEqual(normalizeCalibrationGame(game))

    const archive = v2Archive()
    const builtArchive = buildRankCalibrationExportV2((({ format: _format, schemaVersion: _schema, ...rest }) => rest)(archive))
    expect(builtArchive).toEqual(normalizeRankCalibrationExport(archive))
  })

  it('使用 UTF-8 bytes 執行共用 50 MiB 邊界', () => {
    expect(assertRankCalibrationTextSize('象棋', 6)).toBe(6)
    expect(() => assertRankCalibrationTextSize('象棋', 5)).toThrow(/目前 6 bytes/)
  })

  it('拒絕 duplicate ID、壞 reference 與 game future schema', () => {
    const duplicateProfile = mutable(v2Archive())
    duplicateProfile.profiles.push(duplicateProfile.profiles[0])
    expect(() => normalizeRankCalibrationExport(duplicateProfile)).toThrow(/協助者 ID 重複/)

    const duplicateGame = mutable(v2Archive())
    duplicateGame.games.push(duplicateGame.games[0])
    expect(() => normalizeRankCalibrationExport(duplicateGame)).toThrow(/校準對局 ID 重複/)

    const duplicateAssignment = mutable(v2Archive())
    const secondV2 = mutable(duplicateAssignment.games[1])
    secondV2.id = 'v2-game-duplicate-assignment'
    secondV2.gameSnapshot.id = 'v2-root-duplicate-assignment'
    secondV2.gameSnapshot.children[0].id = 'v2-ply-duplicate-assignment'
    duplicateAssignment.games.push(secondV2)
    expect(() => normalizeRankCalibrationExport(duplicateAssignment)).toThrow(/分派序號重複/)

    const missingProfile = mutable(v2Archive())
    missingProfile.games[1].profileId = 'missing'
    missingProfile.games[1].profileSnapshot.id = 'missing'
    expect(() => normalizeRankCalibrationExport(missingProfile)).toThrow(/找不到對應協助者/)

    const legacyAnchorLink = mutable(v2Archive())
    legacyAnchorLink.games[0].anchorConfigVersion = 'tampered-legacy-config'
    expect(() => normalizeRankCalibrationExport(legacyAnchorLink)).toThrow(/legacy 錨點 snapshot 不一致/)

    const futureGame = mutable(v2Archive())
    futureGame.games[1].schemaVersion = 3
    expect(() => normalizeRankCalibrationExport(futureGame)).toThrow(/game schema 3 較新/)
  })

  it('拒絕未知 protocol／asset 與 profile/anchor snapshot linkage tamper', () => {
    const asset = mutable(v2Archive())
    asset.phase2Anchors[4].engine.wasmSha256 = '0'.repeat(64)
    expect(() => normalizeRankCalibrationExport(asset)).toThrow(/不支援的 Phase 2 protocol/)

    const profileLink = mutable(v2Archive())
    profileLink.games[1].profileRevision = 2
    expect(() => normalizeRankCalibrationExport(profileLink)).toThrow(/profileSnapshot.revision 不一致/)

    const anchorLink = mutable(v2Archive())
    anchorLink.games[1].anchorConfigVersion = 'tampered'
    expect(() => normalizeRankCalibrationExport(anchorLink)).toThrow(/anchorSnapshot 不一致/)

    const collection = mutable(v2Archive())
    collection.games[1].collectionProtocolVersion = 'unknown-controller'
    expect(() => normalizeRankCalibrationExport(collection)).toThrow(/collectionProtocolVersion/)
  })

  it('拒絕 status、linear tree、ply、FEN、selectedUci 與 decision tamper', () => {
    const status = mutable(v2Archive())
    status.games[1].status = 'in-progress'
    expect(() => normalizeRankCalibrationExport(status)).toThrow(/in-progress 不可包含/)

    const sideAssignment = mutable(v2Archive())
    sideAssignment.games[1].sideAssignment.sequenceIndex = 0
    expect(() => normalizeRankCalibrationExport(sideAssignment)).toThrow(/序號不一致/)

    const branch = mutable(v2Archive())
    branch.games[1].gameSnapshot.children.push({
      id: 'branch',
      move: { from: 2, to: 20 },
      fenAfter: formatFen(applyMove(parseFen(START_FEN), { from: 2, to: 20 })),
      children: [],
    })
    expect(() => normalizeRankCalibrationExport(branch)).toThrow(/必須是線性棋譜/)

    const currentPly = mutable(v2Archive())
    currentPly.games[1].currentPly = 2
    expect(() => normalizeRankCalibrationExport(currentPly)).toThrow(/必須等於線性棋譜著數/)

    const fen = mutable(v2Archive())
    fen.games[1].engineMoves[0].fenBefore = fen.games[1].gameSnapshot.children[0].fenAfter
    expect(() => normalizeRankCalibrationExport(fen)).toThrow(/無法重播|局面不一致/)

    const fenMetadata = mutable(v2Archive())
    fenMetadata.games[1].engineMoves[0].fenBefore = START_FEN.replace(/ 1$/, ' 2')
    const changedDecision = selectHumanMoveV1({
      lines: fenMetadata.games[1].engineMoves[0].analysis.lines,
      bestmove: fenMetadata.games[1].engineMoves[0].analysis.bestmove,
      fen: fenMetadata.games[1].engineMoves[0].fenBefore,
      gameSeed: fenMetadata.games[1].randomSeed,
      ply: 1,
      policy: fenMetadata.games[1].anchorSnapshot.policy,
      anomalies: fenMetadata.games[1].engineMoves[0].analysis.anomalies,
    })
    fenMetadata.games[1].engineMoves[0].decision = changedDecision
    fenMetadata.games[1].engineMoves[0].selectedUci = changedDecision.selectedUci
    expect(() => normalizeRankCalibrationExport(fenMetadata)).toThrow(/局面不一致/)

    const selected = mutable(v2Archive())
    selected.games[1].engineMoves[0].selectedUci = 'c4c5'
    expect(() => normalizeRankCalibrationExport(selected)).toThrow(/decision.selectedUci 不一致/)

    const decision = mutable(v2Archive())
    decision.games[1].engineMoves[0].decision.randomUint += 1
    expect(() => normalizeRankCalibrationExport(decision)).toThrow(/重播結果不一致/)

    const anomalies = mutable(v2Archive())
    anomalies.games[1].engineMoves[0].analysis.anomalies = []
    expect(() => normalizeRankCalibrationExport(anomalies)).toThrow(/batch／bestmove 狀態不一致/)
  })

  it('pure merge planner 可 add/skip，任一同 ID 異內容直接 conflict', () => {
    const incoming = normalizeRankCalibrationExport(v2Archive())
    const empty = planRankCalibrationMerge([], [], incoming)
    expect(empty).toMatchObject({ profilesSkipped: 0, gamesSkipped: 0 })
    expect(empty.profilesToAdd).toHaveLength(1)
    expect(empty.gamesToAdd).toHaveLength(2)

    const repeat = planRankCalibrationMerge(incoming.profiles, incoming.games, incoming)
    expect(repeat).toEqual({ profilesToAdd: [], gamesToAdd: [], profilesSkipped: 1, gamesSkipped: 2 })

    const conflictingProfile = mutable(incoming.profiles)
    conflictingProfile[0].alias = '不同內容'
    expect(() => planRankCalibrationMerge(conflictingProfile, [], incoming)).toThrow(/段級協助者識別.*內容不同/)

    const conflictingGame = mutable(incoming.games)
    conflictingGame[0].resultReason = '不同內容'
    expect(() => planRankCalibrationMerge(incoming.profiles, conflictingGame, incoming)).toThrow(/段級校準對局識別.*內容不同/)

    const localAssignmentConflict = mutable(incoming.games[1])
    localAssignmentConflict.id = 'local-assignment-conflict'
    localAssignmentConflict.gameSnapshot.id = 'local-assignment-root'
    localAssignmentConflict.gameSnapshot.children[0].id = 'local-assignment-ply'
    expect(() => planRankCalibrationMerge(incoming.profiles, [localAssignmentConflict], incoming)).toThrow(/分派序號衝突/)

    expect(() => planRankCalibrationMerge([], incoming.games, incoming)).toThrow(/找不到本機協助者/)
  })
})
