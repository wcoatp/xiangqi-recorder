import type { Move } from '../core/board'
import { START_FEN } from '../core/fen'
import { normalizeCalibrationGame, normalizeCalibratorProfile } from '../calibration/rankArchive'
import {
  phase2AnchorById,
  type Phase2AnchorProtocolV1,
} from '../calibration/phase2Protocol'
import {
  CALIBRATION_COLLECTION_PROTOCOL_V1,
  type AnchorId,
  type CalibrationAnalyzeSnapshotV1,
  type CalibrationGame,
  type CalibrationGameV2,
  type CalibratorProfile,
} from '../calibration/rankTypes'
import {
  abortCalibrationMatchDraft,
  applyEngineCalibrationMoveDraft,
  applyHumanCalibrationMoveDraft,
  calibrationMatchToken,
  completeCalibrationMatchDraft,
  createCalibrationMatchDraft,
  type CalibrationAbortReasonCode,
  type CalibrationCompletedReasonCode,
  type CalibrationCompletedResult,
  type CalibrationMatchToken,
} from '../calibration/matchController'
import { APP_VERSION } from '../version'
import { db } from './db'

export interface CreateCalibrationMatchInput {
  profileId: string
  profileRevision: number
  anchorId: AnchorId
  /** Omit to create a new collection session; pass an existing owned session to continue a visit. */
  sessionId?: string
  /** UI may pass its bundled version for an explicit stale-bundle guard. */
  appVersion?: string
  /** Aborted when the PIN-gated UI unmounts before the ply-0 transaction commits. */
  signal?: AbortSignal
}

export interface CalibrationMatchStoreRuntime {
  now(): number
  stableId(prefix: string): string
  randomSeed(): string
}

let fallbackIdCounter = 0

const defaultStableId = (prefix: string): string => {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}-${uuid}`
  fallbackIdCounter += 1
  return `${prefix}-${Date.now()}-${fallbackIdCounter}`
}

const DEFAULT_RUNTIME: CalibrationMatchStoreRuntime = {
  now: () => Date.now(),
  stableId: defaultStableId,
  randomSeed: () => defaultStableId('calibration-seed'),
}

type RuntimeOverride = Partial<CalibrationMatchStoreRuntime>

const resolveRuntime = (runtime?: RuntimeOverride): CalibrationMatchStoreRuntime => ({
  ...DEFAULT_RUNTIME,
  ...runtime,
})

const ensureCreateNotAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('校準建局已取消', 'AbortError')
}

export class CalibrationMatchNotFoundError extends Error {
  constructor(id: string) {
    super(`找不到校準對局：${id}`)
    this.name = 'CalibrationMatchNotFoundError'
  }
}

export class CalibrationMatchConflictError extends Error {
  readonly latest: CalibrationGameV2

  constructor(latest: CalibrationGameV2) {
    super('校準對局已在另一個頁面更新，這次操作未寫入')
    this.name = 'CalibrationMatchConflictError'
    this.latest = latest
  }
}

export class CalibrationMatchTerminalError extends Error {
  readonly latest: CalibrationGameV2

  constructor(latest: CalibrationGameV2) {
    super('校準對局已結束，不能再修改')
    this.name = 'CalibrationMatchTerminalError'
    this.latest = latest
  }
}

export class CalibrationMatchVersionError extends Error {
  readonly latest: CalibrationGameV2

  constructor(latest: CalibrationGameV2) {
    super(`這局由 App ${latest.appVersion} 建立，目前 App ${APP_VERSION} 只能唯讀或以版本變更原因中止`)
    this.name = 'CalibrationMatchVersionError'
    this.latest = latest
  }
}

const asV2Match = (value: unknown, path: string): CalibrationGameV2 => {
  const game = normalizeCalibrationGame(value, path)
  if (game.schemaVersion !== 2) throw new Error(`${path} 不是 schema v2 現場校準對局`)
  return game
}

const normalizeLocalGames = (rows: readonly unknown[]): CalibrationGame[] =>
  rows.map((row, index) => normalizeCalibrationGame(row, `本機 rankCalibrationGames[${index}]`))

const sameSequenceKey = (
  game: CalibrationGameV2,
  profile: CalibratorProfile,
  anchor: Phase2AnchorProtocolV1,
): boolean =>
  game.profileId === profile.id &&
  game.profileRevision === profile.revision &&
  game.anchorId === anchor.id &&
  game.anchorConfigVersion === anchor.configVersion &&
  game.collectionProtocolVersion === CALIBRATION_COLLECTION_PROTOCOL_V1

const nextSequenceIndex = (
  games: readonly CalibrationGame[],
  profile: CalibratorProfile,
  anchor: Phase2AnchorProtocolV1,
): number => {
  let maximum = -1
  for (const game of games) {
    if (game.schemaVersion !== 2 || !sameSequenceKey(game, profile, anchor)) continue
    maximum = Math.max(maximum, game.sideAssignment.sequenceIndex)
  }
  return maximum + 1
}

/**
 * Creates and saves ply 0 before the UI enters the board. The two-table transaction re-reads
 * every ownership and sequence input so concurrent tabs cannot allocate from a stale snapshot.
 */
export async function createCalibrationMatch(
  input: CreateCalibrationMatchInput,
  runtimeOverride?: RuntimeOverride,
): Promise<CalibrationGameV2> {
  const runtime = resolveRuntime(runtimeOverride)
  ensureCreateNotAborted(input.signal)
  const suppliedSessionId = input.sessionId?.trim()
  if (input.sessionId !== undefined && !suppliedSessionId) throw new Error('sessionId 不可為空白')
  if (input.appVersion !== undefined && input.appVersion !== APP_VERSION) {
    throw new Error(`建局 App 版本不一致（收到 ${input.appVersion}，目前 ${APP_VERSION}）`)
  }

  return db.transaction('rw', db.rankCalibrators, db.rankCalibrationGames, async () => {
    const rawProfile = await db.rankCalibrators.get(input.profileId)
    ensureCreateNotAborted(input.signal)
    if (!rawProfile) throw new Error(`找不到校準協助者：${input.profileId}`)
    const profile = normalizeCalibratorProfile(rawProfile, `本機 rankCalibrators[${input.profileId}]`)
    if (profile.revision !== input.profileRevision) {
      throw new Error(`協助者 revision 已變更（目前 ${profile.revision}，建局要求 ${input.profileRevision}）`)
    }

    const games = normalizeLocalGames(await db.rankCalibrationGames.toArray())
    ensureCreateNotAborted(input.signal)
    const inProgress = games.find((game): game is CalibrationGameV2 =>
      game.schemaVersion === 2 && game.status === 'in-progress')
    if (inProgress) throw new Error(`已有進行中的校準局：${inProgress.id}；請先續局或明確中止`)

    const sessionId = suppliedSessionId ?? runtime.stableId('calibration-session')
    const sessionGames = games.filter((game): game is CalibrationGameV2 =>
      game.schemaVersion === 2 && game.sessionId === sessionId)
    if (suppliedSessionId && sessionGames.length === 0) {
      throw new Error('指定的既有收集時段不存在')
    }
    if (!suppliedSessionId && sessionGames.length > 0) {
      throw new Error('新收集時段 ID 與既有資料衝突')
    }
    for (const game of sessionGames) {
      if (game.profileId !== profile.id || game.profileRevision !== profile.revision) {
        throw new Error('這個收集時段屬於另一位協助者或不同 profile revision')
      }
      if (game.appVersion !== APP_VERSION) {
        throw new Error(`這個收集時段由 App ${game.appVersion} 建立，不能由目前版本重用`)
      }
    }

    const anchor = phase2AnchorById(input.anchorId)
    const startedAt = runtime.now()
    const draft = createCalibrationMatchDraft({
      id: runtime.stableId('calibration-game'),
      sessionId,
      profile,
      anchor,
      randomSeed: runtime.randomSeed(),
      sequenceIndex: nextSequenceIndex(games, profile, anchor),
      startedAt,
      appVersion: APP_VERSION,
      initialFen: START_FEN,
    })
    ensureCreateNotAborted(input.signal)
    await db.rankCalibrationGames.add(draft)
    ensureCreateNotAborted(input.signal)
    return draft
  })
}

export async function getCalibrationMatch(id: string): Promise<CalibrationGameV2 | undefined> {
  const row = await db.rankCalibrationGames.get(id)
  return row === undefined ? undefined : asV2Match(row, `本機 rankCalibrationGames[${id}]`)
}

export async function listCalibrationMatches(): Promise<CalibrationGameV2[]> {
  const rows = await db.rankCalibrationGames.orderBy('startedAt').toArray()
  return normalizeLocalGames(rows).filter((game): game is CalibrationGameV2 => game.schemaVersion === 2)
}

type Transition = (current: CalibrationGameV2, at: number) => CalibrationGameV2

interface CommitOptions {
  versionChangedAbort?: boolean
}

const tokenMatches = (current: CalibrationGameV2, token: CalibrationMatchToken): boolean =>
  current.id === token.id &&
  current.sessionId === token.sessionId &&
  current.currentPly === token.currentPly &&
  current.updatedAt === token.updatedAt &&
  current.status === token.status

const commitTransition = async (
  token: CalibrationMatchToken,
  transition: Transition,
  runtimeOverride?: RuntimeOverride,
  options: CommitOptions = {},
): Promise<CalibrationGameV2> => {
  const runtime = resolveRuntime(runtimeOverride)
  return db.transaction('rw', db.rankCalibrationGames, async () => {
    const row = await db.rankCalibrationGames.get(token.id)
    if (!row) throw new CalibrationMatchNotFoundError(token.id)
    const current = asV2Match(row, `本機 rankCalibrationGames[${token.id}]`)
    if (current.status !== 'in-progress') throw new CalibrationMatchTerminalError(current)
    if (!tokenMatches(current, token)) throw new CalibrationMatchConflictError(current)
    if (options.versionChangedAbort && current.appVersion === APP_VERSION) {
      throw new Error('目前 App 版本未變更，不能使用 app-version-changed 中止原因')
    }
    if (current.appVersion !== APP_VERSION && !options.versionChangedAbort) {
      throw new CalibrationMatchVersionError(current)
    }

    const at = Math.max(runtime.now(), current.updatedAt + 1)
    const candidate = asV2Match(
      transition(current, at),
      `校準對局 ${current.id} 的下一個 checkpoint`,
    )
    if (candidate.id !== current.id || candidate.updatedAt <= current.updatedAt) {
      throw new Error('校準 checkpoint 必須保留 ID 並嚴格遞增 updatedAt')
    }
    await db.rankCalibrationGames.put(candidate)
    return candidate
  })
}

export function commitCalibrationHumanMove(
  token: CalibrationMatchToken,
  move: Move,
  runtime?: RuntimeOverride,
): Promise<CalibrationGameV2> {
  return commitTransition(token, (game, at) => applyHumanCalibrationMoveDraft(game, move, at), runtime)
}

export function commitCalibrationEngineMove(
  token: CalibrationMatchToken,
  analysis: CalibrationAnalyzeSnapshotV1,
  runtime?: RuntimeOverride,
): Promise<CalibrationGameV2> {
  return commitTransition(token, (game, at) => applyEngineCalibrationMoveDraft(game, analysis, at), runtime)
}

export function completeCalibrationMatch(
  token: CalibrationMatchToken,
  result: CalibrationCompletedResult,
  reason: CalibrationCompletedReasonCode,
  runtime?: RuntimeOverride,
): Promise<CalibrationGameV2> {
  return commitTransition(token, (game, at) => completeCalibrationMatchDraft(game, result, reason, at), runtime)
}

export function abortCalibrationMatch(
  token: CalibrationMatchToken,
  reason: CalibrationAbortReasonCode,
  runtime?: RuntimeOverride,
): Promise<CalibrationGameV2> {
  return commitTransition(
    token,
    (game, at) => abortCalibrationMatchDraft(game, reason, at),
    runtime,
    { versionChangedAbort: reason === 'app-version-changed' },
  )
}

export { calibrationMatchToken }
export type {
  CalibrationAbortReasonCode,
  CalibrationCompletedReasonCode,
  CalibrationCompletedResult,
  CalibrationMatchToken,
}
