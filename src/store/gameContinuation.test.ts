import { describe, expect, it } from 'vitest'
import { sq } from '../core/board'
import { START_FEN } from '../core/fen'
import { addMove, newRoot } from '../core/tree'
import type { GameRow } from './db'
import { buildContinuationRow } from './gameContinuation'

function sourceGame(initialFen = START_FEN): GameRow {
  return {
    id: 42,
    redName: '紅方甲',
    blackName: '黑方乙',
    mode: 'record',
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    result: 'red',
    resultReason: '認輸',
    initialFen,
    tree: newRoot(initialFen),
    moveCount: 0,
    review: {
      plies: [],
      movetimeMs: 100,
      judgments: [],
      accuracy: { red: 100, black: 100 },
      counts: {
        red: { inacc: 0, mistake: 0, blunder: 0 },
        black: { inacc: 0, mistake: 0, blunder: 0 },
      },
    },
  }
}

describe('buildContinuationRow', () => {
  it('可從開局 root 建立空白實體記譜局並保存自含來源快照', () => {
    const source = sourceGame()
    const before = JSON.stringify(source)
    const row = buildContinuationRow(
      source,
      source.tree.id,
      { mode: 'record', redName: ' 新紅 ', blackName: '新黑' },
      1_800_000_000_000,
    )

    expect(row.mode).toBe('record')
    expect(row.redName).toBe('新紅')
    expect(row.blackName).toBe('新黑')
    expect(row.result).toBe('*')
    expect(row.resultReason).toBeUndefined()
    expect(row.review).toBeUndefined()
    expect(row.initialFen).toBe(START_FEN)
    expect(row.tree.fenAfter).toBe(START_FEN)
    expect(row.tree.id).not.toBe(source.tree.id)
    expect(row.tree.children).toEqual([])
    expect(row.moveCount).toBe(0)
    expect(row.continuedFrom).toMatchObject({
      schemaVersion: 1,
      sourceGameIdAtCreation: 42,
      sourceRootId: source.tree.id,
      sourceNodeId: source.tree.id,
      sourcePly: 0,
      sourceRedName: '紅方甲',
      sourceBlackName: '黑方乙',
      sourceFen: START_FEN,
      sourceNodeLabel: '開局局面',
    })
    expect(JSON.stringify(source)).toBe(before)
  })

  it('主線節點使用精確 FEN，並建立正確的人機欄位', () => {
    const source = sourceGame()
    const first = addMove(source.tree, { from: sq(0, 0), to: sq(1, 0) }).node
    const second = addMove(first, { from: sq(9, 0), to: sq(8, 0) }).node
    const row = buildContinuationRow(
      source,
      second.id,
      {
        mode: 'play',
        redName: '我',
        blackName: '引擎・業餘3級',
        playerSide: 'red',
        level: 7,
      },
      1_800_000_000_000,
    )

    expect(row.mode).toBe('play')
    expect(row.playerSide).toBe('red')
    expect(row.level).toBe(7)
    expect(row.initialFen).toBe(second.fenAfter)
    expect(row.tree.fenAfter).toBe(second.fenAfter)
    expect(row.continuedFrom?.sourcePly).toBe(2)
    expect(row.continuedFrom?.sourceNodeLabel).toBe(second.zh)
  })

  it('變著節點不會誤用主線 FEN 或修改來源樹', () => {
    const source = sourceGame()
    const main = addMove(source.tree, { from: sq(0, 0), to: sq(1, 0) }).node
    const variation = addMove(source.tree, { from: sq(0, 1), to: sq(2, 2) }).node
    const before = JSON.stringify(source.tree)
    const row = buildContinuationRow(
      source,
      variation.id,
      { mode: 'record', redName: source.redName, blackName: source.blackName },
      1_800_000_000_000,
    )

    expect(source.tree.children[0].id).toBe(main.id)
    expect(row.initialFen).toBe(variation.fenAfter)
    expect(row.initialFen).not.toBe(main.fenAfter)
    expect(row.continuedFrom?.sourcePly).toBe(1)
    expect(JSON.stringify(source.tree)).toBe(before)
  })

  it('來源快照可經 JSON round trip 保留', () => {
    const source = sourceGame()
    const row = buildContinuationRow(
      source,
      source.tree.id,
      { mode: 'record', redName: '紅', blackName: '黑' },
      1_800_000_000_000,
    )
    expect(JSON.parse(JSON.stringify(row.continuedFrom))).toEqual(row.continuedFrom)
  })

  it('拒絕不存在、FEN 無效與終局局面', () => {
    const source = sourceGame()
    expect(() =>
      buildContinuationRow(
        source,
        'missing',
        { mode: 'record', redName: '紅', blackName: '黑' },
        1_800_000_000_000,
      ),
    ).toThrow('找不到')

    const invalid = sourceGame('not-a-fen')
    expect(() =>
      buildContinuationRow(
        invalid,
        invalid.tree.id,
        { mode: 'record', redName: '紅', blackName: '黑' },
        1_800_000_000_000,
      ),
    ).toThrow('格式無效')

    const mate = sourceGame('4k4/3RRP3/9/9/9/9/9/9/9/3K5 b - - 0 1')
    expect(() =>
      buildContinuationRow(
        mate,
        mate.tree.id,
        { mode: 'record', redName: '紅', blackName: '黑' },
        1_800_000_000_000,
      ),
    ).toThrow('已絕殺')

    const stalemate = sourceGame('4k4/3P1P3/9/9/9/9/9/9/9/3K5 b - - 0 1')
    expect(() =>
      buildContinuationRow(
        stalemate,
        stalemate.tree.id,
        { mode: 'record', redName: '紅', blackName: '黑' },
        1_800_000_000_000,
      ),
    ).toThrow('已困斃')
  })
})
