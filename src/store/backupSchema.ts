import {
  type RankCalibrationExport,
} from '../calibration/rankTypes'
import { normalizeRankCalibrationExport } from '../calibration/rankArchive'
export { normalizeCalibrationGame, normalizeCalibratorProfile } from '../calibration/rankArchive'
import { applyMove, type Move, type PieceType, type Position, type Side } from '../core/board'
import { parseFen } from '../core/fen'
import { legalMovesFrom } from '../core/movegen'
import type { GameNode } from '../core/tree'
import type { GameReview, MoveJudgment, MoveTag, PlyAnalysis } from '../engine/analysis'
import { INK_CAP, PATCH } from '../vision/patch'
import type { PieceTemplates } from '../vision/templates'
import type { EndgameGameSource, GameContinuationSource, GameRow, PlayerRow } from './db'

export const BACKUP_FORMAT = 'xiangqi-recorder-backup' as const
export const BACKUP_VERSION = 2 as const
export const MAX_BACKUP_TEXT_LENGTH = 50 * 1024 * 1024

const MAX_NODES = 100_000
const MAX_TREE_DEPTH = 2_048
const MAX_STRING_LENGTH = 1_048_576
const MAX_ARRAY_LENGTH = 100_000
const PIECE_FLOAT_COUNT = PATCH * PATCH
const PIECE_BYTE_LENGTH = PIECE_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT
const PIECE_TYPES = ['K', 'A', 'B', 'N', 'R', 'C', 'P'] as const satisfies readonly PieceType[]
const SIDES = ['red', 'black'] as const satisfies readonly Side[]
const PIECE_HISTOGRAM: Readonly<Record<PieceType, number>> = {
  K: 1,
  A: 2,
  B: 2,
  N: 2,
  R: 2,
  C: 2,
  P: 5,
}

type JsonObject = Record<string, unknown>
type GameRecord = Omit<GameRow, 'id'>
type PlayerRecord = Omit<PlayerRow, 'id'>

export interface BackupPreferencesV1 {
  schemaVersion: 1
  voiceLang: 'zh-TW' | 'zh-CN'
  ttsReadback: boolean
  autoRelisten: boolean
  analysisMovetimeMs: number
  tabletop: boolean
}

export interface EncodedPieceSampleV1 {
  type: PieceType
  data: string
}

export interface EncodedPieceTemplatesV1 {
  schemaVersion: 1
  codec: 'float32-le-base64'
  createdAt: number
  patch: number
  samples: Record<Side, EncodedPieceSampleV1[]>
}

export interface BackupGameV2 {
  stableId: string
  record: GameRecord
}

export interface BackupFileV2 {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: number
  appVersion: string
  games: BackupGameV2[]
  players: PlayerRecord[]
  preferences: BackupPreferencesV1
  pieceCalibration: EncodedPieceTemplatesV1 | null
  rankCalibration: RankCalibrationExport
}

export interface BackupInspection {
  version: 1 | 2
  exportedAt: number
  appVersion?: string
  gameCount: number
  playerCount: number
  profileCount: number
  calibrationGameCount: number
  hasPreferences: boolean
  hasPieceCalibration: boolean
  isLegacyV1: boolean
  omittedStaleReviewCount: number
}

export interface ParsedBackup {
  version: 1 | 2
  exportedAt: number
  appVersion?: string
  games: BackupGameV2[]
  players: PlayerRecord[]
  preferences: BackupPreferencesV1 | null
  pieceCalibration: PieceTemplates | null
  rankCalibration: RankCalibrationExport | null
  omittedStaleReviewCount: number
}

export interface BuildBackupFileV2Input {
  exportedAt: number
  appVersion: string
  games: GameRecord[]
  players: PlayerRecord[]
  preferences: Omit<BackupPreferencesV1, 'schemaVersion'> | BackupPreferencesV1
  pieceCalibration: PieceTemplates | null
  rankCalibration: RankCalibrationExport
}

function fail(path: string, message: string): never {
  throw new Error(`${path}：${message}`)
}

export function assertBackupTextSize(text: string, maxBytes = MAX_BACKUP_TEXT_LENGTH): number {
  const byteLength = new TextEncoder().encode(text).byteLength
  if (byteLength > maxBytes) fail('backup', `檔案不可超過 ${maxBytes} bytes（目前 ${byteLength} bytes）`)
  return byteLength
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objectAt(value: unknown, path: string): JsonObject {
  if (!isObject(value)) fail(path, '必須是物件')
  return value
}

function exactKeys(value: JsonObject, allowed: readonly string[], path: string): void {
  const set = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!set.has(key)) fail(`${path}.${key}`, '不支援的欄位')
  }
}

function arrayAt(value: unknown, path: string, max = MAX_ARRAY_LENGTH): unknown[] {
  if (!Array.isArray(value)) fail(path, '必須是陣列')
  if (value.length > max) fail(path, `項目不可超過 ${max} 筆`)
  return value
}

function stringAt(value: unknown, path: string, options: { empty?: boolean; max?: number } = {}): string {
  if (typeof value !== 'string') fail(path, '必須是字串')
  const max = options.max ?? MAX_STRING_LENGTH
  if (value.length > max) fail(path, `字串不可超過 ${max} 字元`)
  if (options.empty === false && value.length === 0) fail(path, '不可空白')
  return value
}

function trimmedStringAt(value: unknown, path: string, max: number): string {
  const result = stringAt(value, path, { empty: false, max }).trim()
  if (!result) fail(path, '不可只含空白')
  return result
}

function finiteAt(value: unknown, path: string, options: { min?: number; max?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, '必須是有限數字')
  if (options.min !== undefined && value < options.min) fail(path, `不可小於 ${options.min}`)
  if (options.max !== undefined && value > options.max) fail(path, `不可大於 ${options.max}`)
  return value
}

function integerAt(value: unknown, path: string, options: { min?: number; max?: number } = {}): number {
  const result = finiteAt(value, path, options)
  if (!Number.isSafeInteger(result)) fail(path, '必須是安全整數')
  return result
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, '必須是布林值')
  return value
}

function optionalString(value: unknown, path: string, max = MAX_STRING_LENGTH): string | undefined {
  return value === undefined ? undefined : stringAt(value, path, { max })
}

function enumAt<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    fail(path, `必須是 ${values.join('、')} 之一`)
  }
  return value as T
}

function timestampAt(value: unknown, path: string): number {
  return integerAt(value, path, { min: 0 })
}

function strictPosition(value: unknown, path: string): { fen: string; position: Position } {
  const fen = stringAt(value, path, { empty: false, max: 4_096 })
  const parts = fen.trim().split(/\s+/)
  if (parts.length < 2 || !['w', 'r', 'b'].includes(parts[1].toLowerCase())) {
    fail(path, 'FEN 輪走方必須是 w、r 或 b')
  }
  try {
    return { fen, position: parseFen(fen) }
  } catch (error) {
    fail(path, `FEN 無效（${error instanceof Error ? error.message : '無法解析'}）`)
  }
}

function samePosition(a: Position, b: Position): boolean {
  if (a.turn !== b.turn || a.board.length !== b.board.length) return false
  for (let index = 0; index < a.board.length; index++) {
    const left = a.board[index]
    const right = b.board[index]
    if (left?.side !== right?.side || left?.type !== right?.type) return false
  }
  return true
}

function normalizeMove(value: unknown, path: string): Move {
  const move = objectAt(value, path)
  exactKeys(move, ['from', 'to'], path)
  const from = integerAt(move.from, `${path}.from`, { min: 0, max: 89 })
  const to = integerAt(move.to, `${path}.to`, { min: 0, max: 89 })
  if (from === to) fail(path, '起點與終點不可相同')
  return { from, to }
}

interface NormalizedTree {
  root: GameNode
  ids: Set<string>
}

function normalizeTree(value: unknown, path: string): NormalizedTree {
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

    const id = stringAt(current.input.id, `${current.path}.id`, { empty: false, max: 256 })
    if (ids.has(id)) fail(`${current.path}.id`, `棋譜樹節點 ID 重複：${id}`)
    ids.add(id)
    const move = current.root
      ? current.input.move === null
        ? null
        : fail(`${current.path}.move`, 'root move 必須是 null')
      : normalizeMove(current.input.move, `${current.path}.move`)
    const parsedFen = strictPosition(current.input.fenAfter, `${current.path}.fenAfter`)

    if (!current.root) {
      const moving = current.parentPosition!.board[move!.from]
      if (!moving || moving.side !== current.parentPosition!.turn) {
        fail(`${current.path}.move`, '起點沒有輪走方棋子')
      }
      const destination = current.parentPosition!.board[move!.to]
      if (destination?.side === moving.side) fail(`${current.path}.move`, '不可吃掉己方棋子')
      if (!legalMovesFrom(current.parentPosition!, move!.from).some((candidate) =>
        candidate.to === move!.to)) {
        fail(`${current.path}.move`, '不是父節點局面的合法著法')
      }
      const expected = applyMove(current.parentPosition!, move!)
      if (!samePosition(expected, parsedFen.position)) {
        fail(`${current.path}.fenAfter`, '與父節點套用著法後的盤面或輪走方不一致')
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
  return { root, ids }
}

function mainlineLength(root: GameNode): number {
  let result = 0
  let node = root
  while (node.children.length > 0) {
    result++
    node = node.children[0]
  }
  return result
}

function normalizeContinuation(value: unknown, path: string): GameContinuationSource {
  const source = objectAt(value, path)
  exactKeys(source, [
    'schemaVersion',
    'sourceGameIdAtCreation',
    'sourceRootId',
    'sourceNodeId',
    'sourcePly',
    'sourceStartedAt',
    'sourceRedName',
    'sourceBlackName',
    'sourceFen',
    'sourceNodeLabel',
  ], path)
  if (source.schemaVersion !== 1) fail(`${path}.schemaVersion`, '只支援 continuedFrom schema 1')
  const result: GameContinuationSource = {
    schemaVersion: 1,
    sourceGameIdAtCreation: integerAt(source.sourceGameIdAtCreation, `${path}.sourceGameIdAtCreation`, { min: 1 }),
    sourceRootId: stringAt(source.sourceRootId, `${path}.sourceRootId`, { empty: false, max: 256 }),
    sourceNodeId: stringAt(source.sourceNodeId, `${path}.sourceNodeId`, { empty: false, max: 256 }),
    sourcePly: integerAt(source.sourcePly, `${path}.sourcePly`, { min: 0 }),
    sourceStartedAt: timestampAt(source.sourceStartedAt, `${path}.sourceStartedAt`),
    sourceRedName: stringAt(source.sourceRedName, `${path}.sourceRedName`),
    sourceBlackName: stringAt(source.sourceBlackName, `${path}.sourceBlackName`),
    sourceFen: strictPosition(source.sourceFen, `${path}.sourceFen`).fen,
  }
  const label = optionalString(source.sourceNodeLabel, `${path}.sourceNodeLabel`, 1_024)
  if (label !== undefined) result.sourceNodeLabel = label
  return result
}

function normalizeEndgameSource(value: unknown, path: string): EndgameGameSource {
  const source = objectAt(value, path)
  exactKeys(source, [
    'schemaVersion',
    'packId',
    'puzzleId',
    'title',
    'sourceWork',
    'sourceOrdinal',
    'sourceFen',
    'launchMode',
  ], path)
  if (source.schemaVersion !== 1) fail(`${path}.schemaVersion`, '只支援 endgameSource schema 1')
  return {
    schemaVersion: 1,
    packId: stringAt(source.packId, `${path}.packId`, { empty: false, max: 256 }),
    puzzleId: stringAt(source.puzzleId, `${path}.puzzleId`, { empty: false, max: 256 }),
    title: stringAt(source.title, `${path}.title`, { empty: false, max: 1_024 }),
    sourceWork: stringAt(source.sourceWork, `${path}.sourceWork`, { empty: false, max: 1_024 }),
    sourceOrdinal: integerAt(source.sourceOrdinal, `${path}.sourceOrdinal`, { min: 1, max: 100_000 }),
    sourceFen: strictPosition(source.sourceFen, `${path}.sourceFen`).fen,
    launchMode: enumAt(source.launchMode, ['solve', 'record', 'play'] as const, `${path}.launchMode`),
  }
}

function normalizePlyAnalysis(value: unknown, path: string): PlyAnalysis {
  const item = objectAt(value, path)
  exactKeys(item, ['ply', 'fen', 'scoreRed', 'bestUci', 'bestZh', 'bestLineZh', 'depth'], path)
  return {
    ply: integerAt(item.ply, `${path}.ply`, { min: 0 }),
    fen: strictPosition(item.fen, `${path}.fen`).fen,
    scoreRed: finiteAt(item.scoreRed, `${path}.scoreRed`),
    bestUci: stringAt(item.bestUci, `${path}.bestUci`, { max: 1_024 }),
    bestZh: stringAt(item.bestZh, `${path}.bestZh`, { max: 1_024 }),
    bestLineZh: arrayAt(item.bestLineZh, `${path}.bestLineZh`, 256).map((entry, index) =>
      stringAt(entry, `${path}.bestLineZh[${index}]`, { max: 1_024 })),
    depth: integerAt(item.depth, `${path}.depth`, { min: 0 }),
  }
}

function normalizeJudgment(value: unknown, path: string): MoveJudgment {
  const item = objectAt(value, path)
  exactKeys(item, [
    'nodeId', 'ply', 'side', 'zh', 'tag', 'loss', 'scoreRedBefore', 'scoreRedAfter', 'bestZh', 'bestLineZh',
  ], path)
  return {
    nodeId: stringAt(item.nodeId, `${path}.nodeId`, { empty: false, max: 256 }),
    ply: integerAt(item.ply, `${path}.ply`, { min: 1 }),
    side: enumAt(item.side, SIDES, `${path}.side`),
    zh: stringAt(item.zh, `${path}.zh`, { max: 1_024 }),
    tag: enumAt(item.tag, ['best', 'good', 'inacc', 'mistake', 'blunder'] as const satisfies readonly MoveTag[], `${path}.tag`),
    loss: finiteAt(item.loss, `${path}.loss`, { min: 0 }),
    scoreRedBefore: finiteAt(item.scoreRedBefore, `${path}.scoreRedBefore`),
    scoreRedAfter: finiteAt(item.scoreRedAfter, `${path}.scoreRedAfter`),
    bestZh: stringAt(item.bestZh, `${path}.bestZh`, { max: 1_024 }),
    bestLineZh: arrayAt(item.bestLineZh, `${path}.bestLineZh`, 256).map((entry, index) =>
      stringAt(entry, `${path}.bestLineZh[${index}]`, { max: 1_024 })),
  }
}

function normalizeReview(value: unknown, path: string): GameReview {
  const review = objectAt(value, path)
  exactKeys(review, ['plies', 'judgments', 'counts', 'accuracy', 'movetimeMs'], path)
  const counts = objectAt(review.counts, `${path}.counts`)
  exactKeys(counts, SIDES, `${path}.counts`)
  const accuracy = objectAt(review.accuracy, `${path}.accuracy`)
  exactKeys(accuracy, SIDES, `${path}.accuracy`)
  const normalizeCounts = (side: Side) => {
    const item = objectAt(counts[side], `${path}.counts.${side}`)
    exactKeys(item, ['inacc', 'mistake', 'blunder'], `${path}.counts.${side}`)
    return {
      inacc: integerAt(item.inacc, `${path}.counts.${side}.inacc`, { min: 0 }),
      mistake: integerAt(item.mistake, `${path}.counts.${side}.mistake`, { min: 0 }),
      blunder: integerAt(item.blunder, `${path}.counts.${side}.blunder`, { min: 0 }),
    }
  }
  return {
    plies: arrayAt(review.plies, `${path}.plies`).map((entry, index) => normalizePlyAnalysis(entry, `${path}.plies[${index}]`)),
    judgments: arrayAt(review.judgments, `${path}.judgments`).map((entry, index) => normalizeJudgment(entry, `${path}.judgments[${index}]`)),
    counts: { red: normalizeCounts('red'), black: normalizeCounts('black') },
    accuracy: {
      red: finiteAt(accuracy.red, `${path}.accuracy.red`, { min: 0, max: 100 }),
      black: finiteAt(accuracy.black, `${path}.accuracy.black`, { min: 0, max: 100 }),
    },
    movetimeMs: integerAt(review.movetimeMs, `${path}.movetimeMs`, { min: 1 }),
  }
}

function validateReviewLinks(review: GameReview, root: GameNode, path: string): void {
  const nodes: GameNode[] = []
  let node = root
  while (node.children.length > 0) {
    node = node.children[0]
    nodes.push(node)
  }
  if (review.plies.length !== nodes.length + 1) {
    fail(`${path}.plies`, `必須包含主線 ${nodes.length + 1} 個局面`)
  }
  if (review.judgments.length !== nodes.length) {
    fail(`${path}.judgments`, `必須對應主線 ${nodes.length} 著`)
  }

  const expectedFens = [root.fenAfter, ...nodes.map((entry) => entry.fenAfter)]
  review.plies.forEach((ply, index) => {
    if (ply.ply !== index) fail(`${path}.plies[${index}].ply`, `必須是 ${index}`)
    const actual = strictPosition(ply.fen, `${path}.plies[${index}].fen`).position
    const expected = strictPosition(expectedFens[index], `${path}.expectedFens[${index}]`).position
    if (!samePosition(actual, expected)) fail(`${path}.plies[${index}].fen`, '與主線同一 ply 的局面不一致')
  })

  const counts: GameReview['counts'] = {
    red: { inacc: 0, mistake: 0, blunder: 0 },
    black: { inacc: 0, mistake: 0, blunder: 0 },
  }
  review.judgments.forEach((judgment, index) => {
    const expectedNode = nodes[index]
    const expectedSide = strictPosition(expectedFens[index], `${path}.expectedFens[${index}]`).position.turn
    if (judgment.nodeId !== expectedNode.id) fail(`${path}.judgments[${index}].nodeId`, '與主線節點不一致')
    if (judgment.ply !== index + 1) fail(`${path}.judgments[${index}].ply`, `必須是 ${index + 1}`)
    if (judgment.side !== expectedSide) fail(`${path}.judgments[${index}].side`, '與該著輪走方不一致')
    if (judgment.zh !== (expectedNode.zh ?? '')) fail(`${path}.judgments[${index}].zh`, '與主線著法文字不一致')
    if (judgment.scoreRedBefore !== review.plies[index].scoreRed) {
      fail(`${path}.judgments[${index}].scoreRedBefore`, '與前一局面評分不一致')
    }
    if (judgment.scoreRedAfter !== review.plies[index + 1].scoreRed) {
      fail(`${path}.judgments[${index}].scoreRedAfter`, '與後一局面評分不一致')
    }
    const expectedLoss = Math.max(
      0,
      expectedSide === 'red'
        ? judgment.scoreRedBefore - judgment.scoreRedAfter
        : judgment.scoreRedAfter - judgment.scoreRedBefore,
    )
    if (Math.abs(judgment.loss - expectedLoss) > 1e-9) {
      fail(`${path}.judgments[${index}].loss`, '與前後評分推導的損失不一致')
    }
    if (judgment.bestZh !== review.plies[index].bestZh) {
      fail(`${path}.judgments[${index}].bestZh`, '與前一局面的最佳著不一致')
    }
    if (canonicalJson(judgment.bestLineZh) !== canonicalJson(review.plies[index].bestLineZh)) {
      fail(`${path}.judgments[${index}].bestLineZh`, '與前一局面的主變不一致')
    }
    if (judgment.tag === 'inacc' || judgment.tag === 'mistake' || judgment.tag === 'blunder') {
      counts[judgment.side][judgment.tag]++
    }
  })
  for (const side of SIDES) {
    for (const tag of ['inacc', 'mistake', 'blunder'] as const) {
      if (review.counts[side][tag] !== counts[side][tag]) {
        fail(`${path}.counts.${side}.${tag}`, '與逐著標記統計不一致')
      }
    }
  }
}

export function normalizeGameRecord(value: unknown, path = 'game'): GameRecord {
  return normalizeGameRecordInternal(value, path, false).record
}

export function normalizeGameRecordForArchive(
  value: unknown,
  path = 'game',
): { record: GameRecord; staleReviewOmitted: boolean } {
  return normalizeGameRecordInternal(value, path, true)
}

function normalizeGameRecordInternal(
  value: unknown,
  path: string,
  allowStaleReview: boolean,
): { record: GameRecord; staleReviewOmitted: boolean } {
  const record = objectAt(value, path)
  exactKeys(record, [
    'redName', 'blackName', 'mode', 'playerSide', 'level', 'startedAt', 'updatedAt', 'result', 'resultReason',
    'initialFen', 'tree', 'moveCount', 'continuedFrom', 'endgameSource', 'review', 'reviewedAt',
  ], path)
  const normalizedTree = normalizeTree(record.tree, `${path}.tree`)
  const initial = strictPosition(record.initialFen, `${path}.initialFen`)
  const rootPosition = strictPosition(normalizedTree.root.fenAfter, `${path}.tree.fenAfter`)
  if (!samePosition(initial.position, rootPosition.position)) {
    fail(`${path}.initialFen`, '必須與棋譜 root 局面一致')
  }
  const moveCount = integerAt(record.moveCount, `${path}.moveCount`, { min: 0 })
  const expectedMoveCount = mainlineLength(normalizedTree.root)
  if (moveCount !== expectedMoveCount) fail(`${path}.moveCount`, `主線實際為 ${expectedMoveCount} 著`)

  const result: GameRecord = {
    redName: stringAt(record.redName, `${path}.redName`),
    blackName: stringAt(record.blackName, `${path}.blackName`),
    startedAt: timestampAt(record.startedAt, `${path}.startedAt`),
    updatedAt: timestampAt(record.updatedAt, `${path}.updatedAt`),
    result: enumAt(record.result, ['red', 'black', 'draw', '*'] as const, `${path}.result`),
    initialFen: initial.fen,
    tree: normalizedTree.root,
    moveCount,
  }
  if (record.mode !== undefined) result.mode = enumAt(record.mode, ['record', 'play'] as const, `${path}.mode`)
  if (record.playerSide !== undefined) result.playerSide = enumAt(record.playerSide, SIDES, `${path}.playerSide`)
  if (record.level !== undefined) result.level = integerAt(record.level, `${path}.level`, { min: 0, max: 100 })
  const reason = optionalString(record.resultReason, `${path}.resultReason`)
  if (reason !== undefined) result.resultReason = reason
  if (record.continuedFrom !== undefined) result.continuedFrom = normalizeContinuation(record.continuedFrom, `${path}.continuedFrom`)
  if (record.endgameSource !== undefined) result.endgameSource = normalizeEndgameSource(record.endgameSource, `${path}.endgameSource`)
  if (result.continuedFrom && result.endgameSource) fail(path, '不可同時有 continuedFrom 與 endgameSource')
  let staleReviewOmitted = false
  if (record.review !== undefined) {
    if (record.review === null) {
      result.review = null
    } else {
      const review = normalizeReview(record.review, `${path}.review`)
      try {
        validateReviewLinks(review, normalizedTree.root, `${path}.review`)
        result.review = review
      } catch (error) {
        if (!allowStaleReview) throw error
        staleReviewOmitted = true
      }
    }
  }
  const reviewedAt = record.reviewedAt === undefined
    ? undefined
    : timestampAt(record.reviewedAt, `${path}.reviewedAt`)
  if (reviewedAt !== undefined && !staleReviewOmitted) {
    result.reviewedAt = reviewedAt
  }
  return { record: result, staleReviewOmitted }
}

export function normalizePlayerRecord(value: unknown, path = 'player'): PlayerRecord {
  const player = objectAt(value, path)
  exactKeys(player, ['name', 'createdAt'], path)
  return {
    name: trimmedStringAt(player.name, `${path}.name`, MAX_STRING_LENGTH),
    createdAt: timestampAt(player.createdAt, `${path}.createdAt`),
  }
}

function validatePieceSamples(samples: PieceTemplates['samples'], path: string): void {
  for (const side of SIDES) {
    const counts: Record<PieceType, number> = { K: 0, A: 0, B: 0, N: 0, R: 0, C: 0, P: 0 }
    for (const [index, sample] of samples[side].entries()) {
      counts[sample.type]++
      if (!(sample.data instanceof Float32Array)) fail(`${path}.${side}[${index}].data`, '必須是 Float32Array')
      if (sample.data.length !== PIECE_FLOAT_COUNT) {
        fail(`${path}.${side}[${index}].data`, `必須恰有 ${PIECE_FLOAT_COUNT} 個 float32`)
      }
      for (let offset = 0; offset < sample.data.length; offset++) {
        const number = sample.data[offset]
        if (!Number.isFinite(number) || number < 0 || number > INK_CAP) {
          fail(`${path}.${side}[${index}].data[${offset}]`, `必須是 0..${INK_CAP} 的有限數字`)
        }
      }
    }
    for (const type of PIECE_TYPES) {
      if (counts[type] !== PIECE_HISTOGRAM[type]) {
        fail(`${path}.${side}`, `${type} 範本數必須是 ${PIECE_HISTOGRAM[type]}（收到 ${counts[type]}）`)
      }
    }
  }
}

export function normalizePieceTemplates(value: unknown, path = 'pieceCalibration'): PieceTemplates {
  const templates = objectAt(value, path)
  if (templates.codec !== undefined || templates.schemaVersion !== undefined) {
    return decodePieceTemplates(templates, path)
  }
  exactKeys(templates, ['createdAt', 'patch', 'samples'], path)
  const samplesObject = objectAt(templates.samples, `${path}.samples`)
  exactKeys(samplesObject, SIDES, `${path}.samples`)
  const samples = { red: [], black: [] } as PieceTemplates['samples']
  for (const side of SIDES) {
    samples[side] = arrayAt(samplesObject[side], `${path}.samples.${side}`, 32).map((entry, index) => {
      const samplePath = `${path}.samples.${side}[${index}]`
      const sample = objectAt(entry, samplePath)
      exactKeys(sample, ['type', 'data'], samplePath)
      return {
        type: enumAt(sample.type, PIECE_TYPES, `${samplePath}.type`),
        data: sample.data instanceof Float32Array
          ? new Float32Array(sample.data)
          : fail(`${samplePath}.data`, '必須是 Float32Array'),
      }
    })
  }
  const result: PieceTemplates = {
    createdAt: timestampAt(templates.createdAt, `${path}.createdAt`),
    patch: integerAt(templates.patch, `${path}.patch`, { min: 1, max: 1_024 }),
    samples,
  }
  validatePieceSamples(result.samples, `${path}.samples`)
  return result
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0
    output += BASE64[a >> 2]
    output += BASE64[((a & 3) << 4) | (b >> 4)]
    output += index + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : '='
    output += index + 2 < bytes.length ? BASE64[c & 63] : '='
  }
  return output
}

function base64ToBytes(value: unknown, path: string): Uint8Array {
  const text = stringAt(value, path, { empty: false, max: Math.ceil(PIECE_BYTE_LENGTH / 3) * 4 })
  if (text.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    fail(path, '不是標準 base64')
  }
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((text.length / 4) * 3 - padding)
  let cursor = 0
  for (let index = 0; index < text.length; index += 4) {
    const a = BASE64.indexOf(text[index])
    const b = BASE64.indexOf(text[index + 1])
    const c = text[index + 2] === '=' ? 0 : BASE64.indexOf(text[index + 2])
    const d = text[index + 3] === '=' ? 0 : BASE64.indexOf(text[index + 3])
    bytes[cursor++] = (a << 2) | (b >> 4)
    if (cursor < bytes.length) bytes[cursor++] = ((b & 15) << 4) | (c >> 2)
    if (cursor < bytes.length) bytes[cursor++] = ((c & 3) << 6) | d
  }
  return bytes
}

function encodeFloat32(data: Float32Array): string {
  const bytes = new Uint8Array(data.length * Float32Array.BYTES_PER_ELEMENT)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < data.length; index++) view.setFloat32(index * 4, data[index], true)
  return bytesToBase64(bytes)
}

function decodeFloat32(value: unknown, path: string): Float32Array {
  const bytes = base64ToBytes(value, path)
  if (bytes.byteLength !== PIECE_BYTE_LENGTH) fail(path, `解碼後必須恰有 ${PIECE_BYTE_LENGTH} bytes`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const result = new Float32Array(PIECE_FLOAT_COUNT)
  for (let index = 0; index < result.length; index++) result[index] = view.getFloat32(index * 4, true)
  return result
}

export function encodePieceTemplates(value: PieceTemplates, path = 'pieceCalibration'): EncodedPieceTemplatesV1 {
  const templates = normalizePieceTemplates(value, path)
  return {
    schemaVersion: 1,
    codec: 'float32-le-base64',
    createdAt: templates.createdAt,
    patch: templates.patch,
    samples: {
      red: templates.samples.red.map((sample) => ({ type: sample.type, data: encodeFloat32(sample.data) })),
      black: templates.samples.black.map((sample) => ({ type: sample.type, data: encodeFloat32(sample.data) })),
    },
  }
}

export function decodePieceTemplates(value: unknown, path = 'pieceCalibration'): PieceTemplates {
  const templates = objectAt(value, path)
  exactKeys(templates, ['schemaVersion', 'codec', 'createdAt', 'patch', 'samples'], path)
  if (templates.schemaVersion !== 1) fail(`${path}.schemaVersion`, '只支援棋子範本 schema 1')
  if (templates.codec !== 'float32-le-base64') fail(`${path}.codec`, '只支援 float32-le-base64')
  const sampleObject = objectAt(templates.samples, `${path}.samples`)
  exactKeys(sampleObject, SIDES, `${path}.samples`)
  const samples = { red: [], black: [] } as PieceTemplates['samples']
  for (const side of SIDES) {
    samples[side] = arrayAt(sampleObject[side], `${path}.samples.${side}`, 32).map((entry, index) => {
      const samplePath = `${path}.samples.${side}[${index}]`
      const sample = objectAt(entry, samplePath)
      exactKeys(sample, ['type', 'data'], samplePath)
      return {
        type: enumAt(sample.type, PIECE_TYPES, `${samplePath}.type`),
        data: decodeFloat32(sample.data, `${samplePath}.data`),
      }
    })
  }
  const result: PieceTemplates = {
    createdAt: timestampAt(templates.createdAt, `${path}.createdAt`),
    patch: integerAt(templates.patch, `${path}.patch`, { min: 1, max: 1_024 }),
    samples,
  }
  validatePieceSamples(result.samples, `${path}.samples`)
  return result
}

function normalizePreferences(value: unknown, path: string): BackupPreferencesV1 {
  const preferences = objectAt(value, path)
  exactKeys(preferences, ['schemaVersion', 'voiceLang', 'ttsReadback', 'autoRelisten', 'analysisMovetimeMs', 'tabletop'], path)
  if (preferences.schemaVersion !== 1) fail(`${path}.schemaVersion`, '只支援偏好設定 schema 1')
  const analysisMovetimeMs = integerAt(preferences.analysisMovetimeMs, `${path}.analysisMovetimeMs`)
  if (![500, 1_000, 2_000].includes(analysisMovetimeMs)) {
    fail(`${path}.analysisMovetimeMs`, '必須是 500、1000 或 2000')
  }
  return {
    schemaVersion: 1,
    voiceLang: enumAt(preferences.voiceLang, ['zh-TW', 'zh-CN'] as const, `${path}.voiceLang`),
    ttsReadback: booleanAt(preferences.ttsReadback, `${path}.ttsReadback`),
    autoRelisten: booleanAt(preferences.autoRelisten, `${path}.autoRelisten`),
    analysisMovetimeMs,
    tabletop: booleanAt(preferences.tabletop, `${path}.tabletop`),
  }
}

function normalizeGamesV2(
  value: unknown,
  path: string,
  allowStaleReview = false,
): { games: BackupGameV2[]; omittedStaleReviewCount: number } {
  const ids = new Set<string>()
  let omittedStaleReviewCount = 0
  const games = arrayAt(value, path).map((entry, index) => {
    const entryPath = `${path}[${index}]`
    const wrapper = objectAt(entry, entryPath)
    exactKeys(wrapper, ['stableId', 'record'], entryPath)
    const stableId = stringAt(wrapper.stableId, `${entryPath}.stableId`, { empty: false, max: 256 })
    const normalized = allowStaleReview
      ? normalizeGameRecordForArchive(wrapper.record, `${entryPath}.record`)
      : { record: normalizeGameRecord(wrapper.record, `${entryPath}.record`), staleReviewOmitted: false }
    const record = normalized.record
    if (normalized.staleReviewOmitted) omittedStaleReviewCount++
    if (stableId !== record.tree.id) fail(`${entryPath}.stableId`, '必須等於 record.tree.id')
    if (ids.has(stableId)) fail(`${entryPath}.stableId`, '棋局 stable ID 重複')
    ids.add(stableId)
    return { stableId, record }
  })
  return { games, omittedStaleReviewCount }
}

function normalizePlayers(value: unknown, path: string): PlayerRecord[] {
  const names = new Set<string>()
  return arrayAt(value, path).map((entry, index) => {
    const player = normalizePlayerRecord(entry, `${path}[${index}]`)
    if (names.has(player.name)) fail(`${path}[${index}].name`, '玩家姓名重複')
    names.add(player.name)
    return player
  })
}

function derivePlayers(games: BackupGameV2[]): PlayerRecord[] {
  const players = new Map<string, PlayerRecord>()
  for (const { record } of games) {
    for (const name of [record.redName, record.blackName]) {
      const trimmed = name.trim()
      if (!trimmed || players.has(trimmed)) continue
      players.set(trimmed, { name: trimmed, createdAt: record.startedAt })
    }
  }
  return [...players.values()]
}

function mergeDerivedPlayers(explicit: PlayerRecord[], games: BackupGameV2[]): PlayerRecord[] {
  const result = [...explicit]
  const names = new Set(result.map((player) => player.name))
  for (const player of derivePlayers(games)) {
    if (!names.has(player.name)) {
      names.add(player.name)
      result.push(player)
    }
  }
  return result
}

function normalizeV1(value: JsonObject): ParsedBackup {
  exactKeys(value, ['format', 'version', 'exportedAt', 'games'], 'backup')
  const exportedAt = timestampAt(value.exportedAt, 'backup.exportedAt')
  const ids = new Set<string>()
  let omittedStaleReviewCount = 0
  const games = arrayAt(value.games, 'backup.games').map((entry, index) => {
    const normalized = normalizeGameRecordForArchive(entry, `backup.games[${index}]`)
    const record = normalized.record
    if (normalized.staleReviewOmitted) omittedStaleReviewCount++
    const stableId = record.tree.id
    if (ids.has(stableId)) fail(`backup.games[${index}].tree.id`, '棋局 stable ID 重複')
    ids.add(stableId)
    return { stableId, record }
  })
  return {
    version: 1,
    exportedAt,
    games,
    players: derivePlayers(games),
    preferences: null,
    pieceCalibration: null,
    rankCalibration: null,
    omittedStaleReviewCount,
  }
}

function normalizeV2(value: JsonObject): ParsedBackup {
  exactKeys(value, [
    'format', 'version', 'exportedAt', 'appVersion', 'games', 'players', 'preferences', 'pieceCalibration',
    'rankCalibration',
  ], 'backup')
  const normalizedGames = normalizeGamesV2(value.games, 'backup.games', true)
  const games = normalizedGames.games
  const players = mergeDerivedPlayers(normalizePlayers(value.players, 'backup.players'), games)
  return {
    version: 2,
    exportedAt: timestampAt(value.exportedAt, 'backup.exportedAt'),
    appVersion: stringAt(value.appVersion, 'backup.appVersion', { empty: false, max: 256 }),
    games,
    players,
    preferences: normalizePreferences(value.preferences, 'backup.preferences'),
    pieceCalibration: value.pieceCalibration === null
      ? null
      : decodePieceTemplates(value.pieceCalibration, 'backup.pieceCalibration'),
    rankCalibration: normalizeRankCalibrationExport(value.rankCalibration, 'backup.rankCalibration'),
    omittedStaleReviewCount: normalizedGames.omittedStaleReviewCount,
  }
}

export function parseBackup(text: string): ParsedBackup {
  if (typeof text !== 'string') fail('backup', '必須是 JSON 字串')
  assertBackupTextSize(text)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    fail('backup', 'JSON 格式損壞')
  }
  const value = objectAt(parsed, 'backup')
  if (value.format !== BACKUP_FORMAT) fail('backup.format', '不是本 App 的備份檔')
  if (value.version === 1) return normalizeV1(value)
  if (value.version === 2) return normalizeV2(value)
  if (typeof value.version === 'number' && value.version > BACKUP_VERSION) {
    fail('backup.version', `備份版本 ${value.version} 較新，請更新 App 後再試`)
  }
  fail('backup.version', '只支援備份版本 1 或 2')
}

export function inspectBackup(text: string): BackupInspection {
  const parsed = parseBackup(text)
  return {
    version: parsed.version,
    exportedAt: parsed.exportedAt,
    ...(parsed.appVersion === undefined ? {} : { appVersion: parsed.appVersion }),
    gameCount: parsed.games.length,
    playerCount: parsed.players.length,
    profileCount: parsed.rankCalibration?.profiles.length ?? 0,
    calibrationGameCount: parsed.rankCalibration?.games.length ?? 0,
    hasPreferences: parsed.preferences !== null,
    hasPieceCalibration: parsed.pieceCalibration !== null,
    isLegacyV1: parsed.version === 1,
    omittedStaleReviewCount: parsed.omittedStaleReviewCount,
  }
}

export function buildBackupFileV2(input: BuildBackupFileV2Input): BackupFileV2 {
  const preferences = normalizePreferences(
    { ...input.preferences, schemaVersion: 1 },
    'backup.preferences',
  )
  const games = normalizeGamesV2(
    input.games.map((record) => ({ stableId: record.tree?.id, record })),
    'backup.games',
  ).games
  const players = mergeDerivedPlayers(normalizePlayers(input.players, 'backup.players'), games)
  const result: BackupFileV2 = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: timestampAt(input.exportedAt, 'backup.exportedAt'),
    appVersion: stringAt(input.appVersion, 'backup.appVersion', { empty: false, max: 256 }),
    games,
    players,
    preferences,
    pieceCalibration: input.pieceCalibration === null ? null : encodePieceTemplates(input.pieceCalibration, 'backup.pieceCalibration'),
    rankCalibration: normalizeRankCalibrationExport(input.rankCalibration, 'backup.rankCalibration'),
  }
  return result
}

export function canonicalJson(normalized: unknown): string {
  const result = JSON.stringify(normalized)
  if (result === undefined) fail('value', '無法轉成 JSON')
  return result
}
