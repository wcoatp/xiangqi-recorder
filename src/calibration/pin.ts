import type { PinKdfConfig, RankCalibrationGate } from './rankTypes'

export const PIN_KDF: PinKdfConfig = {
  name: 'PBKDF2',
  hash: 'SHA-256',
  iterations: 150_000,
}

export const isValidCalibrationPin = (pin: string): boolean => /^\d{4,12}$/.test(pin)

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

const requireCrypto = (): Crypto => {
  if (!globalThis.crypto?.subtle) throw new Error('此瀏覽器不支援安全 PIN 驗證所需的 Web Crypto')
  return globalThis.crypto
}

async function deriveVerifier(pin: string, salt: Uint8Array<ArrayBuffer>, kdf: PinKdfConfig): Promise<string> {
  const cryptoApi = requireCrypto()
  const material = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    { name: kdf.name },
    false,
    ['deriveBits'],
  )
  const bits = await cryptoApi.subtle.deriveBits(
    { name: kdf.name, hash: kdf.hash, salt, iterations: kdf.iterations },
    material,
    256,
  )
  return toBase64(new Uint8Array(bits))
}

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export async function setCalibrationPin(gate: RankCalibrationGate, pin: string): Promise<RankCalibrationGate> {
  if (!isValidCalibrationPin(pin)) throw new Error('PIN 必須是 4～12 位數字')
  const cryptoApi = requireCrypto()
  const salt = cryptoApi.getRandomValues(new Uint8Array(16))
  const pinSalt = toBase64(salt)
  const pinVerifier = await deriveVerifier(pin, salt, PIN_KDF)
  return {
    ...gate,
    pinSalt,
    pinVerifier,
    kdf: PIN_KDF,
    updatedAt: Date.now(),
  }
}

export async function verifyCalibrationPin(gate: RankCalibrationGate, pin: string): Promise<boolean> {
  if (!gate.pinSalt || !gate.pinVerifier || !isValidCalibrationPin(pin)) return false
  const verifier = await deriveVerifier(pin, fromBase64(gate.pinSalt), gate.kdf)
  return constantTimeEqual(verifier, gate.pinVerifier)
}
