import { describe, expect, it } from 'vitest'
import type { CalibratorProfile } from '../calibration/rankTypes'
import { buildRankCalibrationExport } from './rankCalibration'

describe('段級校準匯出格式', () => {
  it('包含固定錨點與 profile，但不可能帶入 PIN gate', () => {
    const profile: CalibratorProfile = {
      id: 'calibrator-test',
      revision: 1,
      alias: '棋友 A',
      claimedRank: '3段',
      rankSystem: '棋友自評',
      consentedAt: 100,
      createdAt: 100,
    }
    const payload = buildRankCalibrationExport([profile], [], 200, '0.3.0')
    expect(payload.format).toBe('xiangqi-recorder-rank-calibration')
    expect(payload.schemaVersion).toBe(1)
    expect(payload.anchorSetVersion).toBe('2026.07-v1')
    expect(payload.anchors).toHaveLength(10)
    expect(payload.profiles).toEqual([profile])
    expect(payload.games).toEqual([])
    const json = JSON.stringify(payload)
    expect(json).not.toContain('pinSalt')
    expect(json).not.toContain('pinVerifier')
    expect(json).not.toContain('autoLockMinutes')
  })
})
