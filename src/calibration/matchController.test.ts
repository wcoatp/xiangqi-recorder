import { describe, expect, it } from 'vitest'
import { sq } from '../core/board'
import { parseFen, START_FEN } from '../core/fen'
import { legalMoves } from '../core/movegen'
import { uciMove } from '../core/notation'
import { mainline } from '../core/tree'
import type { CalibrationAnalyzeSnapshotV1, CalibratorProfile } from './rankTypes'
import { PHASE2_ANCHORS } from './phase2Protocol'
import {
  CALIBRATION_ABORT_REASON_LABELS,
  CALIBRATION_COMPLETED_REASON_LABELS,
  abortCalibrationMatchDraft,
  applyEngineCalibrationMoveDraft,
  applyHumanCalibrationMoveDraft,
  calibrationMatchToken,
  completeCalibrationMatchDraft,
  createCalibrationMatchDraft,
  getCalibrationRuleProgress,
  type CreateCalibrationMatchDraftInput,
} from './matchController'

const NOW = 1_750_000_000_000

const profile = (): CalibratorProfile => ({
  id: 'controller-profile',
  revision: 1,
  alias: '現場棋友',
  claimedRank: '3段',
  rankSystem: '棋友自評',
  consentedAt: NOW,
  createdAt: NOW,
})

const input = (
  sequenceIndex = 0,
  initialFen = START_FEN,
): CreateCalibrationMatchDraftInput => ({
  id: `controller-game-${sequenceIndex}`,
  sessionId: 'field-session-1',
  profile: profile(),
  anchor: PHASE2_ANCHORS[4],
  randomSeed: `controller-seed-${sequenceIndex}`,
  sequenceIndex,
  startedAt: NOW,
  appVersion: '0.7.0',
  initialFen,
})

const currentFen = (game: ReturnType<typeof createCalibrationMatchDraft>): string => {
  const path = mainline(game.gameSnapshot)
  return path[path.length - 1]?.fenAfter ?? game.initialFen
}

const analysisFor = (
  game: ReturnType<typeof createCalibrationMatchDraft>,
  preferredUci?: string,
): CalibrationAnalyzeSnapshotV1 => {
  const moves = legalMoves(parseFen(currentFen(game)))
  const preferred = preferredUci
    ? moves.find((move) => uciMove(move) === preferredUci)
    : moves[0]
  if (!preferred) throw new Error('測試局面找不到指定合法著')
  return {
    nodes: game.anchorSnapshot.search.nodes,
    multipv: game.anchorSnapshot.search.multipv,
    lines: [{
      multipv: 1,
      depth: 12,
      scoreCp: 100,
      pv: [uciMove(preferred)],
    }],
    bestmove: uciMove(preferred),
    completedDepth: 12,
    completeCandidateBatch: false,
    anomalies: [`incomplete-multipv-batch:1/${game.anchorSnapshot.search.multipv}`],
  }
}

describe('PIN 內校準對弈純 controller', () => {
  it('建立 ply 0 draft，偶紅奇黑並保存 self-contained snapshots', () => {
    const evenInput = input(0)
    const even = createCalibrationMatchDraft(evenInput)
    const odd = createCalibrationMatchDraft(input(1))

    expect(even).toMatchObject({
      schemaVersion: 2,
      collectionProtocolVersion: 'pin-gated-local-match-v1',
      playerSide: 'red',
      sideAssignment: { version: 'balanced-alternation-v1', sequenceIndex: 0 },
      status: 'in-progress',
      currentPly: 0,
      engineMoves: [],
    })
    expect(odd.playerSide).toBe('black')
    expect(even.profileSnapshot).toEqual(evenInput.profile)
    expect(even.profileSnapshot).not.toBe(evenInput.profile)
    expect(even.anchorSnapshot).toEqual(evenInput.anchor)
    expect(even.gameSnapshot.id).toMatch(/^cal-[0-9a-f]{8}-root$/)
  })

  it('token 只含 CAS 所需 identity/state 欄位', () => {
    const game = createCalibrationMatchDraft(input())
    expect(calibrationMatchToken(game)).toEqual({
      id: game.id,
      sessionId: game.sessionId,
      currentPly: 0,
      updatedAt: NOW,
      status: 'in-progress',
    })
  })

  it('人類合法著 immutable append，時間同毫秒仍嚴格遞增', () => {
    const game = createCalibrationMatchDraft(input())
    const before = JSON.stringify(game)
    const next = applyHumanCalibrationMoveDraft(game, { from: 27, to: 36 }, NOW)

    expect(JSON.stringify(game)).toBe(before)
    expect(next.currentPly).toBe(1)
    expect(next.updatedAt).toBe(NOW + 1)
    expect(mainline(next.gameSnapshot)[0]).toMatchObject({ move: { from: 27, to: 36 }, tMs: 1 })
    expect(next.status).toBe('in-progress')
  })

  it('拒絕不可能跳躍著、錯方回合與非法時間', () => {
    const game = createCalibrationMatchDraft(input())
    expect(() => applyHumanCalibrationMoveDraft(game, { from: 0, to: 80 }, NOW + 1)).toThrow(/合法著法/)

    const afterHuman = applyHumanCalibrationMoveDraft(game, { from: 27, to: 36 }, NOW + 1)
    expect(() => applyHumanCalibrationMoveDraft(afterHuman, { from: 29, to: 38 }, NOW + 2)).toThrow(/協助者回合/)
    expect(() => applyHumanCalibrationMoveDraft(game, { from: 27, to: 36 }, Number.NaN)).toThrow(/transition time/)
  })

  it('引擎著使用 seeded selection，tree 與完整 decision 同步 append', () => {
    const game = createCalibrationMatchDraft(input(1))
    const before = JSON.stringify(game)
    const analysis = analysisFor(game)
    const next = applyEngineCalibrationMoveDraft(game, analysis, NOW + 10)

    expect(JSON.stringify(game)).toBe(before)
    expect(next.currentPly).toBe(1)
    expect(next.engineMoves).toHaveLength(1)
    expect(next.engineMoves[0]).toMatchObject({
      ply: 1,
      fenBefore: START_FEN,
      analysis,
    })
    expect(next.engineMoves[0].decision.selectedUci).toBe(next.engineMoves[0].selectedUci)
    expect(uciMove(mainline(next.gameSnapshot)[0].move!)).toBe(next.engineMoves[0].selectedUci)
  })

  it('拒絕錯方引擎 transition 與不符合 anchor 的搜尋 snapshot', () => {
    const humanStarts = createCalibrationMatchDraft(input(0))
    expect(() => applyEngineCalibrationMoveDraft(humanStarts, analysisFor(humanStarts), NOW + 1)).toThrow(/引擎回合/)

    const engineStarts = createCalibrationMatchDraft(input(1))
    const wrongNodes = { ...analysisFor(engineStarts), nodes: 123 }
    expect(() => applyEngineCalibrationMoveDraft(engineStarts, wrongNodes, NOW + 1)).toThrow(/fixed-nodes/)
  })

  it('人類著造成困斃時在同一 transition 自動 completed', () => {
    const fen = '4k4/5P3/3P5/9/9/9/9/9/9/3K5 w - - 0 1'
    const game = createCalibrationMatchDraft(input(0, fen))
    const next = applyHumanCalibrationMoveDraft(game, { from: sq(7, 3), to: sq(8, 3) }, NOW + 1)

    expect(next).toMatchObject({
      status: 'completed',
      result: 'red',
      resultReason: 'stalemate',
      endedAt: NOW + 1,
    })
    expect(getCalibrationRuleProgress(next).automaticOutcome).toEqual({ result: 'red', reason: 'stalemate' })
  })

  it('引擎著造成絕殺時在 engine record 同一 transition 自動 completed', () => {
    const fen = '4k4/3R1R3/4R4/9/9/9/9/9/9/3K5 w - - 0 1'
    const game = createCalibrationMatchDraft(input(1, fen))
    const next = applyEngineCalibrationMoveDraft(game, analysisFor(game, 'e8e9'), NOW + 1)

    expect(next).toMatchObject({ status: 'completed', result: 'red', resultReason: 'checkmate' })
    expect(next.engineMoves).toHaveLength(1)
    expect(next.endedAt).toBe(next.engineMoves[0].playedAt)
  })

  it('人工完成原因維持穩定 code 並檢查結果一致性', () => {
    const game = createCalibrationMatchDraft(input())
    expect(() => completeCalibrationMatchDraft(game, 'red', 'human-resigned', NOW + 1)).toThrow(/勝方必須是引擎方/)
    expect(() => completeCalibrationMatchDraft(game, 'red', 'agreed-draw', NOW + 1)).toThrow(/必須是和棋/)
    expect(() => completeCalibrationMatchDraft(game, 'draw', 'checkmate', NOW + 1)).toThrow(/不符合指定/)
    expect(() => completeCalibrationMatchDraft(game, 'draw', 'natural-limit-ruling', NOW + 1)).toThrow(/100 著/)
    expect(() => completeCalibrationMatchDraft(game, 'draw', 'cycle-ruling', NOW + 1)).toThrow(/三次/)
    expect(() => completeCalibrationMatchDraft(game, 'draw', 'unknown' as never, NOW + 1)).toThrow(/不支援/)

    const resigned = completeCalibrationMatchDraft(game, 'black', 'human-resigned', NOW + 1)
    expect(resigned).toMatchObject({ status: 'completed', result: 'black', resultReason: 'human-resigned' })
    expect(CALIBRATION_COMPLETED_REASON_LABELS['human-resigned']).toBe('協助者認輸')
  })

  it('中止使用穩定 code，terminal draft immutable', () => {
    const game = createCalibrationMatchDraft(input())
    expect(() => abortCalibrationMatchDraft(game, 'unknown' as never, NOW + 1)).toThrow(/不支援/)
    const aborted = abortCalibrationMatchDraft(game, 'engine-unavailable', NOW + 1)
    expect(aborted).toMatchObject({
      status: 'aborted',
      resultReason: 'engine-unavailable',
      endedAt: NOW + 1,
    })
    expect(CALIBRATION_ABORT_REASON_LABELS['engine-unavailable']).toBe('引擎無法使用')
    expect(() => abortCalibrationMatchDraft(aborted, 'operator-aborted', NOW + 2)).toThrow(/不可再修改/)
    expect(() => completeCalibrationMatchDraft(aborted, 'draw', 'referee-ruling', NOW + 2)).toThrow(/不可再修改/)
  })

  it('規則進度由 initial FEN 與線性主線重算，不把一次出現誤報為循環', () => {
    const game = createCalibrationMatchDraft(input())
    expect(getCalibrationRuleProgress(game)).toMatchObject({
      currentPositionOccurrences: 1,
      consecutiveNonCapturePlies: 0,
      repetitionReviewRecommended: false,
      naturalLimitReviewRecommended: false,
      automaticOutcome: null,
    })
    const next = applyHumanCalibrationMoveDraft(game, { from: 27, to: 36 }, NOW + 1)
    expect(getCalibrationRuleProgress(next)).toMatchObject({
      currentPositionOccurrences: 1,
      consecutiveNonCapturePlies: 1,
      repetitionReviewRecommended: false,
      naturalLimitReviewRecommended: false,
    })
  })
})
