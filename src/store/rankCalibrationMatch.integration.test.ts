import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mainline } from '../core/tree'
import { parseFen } from '../core/fen'
import { legalMoves } from '../core/movegen'
import { uciMove } from '../core/notation'
import {
  abortCalibrationMatchDraft,
  calibrationMatchToken,
  createCalibrationMatchDraft,
} from '../calibration/matchController'
import { PHASE2_ANCHORS } from '../calibration/phase2Protocol'
import type {
  CalibrationAnalyzeSnapshotV1,
  CalibrationGameV2,
  CalibratorProfile,
} from '../calibration/rankTypes'
import { APP_VERSION } from '../version'
import { db } from './db'
import { exportRankCalibration, importRankCalibration } from './rankCalibration'
import {
  abortCalibrationMatch,
  CalibrationMatchConflictError,
  CalibrationMatchTerminalError,
  CalibrationMatchVersionError,
  commitCalibrationEngineMove,
  commitCalibrationHumanMove,
  completeCalibrationMatch,
  createCalibrationMatch,
  getCalibrationMatch,
  listCalibrationMatches,
  type CalibrationMatchStoreRuntime,
} from './rankCalibrationMatch'

describe.sequential('WP011 校準 match Dexie transactions', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await resetDatabase()
    db.close()
  })

  it('PIN 子樹取消建局時不保存 ply 0', async () => {
    const profile = makeProfile('profile-aborted-create')
    await db.rankCalibrators.add(profile)
    const controller = new AbortController()
    controller.abort()

    await expect(createCalibrationMatch(
      { ...baseInput(profile), signal: controller.signal },
      runtime('aborted-create'),
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(await listCalibrationMatches()).toEqual([])
  })

  it('建局先保存 ply 0，所有狀態以 max+1 占號且不同 anchor 各自計數', async () => {
    const profile = makeProfile('profile-sequence')
    await db.rankCalibrators.add(profile)

    const first = await createCalibrationMatch(baseInput(profile, 'A01'), runtime('first', 1_000))
    expect(first).toMatchObject({ status: 'in-progress', currentPly: 0, playerSide: 'red' })
    expect(await getCalibrationMatch(first.id)).toEqual(first)

    const stopped = await abortCalibrationMatch(
      calibrationMatchToken(first),
      'operator-aborted',
      runtime('stop-first', 1_000),
    )
    expect(stopped.updatedAt).toBe(1_001)

    const second = await createCalibrationMatch(
      { ...baseInput(profile, 'A01'), sessionId: first.sessionId },
      runtime('second', 2_000),
    )
    expect(second.sideAssignment.sequenceIndex).toBe(1)
    expect(second.playerSide).toBe('black')
    const afterOpeningEngine = await commitCalibrationEngineMove(
      calibrationMatchToken(second),
      analysisFor(second),
      runtime('second-engine', 2_001),
    )
    const afterEngineLine = mainline(afterOpeningEngine.gameSnapshot)
    const afterEngineFen = afterEngineLine[afterEngineLine.length - 1].fenAfter
    const afterBlackHuman = await commitCalibrationHumanMove(
      calibrationMatchToken(afterOpeningEngine),
      legalMoves(parseFen(afterEngineFen))[0],
      runtime('second-human', 2_002),
    )
    expect(afterBlackHuman).toMatchObject({ currentPly: 2, playerSide: 'black' })
    expect(afterBlackHuman.engineMoves).toHaveLength(1)
    await abortCalibrationMatch(
      calibrationMatchToken(afterBlackHuman),
      'participant-withdrew',
      runtime('stop-second', 2_003),
    )

    const gap = createCalibrationMatchDraft({
      id: 'calibration-game-gap',
      sessionId: first.sessionId,
      profile,
      anchor: PHASE2_ANCHORS[0],
      randomSeed: 'gap-seed',
      sequenceIndex: 4,
      startedAt: 2_500,
      appVersion: APP_VERSION,
    })
    await db.rankCalibrationGames.add(abortCalibrationMatchDraft(gap, 'other-invalid', 2_501))

    const afterGap = await createCalibrationMatch(
      { ...baseInput(profile, 'A01'), sessionId: first.sessionId },
      runtime('after-gap', 3_000),
    )
    expect(afterGap.sideAssignment.sequenceIndex).toBe(5)
    expect(afterGap.playerSide).toBe('black')
    await abortCalibrationMatch(calibrationMatchToken(afterGap), 'operator-aborted', runtime('stop-gap', 3_000))

    const otherAnchor = await createCalibrationMatch(
      { ...baseInput(profile, 'A02'), sessionId: first.sessionId },
      runtime('other-anchor', 4_000),
    )
    expect(otherAnchor.sideAssignment.sequenceIndex).toBe(0)
    expect(otherAnchor.playerSide).toBe('red')
    expect((await listCalibrationMatches()).map((game) => game.id)).toContain(otherAnchor.id)
  })

  it('重讀 profile revision、只接受同 owner/current-version 既有 session，且全域最多一局進行中', async () => {
    const firstProfile = makeProfile('profile-owner-a')
    const secondProfile = makeProfile('profile-owner-b')
    await db.rankCalibrators.bulkAdd([firstProfile, secondProfile])

    await expect(createCalibrationMatch({ ...baseInput(firstProfile), profileRevision: 2 }, runtime('revision')))
      .rejects.toThrow(/revision/)
    await expect(createCalibrationMatch({ ...baseInput(firstProfile), sessionId: 'missing-session' }, runtime('missing')))
      .rejects.toThrow(/不存在/)

    const owned = await createCalibrationMatch(baseInput(firstProfile), runtime('owned', 10_000))
    await expect(createCalibrationMatch(baseInput(secondProfile), runtime('blocked', 10_001)))
      .rejects.toThrow(/進行中的校準局/)
    await abortCalibrationMatch(calibrationMatchToken(owned), 'operator-aborted', runtime('stop-owned', 10_002))

    await expect(createCalibrationMatch(
      { ...baseInput(secondProfile), sessionId: owned.sessionId },
      runtime('wrong-owner', 10_003),
    )).rejects.toThrow(/另一位協助者|revision/)

    const oldVersion = createCalibrationMatchDraft({
      id: 'old-version-game',
      sessionId: 'old-version-session',
      profile: firstProfile,
      anchor: PHASE2_ANCHORS[0],
      randomSeed: 'old-version-seed',
      sequenceIndex: 8,
      startedAt: 11_000,
      appVersion: '0.0.1',
    })
    await db.rankCalibrationGames.add(abortCalibrationMatchDraft(oldVersion, 'app-version-changed', 11_001))
    await expect(createCalibrationMatch(
      { ...baseInput(firstProfile), sessionId: oldVersion.sessionId },
      runtime('old-session', 11_002),
    )).rejects.toThrow(/版本|App/)

    const parallel = await Promise.allSettled([
      createCalibrationMatch(baseInput(firstProfile), runtime('parallel-a', 12_000)),
      createCalibrationMatch(baseInput(firstProfile), runtime('parallel-b', 12_000)),
    ])
    expect(parallel.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(parallel.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await listCalibrationMatches()).filter((game) => game.status === 'in-progress')).toHaveLength(1)
  })

  it('相同 CAS token 的平行人著只有一筆成功，updatedAt 嚴格遞增且不建立分支', async () => {
    const profile = makeProfile('profile-cas')
    await db.rankCalibrators.add(profile)
    const game = await createCalibrationMatch(baseInput(profile), runtime('cas-create', 20_000))
    const token = calibrationMatchToken(game)
    const move = { from: 27, to: 36 }

    const results = await Promise.allSettled([
      commitCalibrationHumanMove(token, move, runtime('cas-a', 20_000)),
      commitCalibrationHumanMove(token, move, runtime('cas-b', 20_000)),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(CalibrationMatchConflictError)

    const saved = (await getCalibrationMatch(game.id))!
    expect(saved.currentPly).toBe(1)
    expect(saved.updatedAt).toBe(20_001)
    expect(saved.gameSnapshot.children).toHaveLength(1)
    expect(saved.gameSnapshot.children[0].children).toHaveLength(0)
    await expect(commitCalibrationHumanMove(token, move, runtime('stale', 30_000)))
      .rejects.toBeInstanceOf(CalibrationMatchConflictError)
  })

  it('引擎 tree move 與 decision 同一 put；寫入失敗時 checkpoint 完全不變', async () => {
    const profile = makeProfile('profile-engine')
    await db.rankCalibrators.add(profile)
    const game = await createCalibrationMatch(baseInput(profile), runtime('engine-create', 30_000))
    const afterHuman = await commitCalibrationHumanMove(
      calibrationMatchToken(game),
      { from: 27, to: 36 },
      runtime('human', 30_001),
    )
    const analysis = analysisFor(afterHuman)
    const putFailure = vi.spyOn(db.rankCalibrationGames, 'put').mockRejectedValueOnce(new Error('FORCED_MATCH_PUT_FAILURE'))

    await expect(commitCalibrationEngineMove(
      calibrationMatchToken(afterHuman),
      analysis,
      runtime('engine-fail', 30_002),
    )).rejects.toThrow('FORCED_MATCH_PUT_FAILURE')
    putFailure.mockRestore()
    expect(await getCalibrationMatch(game.id)).toEqual(afterHuman)

    const saved = await commitCalibrationEngineMove(
      calibrationMatchToken(afterHuman),
      analysis,
      runtime('engine-success', 30_002),
    )
    expect(saved.currentPly).toBe(2)
    expect(saved.engineMoves).toHaveLength(1)
    expect(saved.engineMoves[0]).toMatchObject({
      ply: 2,
      fenBefore: mainline(afterHuman.gameSnapshot)[0].fenAfter,
      playedAt: saved.updatedAt,
    })
    expect(mainline(saved.gameSnapshot)).toHaveLength(2)
    expect(await getCalibrationMatch(saved.id)).toEqual(saved)

    const exported = await exportRankCalibration(APP_VERSION)
    await db.rankCalibrationGames.clear()
    await db.rankCalibrators.clear()
    const imported = await importRankCalibration(exported.json)
    expect(imported).toMatchObject({
      profiles: { added: 1, skipped: 0 },
      games: { added: 1, skipped: 0 },
    })
    expect(await getCalibrationMatch(saved.id)).toEqual(saved)
  })

  it('completed/aborted immutable；跨版本只允許 app-version-changed 中止', async () => {
    const profile = makeProfile('profile-terminal')
    await db.rankCalibrators.add(profile)
    const completedSource = await createCalibrationMatch(baseInput(profile), runtime('complete-create', 40_000))
    const completed = await completeCalibrationMatch(
      calibrationMatchToken(completedSource),
      'draw',
      'agreed-draw',
      runtime('complete', 40_000),
    )
    expect(completed).toMatchObject({ status: 'completed', result: 'draw', endedAt: 40_001 })
    await expect(abortCalibrationMatch(
      calibrationMatchToken(completed),
      'operator-aborted',
      runtime('after-complete', 40_002),
    )).rejects.toBeInstanceOf(CalibrationMatchTerminalError)

    const current = await createCalibrationMatch(
      { ...baseInput(profile), sessionId: completedSource.sessionId },
      runtime('version-create', 41_000),
    )
    await expect(abortCalibrationMatch(
      calibrationMatchToken(current),
      'app-version-changed',
      runtime('same-version', 41_001),
    )).rejects.toThrow(/版本未變更/)

    const oldVersion = { ...current, appVersion: '0.0.1' } satisfies CalibrationGameV2
    await db.rankCalibrationGames.put(oldVersion)
    const oldToken = calibrationMatchToken(oldVersion)
    await expect(commitCalibrationHumanMove(oldToken, { from: 27, to: 36 }, runtime('old-move', 41_002)))
      .rejects.toBeInstanceOf(CalibrationMatchVersionError)
    await expect(abortCalibrationMatch(oldToken, 'operator-aborted', runtime('old-abort', 41_002)))
      .rejects.toBeInstanceOf(CalibrationMatchVersionError)

    const stopped = await abortCalibrationMatch(
      oldToken,
      'app-version-changed',
      runtime('version-stop', 41_002),
    )
    expect(stopped).toMatchObject({ status: 'aborted', resultReason: 'app-version-changed' })
  })
})

const baseInput = (profile: CalibratorProfile, anchorId: 'A01' | 'A02' = 'A01') => ({
  profileId: profile.id,
  profileRevision: profile.revision,
  anchorId,
  appVersion: APP_VERSION,
})

const runtime = (label: string, timestamp = 1_000): CalibrationMatchStoreRuntime => {
  let id = 0
  return {
    now: () => timestamp,
    stableId: (prefix) => `${prefix}-${label}-${++id}`,
    randomSeed: () => `seed-${label}`,
  }
}

const makeProfile = (id: string): CalibratorProfile => ({
  id,
  revision: 1,
  alias: id,
  claimedRank: '3段',
  rankSystem: '棋友自評',
  consentedAt: 100,
  createdAt: 100,
})

const analysisFor = (game: CalibrationGameV2): CalibrationAnalyzeSnapshotV1 => {
  const path = mainline(game.gameSnapshot)
  const fen = path.length > 0 ? path[path.length - 1].fenAfter : game.initialFen
  const selected = uciMove(legalMoves(parseFen(fen))[0])
  return {
    nodes: game.anchorSnapshot.search.nodes,
    multipv: game.anchorSnapshot.search.multipv,
    lines: [{ multipv: 1, depth: 8, scoreCp: 0, pv: [selected] }],
    bestmove: selected,
    completedDepth: 8,
    completeCandidateBatch: false,
    anomalies: [`incomplete-multipv-batch:1/${game.anchorSnapshot.search.multipv}`],
  }
}

async function resetDatabase() {
  db.close()
  await db.delete()
  await db.open()
}
