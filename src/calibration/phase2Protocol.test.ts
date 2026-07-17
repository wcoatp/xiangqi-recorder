import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CALIBRATION_ENGINE_ARTIFACT_V1,
  CALIBRATION_SEARCH_PROFILE_V1,
  HUMAN_MOVE_POLICY_VERSION,
  PHASE2_ANCHORS,
  PHASE2_CONFIG_VERSION,
  phase2AnchorById,
} from './phase2Protocol'

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(resolve(process.cwd(), path))).digest('hex')

describe('Phase 2 可重現校準協定', () => {
  it('固定 A01～A10 的 inactive policy table 與單調參數', () => {
    expect(
      PHASE2_ANCHORS.map((anchor) => [
        anchor.id,
        anchor.order,
        anchor.policy.topK,
        anchor.policy.temperatureCp,
        anchor.policy.maxLossCp,
        anchor.policy.preserveForcedMate,
      ]),
    ).toEqual([
      ['A01', 1, 8, 260, 700, true],
      ['A02', 2, 8, 220, 600, true],
      ['A03', 3, 7, 190, 520, true],
      ['A04', 4, 6, 160, 440, true],
      ['A05', 5, 5, 130, 360, true],
      ['A06', 6, 5, 105, 280, true],
      ['A07', 7, 4, 80, 210, true],
      ['A08', 8, 3, 55, 140, true],
      ['A09', 9, 2, 30, 70, true],
      ['A10', 10, 1, 1, 0, true],
    ])
    expect(new Set(PHASE2_ANCHORS.map((anchor) => anchor.id)).size).toBe(10)
    expect(PHASE2_ANCHORS.every((anchor) => anchor.configVersion === PHASE2_CONFIG_VERSION)).toBe(true)
    expect(PHASE2_ANCHORS.every((anchor) => anchor.policy.version === HUMAN_MOVE_POLICY_VERSION)).toBe(true)
    expect(PHASE2_ANCHORS.every((anchor) => anchor.active === false)).toBe(true)
    for (let index = 1; index < PHASE2_ANCHORS.length; index++) {
      expect(PHASE2_ANCHORS[index].policy.topK).toBeLessThanOrEqual(PHASE2_ANCHORS[index - 1].policy.topK)
      expect(PHASE2_ANCHORS[index].policy.temperatureCp).toBeLessThanOrEqual(
        PHASE2_ANCHORS[index - 1].policy.temperatureCp,
      )
      expect(PHASE2_ANCHORS[index].policy.maxLossCp).toBeLessThanOrEqual(
        PHASE2_ANCHORS[index - 1].policy.maxLossCp,
      )
    }
    expect(phase2AnchorById('A06')).toBe(PHASE2_ANCHORS[5])
  })

  it('固定單執行緒 nodes 搜尋，不暴露 movetime 或 Elo', () => {
    expect(CALIBRATION_SEARCH_PROFILE_V1).toEqual({
      nodes: 40000,
      multipv: 8,
      threads: 1,
      hashMb: 32,
      skillLevel: 20,
      limitStrength: false,
      freshHashEveryMove: true,
    })
    expect('movetimeMs' in CALIBRATION_SEARCH_PROFILE_V1).toBe(false)
    expect('uciElo' in CALIBRATION_SEARCH_PROFILE_V1).toBe(false)
    expect(PHASE2_ANCHORS.every((anchor) => anchor.engine === CALIBRATION_ENGINE_ARTIFACT_V1)).toBe(true)
    expect(PHASE2_ANCHORS.every((anchor) => anchor.search === CALIBRATION_SEARCH_PROFILE_V1)).toBe(true)
  })

  it('所有版本固定物件都 deep-frozen', () => {
    expect(Object.isFrozen(PHASE2_ANCHORS)).toBe(true)
    expect(Object.isFrozen(CALIBRATION_ENGINE_ARTIFACT_V1)).toBe(true)
    expect(Object.isFrozen(CALIBRATION_SEARCH_PROFILE_V1)).toBe(true)
    expect(
      PHASE2_ANCHORS.every(
        (anchor) =>
          Object.isFrozen(anchor) &&
          Object.isFrozen(anchor.engine) &&
          Object.isFrozen(anchor.search) &&
          Object.isFrozen(anchor.policy),
      ),
    ).toBe(true)
  })

  it('資產 hash 與 npm lock 身分完全相符', () => {
    expect(CALIBRATION_ENGINE_ARTIFACT_V1).toEqual({
      protocolVersion: 'calibration-engine-v1',
      package: 'fairy-stockfish-nnue.wasm@1.1.11',
      engineCommit: '5589ea54',
      uciWorkerSha256: sha256('public/engine/uci-worker.js'),
      javascriptSha256: sha256('public/engine/stockfish.js'),
      wasmSha256: sha256('public/engine/stockfish.wasm'),
      pthreadWorkerSha256: sha256('public/engine/stockfish.worker.js'),
      nnueSha256: sha256('public/engine/xiangqi.nnue'),
    })
    const packageLock = JSON.parse(readFileSync(resolve(process.cwd(), 'package-lock.json'), 'utf8')) as {
      packages?: Record<string, { version?: string }>
    }
    expect(packageLock.packages?.['node_modules/fairy-stockfish-nnue.wasm']?.version).toBe('1.1.11')
  })
})
