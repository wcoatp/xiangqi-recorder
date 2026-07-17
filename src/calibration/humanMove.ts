import { parseFen } from '../core/fen'
import { legalMoves } from '../core/movegen'
import { uciMove } from '../core/notation'
import { scoreToCp, type PvLine } from '../engine/engineClient'
import { HUMAN_MOVE_POLICY_VERSION, type HumanMovePolicyV1 } from './phase2Protocol'

const UINT32_RANGE = 0x1_0000_0000
const WEIGHT_SCALE = 1_000_000
const MAX_SCORE_MAGNITUDE = 1_000_000
const MAX_MATE_DISTANCE = 29_999

export type RecordedScoreV1 =
  | Readonly<{ type: 'cp'; value: number }>
  | Readonly<{ type: 'mate'; value: number }>

export type CandidateIneligibilityV1 =
  | 'missing-pv'
  | 'illegal'
  | 'duplicate'
  | 'beyond-top-k'
  | 'exceeds-max-loss'
  | 'forced-mate-protection'
  | 'losing-mate-protection'

export interface HumanMoveCandidateV1 {
  readonly uci: string
  readonly reportedMultiPv: number
  readonly depth: number
  readonly score: RecordedScoreV1
  readonly normalizedCp: number
  readonly lossCp: number | null
  readonly pv: readonly string[]
  readonly legal: boolean
  readonly duplicate: boolean
  readonly rank: number | null
  readonly eligible: boolean
  readonly ineligibility: readonly CandidateIneligibilityV1[]
  readonly weight: number
}

export type HumanMoveDecisionQualityV1 =
  | 'complete'
  | 'anomalous-candidate-selection'
  | 'bestmove-fallback'

export interface HumanMoveDecisionV1 {
  readonly schemaVersion: 1
  readonly policyVersion: typeof HUMAN_MOVE_POLICY_VERSION
  readonly scorePerspective: 'side-to-move'
  readonly decisionSeedHash: string
  readonly randomAlgorithm: 'fnv1a32-mulberry32-v1'
  readonly randomUint: number
  readonly randomUnit: number
  readonly totalWeight: number
  readonly threshold: number | null
  readonly candidates: readonly HumanMoveCandidateV1[]
  readonly selectedUci: string
  readonly quality: HumanMoveDecisionQualityV1
  readonly anomalies: readonly string[]
}

export interface SelectHumanMoveInputV1 {
  readonly lines: readonly PvLine[]
  readonly bestmove: string
  readonly fen: string
  readonly gameSeed: string
  readonly ply: number
  readonly policy: HumanMovePolicyV1
  /**
   * Stable engine/protocol anomaly codes. Callers must pass an explicit array, including `[]`,
   * so an incomplete MultiPV batch or bestmove mismatch cannot disappear by omission.
   */
  readonly anomalies: readonly string[]
}

interface PreparedCandidate {
  readonly uci: string
  readonly reportedMultiPv: number
  readonly depth: number
  readonly score: RecordedScoreV1
  readonly normalizedCp: number
  readonly pv: readonly string[]
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const assertSafeInteger = (value: number, field: string, min: number, max: number): void => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${field} 必須是 ${min}～${max} 的安全整數`)
  }
}

const normalizeFen = (fen: string): string => {
  if (typeof fen !== 'string') throw new Error('fen 必須是字串')
  const normalized = fen.trim().replace(/\s+/g, ' ')
  const parts = normalized.split(' ')
  if (!normalized || !parts[1] || !['w', 'r', 'b'].includes(parts[1].toLowerCase())) {
    throw new Error('fen 必須包含有效的輪走方')
  }
  return normalized
}

const validatePolicy = (policy: HumanMovePolicyV1): void => {
  if (policy.version !== HUMAN_MOVE_POLICY_VERSION) throw new Error('不支援的選著 policy version')
  if (policy.preserveForcedMate !== true) throw new Error('seeded-multipv-v1 必須保護強制殺棋')
  assertSafeInteger(policy.topK, 'policy.topK', 1, 100)
  assertSafeInteger(policy.temperatureCp, 'policy.temperatureCp', 1, MAX_SCORE_MAGNITUDE)
  assertSafeInteger(policy.maxLossCp, 'policy.maxLossCp', 0, MAX_SCORE_MAGNITUDE)
  if (boundedQuadraticWeight(policy.temperatureCp, policy.maxLossCp) === 0) {
    throw new Error('policy 的 maxLossCp 會產生零權重候選')
  }
}

const scoreFromLine = (line: PvLine, index: number): RecordedScoreV1 => {
  const hasCp = line.scoreCp !== undefined
  const hasMate = line.mate !== undefined
  if (hasCp === hasMate) throw new Error(`lines[${index}] 必須且只能有一種 score`)
  const value = hasMate ? line.mate : line.scoreCp
  if (hasMate) {
    assertSafeInteger(
      value as number,
      `lines[${index}].mate`,
      -MAX_MATE_DISTANCE,
      MAX_MATE_DISTANCE,
    )
    if (value === 0) throw new Error(`lines[${index}].mate 不可為 0`)
  } else {
    assertSafeInteger(
      value as number,
      `lines[${index}].scoreCp`,
      -MAX_SCORE_MAGNITUDE,
      MAX_SCORE_MAGNITUDE,
    )
  }
  return Object.freeze(hasMate ? { type: 'mate' as const, value: value as number } : { type: 'cp' as const, value: value as number })
}

const prepareCandidates = (lines: readonly PvLine[]): PreparedCandidate[] =>
  lines
    .map((line, index): PreparedCandidate => {
      assertSafeInteger(line.depth, `lines[${index}].depth`, 0, 1_000_000)
      assertSafeInteger(line.multipv, `lines[${index}].multipv`, 1, 100_000)
      if (!Array.isArray(line.pv) || line.pv.some((token) => typeof token !== 'string')) {
        throw new Error(`lines[${index}].pv 必須是字串陣列`)
      }
      const score = scoreFromLine(line, index)
      const pv = Object.freeze(line.pv.map((token) => token.trim().toLowerCase()))
      const normalizedCp = scoreToCp(line)
      assertSafeInteger(normalizedCp, `lines[${index}].normalizedCp`, -2 * MAX_SCORE_MAGNITUDE, 2 * MAX_SCORE_MAGNITUDE)
      return {
        uci: pv[0] ?? '',
        reportedMultiPv: line.multipv,
        depth: line.depth,
        score,
        normalizedCp,
        pv,
      }
    })
    .sort((a, b) => {
      if (a.normalizedCp !== b.normalizedCp) return b.normalizedCp - a.normalizedCp
      const uciOrder = compareText(a.uci, b.uci)
      if (uciOrder !== 0) return uciOrder
      if (a.depth !== b.depth) return b.depth - a.depth
      if (a.reportedMultiPv !== b.reportedMultiPv) return a.reportedMultiPv - b.reportedMultiPv
      if (a.score.type !== b.score.type) return compareText(a.score.type, b.score.type)
      if (a.score.value !== b.score.value) return b.score.value - a.score.value
      return compareText(a.pv.join('\0'), b.pv.join('\0'))
    })

/** FNV-1a over UTF-8 bytes, returned as an unsigned 32-bit integer. */
export const fnv1a32Utf8 = (value: string): number => {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** The first unsigned 32-bit output of the Mulberry32 generator for a seed. */
export const mulberry32FirstUint = (seed: number): number => {
  let value = (seed + 0x6d2b79f5) >>> 0
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return (value ^ (value >>> 14)) >>> 0
}

export const boundedQuadraticWeight = (temperatureCp: number, lossCp: number): number => {
  assertSafeInteger(temperatureCp, 'temperatureCp', 1, MAX_SCORE_MAGNITUDE)
  assertSafeInteger(lossCp, 'lossCp', 0, 2 * MAX_SCORE_MAGNITUDE)
  if (lossCp === 0) return WEIGHT_SCALE
  const temperature = BigInt(temperatureCp)
  const denominator = BigInt(temperatureCp + lossCp)
  return Number((BigInt(WEIGHT_SCALE) * temperature * temperature) / (denominator * denominator))
}

const canonicalAnomalies = (anomalies: readonly string[]): string[] => {
  if (!Array.isArray(anomalies)) {
    throw new Error('anomalies 必須明確提供字串陣列（沒有異常時使用空陣列）')
  }
  const unique = new Set<string>()
  for (const anomaly of anomalies) {
    if (typeof anomaly !== 'string' || anomaly.length === 0 || anomaly.length > 256) {
      throw new Error('anomaly 必須是 1～256 字元的穩定代碼')
    }
    unique.add(anomaly)
  }
  return [...unique].sort(compareText)
}

const freezeCandidate = (candidate: HumanMoveCandidateV1): HumanMoveCandidateV1 => {
  Object.freeze(candidate.pv)
  Object.freeze(candidate.ineligibility)
  Object.freeze(candidate.score)
  return Object.freeze(candidate)
}

const freezeDecision = (decision: HumanMoveDecisionV1): HumanMoveDecisionV1 => {
  for (const candidate of decision.candidates) freezeCandidate(candidate)
  Object.freeze(decision.candidates)
  Object.freeze(decision.anomalies)
  return Object.freeze(decision)
}

export const selectHumanMoveV1 = (input: SelectHumanMoveInputV1): HumanMoveDecisionV1 => {
  validatePolicy(input.policy)
  if (
    typeof input.gameSeed !== 'string' ||
    input.gameSeed.length === 0 ||
    input.gameSeed.length > 512 ||
    input.gameSeed.includes('\0')
  ) {
    throw new Error('gameSeed 必須是 1～512 字元的字串')
  }
  if (!Array.isArray(input.lines) || input.lines.length > 100) throw new Error('lines 最多只能有 100 個候選')
  assertSafeInteger(input.ply, 'ply', 0, 1_000_000)
  const normalizedFen = normalizeFen(input.fen)
  const position = parseFen(normalizedFen)
  const legalUciMoves = new Set(legalMoves(position).map(uciMove))
  if (legalUciMoves.size === 0) throw new Error('此局面沒有合法著法，不能執行選著')

  const seedMaterial = `${HUMAN_MOVE_POLICY_VERSION}\0${input.gameSeed}\0${input.ply}\0${normalizedFen}`
  const seed = fnv1a32Utf8(seedMaterial)
  const decisionSeedHash = seed.toString(16).padStart(8, '0')
  const randomUint = mulberry32FirstUint(seed)
  const randomUnit = randomUint / UINT32_RANGE
  const prepared = prepareCandidates(input.lines)

  const seenUci = new Set<string>()
  const duplicateByIndex: boolean[] = []
  for (const candidate of prepared) {
    const duplicate = candidate.uci.length > 0 && seenUci.has(candidate.uci)
    duplicateByIndex.push(duplicate)
    if (candidate.uci.length > 0) seenUci.add(candidate.uci)
  }

  const uniqueLegalIndices: number[] = []
  for (let index = 0; index < prepared.length; index++) {
    if (legalUciMoves.has(prepared[index].uci) && !duplicateByIndex[index]) uniqueLegalIndices.push(index)
  }
  const bestCandidate = uniqueLegalIndices.length > 0 ? prepared[uniqueLegalIndices[0]] : undefined
  const bestScore = bestCandidate?.normalizedCp
  const bestIsForcedMate = bestCandidate?.score.type === 'mate' && bestCandidate.score.value > 0
  const hasNonLosingMateAlternative = uniqueLegalIndices.some((index) => {
    const score = prepared[index].score
    return score.type !== 'mate' || score.value >= 0
  })
  const rankByIndex = new Map(uniqueLegalIndices.map((index, rank) => [index, rank + 1]))

  const candidates = prepared.map((candidate, index): HumanMoveCandidateV1 => {
    const legal = legalUciMoves.has(candidate.uci)
    const duplicate = duplicateByIndex[index]
    const rank = rankByIndex.get(index) ?? null
    const lossCp = bestScore === undefined ? null : Math.max(0, bestScore - candidate.normalizedCp)
    const ineligibility: CandidateIneligibilityV1[] = []
    if (!candidate.uci) ineligibility.push('missing-pv')
    if (!legal) ineligibility.push('illegal')
    if (duplicate) ineligibility.push('duplicate')
    if (rank !== null && rank > input.policy.topK) ineligibility.push('beyond-top-k')
    if (lossCp !== null && lossCp > input.policy.maxLossCp) ineligibility.push('exceeds-max-loss')
    if (
      bestIsForcedMate &&
      input.policy.preserveForcedMate &&
      !(candidate.score.type === 'mate' && candidate.score.value > 0)
    ) {
      ineligibility.push('forced-mate-protection')
    }
    if (
      hasNonLosingMateAlternative &&
      candidate.score.type === 'mate' &&
      candidate.score.value < 0
    ) {
      ineligibility.push('losing-mate-protection')
    }
    const eligible = ineligibility.length === 0 && lossCp !== null
    return freezeCandidate({
      uci: candidate.uci,
      reportedMultiPv: candidate.reportedMultiPv,
      depth: candidate.depth,
      score: candidate.score,
      normalizedCp: candidate.normalizedCp,
      lossCp,
      pv: candidate.pv,
      legal,
      duplicate,
      rank,
      eligible,
      ineligibility: Object.freeze(ineligibility),
      weight: eligible ? boundedQuadraticWeight(input.policy.temperatureCp, lossCp) : 0,
    })
  })

  const anomalies = canonicalAnomalies(input.anomalies)
  const filteredCount = candidates.filter((candidate) =>
    candidate.ineligibility.some((reason) => ['missing-pv', 'illegal', 'duplicate'].includes(reason)),
  ).length
  if (filteredCount > 0) anomalies.push(`filtered-candidates:${filteredCount}`)

  const normalizedBestmove = typeof input.bestmove === 'string' ? input.bestmove.trim().toLowerCase() : ''
  const legalBestmove = legalUciMoves.has(normalizedBestmove)
  if (!normalizedBestmove) anomalies.push('missing-bestmove')
  else if (!legalBestmove) anomalies.push('illegal-bestmove')
  else if (bestCandidate && normalizedBestmove !== bestCandidate.uci) anomalies.push('bestmove-mismatch')

  const eligible = candidates.filter((candidate) => candidate.eligible && candidate.weight > 0)
  if (eligible.length === 0) {
    if (!legalBestmove) throw new Error('沒有合法候選著或合法 bestmove')
    anomalies.push('bestmove-fallback')
    return freezeDecision({
      schemaVersion: 1,
      policyVersion: HUMAN_MOVE_POLICY_VERSION,
      scorePerspective: 'side-to-move',
      decisionSeedHash,
      randomAlgorithm: 'fnv1a32-mulberry32-v1',
      randomUint,
      randomUnit,
      totalWeight: 0,
      threshold: null,
      candidates: Object.freeze(candidates),
      selectedUci: normalizedBestmove,
      quality: 'bestmove-fallback',
      anomalies: Object.freeze([...new Set(anomalies)].sort(compareText)),
    })
  }

  const totalWeight = eligible.reduce((total, candidate) => total + candidate.weight, 0)
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) throw new Error('候選權重總和無效')
  const threshold = Number((BigInt(randomUint) * BigInt(totalWeight)) / BigInt(UINT32_RANGE))
  let cumulative = 0
  let selectedUci = eligible[eligible.length - 1].uci
  for (const candidate of eligible) {
    cumulative += candidate.weight
    if (threshold < cumulative) {
      selectedUci = candidate.uci
      break
    }
  }
  const finalAnomalies = [...new Set(anomalies)].sort(compareText)
  return freezeDecision({
    schemaVersion: 1,
    policyVersion: HUMAN_MOVE_POLICY_VERSION,
    scorePerspective: 'side-to-move',
    decisionSeedHash,
    randomAlgorithm: 'fnv1a32-mulberry32-v1',
    randomUint,
    randomUnit,
    totalWeight,
    threshold,
    candidates: Object.freeze(candidates),
    selectedUci,
    quality: finalAnomalies.length === 0 ? 'complete' : 'anomalous-candidate-selection',
    anomalies: Object.freeze(finalAnomalies),
  })
}

/** Replays from trusted original inputs; every stored derived field must match byte-for-byte JSON. */
export const verifyHumanMoveDecisionV1 = (
  input: SelectHumanMoveInputV1,
  decision: unknown,
): boolean => {
  try {
    return JSON.stringify(selectHumanMoveV1(input)) === JSON.stringify(decision)
  } catch {
    return false
  }
}
