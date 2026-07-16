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
})
