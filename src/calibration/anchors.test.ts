import { describe, expect, it } from 'vitest'
import { ANCHOR_SET_VERSION, RANK_ANCHORS, anchorById } from './anchors'

describe('段級校準固定錨點', () => {
  it('固定 A01～A10 與 2026.07-v1 設定快照', () => {
    expect(
      RANK_ANCHORS.map((anchor) => [
        anchor.id,
        anchor.order,
        anchor.engineConfig.uciElo ?? null,
        anchor.engineConfig.movetimeMs,
        anchor.engineConfig.multiPv,
      ]),
    ).toEqual([
      ['A01', 1, 500, 120, 5],
      ['A02', 2, 700, 160, 5],
      ['A03', 3, 900, 220, 5],
      ['A04', 4, 1100, 300, 5],
      ['A05', 5, 1300, 400, 5],
      ['A06', 6, 1550, 550, 5],
      ['A07', 7, 1800, 700, 5],
      ['A08', 8, 2050, 900, 5],
      ['A09', 9, 2350, 1200, 5],
      ['A10', 10, null, 1800, 5],
    ])
    expect(RANK_ANCHORS.every((anchor) => anchor.configVersion === ANCHOR_SET_VERSION)).toBe(true)
    expect(Object.isFrozen(RANK_ANCHORS)).toBe(true)
    expect(RANK_ANCHORS.every((anchor) => Object.isFrozen(anchor) && Object.isFrozen(anchor.engineConfig))).toBe(true)
  })

  it('ID 唯一且順序單調', () => {
    expect(new Set(RANK_ANCHORS.map((anchor) => anchor.id)).size).toBe(10)
    expect(RANK_ANCHORS.map((anchor) => anchor.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(anchorById('A06').engineConfig.movetimeMs).toBe(550)
  })

  it('完整 legacy 2026.07-v1 契約不因 Phase 2 漂移', () => {
    expect(JSON.parse(JSON.stringify(RANK_ANCHORS))).toEqual([
      {
        id: 'A01', order: 1, configVersion: '2026.07-v1',
        engineConfig: { limitStrength: true, uciElo: 500, skillLevel: 20, movetimeMs: 120, multiPv: 5 },
        movePolicyVersion: 'not-active-phase1',
      },
      {
        id: 'A02', order: 2, configVersion: '2026.07-v1',
        engineConfig: { limitStrength: true, uciElo: 700, skillLevel: 20, movetimeMs: 160, multiPv: 5 },
        movePolicyVersion: 'not-active-phase1',
      },
      {
        id: 'A03', order: 3, configVersion: '2026.07-v1',
        engineConfig: { limitStrength: true, uciElo: 900, skillLevel: 20, movetimeMs: 220, multiPv: 5 },
        movePolicyVersion: 'not-active-phase1',
      },
      {
        id: 'A04', order: 4, configVersion: '2026.07-v1',
        engineConfig: { limitStrength: true, uciElo: 1100, skillLevel: 20, movetimeMs: 300, multiPv: 5 },
        movePolicyVersion: 'not-active-phase1',
      },
      {
        id: 'A05', order: 5, configVersion: '2026.07-v1',
        engineConfig: { limitStrength: true, uciElo: 1300, skillLevel: 20, movetimeMs: 400, multiPv: 5 },
        movePolicyVersion: 'not-active-phase1',
      },
      {
        id: 'A06', order: 6, configVersion: '2026.07-v1',
        engineConfig: { limitStrength: true, uciElo: 1550, skillLevel: 20, movetimeMs: 550, multiPv: 5 },
        movePolicyVersion: 'not-active-phase1',
      },
      {
        id: 'A07', order: 7, configVersion: '2026.07-v1',
        engineConfig: { limitStrength: true, uciElo: 1800, skillLevel: 20, movetimeMs: 700, multiPv: 5 },
        movePolicyVersion: 'not-active-phase1',
      },
      {
        id: 'A08', order: 8, configVersion: '2026.07-v1',
        engineConfig: { limitStrength: true, uciElo: 2050, skillLevel: 20, movetimeMs: 900, multiPv: 5 },
        movePolicyVersion: 'not-active-phase1',
      },
      {
        id: 'A09', order: 9, configVersion: '2026.07-v1',
        engineConfig: { limitStrength: true, uciElo: 2350, skillLevel: 20, movetimeMs: 1200, multiPv: 5 },
        movePolicyVersion: 'not-active-phase1',
      },
      {
        id: 'A10', order: 10, configVersion: '2026.07-v1',
        engineConfig: { limitStrength: false, skillLevel: 20, movetimeMs: 1800, multiPv: 5 },
        movePolicyVersion: 'not-active-phase1',
      },
    ])
  })
})
