import { describe, expect, it } from 'vitest'
import { START_FEN } from '../core/fen'
import { buildPositionGameRow } from './positionGame'

const SOURCE = {
  schemaVersion: 1 as const,
  packId: 'starter-v1',
  puzzleId: 'shiqing-0435',
  title: '獨行千里',
  sourceWork: '《適情雅趣》',
  sourceOrdinal: 435,
  sourceFen: START_FEN,
  launchMode: 'solve' as const,
}

describe('buildPositionGameRow', () => {
  it('從任意合法 FEN 建立重新計著的人機局並保存殘局來源', () => {
    const row = buildPositionGameRow(
      START_FEN,
      {
        mode: 'play',
        redName: ' 我 ',
        blackName: '解題引擎',
        playerSide: 'red',
        level: 5,
      },
      { endgameSource: SOURCE },
      1_800_000_000_000,
    )

    expect(row).toMatchObject({
      redName: '我',
      blackName: '解題引擎',
      mode: 'play',
      playerSide: 'red',
      level: 5,
      result: '*',
      initialFen: START_FEN,
      moveCount: 0,
      endgameSource: SOURCE,
    })
    expect(row.tree.fenAfter).toBe(START_FEN)
    expect(row.tree.children).toEqual([])
    expect(row.endgameSource).not.toBe(SOURCE)
  })

  it('實體記譜使用預設姓名且沒有對弈欄位', () => {
    const row = buildPositionGameRow(
      START_FEN,
      { mode: 'record', redName: ' ', blackName: '' },
      {},
      1_800_000_000_000,
    )
    expect(row.redName).toBe('紅方')
    expect(row.blackName).toBe('黑方')
    expect(row.playerSide).toBeUndefined()
    expect(row.level).toBeUndefined()
  })

  it('拒絕無效、非法、終局、錯誤難度與雙重來源', () => {
    expect(() => buildPositionGameRow('bad-fen', { mode: 'record', redName: '紅', blackName: '黑' }))
      .toThrow('格式無效')
    expect(() => buildPositionGameRow(
      '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
      { mode: 'record', redName: '紅', blackName: '黑' },
    )).toThrow('不合法')
    expect(() => buildPositionGameRow(
      '4k4/3RRP3/9/9/9/9/9/9/9/3K5 b - - 0 1',
      { mode: 'record', redName: '紅', blackName: '黑' },
    )).toThrow('已絕殺')
    expect(() => buildPositionGameRow(
      START_FEN,
      { mode: 'play', redName: '我', blackName: '引擎', playerSide: 'red', level: -1 },
    )).toThrow('難度')
    expect(() => buildPositionGameRow(
      START_FEN,
      { mode: 'record', redName: '紅', blackName: '黑' },
      {
        endgameSource: SOURCE,
        continuedFrom: {
          schemaVersion: 1,
          sourceGameIdAtCreation: 1,
          sourceRootId: 'root',
          sourceNodeId: 'node',
          sourcePly: 0,
          sourceStartedAt: 1,
          sourceRedName: '紅',
          sourceBlackName: '黑',
          sourceFen: START_FEN,
        },
      },
    )).toThrow('只能有一種來源')
  })
})
