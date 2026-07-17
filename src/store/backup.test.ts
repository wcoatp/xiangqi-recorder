import { describe, expect, it } from 'vitest'
import { RANK_ANCHORS, ANCHOR_SET_VERSION } from '../calibration/anchors'
import { PHASE2_ANCHORS, PHASE2_CONFIG_VERSION } from '../calibration/phase2Protocol'
import {
  CALIBRATION_COLLECTION_PROTOCOL_V1,
  RANK_CALIBRATION_EXPORT_SCHEMA_V1,
  RANK_CALIBRATION_EXPORT_SCHEMA_V2,
  RANK_CALIBRATION_FORMAT,
  type CalibrationGameV1,
  type CalibrationGameV2,
  type CalibratorProfile,
  type RankCalibrationExport,
  type RankCalibrationExportV1,
  type RankCalibrationExportV2,
} from '../calibration/rankTypes'
import { applyMove } from '../core/board'
import { formatFen, parseFen, START_FEN } from '../core/fen'
import type { GameNode } from '../core/tree'
import { INK_CAP, PATCH, PATCH_RADIUS } from '../vision/patch'
import type { PieceTemplates } from '../vision/templates'
import type { GameRow } from './db'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  assertBackupTextSize,
  buildBackupFileV2,
  canonicalJson,
  decodePieceTemplates,
  encodePieceTemplates,
  inspectBackup,
  normalizeGameRecord,
  normalizePieceTemplates,
  parseBackup,
} from './backupSchema'

const now = 1_750_000_000_000

function gameRecord(): Omit<GameRow, 'id'> {
  const move = { from: 27, to: 36 }
  const variationMove = { from: 29, to: 38 }
  const root: GameNode = {
    id: 'root-1',
    move: null,
    fenAfter: START_FEN,
    comment: '開局',
    children: [
      {
        id: 'main-1',
        move,
        zh: '兵九進一',
        wxf: 'P9+1',
        fenAfter: formatFen(applyMove(parseFen(START_FEN), move)),
        tMs: 1200,
        comment: '主線',
        children: [],
      },
      {
        id: 'variation-1',
        move: variationMove,
        zh: '兵七進一',
        wxf: 'P7+1',
        fenAfter: formatFen(applyMove(parseFen(START_FEN), variationMove)),
        comment: '變化',
        children: [],
      },
    ],
  }
  return {
    redName: '紅方',
    blackName: '黑方',
    mode: 'record',
    startedAt: now,
    updatedAt: now + 1,
    result: '*',
    initialFen: START_FEN,
    tree: root,
    moveCount: 1,
    continuedFrom: {
      schemaVersion: 1,
      sourceGameIdAtCreation: 7,
      sourceRootId: 'old-root',
      sourceNodeId: 'old-node',
      sourcePly: 12,
      sourceStartedAt: now - 1000,
      sourceRedName: '甲',
      sourceBlackName: '乙',
      sourceFen: START_FEN,
      sourceNodeLabel: '第 12 著',
    },
    review: {
      plies: [{
        ply: 0,
        fen: START_FEN,
        scoreRed: 12,
        bestUci: 'a3a4',
        bestZh: '兵九進一',
        bestLineZh: ['兵九進一'],
        depth: 8,
      }, {
        ply: 1,
        fen: root.children[0].fenAfter,
        scoreRed: 14,
        bestUci: 'a6a5',
        bestZh: '卒１進１',
        bestLineZh: ['卒１進１'],
        depth: 8,
      }],
      judgments: [{
        nodeId: 'main-1',
        ply: 1,
        side: 'red',
        zh: '兵九進一',
        tag: 'best',
        loss: 0,
        scoreRedBefore: 12,
        scoreRedAfter: 14,
        bestZh: '兵九進一',
        bestLineZh: ['兵九進一'],
      }],
      counts: {
        red: { inacc: 0, mistake: 0, blunder: 0 },
        black: { inacc: 0, mistake: 0, blunder: 0 },
      },
      accuracy: { red: 100, black: 100 },
      movetimeMs: 500,
    },
    reviewedAt: now + 1,
  }
}

function rankProfile(): CalibratorProfile {
  return {
    id: 'profile-1',
    revision: 2,
    alias: '測試者',
    claimedRank: '3段',
    rankSystem: '棋友自評',
    consentedAt: now,
    createdAt: now,
    notes: '只存在本機',
  }
}

function legacyCalibrationGame(owner = rankProfile()): CalibrationGameV1 {
  const anchor = RANK_ANCHORS[0]
  return {
    id: 'cal-game-1',
    schemaVersion: 1,
    profileId: owner.id,
    profileRevision: 1,
    anchorId: anchor.id,
    anchorConfigVersion: anchor.configVersion,
    movePolicyVersion: anchor.movePolicyVersion,
    randomSeed: 'seed-1',
    playerSide: 'red',
    result: 'draw',
    startedAt: now,
    endedAt: now + 1000,
    gameSnapshot: { id: 'cal-root', move: null, fenAfter: START_FEN, children: [] },
    appVersion: '0.3.0',
    engineVersion: 'test-engine',
  }
}

function rankExportV1(): RankCalibrationExportV1 {
  const owner = rankProfile()
  return {
    format: RANK_CALIBRATION_FORMAT,
    schemaVersion: RANK_CALIBRATION_EXPORT_SCHEMA_V1,
    exportedAt: now,
    appVersion: '0.3.0',
    anchorSetVersion: ANCHOR_SET_VERSION,
    anchors: RANK_ANCHORS.map((anchor) => ({ ...anchor, engineConfig: { ...anchor.engineConfig } })),
    profiles: [owner],
    games: [legacyCalibrationGame(owner)],
  }
}

function calibrationGameV2(owner = rankProfile()): CalibrationGameV2 {
  const anchor = PHASE2_ANCHORS[4]
  return {
    id: 'v2-cal-game',
    schemaVersion: 2,
    sessionId: 'session-1',
    collectionProtocolVersion: CALIBRATION_COLLECTION_PROTOCOL_V1,
    profileId: owner.id,
    profileRevision: owner.revision,
    profileSnapshot: { ...owner },
    anchorId: anchor.id,
    anchorConfigVersion: anchor.configVersion,
    movePolicyVersion: anchor.policy.version,
    anchorSnapshot: structuredClone(anchor),
    randomSeed: 'v2-seed',
    playerSide: 'red',
    sideAssignment: { version: 'balanced-alternation-v1', sequenceIndex: 0 },
    status: 'in-progress',
    startedAt: now + 2_000,
    updatedAt: now + 2_000,
    initialFen: START_FEN,
    currentPly: 0,
    gameSnapshot: { id: 'v2-cal-root', move: null, fenAfter: START_FEN, children: [] },
    engineMoves: [],
    appVersion: '0.6.0',
  }
}

function rankExportV2(): RankCalibrationExportV2 {
  const owner = rankProfile()
  return {
    format: RANK_CALIBRATION_FORMAT,
    schemaVersion: RANK_CALIBRATION_EXPORT_SCHEMA_V2,
    exportedAt: now,
    appVersion: '0.6.0',
    anchorSetVersion: ANCHOR_SET_VERSION,
    anchors: RANK_ANCHORS.map((anchor) => ({ ...anchor, engineConfig: { ...anchor.engineConfig } })),
    phase2ConfigVersion: PHASE2_CONFIG_VERSION,
    phase2Anchors: PHASE2_ANCHORS.map((anchor) => ({
      ...anchor,
      engine: { ...anchor.engine },
      search: { ...anchor.search },
      policy: { ...anchor.policy },
    })),
    profiles: [owner],
    games: [legacyCalibrationGame(owner), calibrationGameV2(owner)],
  }
}

function pieceTemplates(): PieceTemplates {
  const types = ['K', 'A', 'A', 'B', 'B', 'N', 'N', 'R', 'R', 'C', 'C', 'P', 'P', 'P', 'P', 'P'] as const
  const make = (offset: number) => types.map((type, sampleIndex) => {
    const data = new Float32Array(PATCH * PATCH)
    for (let index = 0; index < data.length; index++) {
      data[index] = Math.fround(((index + sampleIndex + offset) % 257) / 256 * INK_CAP)
    }
    data[0] = -0
    return { type, data }
  })
  return {
    createdAt: now,
    patch: PATCH_RADIUS,
    samples: { red: make(0), black: make(17) },
  }
}

function v2File(
  pieceCalibration: PieceTemplates | null = null,
  rankCalibration: RankCalibrationExport = rankExportV2(),
) {
  return buildBackupFileV2({
    exportedAt: now,
    appVersion: '0.3.0',
    games: [gameRecord()],
    players: [{ name: '紅方', createdAt: now }],
    preferences: {
      voiceLang: 'zh-TW',
      ttsReadback: true,
      autoRelisten: false,
      analysisMovetimeMs: 1000,
      tabletop: true,
    },
    pieceCalibration,
    rankCalibration,
  })
}

describe('backup schema v1/v2', () => {
  it('uses the same UTF-8 byte limit for exporter and importer', () => {
    expect(assertBackupTextSize('象棋', 6)).toBe(6)
    expect(() => assertBackupTextSize('象棋', 5)).toThrow(/目前 6 bytes/)
  })

  it('normalizes v1 games-only backups and derives the player roster', () => {
    const record = gameRecord()
    const parsed = parseBackup(JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: now,
      games: [record],
    }))
    expect(parsed.version).toBe(1)
    expect(parsed.games[0].stableId).toBe('root-1')
    expect(parsed.players.map((player) => player.name)).toEqual(['紅方', '黑方'])
    expect(parsed.preferences).toBeNull()
    expect(parsed.pieceCalibration).toBeNull()
    expect(parsed.rankCalibration).toBeNull()
    expect(inspectBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: now, games: [record] })))
      .toMatchObject({ version: 1, gameCount: 1, playerCount: 2, isLegacyV1: true })
  })

  it('keeps legacy v1 games usable while omitting only a stale derived review', () => {
    const stale = gameRecord()
    stale.review!.plies.pop()
    const parsed = parseBackup(JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: now,
      games: [stale],
    }))
    expect(parsed.omittedStaleReviewCount).toBe(1)
    expect(parsed.games[0].record).not.toHaveProperty('review')
    expect(parsed.games[0].record).not.toHaveProperty('reviewedAt')
    expect(parsed.games[0].record.tree).toEqual(stale.tree)
  })

  it('outer backup v2 keeps the nested rank schema v1 reader', () => {
    const file = v2File(null, rankExportV1())
    const parsed = parseBackup(JSON.stringify(file))
    expect(parsed.version).toBe(2)
    expect(parsed.rankCalibration).toMatchObject({
      schemaVersion: 1,
      appVersion: '0.3.0',
    })
    expect(parsed.rankCalibration?.games).toHaveLength(1)
    expect(parsed.rankCalibration?.games[0]).toMatchObject({
      schemaVersion: 1,
      anchorConfigVersion: RANK_ANCHORS[0].configVersion,
    })
  })

  it('builds and parses outer v2 with nested rank v2 mixed games', () => {
    const file = v2File()
    const parsed = parseBackup(JSON.stringify(file))
    expect(file.version).toBe(BACKUP_VERSION)
    expect(parsed.games[0].record.tree.children.map((node) => node.id)).toEqual(['main-1', 'variation-1'])
    expect(parsed.games[0].record.continuedFrom?.sourceNodeLabel).toBe('第 12 著')
    expect(parsed.games[0].record.review?.judgments[0].tag).toBe('best')
    expect(parsed.players.map((player) => player.name)).toEqual(['紅方', '黑方'])
    expect(parsed.rankCalibration?.schemaVersion).toBe(2)
    expect(parsed.rankCalibration?.games.map((game) => game.schemaVersion)).toEqual([1, 2])
    expect(parsed.rankCalibration?.games[0].anchorConfigVersion).toBe(RANK_ANCHORS[0].configVersion)
    expect(inspectBackup(JSON.stringify(file))).toMatchObject({
      version: 2,
      appVersion: '0.3.0',
      gameCount: 1,
      playerCount: 2,
      profileCount: 1,
      calibrationGameCount: 2,
      hasPreferences: true,
      isLegacyV1: false,
    })
    expect(canonicalJson(normalizeGameRecord(parsed.games[0].record)))
      .toBe(canonicalJson(normalizeGameRecord(gameRecord())))
  })

  it('rejects future, corrupt and unknown fields with a useful path', () => {
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 3 }))).toThrow(/backup\.version/)
    const badStable = v2File() as unknown as Record<string, unknown>
    ;((badStable.games as Array<Record<string, unknown>>)[0]).stableId = 'wrong'
    expect(() => parseBackup(JSON.stringify(badStable))).toThrow(/backup\.games\[0\]\.stableId/)

    const badFen = structuredClone(v2File()) as unknown as Record<string, unknown>
    const child = ((((badFen.games as Array<Record<string, unknown>>)[0].record as Record<string, unknown>).tree as Record<string, unknown>).children as Array<Record<string, unknown>>)[0]
    child.fenAfter = START_FEN
    expect(() => parseBackup(JSON.stringify(badFen))).toThrow(/fenAfter/)

    const unknown = v2File() as unknown as Record<string, unknown>
    unknown.llmToken = 'must-never-import'
    expect(() => parseBackup(JSON.stringify(unknown))).toThrow(/backup\.llmToken/)
  })

  it('rejects a wrong mainline count and an own-side capture', () => {
    const wrongCount = gameRecord()
    wrongCount.moveCount = 0
    expect(() => normalizeGameRecord(wrongCount)).toThrow(/moveCount/)

    const ownCapture = gameRecord()
    ownCapture.tree.children[0].move = { from: 27, to: 29 }
    ownCapture.tree.children[0].fenAfter = formatFen(applyMove(parseFen(START_FEN), { from: 27, to: 29 }))
    expect(() => normalizeGameRecord(ownCapture)).toThrow(/己方棋子/)

    const backwardPawn = gameRecord()
    backwardPawn.tree.children[0].move = { from: 27, to: 18 }
    backwardPawn.tree.children[0].fenAfter = formatFen(applyMove(parseFen(START_FEN), { from: 27, to: 18 }))
    expect(() => normalizeGameRecord(backwardPawn)).toThrow(/合法著法/)
  })

  it('rejects review records that no longer correspond to the mainline', () => {
    const wrongPlyFen = gameRecord()
    wrongPlyFen.review!.plies[1].fen = START_FEN
    expect(() => normalizeGameRecord(wrongPlyFen)).toThrow(/同一 ply 的局面不一致/)

    const wrongNode = gameRecord()
    wrongNode.review!.judgments[0].nodeId = 'not-on-mainline'
    expect(() => normalizeGameRecord(wrongNode)).toThrow(/與主線節點不一致/)

    const wrongCounts = gameRecord()
    wrongCounts.review!.judgments[0].tag = 'blunder'
    expect(() => normalizeGameRecord(wrongCounts)).toThrow(/逐著標記統計不一致/)
  })

  it('does not expose secret fields in the v2 type or serialized output', () => {
    const file = v2File()
    expect(JSON.stringify(file)).not.toMatch(/llmToken|rankCalibrationGate|pinSalt|pinVerifier|autoLockMinutes/)
    expect(Object.keys(file.preferences)).toEqual([
      'schemaVersion', 'voiceLang', 'ttsReadback', 'autoRelisten', 'analysisMovetimeMs', 'tabletop',
    ])
  })
})

describe('piece template float32-le-base64 codec', () => {
  it('preserves every float32 bit and reconstructs real Float32Array values', () => {
    const source = pieceTemplates()
    const encoded = encodePieceTemplates(source)
    const decoded = decodePieceTemplates(encoded)
    expect(decoded.samples.red[0].data).toBeInstanceOf(Float32Array)
    const before = new Uint32Array(source.samples.red[0].data.buffer)
    const after = new Uint32Array(decoded.samples.red[0].data.buffer)
    expect([...after]).toEqual([...before])
  })

  it('rejects wrong byte length, NaN and the wrong per-side histogram', () => {
    const encoded = encodePieceTemplates(pieceTemplates())
    encoded.samples.red[0].data = 'AAAA'
    expect(() => decodePieceTemplates(encoded)).toThrow(/9216 bytes/)

    const withNaN = pieceTemplates()
    withNaN.samples.red[0].data[10] = Number.NaN
    expect(() => normalizePieceTemplates(withNaN)).toThrow(/有限數字/)

    const wrongHistogram = pieceTemplates()
    wrongHistogram.samples.black[0].type = 'P'
    expect(() => normalizePieceTemplates(wrongHistogram)).toThrow(/K 範本數/)
  })
})
