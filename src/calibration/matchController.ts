import { applyMove, moveEquals, opposite, type Move, type Side } from '../core/board'
import {
  countConsecutiveNonCapturePlies,
  countCurrentPositionOccurrences,
} from '../core/adjudication'
import { formatFen, parseFen, START_FEN } from '../core/fen'
import { gameStatus, legalMoves } from '../core/movegen'
import { moveNotations, parseUciMove } from '../core/notation'
import { mainline, type GameNode } from '../core/tree'
import { buildCalibrationGameV2 } from './rankArchive'
import { fnv1a32Utf8, selectHumanMoveV1 } from './humanMove'
import {
  CALIBRATION_COLLECTION_PROTOCOL_V1,
  type CalibrationAnalyzeSnapshotV1,
  type CalibrationGameV2,
  type CalibratorProfile,
} from './rankTypes'
import type { Phase2AnchorProtocolV1 } from './phase2Protocol'

export const CALIBRATION_COMPLETED_REASON_LABELS = {
  checkmate: '絕殺',
  stalemate: '困斃',
  'human-resigned': '協助者認輸',
  'agreed-draw': '雙方同意和棋',
  'cycle-ruling': '循環局面裁定',
  'natural-limit-ruling': '自然限著裁定',
  'referee-ruling': '裁判裁定',
} as const

export type CalibrationCompletedReasonCode = keyof typeof CALIBRATION_COMPLETED_REASON_LABELS

export const CALIBRATION_ABORT_REASON_LABELS = {
  'operator-aborted': '操作者中止',
  'participant-withdrew': '協助者退出',
  'engine-unavailable': '引擎無法使用',
  'invalid-setup': '建局設定無效',
  'app-version-changed': 'App 版本已變更',
  'other-invalid': '其他無效局',
} as const

export type CalibrationAbortReasonCode = keyof typeof CALIBRATION_ABORT_REASON_LABELS
export type CalibrationCompletedResult = 'red' | 'black' | 'draw'

export interface CreateCalibrationMatchDraftInput {
  id: string
  sessionId: string
  profile: CalibratorProfile
  anchor: Phase2AnchorProtocolV1
  randomSeed: string
  sequenceIndex: number
  startedAt: number
  appVersion: string
  initialFen?: string
}

export interface CalibrationMatchToken {
  id: string
  sessionId: string
  currentPly: number
  updatedAt: number
  status: CalibrationGameV2['status']
}

export interface CalibrationAutomaticOutcome {
  result: 'red' | 'black'
  reason: 'checkmate' | 'stalemate'
}

export interface CalibrationRuleProgress {
  currentPositionOccurrences: number
  consecutiveNonCapturePlies: number
  repetitionReviewRecommended: boolean
  naturalLimitReviewRecommended: boolean
  inCheck: boolean
  automaticOutcome: CalibrationAutomaticOutcome | null
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

type CalibrationInProgressGame = Extract<CalibrationGameV2, { status: 'in-progress' }>

const validatedCopy = (game: CalibrationGameV2): CalibrationGameV2 => {
  const copy = clone(game)
  const { schemaVersion: _schemaVersion, ...input } = copy
  void _schemaVersion
  return buildCalibrationGameV2(input)
}

const requireInProgress = (game: CalibrationGameV2): CalibrationInProgressGame => {
  const normalized = validatedCopy(game)
  if (normalized.status !== 'in-progress') throw new Error('已完成或中止的校準局不可再修改')
  return normalized as CalibrationInProgressGame
}

const nextTimestamp = (game: CalibrationGameV2, at: number): number => {
  if (!Number.isSafeInteger(at) || at < 0) throw new Error('transition time 必須是非負安全整數')
  if (game.updatedAt >= Number.MAX_SAFE_INTEGER) throw new Error('updatedAt 已無法安全遞增')
  return Math.max(at, game.updatedAt + 1)
}

const gameHash = (gameId: string): string => fnv1a32Utf8(gameId).toString(16).padStart(8, '0')

const collectNodeIds = (root: GameNode): Set<string> => {
  const ids = new Set<string>()
  let node: GameNode | undefined = root
  while (node) {
    ids.add(node.id)
    node = node.children[0]
  }
  return ids
}

const nextNodeId = (game: CalibrationGameV2, ply: number): string => {
  const ids = collectNodeIds(game.gameSnapshot)
  const base = `cal-${gameHash(game.id)}-p${ply}`
  if (!ids.has(base)) return base
  let suffix = 2
  while (ids.has(`${base}-${suffix}`)) suffix++
  return `${base}-${suffix}`
}

const currentNode = (root: GameNode): GameNode => {
  let node = root
  while (node.children.length > 0) node = node.children[0]
  return node
}

const appendMove = (game: CalibrationGameV2, move: Move, at: number): void => {
  const parent = currentNode(game.gameSnapshot)
  const position = parseFen(parent.fenAfter)
  const notation = moveNotations(position, move)
  const child: GameNode = {
    id: nextNodeId(game, game.currentPly + 1),
    move: { ...move },
    zh: notation.zh,
    wxf: notation.wxf,
    fenAfter: formatFen(applyMove(position, move)),
    tMs: at - game.startedAt,
    children: [],
  }
  parent.children = [child]
  game.currentPly++
  game.updatedAt = at
}

const automaticOutcome = (game: CalibrationGameV2): CalibrationAutomaticOutcome | null => {
  const status = gameStatus(parseFen(currentNode(game.gameSnapshot).fenAfter))
  if (!status.over || !status.winner || !status.reason) return null
  return { result: status.winner, reason: status.reason }
}

const finishAutomatically = (game: CalibrationGameV2): CalibrationGameV2 => {
  const outcome = automaticOutcome(game)
  if (!outcome) return buildDraft(game)
  return buildDraft({
    ...game,
    status: 'completed',
    result: outcome.result,
    resultReason: outcome.reason,
    endedAt: game.updatedAt,
  })
}

const buildDraft = (game: CalibrationGameV2): CalibrationGameV2 => {
  const { schemaVersion: _schemaVersion, ...input } = game
  void _schemaVersion
  return buildCalibrationGameV2(input)
}

export const createCalibrationMatchDraft = (
  input: CreateCalibrationMatchDraftInput,
): CalibrationGameV2 => {
  const initialFen = input.initialFen ?? START_FEN
  const playerSide: Side = input.sequenceIndex % 2 === 0 ? 'red' : 'black'
  return buildCalibrationGameV2({
    id: input.id,
    sessionId: input.sessionId,
    collectionProtocolVersion: CALIBRATION_COLLECTION_PROTOCOL_V1,
    profileId: input.profile.id,
    profileRevision: input.profile.revision,
    profileSnapshot: clone(input.profile),
    anchorId: input.anchor.id,
    anchorConfigVersion: input.anchor.configVersion,
    movePolicyVersion: input.anchor.policy.version,
    anchorSnapshot: clone(input.anchor),
    randomSeed: input.randomSeed,
    playerSide,
    sideAssignment: {
      version: 'balanced-alternation-v1',
      sequenceIndex: input.sequenceIndex,
    },
    status: 'in-progress',
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    initialFen,
    currentPly: 0,
    gameSnapshot: {
      id: `cal-${gameHash(input.id)}-root`,
      move: null,
      fenAfter: initialFen,
      children: [],
    },
    engineMoves: [],
    appVersion: input.appVersion,
  })
}

export const calibrationMatchToken = (game: CalibrationGameV2): CalibrationMatchToken => {
  const normalized = validatedCopy(game)
  return {
    id: normalized.id,
    sessionId: normalized.sessionId,
    currentPly: normalized.currentPly,
    updatedAt: normalized.updatedAt,
    status: normalized.status,
  }
}

export const applyHumanCalibrationMoveDraft = (
  game: CalibrationGameV2,
  move: Move,
  at: number,
): CalibrationGameV2 => {
  const next = requireInProgress(game)
  const position = parseFen(currentNode(next.gameSnapshot).fenAfter)
  if (position.turn !== next.playerSide) throw new Error('目前不是協助者回合')
  if (!legalMoves(position).some((candidate) => moveEquals(candidate, move))) {
    throw new Error('不是目前局面的合法著法')
  }
  appendMove(next, move, nextTimestamp(next, at))
  return finishAutomatically(next)
}

export const applyEngineCalibrationMoveDraft = (
  game: CalibrationGameV2,
  analysis: CalibrationAnalyzeSnapshotV1,
  at: number,
): CalibrationGameV2 => {
  const next = requireInProgress(game)
  const parent = currentNode(next.gameSnapshot)
  const position = parseFen(parent.fenAfter)
  if (position.turn === next.playerSide) throw new Error('目前不是引擎回合')
  const ply = next.currentPly + 1
  const decision = selectHumanMoveV1({
    lines: analysis.lines,
    bestmove: analysis.bestmove,
    fen: parent.fenAfter,
    gameSeed: next.randomSeed,
    ply,
    policy: next.anchorSnapshot.policy,
    anomalies: analysis.anomalies,
  })
  const move = parseUciMove(decision.selectedUci)
  if (!move || !legalMoves(position).some((candidate) => moveEquals(candidate, move))) {
    throw new Error('引擎選著不是目前局面的合法著法')
  }
  const transitionedAt = nextTimestamp(next, at)
  appendMove(next, move, transitionedAt)
  next.engineMoves.push({
    schemaVersion: 1,
    ply,
    fenBefore: parent.fenAfter,
    selectedUci: decision.selectedUci,
    playedAt: transitionedAt,
    analysis: clone(analysis),
    decision,
  })
  return finishAutomatically(next)
}

export const completeCalibrationMatchDraft = (
  game: CalibrationGameV2,
  result: CalibrationCompletedResult,
  reason: CalibrationCompletedReasonCode,
  at: number,
): CalibrationGameV2 => {
  const next = requireInProgress(game)
  if (!Object.prototype.hasOwnProperty.call(CALIBRATION_COMPLETED_REASON_LABELS, reason)) {
    throw new Error('不支援的完成原因代碼')
  }
  const automatic = automaticOutcome(next)
  if (automatic) {
    if (reason !== automatic.reason || result !== automatic.result) {
      throw new Error('目前局面已有絕殺／困斃，只能保存自動判定結果')
    }
  } else if (reason === 'checkmate' || reason === 'stalemate') {
    throw new Error('目前局面不符合指定的自動終局原因')
  }
  if (reason === 'human-resigned' && result !== opposite(next.playerSide)) {
    throw new Error('協助者認輸時勝方必須是引擎方')
  }
  if (reason === 'agreed-draw' && result !== 'draw') {
    throw new Error('雙方同意和棋的結果必須是和棋')
  }
  const ruleProgress = getCalibrationRuleProgress(next)
  if (reason === 'natural-limit-ruling') {
    if (!ruleProgress.naturalLimitReviewRecommended) {
      throw new Error('尚未達到連續 100 著未吃子的自然限著裁定門檻')
    }
    if (result !== 'draw') throw new Error('自然限著裁定結果必須是和棋')
  }
  if (reason === 'cycle-ruling' && !ruleProgress.repetitionReviewRecommended) {
    throw new Error('目前局面尚未出現三次，不能保存循環盤面裁定')
  }
  const endedAt = nextTimestamp(next, at)
  return buildDraft({
    ...next,
    status: 'completed',
    result,
    resultReason: reason,
    endedAt,
    updatedAt: endedAt,
  })
}

export const abortCalibrationMatchDraft = (
  game: CalibrationGameV2,
  reason: CalibrationAbortReasonCode,
  at: number,
): CalibrationGameV2 => {
  const next = requireInProgress(game)
  if (!Object.prototype.hasOwnProperty.call(CALIBRATION_ABORT_REASON_LABELS, reason)) {
    throw new Error('不支援的中止原因代碼')
  }
  const endedAt = nextTimestamp(next, at)
  return buildDraft({
    ...next,
    status: 'aborted',
    resultReason: reason,
    endedAt,
    updatedAt: endedAt,
  })
}

export const getCalibrationRuleProgress = (game: CalibrationGameV2): CalibrationRuleProgress => {
  const normalized = validatedCopy(game)
  const path = mainline(normalized.gameSnapshot)
  const fens = [normalized.initialFen, ...path.map((node) => node.fenAfter)]
  const currentStatus = gameStatus(parseFen(fens[fens.length - 1]))
  const currentPositionOccurrences = countCurrentPositionOccurrences(fens)
  const consecutiveNonCapturePlies = countConsecutiveNonCapturePlies(normalized.initialFen, path)
  return {
    currentPositionOccurrences,
    consecutiveNonCapturePlies,
    repetitionReviewRecommended: currentPositionOccurrences >= 3,
    naturalLimitReviewRecommended: consecutiveNonCapturePlies >= 100,
    inCheck: currentStatus.inCheck,
    automaticOutcome:
      currentStatus.over && currentStatus.winner && currentStatus.reason
        ? { result: currentStatus.winner, reason: currentStatus.reason }
        : null,
  }
}
