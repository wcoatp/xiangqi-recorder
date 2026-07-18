import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STARTER_ENDGAME_PACK } from './starterPack'
import { validateEndgamePack } from './schema'

const DOWNLOAD_PATH = new URL('../../public/endgames/shiqing-yaqu-selection-v1.json', import.meta.url)

function downloadFixture(): unknown {
  return JSON.parse(readFileSync(DOWNLOAD_PATH, 'utf8'))
}

describe('經典殘局題包 schema', () => {
  it('內建 12 題與下載 48 題全數通過棋規與權利帳驗證', () => {
    expect(STARTER_ENDGAME_PACK.puzzles).toHaveLength(12)
    const pack = validateEndgamePack(downloadFixture())
    expect(pack.puzzles).toHaveLength(48)
    expect(new Set([...STARTER_ENDGAME_PACK.puzzles, ...pack.puzzles].map((puzzle) => puzzle.id)).size)
      .toBe(60)
    expect(new Set([...STARTER_ENDGAME_PACK.puzzles, ...pack.puzzles].map((puzzle) => puzzle.difficulty)))
      .toEqual(new Set([1, 2, 3, 4, 5]))
    expect(pack.rights).toMatchObject({
      originalStatus: 'public-domain-original',
      editorialLicense: 'GPL-3.0-or-later',
      reviewedAt: '2026-07-18',
    })
  })

  it('拒絕未知欄位、重複 ID、非法 FEN、終局與權利資料不足', () => {
    const unknown = downloadFixture() as any
    unknown.tracking = true
    expect(() => validateEndgamePack(unknown)).toThrow('未支援欄位')

    const duplicate = downloadFixture() as any
    duplicate.puzzles[1].id = duplicate.puzzles[0].id
    expect(() => validateEndgamePack(duplicate)).toThrow('重複 id')

    const illegal = downloadFixture() as any
    illegal.puzzles[0].fen = 'not-a-fen'
    expect(() => validateEndgamePack(illegal)).toThrow('fen')

    const terminal = downloadFixture() as any
    terminal.puzzles[0].fen = '4k4/3RRP3/9/9/9/9/9/9/9/3K5 b - - 0 1'
    terminal.puzzles[0].expectedWinner = 'black'
    expect(() => validateEndgamePack(terminal)).toThrow('已是終局')

    const missingRights = downloadFixture() as any
    delete missingRights.rights.note
    expect(() => validateEndgamePack(missingRights)).toThrow('note 不可省略')
  })

  it('勝方必須是輪走的解題方，且難度不可冒出五階以外', () => {
    const wrongSide = downloadFixture() as any
    wrongSide.puzzles[0].expectedWinner = 'black'
    expect(() => validateEndgamePack(wrongSide)).toThrow('必須等於題目輪走方')

    const wrongDifficulty = downloadFixture() as any
    wrongDifficulty.puzzles[0].difficulty = 6
    expect(() => validateEndgamePack(wrongDifficulty)).toThrow('difficulty')
  })
})
