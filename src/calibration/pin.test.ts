import { describe, expect, it } from 'vitest'
import type { RankCalibrationGate } from './rankTypes'
import { PIN_KDF, isValidCalibrationPin, setCalibrationPin, verifyCalibrationPin } from './pin'

const gate = (): RankCalibrationGate => ({
  schemaVersion: 1,
  enabled: true,
  kdf: PIN_KDF,
  autoLockMinutes: 15,
  updatedAt: 1,
})

describe('段級校準 PIN', () => {
  it('只接受 4～12 位數字', () => {
    expect(isValidCalibrationPin('1234')).toBe(true)
    expect(isValidCalibrationPin('123456789012')).toBe(true)
    expect(isValidCalibrationPin('123')).toBe(false)
    expect(isValidCalibrationPin('12a4')).toBe(false)
    expect(isValidCalibrationPin('1234567890123')).toBe(false)
  })

  it('保存 salted verifier 且不保存明文', async () => {
    const secured = await setCalibrationPin(gate(), '2468')
    expect(secured.pinSalt).toBeTruthy()
    expect(secured.pinVerifier).toBeTruthy()
    expect(secured.kdf).toEqual(PIN_KDF)
    expect(JSON.stringify(secured)).not.toContain('2468')
    await expect(verifyCalibrationPin(secured, '2468')).resolves.toBe(true)
    await expect(verifyCalibrationPin(secured, '1357')).resolves.toBe(false)
  })
})
