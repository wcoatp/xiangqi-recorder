import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { RANK_ANCHORS } from '../calibration/anchors'
import { PHASE2_ANCHORS } from '../calibration/phase2Protocol'
import { setCalibrationPin } from '../calibration/pin'
import {
  CALIBRATION_COLLECTION_PROTOCOL_V1,
  type CalibrationGame,
  type CalibrationGameV2,
  type CalibratorProfile,
} from '../calibration/rankTypes'
import { parseFen, START_FEN } from '../core/fen'
import { legalMoves } from '../core/movegen'
import { addMove, newRoot, type GameNode } from '../core/tree'
import { PATCH, PATCH_RADIUS } from '../vision/patch'
import type { PieceTemplates } from '../vision/templates'
import { APP_VERSION } from '../version'
import { exportBackup, restoreBackup } from './backup'
import { db, type GameRow, type PlayerRow } from './db'
import { defaultRankCalibrationGate } from './rankCalibration'

const PIECE_TYPES = ['K', 'A', 'A', 'B', 'B', 'N', 'N', 'R', 'R', 'C', 'C', 'P', 'P', 'P', 'P', 'P'] as const
const SOURCE_PIN = '2468'
const DESTINATION_PIN = '1357'

describe.sequential('完整備份 Dexie transaction', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await resetDatabase()
    db.close()
  })

  it('v2 round trip 保留完整資料、排除 secrets，重複還原保持冪等', async () => {
    const source = makeCompleteFixture()
    await seedCompleteFixture(source)

    const exported = await exportBackup(SOURCE_PIN)
    expect(exported.summary.version).toBe(2)
    expect(exported.summary.gameCount).toBe(1)
    expect(exported.summary.profileCount).toBe(1)
    expect(exported.summary.calibrationGameCount).toBe(2)
    expect(exported.summary.hasPieceCalibration).toBe(true)
    const exportedPayload = JSON.parse(exported.json) as {
      rankCalibration: { schemaVersion: number; games: Array<{ schemaVersion: number }> }
    }
    expect(exportedPayload.rankCalibration.schemaVersion).toBe(2)
    expect(exportedPayload.rankCalibration.games.map((game) => game.schemaVersion)).toEqual([1, 2])
    expect(exported.json).not.toContain('llmToken')
    expect(exported.json).not.toContain('rankCalibrationGate')
    expect(exported.json).not.toContain('SOURCE_TOKEN_SENTINEL')
    expect(exported.json).not.toContain('pinSalt')
    expect(exported.json).not.toContain('pinVerifier')

    await resetDatabase()
    const destinationGate = await makeGate(DESTINATION_PIN)
    await db.settings.bulkPut([
      { key: 'llmToken', value: 'DESTINATION_TOKEN' },
      { key: 'rankCalibrationGate', value: destinationGate },
    ])

    const first = await restoreBackup(exported.json, DESTINATION_PIN)
    expect(first).toMatchObject({
      sourceVersion: 2,
      games: { added: 1, skipped: 0 },
      players: { added: 2, skipped: 0 },
      profiles: { added: 1, skipped: 0 },
      calibrationGames: { added: 2, skipped: 0 },
      preferencesRestored: true,
      pieceCalibration: 'restored',
    })
    expect(await db.settings.get('llmToken')).toEqual({ key: 'llmToken', value: 'DESTINATION_TOKEN' })
    expect(await db.settings.get('rankCalibrationGate')).toEqual({ key: 'rankCalibrationGate', value: destinationGate })
    expect((await db.settings.get('voiceLang'))?.value).toBe('zh-CN')
    expect((await db.settings.get('tabletop'))?.value).toBe(false)
    const restoredTemplates = (await db.settings.get('pieceCalibration'))?.value as PieceTemplates
    expect(restoredTemplates.samples.red[0].data).toBeInstanceOf(Float32Array)
    expect(restoredTemplates.samples.red[0].data).toEqual(source.templates.samples.red[0].data)
    expect((await db.games.toArray())[0].tree).toEqual(source.game.tree)

    db.close()
    await db.open()
    expect(((await db.settings.get('pieceCalibration'))?.value as PieceTemplates).samples.black[0].data).toBeInstanceOf(Float32Array)

    const second = await restoreBackup(exported.json, DESTINATION_PIN)
    expect(second.games).toEqual({ added: 0, skipped: 1 })
    expect(second.players).toEqual({ added: 0, skipped: 2 })
    expect(second.profiles).toEqual({ added: 0, skipped: 1 })
    expect(second.calibrationGames).toEqual({ added: 0, skipped: 2 })
    expect(second.pieceCalibration).toBe('skipped-same')
    expect(await db.games.count()).toBe(1)
  })

  it('outer schema v2 可還原 nested rank schema v1 並重複略過', async () => {
    const source = makeCompleteFixture()
    await seedCompleteFixture(source)
    const payload = JSON.parse((await exportBackup(SOURCE_PIN)).json) as any
    const rankV2 = payload.rankCalibration
    payload.rankCalibration = {
      format: rankV2.format,
      schemaVersion: 1,
      exportedAt: rankV2.exportedAt,
      appVersion: rankV2.appVersion,
      anchorSetVersion: rankV2.anchorSetVersion,
      anchors: rankV2.anchors,
      profiles: rankV2.profiles,
      games: rankV2.games.filter((game: { schemaVersion: number }) => game.schemaVersion === 1),
    }

    await resetDatabase()
    const destinationGate = await makeGate(DESTINATION_PIN)
    await db.settings.put({ key: 'rankCalibrationGate', value: destinationGate })
    const first = await restoreBackup(JSON.stringify(payload), DESTINATION_PIN)
    expect(first.profiles).toEqual({ added: 1, skipped: 0 })
    expect(first.calibrationGames).toEqual({ added: 1, skipped: 0 })
    expect((await db.rankCalibrationGames.toArray()).map((game) => game.schemaVersion)).toEqual([1])

    const repeat = await restoreBackup(JSON.stringify(payload), DESTINATION_PIN)
    expect(repeat.profiles).toEqual({ added: 0, skipped: 1 })
    expect(repeat.calibrationGames).toEqual({ added: 0, skipped: 1 })
    expect(await db.settings.get('rankCalibrationGate')).toEqual({ key: 'rankCalibrationGate', value: destinationGate })
  })

  it('v1 只合併棋局與姓名，不改設定、棋子或段級資料', async () => {
    const game = makeGame('legacy-root')
    const localTemplates = makePieceTemplates(7)
    const localProfile = makeProfile('local-profile')
    await db.settings.bulkPut([
      { key: 'voiceLang', value: 'zh-TW' },
      { key: 'llmToken', value: 'KEEP_TOKEN' },
      { key: 'pieceCalibration', value: localTemplates },
    ])
    await db.rankCalibrators.add(localProfile)

    const v1 = JSON.stringify({
      format: 'xiangqi-recorder-backup',
      version: 1,
      exportedAt: 123,
      games: [game],
    })
    const result = await restoreBackup(v1)

    expect(result.sourceVersion).toBe(1)
    expect(result.games).toEqual({ added: 1, skipped: 0 })
    expect(result.players).toEqual({ added: 2, skipped: 0 })
    expect(result.preferencesRestored).toBe(false)
    expect(result.pieceCalibration).toBe('not-in-backup')
    expect((await db.settings.get('voiceLang'))?.value).toBe('zh-TW')
    expect((await db.settings.get('llmToken'))?.value).toBe('KEEP_TOKEN')
    expect(((await db.settings.get('pieceCalibration'))?.value as PieceTemplates).createdAt).toBe(7)
    expect(await db.rankCalibrators.toArray()).toEqual([localProfile])
  })

  it('沒有棋局時仍可備份一般偏好與段級 profile', async () => {
    await db.settings.bulkPut([
      { key: 'tabletop', value: false },
      // 舊版或手動寫入的不支援值不能讓整份備份失敗，應回到目前支援的預設值。
      { key: 'analysisMovetimeMs', value: 1500 },
    ])
    await db.rankCalibrators.add(makeProfile('profile-without-games'))
    await db.settings.put({ key: 'rankCalibrationGate', value: await makeGate(SOURCE_PIN) })

    const exported = await exportBackup(SOURCE_PIN)
    expect(exported.summary.gameCount).toBe(0)
    expect(exported.summary.profileCount).toBe(1)
    expect(exported.summary.hasPreferences).toBe(true)
    expect(JSON.parse(exported.json)).toMatchObject({
      version: 2,
      games: [],
      preferences: { tabletop: false, analysisMovetimeMs: 1000 },
    })
  })

  it('既有主線已變更的舊分析不會卡住整份備份，且會明確計數', async () => {
    const source = makeCompleteFixture()
    const end = source.game.tree.children[0].children[0]
    addMove(end, legalMoves(parseFen(end.fenAfter))[0], 1_500)
    source.game.moveCount = 3
    await seedCompleteFixture(source)

    const exported = await exportBackup(SOURCE_PIN)
    const payload = JSON.parse(exported.json) as { games: Array<{ record: GameRow }> }
    expect(exported.summary.omittedStaleReviewCount).toBe(1)
    expect(payload.games[0].record).not.toHaveProperty('review')
    expect(payload.games[0].record).not.toHaveProperty('reviewedAt')
    expect((await db.games.toArray())[0].review).toBeDefined()

    const repeat = await restoreBackup(exported.json, SOURCE_PIN)
    expect(repeat.games).toEqual({ added: 0, skipped: 1 })
    expect((await db.games.toArray())[0].review).toBeDefined()
  })

  it('目的端已有不同棋子範本時保留本機版本並清楚回報', async () => {
    const source = makeCompleteFixture()
    await seedCompleteFixture(source)
    const json = (await exportBackup(SOURCE_PIN)).json
    await resetDatabase()

    const localTemplates = makePieceTemplates(9_999)
    await db.settings.bulkPut([
      { key: 'pieceCalibration', value: localTemplates },
      { key: 'rankCalibrationGate', value: await makeGate(DESTINATION_PIN) },
    ])
    const result = await restoreBackup(json, DESTINATION_PIN)

    expect(result.pieceCalibration).toBe('kept-local')
    const after = (await db.settings.get('pieceCalibration'))?.value as PieceTemplates
    expect(after.createdAt).toBe(9_999)
    expect(after.samples.red[0].data).toEqual(localTemplates.samples.red[0].data)
  })

  it('損壞的 v2 在 transaction 前拒絕且不碰目的端資料', async () => {
    const source = makeCompleteFixture()
    await seedCompleteFixture(source)
    const corrupt = JSON.parse((await exportBackup(SOURCE_PIN)).json) as {
      games: Array<{ stableId: string }>
    }
    corrupt.games[0].stableId = 'not-the-root-id'
    await resetDatabase()
    await db.settings.put({ key: 'llmToken', value: 'KEEP_AFTER_CORRUPT_IMPORT' })

    await expect(restoreBackup(JSON.stringify(corrupt))).rejects.toThrow(/stableId/)
    expect(await db.games.count()).toBe(0)
    expect(await db.players.count()).toBe(0)
    expect(await db.rankCalibrators.count()).toBe(0)
    expect(await db.settings.toArray()).toEqual([
      { key: 'llmToken', value: 'KEEP_AFTER_CORRUPT_IMPORT' },
    ])
  })

  it('同一棋局 stable ID 但內容不同時整包中止且不覆寫', async () => {
    const local = makeGame('conflict-root')
    const conflicting = { ...local, redName: '另一位紅方' }
    await db.games.add(local as GameRow)
    const v1 = JSON.stringify({
      format: 'xiangqi-recorder-backup',
      version: 1,
      exportedAt: 456,
      games: [conflicting],
    })

    await expect(restoreBackup(v1)).rejects.toThrow('內容不同')
    expect(await db.games.count()).toBe(1)
    expect((await db.games.toArray())[0].redName).toBe(local.redName)
    expect(await db.players.count()).toBe(0)
  })

  it('最後一張表寫入失敗時 games、players、settings、profiles 全部 rollback', async () => {
    const source = makeCompleteFixture()
    await seedCompleteFixture(source)
    const json = (await exportBackup(SOURCE_PIN)).json
    await resetDatabase()
    const destinationGate = await makeGate(DESTINATION_PIN)
    await db.settings.put({ key: 'rankCalibrationGate', value: destinationGate })

    const failure = vi
      .spyOn(db.rankCalibrationGames, 'bulkAdd')
      .mockRejectedValueOnce(new Error('FORCED_LATE_WRITE_FAILURE'))
    await expect(restoreBackup(json, DESTINATION_PIN)).rejects.toThrow('FORCED_LATE_WRITE_FAILURE')
    failure.mockRestore()

    expect(await db.games.count()).toBe(0)
    expect(await db.players.count()).toBe(0)
    expect(await db.settings.toArray()).toEqual([{ key: 'rankCalibrationGate', value: destinationGate }])
    expect(await db.rankCalibrators.count()).toBe(0)
    expect(await db.rankCalibrationGames.count()).toBe(0)
  })

  it('含段級資料時匯出與還原都必須驗證目前瀏覽器的 PIN', async () => {
    const source = makeCompleteFixture()
    await seedCompleteFixture(source)

    await expect(exportBackup()).rejects.toMatchObject({ name: 'RankBackupAccessError', code: 'pin-required' })
    await expect(exportBackup('0000')).rejects.toMatchObject({ name: 'RankBackupAccessError', code: 'pin-invalid' })
    const json = (await exportBackup(SOURCE_PIN)).json

    await resetDatabase()
    await db.settings.put({ key: 'rankCalibrationGate', value: await makeGate(DESTINATION_PIN) })
    await expect(restoreBackup(json)).rejects.toMatchObject({ name: 'RankBackupAccessError', code: 'pin-required' })
    await expect(restoreBackup(json, '0000')).rejects.toMatchObject({ name: 'RankBackupAccessError', code: 'pin-invalid' })
    expect(await db.games.count()).toBe(0)
    expect(await db.rankCalibrators.count()).toBe(0)
    await expect(restoreBackup(json, DESTINATION_PIN)).resolves.toMatchObject({
      games: { added: 1, skipped: 0 },
      profiles: { added: 1, skipped: 0 },
    })
  })

  it('rank conflict 在第一筆 write 前讓 games／players／preferences／piece／rank 兩表零變更', async () => {
    const source = makeCompleteFixture()
    await seedCompleteFixture(source)
    const json = (await exportBackup(SOURCE_PIN)).json
    await resetDatabase()
    const destinationGate = await makeGate(DESTINATION_PIN)
    const conflictingProfile = { ...source.profile, alias: '目的端不同內容' }
    const localTemplates = makePieceTemplates(8_888)
    await db.settings.bulkPut([
      { key: 'rankCalibrationGate', value: destinationGate },
      { key: 'voiceLang', value: 'zh-TW' },
      { key: 'tabletop', value: true },
      { key: 'pieceCalibration', value: localTemplates },
    ])
    await db.rankCalibrators.add(conflictingProfile)

    await expect(restoreBackup(json, DESTINATION_PIN)).rejects.toThrow(/段級協助者識別.*內容不同/)
    expect(await db.games.count()).toBe(0)
    expect(await db.players.count()).toBe(0)
    expect((await db.settings.get('voiceLang'))?.value).toBe('zh-TW')
    expect((await db.settings.get('tabletop'))?.value).toBe(true)
    expect((await db.settings.get('pieceCalibration'))?.value).toEqual(localTemplates)
    expect(await db.rankCalibrators.toArray()).toEqual([conflictingProfile])
    expect(await db.rankCalibrationGames.count()).toBe(0)
    expect(await db.settings.get('rankCalibrationGate')).toEqual({ key: 'rankCalibrationGate', value: destinationGate })
  })

  it('校準對局同 ID 異內容也由共用 planner 在所有 writes 前拒絕', async () => {
    const source = makeCompleteFixture()
    await seedCompleteFixture(source)
    const json = (await exportBackup(SOURCE_PIN)).json
    await resetDatabase()
    const destinationGate = await makeGate(DESTINATION_PIN)
    const conflictingGame = {
      ...structuredClone(source.calibrationGames[0]),
      resultReason: '目的端保留的不同中止原因',
    }
    await db.settings.bulkPut([
      { key: 'rankCalibrationGate', value: destinationGate },
      { key: 'voiceLang', value: 'zh-TW' },
    ])
    await db.rankCalibrators.add(source.profile)
    await db.rankCalibrationGames.add(conflictingGame)

    await expect(restoreBackup(json, DESTINATION_PIN)).rejects.toThrow(/段級校準對局識別.*內容不同/)
    expect(await db.games.count()).toBe(0)
    expect(await db.players.count()).toBe(0)
    expect((await db.settings.get('voiceLang'))?.value).toBe('zh-TW')
    expect(await db.rankCalibrators.toArray()).toEqual([source.profile])
    expect(await db.rankCalibrationGames.toArray()).toEqual([conflictingGame])
  })
})

async function resetDatabase() {
  db.close()
  await db.delete()
  await db.open()
}

function makeCompleteFixture() {
  const profile = makeProfile('profile-round-trip')
  const game = makeGame('round-trip-root')
  const calibrationGames = [
    makeCalibrationGame(profile, 'cal-game-round-trip'),
    makeCalibrationGameV2(profile, 'v2-cal-game-round-trip'),
  ]
  return { profile, game, calibrationGames, templates: makePieceTemplates(1_000) }
}

async function seedCompleteFixture(fixture: ReturnType<typeof makeCompleteFixture>) {
  const gate = await makeGate(SOURCE_PIN)
  await db.transaction(
    'rw',
    db.games,
    db.players,
    db.settings,
    db.rankCalibrators,
    db.rankCalibrationGames,
    async () => {
      await db.games.add(fixture.game as GameRow)
      await db.players.bulkAdd([
        { name: fixture.game.redName, createdAt: 900 },
        { name: fixture.game.blackName, createdAt: 901 },
      ] as PlayerRow[])
      await db.settings.bulkPut([
        { key: 'voiceLang', value: 'zh-CN' },
        { key: 'ttsReadback', value: false },
        { key: 'autoRelisten', value: true },
        { key: 'analysisMovetimeMs', value: 2000 },
        { key: 'tabletop', value: false },
        { key: 'llmToken', value: 'SOURCE_TOKEN_SENTINEL' },
        {
          key: 'rankCalibrationGate',
          value: gate,
        },
        { key: 'pieceCalibration', value: fixture.templates },
      ])
      await db.rankCalibrators.add(fixture.profile)
      await db.rankCalibrationGames.bulkAdd(fixture.calibrationGames)
    },
  )
}

async function makeGate(pin: string) {
  return setCalibrationPin({ ...defaultRankCalibrationGate(), enabled: true }, pin)
}

function makeGame(rootId: string): Omit<GameRow, 'id'> {
  const root = newRoot(START_FEN)
  root.id = rootId
  const first = addMove(root, { from: 27, to: 36 }, 500).node
  first.comment = '主線註解'
  const second = addMove(first, { from: 54, to: 45 }, 1200).node
  addMove(root, { from: 29, to: 38 }, 700).node.comment = '保留變著順序'
  return {
    redName: '測試紅方',
    blackName: '測試黑方',
    mode: 'record',
    startedAt: 1_000,
    updatedAt: 2_000,
    result: '*',
    initialFen: START_FEN,
    tree: root,
    moveCount: 2,
    continuedFrom: {
      schemaVersion: 1,
      sourceGameIdAtCreation: 42,
      sourceRootId: 'source-root',
      sourceNodeId: 'source-node',
      sourcePly: 3,
      sourceStartedAt: 500,
      sourceRedName: '來源紅',
      sourceBlackName: '來源黑',
      sourceFen: START_FEN,
      sourceNodeLabel: '第 3 著',
    },
    review: {
      plies: [
        { ply: 0, fen: root.fenAfter, scoreRed: 0, bestUci: 'a3a4', bestZh: '兵九進一', bestLineZh: [], depth: 8 },
        { ply: 1, fen: first.fenAfter, scoreRed: 10, bestUci: 'a6a5', bestZh: '卒１進１', bestLineZh: [], depth: 8 },
        { ply: 2, fen: second.fenAfter, scoreRed: 5, bestUci: '', bestZh: '', bestLineZh: [], depth: 8 },
      ],
      judgments: [
        {
          nodeId: first.id,
          ply: 1,
          side: 'red',
          zh: first.zh ?? '',
          tag: 'best',
          loss: 0,
          scoreRedBefore: 0,
          scoreRedAfter: 10,
          bestZh: '兵九進一',
          bestLineZh: [],
        },
        {
          nodeId: second.id,
          ply: 2,
          side: 'black',
          zh: second.zh ?? '',
          tag: 'best',
          loss: 0,
          scoreRedBefore: 10,
          scoreRedAfter: 5,
          bestZh: '卒１進１',
          bestLineZh: [],
        },
      ],
      counts: {
        red: { inacc: 0, mistake: 0, blunder: 0 },
        black: { inacc: 0, mistake: 0, blunder: 0 },
      },
      accuracy: { red: 100, black: 100 },
      movetimeMs: 500,
    },
    reviewedAt: 2_100,
  }
}

function makeProfile(id: string): CalibratorProfile {
  return {
    id,
    revision: 1,
    alias: '測試協助者',
    claimedRank: '3段',
    rankSystem: '棋友自評',
    consentedAt: 3_000,
    createdAt: 3_000,
    notes: '無個資測試資料',
  }
}

function makeCalibrationGame(profile: CalibratorProfile, id: string): CalibrationGame {
  const anchor = RANK_ANCHORS[0]
  const snapshot: GameNode = newRoot(START_FEN)
  snapshot.id = `${id}-root`
  return {
    id,
    schemaVersion: 1,
    profileId: profile.id,
    profileRevision: profile.revision,
    anchorId: anchor.id,
    anchorConfigVersion: anchor.configVersion,
    movePolicyVersion: anchor.movePolicyVersion,
    randomSeed: 'seed-008',
    playerSide: 'red',
    result: 'aborted',
    resultReason: '測試中止',
    startedAt: 3_100,
    endedAt: 3_200,
    gameSnapshot: snapshot,
    appVersion: APP_VERSION,
    engineVersion: 'test-engine',
  }
}

function makeCalibrationGameV2(profile: CalibratorProfile, id: string): CalibrationGameV2 {
  const anchor = PHASE2_ANCHORS[4]
  const snapshot = newRoot(START_FEN)
  snapshot.id = `${id}-root`
  return {
    id,
    schemaVersion: 2,
    sessionId: `${id}-session`,
    collectionProtocolVersion: CALIBRATION_COLLECTION_PROTOCOL_V1,
    profileId: profile.id,
    profileRevision: profile.revision,
    profileSnapshot: { ...profile },
    anchorId: anchor.id,
    anchorConfigVersion: anchor.configVersion,
    movePolicyVersion: anchor.policy.version,
    anchorSnapshot: structuredClone(anchor),
    randomSeed: `${id}-seed`,
    playerSide: 'red',
    sideAssignment: { version: 'balanced-alternation-v1', sequenceIndex: 0 },
    status: 'in-progress',
    startedAt: 3_300,
    updatedAt: 3_300,
    initialFen: START_FEN,
    currentPly: 0,
    gameSnapshot: snapshot,
    engineMoves: [],
    appVersion: APP_VERSION,
  }
}

function makePieceTemplates(createdAt: number): PieceTemplates {
  const side = (offset: number) =>
    PIECE_TYPES.map((type, index) => {
      const data = new Float32Array(PATCH * PATCH)
      data[(offset + index) % data.length] = (index + 1) / 8
      return { type, data }
    })
  return {
    createdAt,
    patch: PATCH_RADIUS,
    samples: { red: side(0), black: side(32) },
  }
}
