// CNN 前向傳播的 Python↔TS 一致性:同一輸入,TS 實作的機率必須跟 torch 一致。
// fixture 由 training/train.py 匯出(真實 val 樣本 + torch softmax 機率)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from './cnn.fixture.json'
import { CNN_TYPES, parseCnn } from './cnn'

function loadModel() {
  const path = fileURLToPath(new URL('../../public/models/piece-cnn.bin', import.meta.url))
  const buf = readFileSync(path)
  return parseCnn(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

describe('CNN 前向傳播', () => {
  it('與 torch 的機率一致(<1e-3)', () => {
    const model = loadModel()
    const probs = model.forward(Float32Array.from(fixture.input))
    expect(probs).toHaveLength(7)
    for (let i = 0; i < 7; i++) {
      expect(Math.abs(probs[i] - fixture.expectedProbs[i]), `class ${CNN_TYPES[i]}`).toBeLessThan(1e-3)
    }
  })

  it('預測類別正確且機率總和為 1', () => {
    const model = loadModel()
    const probs = model.forward(Float32Array.from(fixture.input))
    const argmax = probs.indexOf(Math.max(...probs))
    expect(argmax).toBe(fixture.label)
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
  })

  it('壞 magic 被拒絕', () => {
    const junk = new ArrayBuffer(64)
    expect(() => parseCnn(junk)).toThrow(/magic/)
  })
})
