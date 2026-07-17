import { applyMove, type Move, type Position, type Side } from '../core/board'
import { parseFen } from '../core/fen'
import { legalMovesFrom } from '../core/movegen'
import { uciMove } from '../core/notation'
import type { GameNode } from '../core/tree'
import type { PvLine } from '../engine/engineClient'
import { ANCHOR_SET_VERSION, RANK_ANCHORS } from './anchors'
import { selectHumanMoveV1, verifyHumanMoveDecisionV1 } from './humanMove'
import {
  PHASE2_ANCHORS,
  PHASE2_CONFIG_VERSION,
  type CalibrationEngineArtifactV1,
  type CalibrationSearchProfileV1,
  type HumanMovePolicyV1,
  type Phase2AnchorProtocolV1,
} from './phase2Protocol'
import {
  CALIBRATION_GAME_SCHEMA_V1,
  CALIBRATION_GAME_SCHEMA_V2,
  CALIBRATION_COLLECTION_PROTOCOL_V1,
  RANK_CALIBRATION_EXPORT_SCHEMA_V1,
  RANK_CALIBRATION_EXPORT_SCHEMA_V2,
  RANK_CALIBRATION_FORMAT,
  RANK_SYSTEM_OPTIONS,
  TAIWAN_RANK_OPTIONS,
  type AnchorDefinition,
  type AnchorEngineConfig,
  type AnchorId,
  type CalibrationAnalyzeSnapshotV1,
  type CalibrationEngineMoveRecordV1,
  type CalibrationGame,
  type CalibrationGameV1,
  type CalibrationGameV2,
  type CalibrationSideAssignmentV1,
  type CalibratorProfile,
  type RankCalibrationExport,
  type RankCalibrationExportV1,
  type RankCalibrationExportV2,
} from './rankTypes'

export const MAX_RANK_CALIBRATION_FILE_BYTES = 50 * 1024 * 1024

const MAX_ARRAY_LENGTH = 100_000
const MAX_NODES = 100_000
const MAX_TREE_DEPTH = 2_048
const MAX_STRING_LENGTH = 1_048_576
const MAX_ID_LENGTH = 256
const MAX_FEN_LENGTH = 4_096
const MAX_PV_LENGTH = 256
const MAX_ENGINE_MOVES = 100_000
const ANCHOR_IDS = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'] as const
const SIDES = ['red', 'black'] as const satisfies readonly Side[]
const RESULT_V1 = ['red', 'black', 'draw', 'aborted'] as const
const RESULT_COMPLETED = ['red', 'black', 'draw'] as const

type JsonObject = Record<string, unknown>

function fail(path: string, message: string): never {
  throw new Error(`${path}：${message}`)
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const objectAt = (value: unknown, path: string): JsonObject => {
  if (!isObject(value)) fail(path, '必須是物件')
  return value
}

const exactKeys = (value: JsonObject, allowed: readonly string[], path: string): void => {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(`${path}.${key}`, '不支援的欄位')
  }
}

const arrayAt = (value: unknown, path: string, max = MAX_ARRAY_LENGTH): unknown[] => {
  if (!Array.isArray(value)) fail(path, '必須是陣列')
  if (value.length > max) fail(path, `項目不可超過 ${max} 筆`)
  return value
}

const stringAt = (
  value: unknown,
  path: string,
  options: { empty?: boolean; max?: number } = {},
): string => {
  if (typeof value !== 'string') fail(path, '必須是字串')
  const max = options.max ?? MAX_STRING_LENGTH
  if (value.length > max) fail(path, `字串不可超過 ${max} 字元`)
  if (options.empty === false && value.length === 0) fail(path, '不可空白')
  return value
}

const trimmedStringAt = (value: unknown, path: string, max: number): string => {
  const result = stringAt(value, path, { empty: false, max }).trim()
  if (!result) fail(path, '不可只含空白')
  return result
}

const integerAt = (
  value: unknown,
  path: string,
  options: { min?: number; max?: number } = {},
): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(path, '必須是安全整數')
  if (options.min !== undefined && value < options.min) fail(path, `不可小於 ${options.min}`)
  if (options.max !== undefined && value > options.max) fail(path, `不可大於 ${options.max}`)
  return value
}

const booleanAt = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') fail(path, '必須是布林值')
  return value
}

const timestampAt = (value: unknown, path: string): number => integerAt(value, path, { min: 0 })

const enumAt = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    fail(path, `必須是 ${values.join('、')} 之一`)
  }
  return value as T
}

const optionalString = (value: unknown, path: string, max = MAX_STRING_LENGTH): string | undefined =>
  value === undefined ? undefined : stringAt(value, path, { max })

const canonicalJson = (value: unknown): string => {
  const canonicalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(canonicalize)
    if (!isObject(entry)) return entry
    return Object.fromEntries(
      Object.keys(entry)
        .sort()
        .map((key) => [key, canonicalize(entry[key])]),
    )
  }
  const result = JSON.stringify(canonicalize(value))
  if (result === undefined) fail('value', '無法轉成 JSON')
  return result
}

const normalizedFenAt = (value: unknown, path: string): { fen: string; position: Position } => {
  const fen = stringAt(value, path, { empty: false, max: MAX_FEN_LENGTH }).trim().replace(/\s+/g, ' ')
  const parts = fen.split(' ')
  if (!parts[1] || !['w', 'r', 'b'].includes(parts[1].toLowerCase())) {
    fail(path, 'FEN 輪走方必須是 w、r 或 b')
  }
  try {
    return { fen, position: parseFen(fen) }
  } catch (error) {
    fail(path, `FEN 無效（${error instanceof Error ? error.message : '無法解析'}）`)
  }
}

const samePosition = (left: Position, right: Position): boolean => {
  if (left.turn !== right.turn || left.board.length !== right.board.length) return false
  for (let index = 0; index < left.board.length; index++) {
    const a = left.board[index]
    const b = right.board[index]
    if (a?.side !== b?.side || a?.type !== b?.type) return false
  }
  return true
}

const normalizeMove = (value: unknown, path: string): Move => {
  const move = objectAt(value, path)
  exactKeys(move, ['from', 'to'], path)
  const result = {
    from: integerAt(move.from, `${path}.from`, { min: 0, max: 89 }),
    to: integerAt(move.to, `${path}.to`, { min: 0, max: 89 }),
  }
  if (result.from === result.to) fail(path, '起點與終點不可相同')
  return result
}

interface NormalizedTree {
  root: GameNode
  mainline: Array<{ node: GameNode; parentFen: string; parentPosition: Position }>
}

const normalizeTree = (value: unknown, path: string, linear: boolean): NormalizedTree => {
  const inputRoot = objectAt(value, path)
  const root = {} as GameNode
  const ids = new Set<string>()
  const seenObjects = new WeakSet<object>()
  let total = 0
  const stack: Array<{
    input: JsonObject
    output: GameNode
    parentPosition: Position | null
    depth: number
    path: string
    root: boolean
  }> = [{ input: inputRoot, output: root, parentPosition: null, depth: 0, path, root: true }]

  while (stack.length > 0) {
    const current = stack.pop()!
    if (seenObjects.has(current.input)) fail(current.path, '棋譜樹含循環或重複物件')
    seenObjects.add(current.input)
    total++
    if (total > MAX_NODES) fail(path, `棋譜樹節點不可超過 ${MAX_NODES}`)
    if (current.depth > MAX_TREE_DEPTH) fail(current.path, `棋譜樹深度不可超過 ${MAX_TREE_DEPTH}`)
    exactKeys(current.input, ['id', 'move', 'zh', 'wxf', 'fenAfter', 'comment', 'tMs', 'children'], current.path)

    const id = stringAt(current.input.id, `${current.path}.id`, { empty: false, max: MAX_ID_LENGTH })
    if (ids.has(id)) fail(`${current.path}.id`, `棋譜樹節點 ID 重複：${id}`)
    ids.add(id)
    const move = current.root
      ? current.input.move === null
        ? null
        : fail(`${current.path}.move`, 'root move 必須是 null')
      : normalizeMove(current.input.move, `${current.path}.move`)
    const parsedFen = normalizedFenAt(current.input.fenAfter, `${current.path}.fenAfter`)

    if (!current.root) {
      const moving = current.parentPosition!.board[move!.from]
      if (!moving || moving.side !== current.parentPosition!.turn) {
        fail(`${current.path}.move`, '起點沒有輪走方棋子')
      }
      if (!legalMovesFrom(current.parentPosition!, move!.from).some((candidate) => candidate.to === move!.to)) {
        fail(`${current.path}.move`, '不是父節點局面的合法著法')
      }
      if (!samePosition(applyMove(current.parentPosition!, move!), parsedFen.position)) {
        fail(`${current.path}.fenAfter`, '與父節點套用著法後的局面不一致')
      }
    }

    current.output.id = id
    current.output.move = move
    current.output.fenAfter = parsedFen.fen
    const zh = optionalString(current.input.zh, `${current.path}.zh`, 1_024)
    const wxf = optionalString(current.input.wxf, `${current.path}.wxf`, 1_024)
    const comment = optionalString(current.input.comment, `${current.path}.comment`)
    const tMs = current.input.tMs === undefined
      ? undefined
      : integerAt(current.input.tMs, `${current.path}.tMs`, { min: 0 })
    if (zh !== undefined) current.output.zh = zh
    if (wxf !== undefined) current.output.wxf = wxf
    if (comment !== undefined) current.output.comment = comment
    if (tMs !== undefined) current.output.tMs = tMs

    const children = arrayAt(current.input.children, `${current.path}.children`)
    if (linear && children.length > 1) fail(`${current.path}.children`, 'v2 校準棋局必須是線性棋譜')
    const siblingMoves = new Set<string>()
    const childObjects = children.map((child, index) => {
      const childPath = `${current.path}.children[${index}]`
      const childObject = objectAt(child, childPath)
      const childMove = normalizeMove(childObject.move, `${childPath}.move`)
      const key = `${childMove.from}-${childMove.to}`
      if (siblingMoves.has(key)) fail(`${childPath}.move`, '同一父節點不可有重複著法')
      siblingMoves.add(key)
      return childObject
    })
    current.output.children = childObjects.map(() => ({} as GameNode))
    for (let index = childObjects.length - 1; index >= 0; index--) {
      stack.push({
        input: childObjects[index],
        output: current.output.children[index],
        parentPosition: parsedFen.position,
        depth: current.depth + 1,
        path: `${current.path}.children[${index}]`,
        root: false,
      })
    }
  }

  const mainline: NormalizedTree['mainline'] = []
  let parent = root
  while (parent.children.length > 0) {
    const child = parent.children[0]
    mainline.push({
      node: child,
      parentFen: parent.fenAfter,
      parentPosition: parseFen(parent.fenAfter),
    })
    parent = child
  }
  return { root, mainline }
}

export const assertRankCalibrationTextSize = (
  text: string,
  maxBytes = MAX_RANK_CALIBRATION_FILE_BYTES,
): number => {
  if (typeof text !== 'string') fail('rankCalibration', '必須是 JSON 字串')
  const byteLength = new TextEncoder().encode(text).byteLength
  if (byteLength > maxBytes) {
    fail('rankCalibration', `檔案不可超過 ${maxBytes} bytes（目前 ${byteLength} bytes）`)
  }
  return byteLength
}

export const normalizeCalibratorProfile = (value: unknown, path = 'profile'): CalibratorProfile => {
  const profile = objectAt(value, path)
  exactKeys(profile, ['id', 'revision', 'alias', 'claimedRank', 'rankSystem', 'consentedAt', 'createdAt', 'notes'], path)
  const result: CalibratorProfile = {
    id: stringAt(profile.id, `${path}.id`, { empty: false, max: MAX_ID_LENGTH }),
    revision: integerAt(profile.revision, `${path}.revision`, { min: 1 }),
    alias: trimmedStringAt(profile.alias, `${path}.alias`, 32),
    claimedRank: enumAt(profile.claimedRank, TAIWAN_RANK_OPTIONS, `${path}.claimedRank`),
    rankSystem: enumAt(profile.rankSystem, RANK_SYSTEM_OPTIONS, `${path}.rankSystem`),
    consentedAt: timestampAt(profile.consentedAt, `${path}.consentedAt`),
    createdAt: timestampAt(profile.createdAt, `${path}.createdAt`),
  }
  const notes = optionalString(profile.notes, `${path}.notes`, 200)
  if (notes !== undefined) result.notes = notes
  return result
}

const normalizeLegacyAnchor = (value: unknown, path: string): AnchorDefinition => {
  const anchor = objectAt(value, path)
  exactKeys(anchor, ['id', 'configVersion', 'order', 'engineConfig', 'movePolicyVersion'], path)
  const engine = objectAt(anchor.engineConfig, `${path}.engineConfig`)
  exactKeys(engine, ['limitStrength', 'uciElo', 'skillLevel', 'movetimeMs', 'multiPv'], `${path}.engineConfig`)
  const engineConfig: AnchorEngineConfig = {
    limitStrength: booleanAt(engine.limitStrength, `${path}.engineConfig.limitStrength`),
    skillLevel: integerAt(engine.skillLevel, `${path}.engineConfig.skillLevel`, { min: 0, max: 100 }),
    movetimeMs: integerAt(engine.movetimeMs, `${path}.engineConfig.movetimeMs`, { min: 1, max: 3_600_000 }),
    multiPv: integerAt(engine.multiPv, `${path}.engineConfig.multiPv`, { min: 1, max: 256 }),
  }
  if (engine.uciElo !== undefined) {
    engineConfig.uciElo = integerAt(engine.uciElo, `${path}.engineConfig.uciElo`, { min: 0, max: 10_000 })
  }
  return {
    id: enumAt(anchor.id, ANCHOR_IDS, `${path}.id`),
    configVersion: stringAt(anchor.configVersion, `${path}.configVersion`, { empty: false, max: MAX_ID_LENGTH }),
    order: integerAt(anchor.order, `${path}.order`, { min: 1, max: 10 }),
    engineConfig,
    movePolicyVersion: stringAt(anchor.movePolicyVersion, `${path}.movePolicyVersion`, { empty: false, max: MAX_ID_LENGTH }),
  }
}

const normalizeEngineArtifact = (value: unknown, path: string): CalibrationEngineArtifactV1 => {
  const engine = objectAt(value, path)
  exactKeys(engine, [
    'protocolVersion', 'package', 'engineCommit', 'uciWorkerSha256', 'javascriptSha256', 'wasmSha256',
    'pthreadWorkerSha256', 'nnueSha256',
  ], path)
  const result = {
    protocolVersion: stringAt(engine.protocolVersion, `${path}.protocolVersion`, { empty: false, max: MAX_ID_LENGTH }),
    package: stringAt(engine.package, `${path}.package`, { empty: false, max: MAX_ID_LENGTH }),
    engineCommit: stringAt(engine.engineCommit, `${path}.engineCommit`, { empty: false, max: MAX_ID_LENGTH }),
    uciWorkerSha256: stringAt(engine.uciWorkerSha256, `${path}.uciWorkerSha256`, { empty: false, max: 128 }),
    javascriptSha256: stringAt(engine.javascriptSha256, `${path}.javascriptSha256`, { empty: false, max: 128 }),
    wasmSha256: stringAt(engine.wasmSha256, `${path}.wasmSha256`, { empty: false, max: 128 }),
    pthreadWorkerSha256: stringAt(engine.pthreadWorkerSha256, `${path}.pthreadWorkerSha256`, { empty: false, max: 128 }),
    nnueSha256: stringAt(engine.nnueSha256, `${path}.nnueSha256`, { empty: false, max: 128 }),
  }
  return result as CalibrationEngineArtifactV1
}

const normalizeSearch = (value: unknown, path: string): CalibrationSearchProfileV1 => {
  const search = objectAt(value, path)
  exactKeys(search, ['nodes', 'multipv', 'threads', 'hashMb', 'skillLevel', 'limitStrength', 'freshHashEveryMove'], path)
  return {
    nodes: integerAt(search.nodes, `${path}.nodes`, { min: 1, max: 1_000_000_000 }),
    multipv: integerAt(search.multipv, `${path}.multipv`, { min: 1, max: 100 }),
    threads: integerAt(search.threads, `${path}.threads`, { min: 1, max: 256 }),
    hashMb: integerAt(search.hashMb, `${path}.hashMb`, { min: 1, max: 1_048_576 }),
    skillLevel: integerAt(search.skillLevel, `${path}.skillLevel`, { min: 0, max: 20 }),
    limitStrength: booleanAt(search.limitStrength, `${path}.limitStrength`),
    freshHashEveryMove: booleanAt(search.freshHashEveryMove, `${path}.freshHashEveryMove`),
  } as CalibrationSearchProfileV1
}

const normalizePolicy = (value: unknown, path: string): HumanMovePolicyV1 => {
  const policy = objectAt(value, path)
  exactKeys(policy, ['version', 'topK', 'temperatureCp', 'maxLossCp', 'preserveForcedMate'], path)
  return {
    version: stringAt(policy.version, `${path}.version`, { empty: false, max: MAX_ID_LENGTH }),
    topK: integerAt(policy.topK, `${path}.topK`, { min: 1, max: 100 }),
    temperatureCp: integerAt(policy.temperatureCp, `${path}.temperatureCp`, { min: 1, max: 1_000_000 }),
    maxLossCp: integerAt(policy.maxLossCp, `${path}.maxLossCp`, { min: 0, max: 1_000_000 }),
    preserveForcedMate: booleanAt(policy.preserveForcedMate, `${path}.preserveForcedMate`),
  } as HumanMovePolicyV1
}

const normalizePhase2Anchor = (value: unknown, path: string): Phase2AnchorProtocolV1 => {
  const anchor = objectAt(value, path)
  exactKeys(anchor, ['schemaVersion', 'id', 'order', 'configVersion', 'active', 'engine', 'search', 'policy'], path)
  const id = enumAt(anchor.id, ANCHOR_IDS, `${path}.id`)
  const result = {
    schemaVersion: integerAt(anchor.schemaVersion, `${path}.schemaVersion`, { min: 1, max: 1 }),
    id,
    order: integerAt(anchor.order, `${path}.order`, { min: 1, max: 10 }),
    configVersion: stringAt(anchor.configVersion, `${path}.configVersion`, { empty: false, max: MAX_ID_LENGTH }),
    active: booleanAt(anchor.active, `${path}.active`),
    engine: normalizeEngineArtifact(anchor.engine, `${path}.engine`),
    search: normalizeSearch(anchor.search, `${path}.search`),
    policy: normalizePolicy(anchor.policy, `${path}.policy`),
  } as Phase2AnchorProtocolV1
  const known = PHASE2_ANCHORS.find((entry) => entry.id === id)
  if (!known || canonicalJson(result) !== canonicalJson(known)) {
    fail(path, '不支援的 Phase 2 protocol、引擎資產、搜尋或選著設定')
  }
  return result
}

const normalizeCalibrationGameV1 = (value: JsonObject, path: string): CalibrationGameV1 => {
  exactKeys(value, [
    'id', 'schemaVersion', 'profileId', 'profileRevision', 'anchorId', 'anchorConfigVersion', 'movePolicyVersion',
    'randomSeed', 'playerSide', 'result', 'resultReason', 'startedAt', 'endedAt', 'gameSnapshot', 'appVersion',
    'engineVersion',
  ], path)
  if (value.schemaVersion !== CALIBRATION_GAME_SCHEMA_V1) fail(`${path}.schemaVersion`, '只支援 game schema 1')
  const startedAt = timestampAt(value.startedAt, `${path}.startedAt`)
  const result: CalibrationGameV1 = {
    id: stringAt(value.id, `${path}.id`, { empty: false, max: MAX_ID_LENGTH }),
    schemaVersion: CALIBRATION_GAME_SCHEMA_V1,
    profileId: stringAt(value.profileId, `${path}.profileId`, { empty: false, max: MAX_ID_LENGTH }),
    profileRevision: integerAt(value.profileRevision, `${path}.profileRevision`, { min: 1 }),
    anchorId: enumAt(value.anchorId, ANCHOR_IDS, `${path}.anchorId`),
    anchorConfigVersion: stringAt(value.anchorConfigVersion, `${path}.anchorConfigVersion`, { empty: false, max: MAX_ID_LENGTH }),
    movePolicyVersion: stringAt(value.movePolicyVersion, `${path}.movePolicyVersion`, { empty: false, max: MAX_ID_LENGTH }),
    randomSeed: stringAt(value.randomSeed, `${path}.randomSeed`, { empty: false, max: 1_024 }),
    playerSide: enumAt(value.playerSide, SIDES, `${path}.playerSide`),
    result: enumAt(value.result, RESULT_V1, `${path}.result`),
    startedAt,
    gameSnapshot: normalizeTree(value.gameSnapshot, `${path}.gameSnapshot`, false).root,
    appVersion: stringAt(value.appVersion, `${path}.appVersion`, { empty: false, max: MAX_ID_LENGTH }),
    engineVersion: stringAt(value.engineVersion, `${path}.engineVersion`, { empty: false, max: MAX_ID_LENGTH }),
  }
  const reason = optionalString(value.resultReason, `${path}.resultReason`)
  if (reason !== undefined) result.resultReason = reason
  if (value.endedAt !== undefined) {
    result.endedAt = timestampAt(value.endedAt, `${path}.endedAt`)
    if (result.endedAt < startedAt) fail(`${path}.endedAt`, '不可早於 startedAt')
  }
  return result
}

const normalizeSideAssignment = (value: unknown, path: string): CalibrationSideAssignmentV1 => {
  const assignment = objectAt(value, path)
  exactKeys(assignment, ['version', 'sequenceIndex'], path)
  if (assignment.version !== 'balanced-alternation-v1') fail(`${path}.version`, '不支援的先後手分配版本')
  return {
    version: 'balanced-alternation-v1',
    sequenceIndex: integerAt(assignment.sequenceIndex, `${path}.sequenceIndex`, { min: 0 }),
  }
}

const normalizePvLine = (value: unknown, path: string): PvLine => {
  const line = objectAt(value, path)
  exactKeys(line, ['multipv', 'depth', 'scoreCp', 'mate', 'pv'], path)
  const hasCp = line.scoreCp !== undefined
  const hasMate = line.mate !== undefined
  if (hasCp === hasMate) fail(path, '必須且只能有一種 score')
  const result: PvLine = {
    multipv: integerAt(line.multipv, `${path}.multipv`, { min: 1, max: 100 }),
    depth: integerAt(line.depth, `${path}.depth`, { min: 0, max: 1_000_000 }),
    pv: arrayAt(line.pv, `${path}.pv`, MAX_PV_LENGTH).map((entry, index) =>
      trimmedStringAt(entry, `${path}.pv[${index}]`, 64).toLowerCase()),
  }
  if (hasCp) result.scoreCp = integerAt(line.scoreCp, `${path}.scoreCp`, { min: -1_000_000, max: 1_000_000 })
  else result.mate = integerAt(line.mate, `${path}.mate`, { min: -29_999, max: 29_999 })
  if (result.mate === 0) fail(`${path}.mate`, '不可為 0')
  return result
}

const normalizeStableStringArray = (value: unknown, path: string, max: number): string[] => {
  const result = arrayAt(value, path, max).map((entry, index) =>
    stringAt(entry, `${path}[${index}]`, { empty: false, max: 256 }))
  if (new Set(result).size !== result.length) fail(path, '不可有重複代碼')
  return result
}

const normalizeAnalysis = (
  value: unknown,
  path: string,
  anchor: Phase2AnchorProtocolV1,
): CalibrationAnalyzeSnapshotV1 => {
  const analysis = objectAt(value, path)
  exactKeys(analysis, [
    'nodes', 'multipv', 'lines', 'bestmove', 'completedDepth', 'completeCandidateBatch', 'anomalies',
  ], path)
  const nodes = integerAt(analysis.nodes, `${path}.nodes`, { min: 1, max: 1_000_000_000 })
  const multipv = integerAt(analysis.multipv, `${path}.multipv`, { min: 1, max: 100 })
  if (nodes !== anchor.search.nodes) fail(`${path}.nodes`, '與 anchor fixed-nodes 設定不一致')
  if (multipv !== anchor.search.multipv) fail(`${path}.multipv`, '與 anchor MultiPV 設定不一致')
  const completedDepth = integerAt(analysis.completedDepth, `${path}.completedDepth`, { min: 0, max: 1_000_000 })
  const lines = arrayAt(analysis.lines, `${path}.lines`, multipv).map((entry, index) =>
    normalizePvLine(entry, `${path}.lines[${index}]`))
  lines.sort((left, right) => left.multipv - right.multipv)
  const multipvIds = new Set<number>()
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (multipvIds.has(line.multipv)) fail(`${path}.lines[${index}].multipv`, 'MultiPV 編號重複')
    multipvIds.add(line.multipv)
    if (line.multipv > multipv) fail(`${path}.lines[${index}].multipv`, '超過分析 MultiPV 設定')
    if (line.depth !== completedDepth) fail(`${path}.lines[${index}].depth`, '必須屬於 completedDepth 的同步 batch')
  }
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].multipv !== index + 1) {
      fail(`${path}.lines[${index}].multipv`, '必須是從 1 開始的連續 MultiPV batch')
    }
  }
  const completeCandidateBatch = booleanAt(analysis.completeCandidateBatch, `${path}.completeCandidateBatch`)
  const hasCompleteIds = lines.length === multipv
  if (completeCandidateBatch !== hasCompleteIds) {
    fail(`${path}.completeCandidateBatch`, '與實際 MultiPV batch 完整性不一致')
  }
  const bestmove = trimmedStringAt(analysis.bestmove, `${path}.bestmove`, 64).toLowerCase()
  const anomalies = normalizeStableStringArray(analysis.anomalies, `${path}.anomalies`, 256)
  const expectedAnomalies: string[] = []
  if (lines.length === 0) expectedAnomalies.push('missing-multipv-batch')
  else if (!completeCandidateBatch) expectedAnomalies.push(`incomplete-multipv-batch:${lines.length}/${multipv}`)
  if (lines[0]?.pv[0] !== undefined && lines[0].pv[0] !== bestmove) expectedAnomalies.push('bestmove-mismatch')
  if (canonicalJson(anomalies) !== canonicalJson(expectedAnomalies)) {
    fail(`${path}.anomalies`, '與 fixed-nodes 搜尋結果的 batch／bestmove 狀態不一致')
  }
  return {
    nodes,
    multipv,
    lines,
    bestmove,
    completedDepth,
    completeCandidateBatch,
    anomalies: expectedAnomalies,
  }
}

const normalizeEngineMove = (
  value: unknown,
  path: string,
  context: {
    anchor: Phase2AnchorProtocolV1
    gameSeed: string
    startedAt: number
    updatedAt: number
  },
): CalibrationEngineMoveRecordV1 => {
  const record = objectAt(value, path)
  exactKeys(record, ['schemaVersion', 'ply', 'fenBefore', 'selectedUci', 'playedAt', 'analysis', 'decision'], path)
  if (record.schemaVersion !== 1) fail(`${path}.schemaVersion`, '只支援 engine move schema 1')
  const ply = integerAt(record.ply, `${path}.ply`, { min: 1, max: 1_000_000 })
  const fenBefore = normalizedFenAt(record.fenBefore, `${path}.fenBefore`).fen
  const playedAt = timestampAt(record.playedAt, `${path}.playedAt`)
  if (playedAt < context.startedAt || playedAt > context.updatedAt) {
    fail(`${path}.playedAt`, '必須介於 startedAt 與 updatedAt')
  }
  const analysis = normalizeAnalysis(record.analysis, `${path}.analysis`, context.anchor)
  const replayInput = {
    lines: analysis.lines,
    bestmove: analysis.bestmove,
    fen: fenBefore,
    gameSeed: context.gameSeed,
    ply,
    policy: context.anchor.policy,
    anomalies: analysis.anomalies,
  }
  let expectedDecision
  try {
    expectedDecision = selectHumanMoveV1(replayInput)
  } catch (error) {
    fail(`${path}.decision`, `無法重播（${error instanceof Error ? error.message : '未知錯誤'}）`)
  }
  if (!verifyHumanMoveDecisionV1(replayInput, expectedDecision)) {
    fail(`${path}.decision`, '選著決策無法由固定輸入重播')
  }
  if (canonicalJson(record.decision) !== canonicalJson(expectedDecision)) {
    fail(`${path}.decision`, '與 fixed-nodes／seeded MultiPV 重播結果不一致')
  }
  const selectedUci = trimmedStringAt(record.selectedUci, `${path}.selectedUci`, 64).toLowerCase()
  if (selectedUci !== expectedDecision.selectedUci) fail(`${path}.selectedUci`, '與 decision.selectedUci 不一致')
  return {
    schemaVersion: 1,
    ply,
    fenBefore,
    selectedUci,
    playedAt,
    analysis,
    decision: expectedDecision,
  }
}

const normalizeCalibrationGameV2 = (value: JsonObject, path: string): CalibrationGameV2 => {
  exactKeys(value, [
    'id', 'schemaVersion', 'sessionId', 'collectionProtocolVersion', 'profileId', 'profileRevision', 'profileSnapshot', 'anchorId',
    'anchorConfigVersion', 'movePolicyVersion', 'anchorSnapshot', 'randomSeed', 'playerSide', 'sideAssignment',
    'status', 'result', 'resultReason', 'startedAt', 'updatedAt', 'endedAt', 'initialFen', 'currentPly',
    'gameSnapshot', 'engineMoves', 'appVersion',
  ], path)
  if (value.schemaVersion !== CALIBRATION_GAME_SCHEMA_V2) fail(`${path}.schemaVersion`, '只支援 game schema 2')
  const startedAt = timestampAt(value.startedAt, `${path}.startedAt`)
  const updatedAt = timestampAt(value.updatedAt, `${path}.updatedAt`)
  if (updatedAt < startedAt) fail(`${path}.updatedAt`, '不可早於 startedAt')
  const profileSnapshot = normalizeCalibratorProfile(value.profileSnapshot, `${path}.profileSnapshot`)
  const profileId = stringAt(value.profileId, `${path}.profileId`, { empty: false, max: MAX_ID_LENGTH })
  const profileRevision = integerAt(value.profileRevision, `${path}.profileRevision`, { min: 1 })
  if (profileId !== profileSnapshot.id) fail(`${path}.profileId`, '與 profileSnapshot.id 不一致')
  if (profileRevision !== profileSnapshot.revision) fail(`${path}.profileRevision`, '與 profileSnapshot.revision 不一致')
  const anchorSnapshot = normalizePhase2Anchor(value.anchorSnapshot, `${path}.anchorSnapshot`)
  const anchorId = enumAt(value.anchorId, ANCHOR_IDS, `${path}.anchorId`)
  const anchorConfigVersion = stringAt(value.anchorConfigVersion, `${path}.anchorConfigVersion`, { empty: false, max: MAX_ID_LENGTH })
  const movePolicyVersion = stringAt(value.movePolicyVersion, `${path}.movePolicyVersion`, { empty: false, max: MAX_ID_LENGTH })
  if (anchorId !== anchorSnapshot.id) fail(`${path}.anchorId`, '與 anchorSnapshot.id 不一致')
  if (anchorConfigVersion !== anchorSnapshot.configVersion) fail(`${path}.anchorConfigVersion`, '與 anchorSnapshot 不一致')
  if (movePolicyVersion !== anchorSnapshot.policy.version) fail(`${path}.movePolicyVersion`, '與 anchorSnapshot.policy 不一致')
  const randomSeed = stringAt(value.randomSeed, `${path}.randomSeed`, { empty: false, max: 512 })
  if (randomSeed.includes('\0')) fail(`${path}.randomSeed`, '不可含 NUL 字元')
  const playerSide = enumAt(value.playerSide, SIDES, `${path}.playerSide`)
  const sideAssignment = normalizeSideAssignment(value.sideAssignment, `${path}.sideAssignment`)
  const assignedSide: Side = sideAssignment.sequenceIndex % 2 === 0 ? 'red' : 'black'
  if (playerSide !== assignedSide) {
    fail(`${path}.playerSide`, `與 balanced-alternation-v1 序號不一致（應為 ${assignedSide}）`)
  }
  const initialFen = normalizedFenAt(value.initialFen, `${path}.initialFen`).fen
  const tree = normalizeTree(value.gameSnapshot, `${path}.gameSnapshot`, true)
  if (initialFen !== tree.root.fenAfter) {
    fail(`${path}.gameSnapshot.fenAfter`, 'root 局面與 initialFen 不一致')
  }
  const currentPly = integerAt(value.currentPly, `${path}.currentPly`, { min: 0, max: MAX_NODES })
  if (currentPly !== tree.mainline.length) fail(`${path}.currentPly`, '必須等於線性棋譜著數')
  const context = { anchor: anchorSnapshot, gameSeed: randomSeed, startedAt, updatedAt }
  const engineMoves = arrayAt(value.engineMoves, `${path}.engineMoves`, MAX_ENGINE_MOVES).map((entry, index) =>
    normalizeEngineMove(entry, `${path}.engineMoves[${index}]`, context))
  engineMoves.sort((left, right) => left.ply - right.ply)
  const recordByPly = new Map<number, CalibrationEngineMoveRecordV1>()
  for (let index = 0; index < engineMoves.length; index++) {
    const record = engineMoves[index]
    if (recordByPly.has(record.ply)) fail(`${path}.engineMoves[${index}].ply`, 'engine ply 重複')
    recordByPly.set(record.ply, record)
    if (index > 0 && record.playedAt < engineMoves[index - 1].playedAt) {
      fail(`${path}.engineMoves[${index}].playedAt`, '不可早於前一筆引擎著')
    }
  }
  const engineSide: Side = playerSide === 'red' ? 'black' : 'red'
  const expectedEnginePlys: number[] = []
  tree.mainline.forEach((entry, index) => {
    const ply = index + 1
    if (entry.parentPosition.turn !== engineSide) return
    expectedEnginePlys.push(ply)
    const record = recordByPly.get(ply)
    if (!record) fail(`${path}.engineMoves`, `缺少引擎第 ${ply} ply 決策紀錄`)
    if (record.fenBefore !== entry.parentFen) {
      fail(`${path}.engineMoves[${engineMoves.indexOf(record)}].fenBefore`, '與棋譜該 ply 前局面不一致')
    }
    if (record.selectedUci !== uciMove(entry.node.move!)) {
      fail(`${path}.engineMoves[${engineMoves.indexOf(record)}].selectedUci`, '與棋譜實際著法不一致')
    }
  })
  if (engineMoves.length !== expectedEnginePlys.length) {
    const extra = engineMoves.find((record) => !expectedEnginePlys.includes(record.ply))
    fail(`${path}.engineMoves`, extra ? `第 ${extra.ply} ply 不是引擎方著法` : '引擎著數量不一致')
  }

  const common = {
    id: stringAt(value.id, `${path}.id`, { empty: false, max: MAX_ID_LENGTH }),
    schemaVersion: CALIBRATION_GAME_SCHEMA_V2,
    sessionId: stringAt(value.sessionId, `${path}.sessionId`, { empty: false, max: MAX_ID_LENGTH }),
    collectionProtocolVersion: enumAt(
      value.collectionProtocolVersion,
      [CALIBRATION_COLLECTION_PROTOCOL_V1] as const,
      `${path}.collectionProtocolVersion`,
    ),
    profileId,
    profileRevision,
    profileSnapshot,
    anchorId,
    anchorConfigVersion,
    movePolicyVersion,
    anchorSnapshot,
    randomSeed,
    playerSide,
    sideAssignment,
    startedAt,
    updatedAt,
    initialFen,
    currentPly,
    gameSnapshot: tree.root,
    engineMoves,
    appVersion: stringAt(value.appVersion, `${path}.appVersion`, { empty: false, max: MAX_ID_LENGTH }),
  }
  const status = enumAt(value.status, ['in-progress', 'completed', 'aborted'] as const, `${path}.status`)
  if (status === 'in-progress') {
    if (value.result !== undefined || value.resultReason !== undefined || value.endedAt !== undefined) {
      fail(path, 'in-progress 不可包含 result、resultReason 或 endedAt')
    }
    return { ...common, status }
  }
  const endedAt = timestampAt(value.endedAt, `${path}.endedAt`)
  if (endedAt < startedAt) fail(`${path}.endedAt`, '不可早於 startedAt')
  if (endedAt > updatedAt) fail(`${path}.endedAt`, '不可晚於 updatedAt')
  if (status === 'completed') {
    if (value.resultReason !== undefined && typeof value.resultReason !== 'string') {
      fail(`${path}.resultReason`, '必須是字串')
    }
    return {
      ...common,
      status,
      result: enumAt(value.result, RESULT_COMPLETED, `${path}.result`),
      ...(value.resultReason === undefined
        ? {}
        : { resultReason: stringAt(value.resultReason, `${path}.resultReason`) }),
      endedAt,
    }
  }
  if (value.result !== undefined) fail(`${path}.result`, 'aborted 不可包含勝負 result')
  return {
    ...common,
    status,
    resultReason: stringAt(value.resultReason, `${path}.resultReason`, { empty: false }),
    endedAt,
  }
}

export const normalizeCalibrationGame = (value: unknown, path = 'calibrationGame'): CalibrationGame => {
  const game = objectAt(value, path)
  if (game.schemaVersion === CALIBRATION_GAME_SCHEMA_V1) return normalizeCalibrationGameV1(game, path)
  if (game.schemaVersion === CALIBRATION_GAME_SCHEMA_V2) return normalizeCalibrationGameV2(game, path)
  if (typeof game.schemaVersion === 'number' && game.schemaVersion > CALIBRATION_GAME_SCHEMA_V2) {
    fail(`${path}.schemaVersion`, `game schema ${game.schemaVersion} 較新，請更新 App 後再試`)
  }
  fail(`${path}.schemaVersion`, '只支援 game schema 1 或 2')
}

const normalizeUniqueAnchors = (value: unknown, path: string): AnchorDefinition[] => {
  const anchors = arrayAt(value, path, 10).map((entry, index) => normalizeLegacyAnchor(entry, `${path}[${index}]`))
  if (anchors.length !== 10) fail(path, '必須包含 10 個固定錨點')
  const ids = new Set<AnchorId>()
  const orders = new Set<number>()
  anchors.forEach((anchor, index) => {
    if (ids.has(anchor.id)) fail(`${path}[${index}].id`, '錨點 ID 重複')
    if (orders.has(anchor.order)) fail(`${path}[${index}].order`, '錨點順序重複')
    ids.add(anchor.id)
    orders.add(anchor.order)
  })
  const sorted = anchors.sort((left, right) => left.order - right.order)
  if (canonicalJson(sorted) !== canonicalJson(RANK_ANCHORS)) {
    fail(path, 'legacy 錨點集合不是支援的 frozen snapshot')
  }
  return sorted
}

const normalizeUniquePhase2Anchors = (value: unknown, path: string): Phase2AnchorProtocolV1[] => {
  const anchors = arrayAt(value, path, 10).map((entry, index) => normalizePhase2Anchor(entry, `${path}[${index}]`))
  if (anchors.length !== 10) fail(path, '必須包含 10 個 Phase 2 固定錨點')
  const ids = new Set<AnchorId>()
  anchors.forEach((anchor, index) => {
    if (ids.has(anchor.id)) fail(`${path}[${index}].id`, 'Phase 2 錨點 ID 重複')
    ids.add(anchor.id)
  })
  const sorted = anchors.sort((left, right) => left.order - right.order)
  if (canonicalJson(sorted) !== canonicalJson(PHASE2_ANCHORS)) {
    fail(path, 'Phase 2 錨點集合不完整或不是支援的 protocol snapshot')
  }
  return sorted
}

const normalizeUniqueProfiles = (value: unknown, path: string): CalibratorProfile[] => {
  const profiles = arrayAt(value, path).map((entry, index) => normalizeCalibratorProfile(entry, `${path}[${index}]`))
  const ids = new Set<string>()
  profiles.forEach((profile, index) => {
    if (ids.has(profile.id)) fail(`${path}[${index}].id`, '協助者 ID 重複')
    ids.add(profile.id)
  })
  return profiles.sort((left, right) => left.id.localeCompare(right.id))
}

const normalizeUniqueGames = (
  value: unknown,
  path: string,
  allowedVersion: 1 | 'mixed',
): CalibrationGame[] => {
  const games = arrayAt(value, path).map((entry, index) => normalizeCalibrationGame(entry, `${path}[${index}]`))
  const ids = new Set<string>()
  const sideAssignments = new Set<string>()
  games.forEach((game, index) => {
    if (allowedVersion === 1 && game.schemaVersion !== CALIBRATION_GAME_SCHEMA_V1) {
      fail(`${path}[${index}].schemaVersion`, 'rank schema v1 只能包含 game schema v1')
    }
    if (ids.has(game.id)) fail(`${path}[${index}].id`, '校準對局 ID 重複')
    ids.add(game.id)
    if (game.schemaVersion === CALIBRATION_GAME_SCHEMA_V2) {
      const assignmentKey = canonicalJson([
        game.profileId,
        game.profileRevision,
        game.anchorId,
        game.anchorConfigVersion,
        game.collectionProtocolVersion,
        game.sideAssignment.sequenceIndex,
      ])
      if (sideAssignments.has(assignmentKey)) {
        fail(`${path}[${index}].sideAssignment.sequenceIndex`, '同一收集序列的分派序號重複')
      }
      sideAssignments.add(assignmentKey)
    }
  })
  return games.sort((left, right) => left.id.localeCompare(right.id))
}

const validateCombinedSideAssignments = (games: readonly CalibrationGame[], path: string): void => {
  const seen = new Set<string>()
  games.forEach((game, index) => {
    if (game.schemaVersion !== CALIBRATION_GAME_SCHEMA_V2) return
    const key = canonicalJson([
      game.profileId,
      game.profileRevision,
      game.anchorId,
      game.anchorConfigVersion,
      game.collectionProtocolVersion,
      game.sideAssignment.sequenceIndex,
    ])
    if (seen.has(key)) {
      fail(`${path}[${index}].sideAssignment.sequenceIndex`, '與另一筆校準局的分派序號衝突')
    }
    seen.add(key)
  })
}

const validateReferences = (
  profiles: CalibratorProfile[],
  games: CalibrationGame[],
  legacyAnchors: AnchorDefinition[],
  phase2Anchors: Phase2AnchorProtocolV1[] | null,
  path: string,
): void => {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))
  const legacyById = new Map(legacyAnchors.map((anchor) => [anchor.id, anchor]))
  const phase2ById = new Map(phase2Anchors?.map((anchor) => [anchor.id, anchor]) ?? [])
  games.forEach((game, index) => {
    const gamePath = `${path}.games[${index}]`
    const profile = profilesById.get(game.profileId)
    if (!profile) fail(`${gamePath}.profileId`, '找不到對應協助者')
    if (game.profileRevision > profile.revision) fail(`${gamePath}.profileRevision`, '不可高於協助者目前 revision')
    if (game.schemaVersion === CALIBRATION_GAME_SCHEMA_V1) {
      const anchor = legacyById.get(game.anchorId)
      if (!anchor) fail(`${gamePath}.anchorId`, '找不到 legacy 錨點')
      if (game.anchorConfigVersion !== anchor.configVersion) {
        fail(`${gamePath}.anchorConfigVersion`, '與 legacy 錨點 snapshot 不一致')
      }
      if (game.movePolicyVersion !== anchor.movePolicyVersion) {
        fail(`${gamePath}.movePolicyVersion`, '與 legacy 錨點 snapshot 不一致')
      }
      return
    }
    const anchor = phase2ById.get(game.anchorId)
    if (!anchor || canonicalJson(anchor) !== canonicalJson(game.anchorSnapshot)) {
      fail(`${gamePath}.anchorSnapshot`, '找不到完全相同的 Phase 2 protocol snapshot')
    }
    if (game.profileRevision === profile.revision && canonicalJson(game.profileSnapshot) !== canonicalJson(profile)) {
      fail(`${gamePath}.profileSnapshot`, '同 revision snapshot 與協助者資料不一致')
    }
  })
}

const normalizeRankV1 = (value: JsonObject, path: string): RankCalibrationExportV1 => {
  exactKeys(value, ['format', 'schemaVersion', 'exportedAt', 'appVersion', 'anchorSetVersion', 'anchors', 'profiles', 'games'], path)
  const anchors = normalizeUniqueAnchors(value.anchors, `${path}.anchors`)
  const profiles = normalizeUniqueProfiles(value.profiles, `${path}.profiles`)
  const games = normalizeUniqueGames(value.games, `${path}.games`, 1) as CalibrationGameV1[]
  validateReferences(profiles, games, anchors, null, path)
  const anchorSetVersion = stringAt(value.anchorSetVersion, `${path}.anchorSetVersion`, { empty: false, max: MAX_ID_LENGTH })
  if (anchorSetVersion !== ANCHOR_SET_VERSION) fail(`${path}.anchorSetVersion`, '不支援的 legacy 錨點版本')
  return {
    format: RANK_CALIBRATION_FORMAT,
    schemaVersion: RANK_CALIBRATION_EXPORT_SCHEMA_V1,
    exportedAt: timestampAt(value.exportedAt, `${path}.exportedAt`),
    appVersion: stringAt(value.appVersion, `${path}.appVersion`, { empty: false, max: MAX_ID_LENGTH }),
    anchorSetVersion,
    anchors,
    profiles,
    games,
  }
}

const normalizeRankV2 = (value: JsonObject, path: string): RankCalibrationExportV2 => {
  exactKeys(value, [
    'format', 'schemaVersion', 'exportedAt', 'appVersion', 'anchorSetVersion', 'anchors', 'phase2ConfigVersion',
    'phase2Anchors', 'profiles', 'games',
  ], path)
  const phase2ConfigVersion = stringAt(value.phase2ConfigVersion, `${path}.phase2ConfigVersion`, {
    empty: false,
    max: MAX_ID_LENGTH,
  })
  if (phase2ConfigVersion !== PHASE2_CONFIG_VERSION) {
    fail(`${path}.phase2ConfigVersion`, '不支援的 Phase 2 config version')
  }
  const anchors = normalizeUniqueAnchors(value.anchors, `${path}.anchors`)
  const phase2Anchors = normalizeUniquePhase2Anchors(value.phase2Anchors, `${path}.phase2Anchors`)
  const profiles = normalizeUniqueProfiles(value.profiles, `${path}.profiles`)
  const games = normalizeUniqueGames(value.games, `${path}.games`, 'mixed')
  validateReferences(profiles, games, anchors, phase2Anchors, path)
  const anchorSetVersion = stringAt(value.anchorSetVersion, `${path}.anchorSetVersion`, { empty: false, max: MAX_ID_LENGTH })
  if (anchorSetVersion !== ANCHOR_SET_VERSION) fail(`${path}.anchorSetVersion`, '不支援的 legacy 錨點版本')
  return {
    format: RANK_CALIBRATION_FORMAT,
    schemaVersion: RANK_CALIBRATION_EXPORT_SCHEMA_V2,
    exportedAt: timestampAt(value.exportedAt, `${path}.exportedAt`),
    appVersion: stringAt(value.appVersion, `${path}.appVersion`, { empty: false, max: MAX_ID_LENGTH }),
    anchorSetVersion,
    anchors,
    phase2ConfigVersion,
    phase2Anchors,
    profiles,
    games,
  }
}

export const normalizeRankCalibrationExport = (
  value: unknown,
  path = 'rankCalibration',
): RankCalibrationExport => {
  const rank = objectAt(value, path)
  if (rank.format !== RANK_CALIBRATION_FORMAT) fail(`${path}.format`, '不是本 App 的段級校準資料')
  if (rank.schemaVersion === RANK_CALIBRATION_EXPORT_SCHEMA_V1) return normalizeRankV1(rank, path)
  if (rank.schemaVersion === RANK_CALIBRATION_EXPORT_SCHEMA_V2) return normalizeRankV2(rank, path)
  if (typeof rank.schemaVersion === 'number' && rank.schemaVersion > RANK_CALIBRATION_EXPORT_SCHEMA_V2) {
    fail(`${path}.schemaVersion`, `校準 schema ${rank.schemaVersion} 較新，請更新 App 後再試`)
  }
  fail(`${path}.schemaVersion`, '只支援校準 schema 1 或 2')
}

export const parseRankCalibrationExport = (text: string): RankCalibrationExport => {
  assertRankCalibrationTextSize(text)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    fail('rankCalibration', 'JSON 格式損壞')
  }
  return normalizeRankCalibrationExport(parsed)
}

export interface RankCalibrationInspection {
  schemaVersion: 1 | 2
  exportedAt: number
  appVersion: string
  profileCount: number
  legacyGameCount: number
  v2GameCount: number
  completedCount: number
  abortedCount: number
  inProgressCount: number
}

export const inspectRankCalibrationExport = (text: string): RankCalibrationInspection => {
  const rank = parseRankCalibrationExport(text)
  const allGames: CalibrationGame[] = [...rank.games]
  const v2Games = allGames.filter((game): game is CalibrationGameV2 => game.schemaVersion === 2)
  return {
    schemaVersion: rank.schemaVersion,
    exportedAt: rank.exportedAt,
    appVersion: rank.appVersion,
    profileCount: rank.profiles.length,
    legacyGameCount: rank.games.length - v2Games.length,
    v2GameCount: v2Games.length,
    completedCount: v2Games.filter((game) => game.status === 'completed').length,
    abortedCount: v2Games.filter((game) => game.status === 'aborted').length,
    inProgressCount: v2Games.filter((game) => game.status === 'in-progress').length,
  }
}

export type BuildRankCalibrationExportV2Input = Omit<
  RankCalibrationExportV2,
  'format' | 'schemaVersion'
>

export const buildRankCalibrationExportV2 = (
  input: BuildRankCalibrationExportV2Input,
): RankCalibrationExportV2 =>
  normalizeRankCalibrationExport({
    ...input,
    format: RANK_CALIBRATION_FORMAT,
    schemaVersion: RANK_CALIBRATION_EXPORT_SCHEMA_V2,
  }) as RankCalibrationExportV2

export const buildCalibrationGameV2 = (
  input: Omit<CalibrationGameV2, 'schemaVersion'>,
): CalibrationGameV2 => normalizeCalibrationGame({ ...input, schemaVersion: CALIBRATION_GAME_SCHEMA_V2 }) as CalibrationGameV2

export const serializeRankCalibrationExport = (value: RankCalibrationExport, pretty = true): string => {
  const normalized = normalizeRankCalibrationExport(value)
  const text = JSON.stringify(normalized, null, pretty ? 2 : undefined)
  assertRankCalibrationTextSize(text)
  return text
}

export interface RankCalibrationMergePlan {
  profilesToAdd: CalibratorProfile[]
  gamesToAdd: CalibrationGame[]
  profilesSkipped: number
  gamesSkipped: number
}

const normalizeLocalUnique = <T extends { id: string }>(
  values: readonly unknown[],
  path: string,
  normalizer: (value: unknown, path: string) => T,
): Map<string, T> => {
  const result = new Map<string, T>()
  values.forEach((value, index) => {
    const normalized = normalizer(value, `${path}[${index}]`)
    if (result.has(normalized.id)) fail(`${path}[${index}].id`, `本機 ID 重複：${normalized.id}`)
    result.set(normalized.id, normalized)
  })
  return result
}

export const planRankCalibrationMerge = (
  localProfiles: readonly unknown[],
  localGames: readonly unknown[],
  incoming: unknown,
): RankCalibrationMergePlan => {
  const normalizedIncoming = normalizeRankCalibrationExport(incoming, 'incoming.rankCalibration')
  const profilesById = normalizeLocalUnique(localProfiles, 'local.rankCalibrators', normalizeCalibratorProfile)
  const gamesById = normalizeLocalUnique(localGames, 'local.rankCalibrationGames', normalizeCalibrationGame)
  for (const game of gamesById.values()) {
    const localProfile = profilesById.get(game.profileId)
    if (!localProfile) fail('local.rankCalibrationGames', `對局 ${game.id} 找不到本機協助者 ${game.profileId}`)
    if (game.profileRevision > localProfile.revision) {
      fail('local.rankCalibrationGames', `對局 ${game.id} 的 profile revision 高於本機協助者`)
    }
    if (
      game.schemaVersion === CALIBRATION_GAME_SCHEMA_V2 &&
      game.profileRevision === localProfile.revision &&
      canonicalJson(game.profileSnapshot) !== canonicalJson(localProfile)
    ) {
      fail('local.rankCalibrationGames', `對局 ${game.id} 的同 revision profile snapshot 與本機資料不一致`)
    }
  }
  const profilesToAdd: CalibratorProfile[] = []
  const gamesToAdd: CalibrationGame[] = []
  let profilesSkipped = 0
  let gamesSkipped = 0

  for (const profile of normalizedIncoming.profiles) {
    const local = profilesById.get(profile.id)
    if (!local) profilesToAdd.push(profile)
    else if (canonicalJson(local) === canonicalJson(profile)) profilesSkipped++
    else {
      fail(
        'incoming.rankCalibration.profiles',
        `段級協助者識別 ${profile.id} 在本機與匯入內容不同；為避免覆寫，整份資料未匯入`,
      )
    }
  }
  for (const game of normalizedIncoming.games) {
    const local = gamesById.get(game.id)
    if (!local) gamesToAdd.push(game)
    else if (canonicalJson(local) === canonicalJson(game)) gamesSkipped++
    else {
      fail(
        'incoming.rankCalibration.games',
        `段級校準對局識別 ${game.id} 在本機與匯入內容不同；為避免覆寫，整份資料未匯入`,
      )
    }
  }
  validateCombinedSideAssignments([...gamesById.values(), ...gamesToAdd], 'merged.rankCalibrationGames')
  return { profilesToAdd, gamesToAdd, profilesSkipped, gamesSkipped }
}
