import { describe, expect, it } from 'vitest'
import { START_FEN, parseFen } from '../core/fen'
import { legalMoves } from '../core/movegen'
import { uciMove } from '../core/notation'
import type { PvLine } from '../engine/engineClient'
import {
  boundedQuadraticWeight,
  fnv1a32Utf8,
  mulberry32FirstUint,
  selectHumanMoveV1,
  verifyHumanMoveDecisionV1,
  type HumanMoveDecisionV1,
  type SelectHumanMoveInputV1,
} from './humanMove'
import {
  HUMAN_MOVE_POLICY_VERSION,
  PHASE2_ANCHORS,
  type HumanMovePolicyV1,
} from './phase2Protocol'

const line = (
  uci: string,
  score: number,
  multipv: number,
  depth = 18,
): PvLine => ({ multipv, depth, scoreCp: score, pv: [uci, 'a10a9'] })

const mateLine = (uci: string, mate: number, multipv: number): PvLine => ({
  multipv,
  depth: 18,
  mate,
  pv: [uci],
})

const policy = (
  topK = 8,
  temperatureCp = 160,
  maxLossCp = 700,
): HumanMovePolicyV1 => ({
  version: HUMAN_MOVE_POLICY_VERSION,
  topK,
  temperatureCp,
  maxLossCp,
  preserveForcedMate: true,
})

const goldenInput = (): SelectHumanMoveInputV1 => ({
  lines: [line('g4g5', -200, 4), line('a1a2', 120, 1), line('e4e5', 20, 3), line('c4c5', 80, 2)],
  bestmove: 'a1a2',
  fen: START_FEN,
  gameSeed: '校準-seed-001',
  ply: 17,
  policy: policy(6, 160, 440),
  anomalies: [],
})

const mutableCopy = (decision: HumanMoveDecisionV1): Record<string, any> =>
  JSON.parse(JSON.stringify(decision)) as Record<string, any>

describe('seeded-multipv-v1 選著核心', () => {
  it('固定 FNV-1a、Mulberry32、整數權重與 golden decision', () => {
    expect(fnv1a32Utf8('hello')).toBe(0x4f9f2cab)
    expect(mulberry32FirstUint(0)).toBe(1144304738)
    expect(boundedQuadraticWeight(160, 0)).toBe(1_000_000)
    expect(boundedQuadraticWeight(160, 40)).toBe(640_000)

    const decision = selectHumanMoveV1(goldenInput())
    expect(decision.decisionSeedHash).toBe('14a3e84d')
    expect(decision.randomUint).toBe(21211399)
    expect(decision.randomUnit).toBe(0.004938663681969047)
    expect(decision.candidates.map((candidate) => [candidate.uci, candidate.lossCp, candidate.weight])).toEqual([
      ['a1a2', 0, 1_000_000],
      ['c4c5', 40, 640_000],
      ['e4e5', 100, 378_698],
      ['g4g5', 320, 111_111],
    ])
    expect(decision.totalWeight).toBe(2_129_809)
    expect(decision.threshold).toBe(10_518)
    expect(decision.selectedUci).toBe('a1a2')
    expect(decision.quality).toBe('complete')
    expect(decision.anomalies).toEqual([])
    expect(Object.isFrozen(decision)).toBe(true)
    expect(Object.isFrozen(decision.candidates[0].pv)).toBe(true)
  })

  it('候選輸入排列與 FEN 空白不影響 byte-equivalent decision', () => {
    const input = goldenInput()
    const expected = selectHumanMoveV1(input)
    const permuted = selectHumanMoveV1({
      ...input,
      lines: [...input.lines].reverse(),
      fen: `  ${START_FEN.replaceAll(' ', '   ')}  `,
    })
    expect(permuted).toEqual(expected)
    expect(JSON.stringify(permuted)).toBe(JSON.stringify(expected))
  })

  it('同分候選固定依 UCI 升冪 tie-break', () => {
    const tiedLines = [line('c4c5', 100, 1), line('a1a2', 100, 2)]
    const input: SelectHumanMoveInputV1 = {
      lines: tiedLines,
      bestmove: 'a1a2',
      fen: START_FEN,
      gameSeed: 'tie-break',
      ply: 8,
      policy: policy(),
      anomalies: [],
    }
    const decision = selectHumanMoveV1(input)
    expect(decision.candidates.map((candidate) => candidate.uci)).toEqual(['a1a2', 'c4c5'])
    expect(selectHumanMoveV1({ ...input, lines: [...tiedLines].reverse() })).toEqual(decision)
  })

  it('非法、重複、topK 與 max-loss 候選會留下原因但永遠不入選', () => {
    const lines = [
      line('g4g5', 0, 6),
      line('a1a2', 90, 3),
      line('e4e5', 50, 5),
      line('a4b4', 999, 1),
      line('c4c5', 80, 4),
      line('a1a2', 100, 2),
    ]
    const input: SelectHumanMoveInputV1 = {
      lines,
      bestmove: 'a1a2',
      fen: START_FEN,
      gameSeed: 'filter-grid',
      ply: 0,
      policy: policy(2, 100, 70),
      anomalies: [],
    }
    const decision = selectHumanMoveV1(input)
    const byScoreAndUci = Object.fromEntries(decision.candidates.map((candidate) => [`${candidate.uci}:${candidate.normalizedCp}`, candidate]))
    expect(byScoreAndUci['a4b4:999'].ineligibility).toContain('illegal')
    expect(byScoreAndUci['a1a2:90'].ineligibility).toContain('duplicate')
    expect(byScoreAndUci['e4e5:50'].ineligibility).toContain('beyond-top-k')
    expect(byScoreAndUci['g4g5:0'].ineligibility).toEqual(
      expect.arrayContaining(['beyond-top-k', 'exceeds-max-loss']),
    )
    expect(decision.candidates.find((candidate) => candidate.uci === decision.selectedUci)?.eligible).toBe(true)
    expect(decision.anomalies).toContain('filtered-candidates:2')
    expect(decision.quality).toBe('anomalous-candidate-selection')
    expect(selectHumanMoveV1({ ...input, lines: [...lines].reverse() })).toEqual(decision)
  })

  it('正 mate 保留強制殺棋，存在非敗著時排除負 mate', () => {
    const forced = selectHumanMoveV1({
      lines: [mateLine('a1a2', 3, 1), line('c4c5', 29990, 2), mateLine('e4e5', 5, 3)],
      bestmove: 'a1a2', fen: START_FEN, gameSeed: 'forced', ply: 1, policy: policy(), anomalies: [],
    })
    expect(forced.candidates.map((candidate) => [candidate.uci, candidate.normalizedCp])).toEqual([
      ['a1a2', 29997],
      ['e4e5', 29995],
      ['c4c5', 29990],
    ])
    expect(forced.candidates.find((candidate) => candidate.uci === 'c4c5')?.ineligibility).toContain(
      'forced-mate-protection',
    )
    expect(forced.candidates.filter((candidate) => candidate.eligible).map((candidate) => candidate.uci)).toEqual([
      'a1a2',
      'e4e5',
    ])

    const avoidLosingMate = selectHumanMoveV1({
      lines: [line('a1a2', -29900, 1), mateLine('c4c5', -1, 2)],
      bestmove: 'a1a2', fen: START_FEN, gameSeed: 'avoid-loss', ply: 2, policy: policy(), anomalies: [],
    })
    expect(avoidLosingMate.candidates.find((candidate) => candidate.uci === 'c4c5')?.normalizedCp).toBe(-29999)
    expect(avoidLosingMate.candidates.find((candidate) => candidate.uci === 'c4c5')?.ineligibility).toContain(
      'losing-mate-protection',
    )

    const allLosingMates = selectHumanMoveV1({
      lines: [mateLine('a1a2', -5, 1), mateLine('c4c5', -3, 2)],
      bestmove: 'a1a2', fen: START_FEN, gameSeed: 'all-losing', ply: 3, policy: policy(), anomalies: [],
    })
    expect(allLosingMates.candidates.some((candidate) => candidate.eligible)).toBe(true)
  })

  it('候選不足只 fallback 到合法 bestmove，全部無效時拒絕', () => {
    const fallback = selectHumanMoveV1({
      lines: [line('a4b4', 100, 1), { multipv: 2, depth: 18, scoreCp: 110, pv: [] }],
      bestmove: 'a1a2',
      fen: START_FEN,
      gameSeed: 'fallback',
      ply: 4,
      policy: policy(),
      anomalies: ['missing-multipv-batch'],
    })
    expect(fallback.selectedUci).toBe('a1a2')
    expect(fallback.quality).toBe('bestmove-fallback')
    expect(fallback.totalWeight).toBe(0)
    expect(fallback.threshold).toBeNull()
    expect(fallback.candidates.find((candidate) => candidate.uci === '')?.ineligibility).toContain('missing-pv')
    expect(fallback.anomalies).toEqual([
      'bestmove-fallback',
      'filtered-candidates:2',
      'missing-multipv-batch',
    ])

    expect(() =>
      selectHumanMoveV1({
        lines: [line('a4b4', 100, 1)], bestmove: 'a4b4', fen: START_FEN,
        gameSeed: 'reject', ply: 4, policy: policy(), anomalies: [],
      }),
    ).toThrow('沒有合法候選著或合法 bestmove')
  })

  it('verifier 從原輸入重播，任何 decision 衍生值竄改都失敗', () => {
    const input = goldenInput()
    const decision = selectHumanMoveV1(input)
    expect(verifyHumanMoveDecisionV1(input, decision)).toBe(true)

    const selected = mutableCopy(decision)
    selected.selectedUci = 'c4c5'
    expect(verifyHumanMoveDecisionV1(input, selected)).toBe(false)

    const random = mutableCopy(decision)
    random.randomUint += 1
    expect(verifyHumanMoveDecisionV1(input, random)).toBe(false)

    const threshold = mutableCopy(decision)
    threshold.threshold += 1
    expect(verifyHumanMoveDecisionV1(input, threshold)).toBe(false)

    const weight = mutableCopy(decision)
    weight.candidates[0].weight -= 1
    expect(verifyHumanMoveDecisionV1(input, weight)).toBe(false)

    const candidate = mutableCopy(decision)
    candidate.candidates[0].pv[0] = 'c4c5'
    expect(verifyHumanMoveDecisionV1(input, candidate)).toBe(false)
  })

  it('seed、ply 變更會改變已知 sample，所有數值維持 JSON-safe', () => {
    const input = goldenInput()
    const base = selectHumanMoveV1(input)
    const changedSeed = selectHumanMoveV1({ ...input, gameSeed: '校準-seed-002' })
    const changedPly = selectHumanMoveV1({ ...input, ply: input.ply + 1 })
    expect(new Set([base.decisionSeedHash, changedSeed.decisionSeedHash, changedPly.decisionSeedHash]).size).toBe(3)
    expect(new Set([base.randomUint, changedSeed.randomUint, changedPly.randomUint]).size).toBe(3)
    expect(JSON.parse(JSON.stringify(base))).toEqual(base)
    expect([base, changedSeed, changedPly].every((decision) => Number.isFinite(decision.randomUnit))).toBe(true)
  })

  it('拒絕 ambiguous、缺漏或非有限 score', () => {
    const common = {
      bestmove: 'a1a2', fen: START_FEN, gameSeed: 'invalid-score', ply: 0,
      policy: policy(), anomalies: [],
    }
    expect(() => selectHumanMoveV1({ ...common, lines: [{ multipv: 1, depth: 1, pv: ['a1a2'] }] })).toThrow(
      '必須且只能有一種 score',
    )
    expect(() =>
      selectHumanMoveV1({ ...common, lines: [{ multipv: 1, depth: 1, scoreCp: 0, mate: 1, pv: ['a1a2'] }] }),
    ).toThrow('必須且只能有一種 score')
    expect(() =>
      selectHumanMoveV1({ ...common, lines: [{ multipv: 1, depth: 1, scoreCp: Number.NaN, pv: ['a1a2'] }] }),
    ).toThrow('安全整數')
  })

  it('mate 距離保持在轉分公式的有效範圍，拒絕 0 與正負 30000', () => {
    const input = goldenInput()
    expect(selectHumanMoveV1({ ...input, lines: [mateLine('a1a2', 29_999, 1)] }).candidates[0].normalizedCp).toBe(1)
    expect(selectHumanMoveV1({ ...input, lines: [mateLine('a1a2', -29_999, 1)] }).candidates[0].normalizedCp).toBe(-1)

    for (const invalidMate of [0, 30_000, -30_000]) {
      expect(() =>
        selectHumanMoveV1({ ...input, lines: [mateLine('a1a2', invalidMate, 1)] }),
      ).toThrow(invalidMate === 0 ? 'mate 不可為 0' : '安全整數')
    }
  })

  it('要求呼叫端明確傳入引擎異常，避免不完整分析被誤標為 complete', () => {
    const input = goldenInput()
    const withEngineAnomaly = selectHumanMoveV1({
      ...input,
      anomalies: ['incomplete-multipv-batch:4/8'],
    })
    expect(withEngineAnomaly.quality).toBe('anomalous-candidate-selection')
    expect(withEngineAnomaly.anomalies).toEqual(['incomplete-multipv-batch:4/8'])

    const missingAnomalies = { ...input } as Record<string, unknown>
    delete missingAnomalies.anomalies
    expect(() => selectHumanMoveV1(missingAnomalies as unknown as SelectHumanMoveInputV1)).toThrow(
      'anomalies 必須明確提供',
    )
  })

  it('固定 seed grid 下 A01→A10 平均選著損失非遞增', () => {
    const moves = legalMoves(parseFen(START_FEN)).map(uciMove).sort().slice(0, 8)
    const losses = [0, 20, 50, 100, 180, 280, 420, 650]
    const lines = moves.map((move, index) => line(move, -losses[index], index + 1))
    const totalLosses = PHASE2_ANCHORS.map((anchor) => {
      let total = 0
      for (let seed = 0; seed < 512; seed++) {
        const decision = selectHumanMoveV1({
          lines,
          bestmove: moves[0],
          fen: START_FEN,
          gameSeed: `grid-${seed}`,
          ply: 20,
          policy: anchor.policy,
          anomalies: [],
        })
        total += decision.candidates.find((candidate) => candidate.uci === decision.selectedUci)?.lossCp ?? 0
      }
      return total
    })
    for (let index = 1; index < totalLosses.length; index++) {
      expect(totalLosses[index]).toBeLessThanOrEqual(totalLosses[index - 1])
    }
    expect(totalLosses[0]).toBeGreaterThan(totalLosses[totalLosses.length - 1])
  })
})
