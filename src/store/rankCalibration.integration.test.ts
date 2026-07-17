import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANCHOR_SET_VERSION, RANK_ANCHORS } from '../calibration/anchors'
import { PHASE2_ANCHORS } from '../calibration/phase2Protocol'
import { setCalibrationPin, verifyCalibrationPin } from '../calibration/pin'
import {
  CALIBRATION_COLLECTION_PROTOCOL_V1,
  RANK_CALIBRATION_FORMAT,
  type CalibrationGameV1,
  type CalibrationGameV2,
  type CalibratorProfile,
  type RankCalibrationExportV1,
} from '../calibration/rankTypes'
import { START_FEN } from '../core/fen'
import { newRoot } from '../core/tree'
import { db } from './db'
import {
  buildRankCalibrationExport,
  defaultRankCalibrationGate,
  importRankCalibration,
  inspectRankCalibrationImport,
  listCalibrationGames,
  listCalibratorProfiles,
  loadRankCalibrationGate,
  saveRankCalibrationGate,
} from './rankCalibration'

describe.sequential('段級校準獨立匯入 transaction', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await resetDatabase()
    db.close()
  })

  it('schema v1 可先預覽再匯入，重複匯入只略過', async () => {
    const profile = makeProfile('profile-v1')
    const text = JSON.stringify(makeV1Archive(profile, makeGame(profile, 'game-v1')))

    expect(inspectRankCalibrationImport(text)).toMatchObject({
      schemaVersion: 1,
      profileCount: 1,
      legacyGameCount: 1,
      v2GameCount: 0,
    })
    expect(await db.rankCalibrators.count()).toBe(0)
    expect(await db.rankCalibrationGames.count()).toBe(0)

    await expect(importRankCalibration(text)).resolves.toEqual({
      sourceVersion: 1,
      profiles: { added: 1, skipped: 0 },
      games: { added: 1, skipped: 0 },
    })
    await expect(importRankCalibration(text)).resolves.toEqual({
      sourceVersion: 1,
      profiles: { added: 0, skipped: 1 },
      games: { added: 0, skipped: 1 },
    })
    expect(await db.rankCalibrators.toArray()).toEqual([profile])
    expect(await db.rankCalibrationGames.count()).toBe(1)
  })

  it('schema v2 mixed games 可 round-trip，預覽與重複匯入保持一致', async () => {
    const profile = makeProfile('profile-v2')
    const text = makeV2ArchiveText(profile, 'mixed')

    expect(inspectRankCalibrationImport(text)).toMatchObject({
      schemaVersion: 2,
      profileCount: 1,
      legacyGameCount: 1,
      v2GameCount: 1,
      inProgressCount: 1,
    })
    await expect(importRankCalibration(text)).resolves.toEqual({
      sourceVersion: 2,
      profiles: { added: 1, skipped: 0 },
      games: { added: 2, skipped: 0 },
    })
    expect((await listCalibrationGames()).map((game) => game.schemaVersion)).toEqual([1, 2])
    await expect(importRankCalibration(text)).resolves.toEqual({
      sourceVersion: 2,
      profiles: { added: 0, skipped: 1 },
      games: { added: 0, skipped: 2 },
    })
  })

  it('可合併到非空本機資料，不會覆寫既有列', async () => {
    const local = makeProfile('profile-local')
    const incoming = makeProfile('profile-incoming')
    await db.rankCalibrators.add(local)

    const result = await importRankCalibration(
      JSON.stringify(makeV1Archive(incoming, makeGame(incoming, 'game-incoming'))),
    )

    expect(result.profiles).toEqual({ added: 1, skipped: 0 })
    expect(result.games).toEqual({ added: 1, skipped: 0 })
    expect((await db.rankCalibrators.toArray()).map((entry) => entry.id).sort()).toEqual([
      'profile-incoming',
      'profile-local',
    ])
  })

  it('同 ID 異內容時在第一筆 write 前拒絕整份匯入', async () => {
    const incoming = makeProfile('profile-conflict')
    const local = { ...incoming, alias: '本機不同內容' }
    await db.rankCalibrators.add(local)
    const text = JSON.stringify(makeV1Archive(incoming, makeGame(incoming, 'game-must-not-write')))

    await expect(importRankCalibration(text)).rejects.toThrow(/profile-conflict|內容不同/)
    expect(await db.rankCalibrators.toArray()).toEqual([local])
    expect(await db.rankCalibrationGames.count()).toBe(0)
  })

  it('第二張表強制失敗時第一張表也會 rollback', async () => {
    const profile = makeProfile('profile-rollback')
    const text = makeV2ArchiveText(profile, 'rollback')
    const failure = vi
      .spyOn(db.rankCalibrationGames, 'bulkAdd')
      .mockRejectedValueOnce(new Error('FORCED_SECOND_TABLE_FAILURE'))

    await expect(importRankCalibration(text)).rejects.toThrow('FORCED_SECOND_TABLE_FAILURE')
    failure.mockRestore()

    expect(await db.rankCalibrators.count()).toBe(0)
    expect(await db.rankCalibrationGames.count()).toBe(0)
  })

  it('standalone v2 同 game ID 異內容時不寫入同檔的其他棋局', async () => {
    const profile = makeProfile('profile-v2-conflict')
    const incoming = makeGameV2(profile, 'game-v2-conflict')
    const local = { ...structuredClone(incoming), updatedAt: incoming.updatedAt + 1 }
    await db.rankCalibrators.add(profile)
    await db.rankCalibrationGames.add(local)
    const text = JSON.stringify(buildRankCalibrationExport(
      [profile],
      [makeGame(profile, 'legacy-must-not-write'), incoming],
      2_000,
      '0.6.0',
    ))

    await expect(importRankCalibration(text)).rejects.toThrow(/game-v2-conflict|內容不同/)
    expect(await db.rankCalibrationGames.toArray()).toEqual([local])
  })

  it('統計讀取前會拒絕未通過 v2 normalizer 的本機列', async () => {
    const profile = makeProfile('profile-corrupt-local')
    const corrupt = {
      ...makeGameV2(profile, 'corrupt-local'),
      collectionProtocolVersion: 'unknown-controller',
    }
    await db.rankCalibrationGames.add(corrupt as unknown as CalibrationGameV2)

    await expect(listCalibrationGames()).rejects.toThrow(/collectionProtocolVersion/)
  })

  it('UI 讀取前也會拒絕未通過 normalizer 的本機 profile', async () => {
    const corrupt = { ...makeProfile('profile-corrupt'), claimedRank: '西洋 Elo 1800' }
    await db.rankCalibrators.add(corrupt as unknown as CalibratorProfile)

    await expect(listCalibratorProfiles()).rejects.toThrow(/claimedRank/)
  })

  it('archive/game 升版不會改寫既有 gate v1 或 PIN verifier', async () => {
    const gate = await setCalibrationPin({ ...defaultRankCalibrationGate(), enabled: true }, '2468')
    await saveRankCalibrationGate(gate)
    const profile = makeProfile('profile-gate')

    await importRankCalibration(JSON.stringify(makeV1Archive(profile, makeGame(profile, 'game-gate'))))

    const after = await loadRankCalibrationGate()
    expect(after.schemaVersion).toBe(1)
    expect(after.pinSalt).toBe(gate.pinSalt)
    expect(after.pinVerifier).toBe(gate.pinVerifier)
    await expect(verifyCalibrationPin(after, '2468')).resolves.toBe(true)
    await expect(verifyCalibrationPin(after, '0000')).resolves.toBe(false)
  })
})

async function resetDatabase() {
  db.close()
  await db.delete()
  await db.open()
}

function makeProfile(id: string): CalibratorProfile {
  return {
    id,
    revision: 1,
    alias: `協助者-${id}`.slice(0, 32),
    claimedRank: '3段',
    rankSystem: '棋友自評',
    consentedAt: 1_000,
    createdAt: 1_000,
  }
}

function makeGame(profile: CalibratorProfile, id: string): CalibrationGameV1 {
  const anchor = RANK_ANCHORS[0]
  const gameSnapshot = newRoot(START_FEN)
  gameSnapshot.id = `${id}-root`
  return {
    id,
    schemaVersion: 1,
    profileId: profile.id,
    profileRevision: profile.revision,
    anchorId: anchor.id,
    anchorConfigVersion: anchor.configVersion,
    movePolicyVersion: anchor.movePolicyVersion,
    randomSeed: `seed-${id}`,
    playerSide: 'red',
    result: 'aborted',
    resultReason: '測試中止',
    startedAt: 1_100,
    endedAt: 1_200,
    gameSnapshot,
    appVersion: '0.5.0',
    engineVersion: 'legacy-test-engine',
  }
}

function makeV1Archive(profile: CalibratorProfile, game: CalibrationGameV1): RankCalibrationExportV1 {
  return {
    format: RANK_CALIBRATION_FORMAT,
    schemaVersion: 1,
    exportedAt: 2_000,
    appVersion: '0.5.0',
    anchorSetVersion: ANCHOR_SET_VERSION,
    anchors: RANK_ANCHORS.map((anchor) => ({
      ...anchor,
      engineConfig: { ...anchor.engineConfig },
    })),
    profiles: [profile],
    games: [game],
  }
}

function makeGameV2(profile: CalibratorProfile, id: string): CalibrationGameV2 {
  const anchor = PHASE2_ANCHORS[4]
  const gameSnapshot = newRoot(START_FEN)
  gameSnapshot.id = `${id}-root`
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
    startedAt: 1_300,
    updatedAt: 1_300,
    initialFen: START_FEN,
    currentPly: 0,
    gameSnapshot,
    engineMoves: [],
    appVersion: '0.6.0',
  }
}

function makeV2ArchiveText(profile: CalibratorProfile, suffix: string): string {
  return JSON.stringify(buildRankCalibrationExport(
    [profile],
    [makeGame(profile, `legacy-${suffix}`), makeGameV2(profile, `v2-${suffix}`)],
    2_000,
    '0.6.0',
  ))
}
