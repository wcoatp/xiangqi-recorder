import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENDGAME_PACK_CATALOG } from '../endgames/catalog'
import { STARTER_ENDGAME_PACK } from '../endgames/starterPack'
import { db } from './db'
import {
  createEndgameGame,
  installEndgamePack,
  loadEndgameProgress,
  loadInstalledEndgamePacks,
  recordEndgameAttempt,
  recordEndgameSolved,
  removeEndgamePack,
} from './endgameLibrary'

const DOWNLOAD_TEXT = readFileSync(
  new URL('../../public/endgames/shiqing-yaqu-selection-v1.json', import.meta.url),
  'utf8',
)

describe.sequential('殘局題包與本機進度', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await resetDatabase()
    db.close()
  })

  it('完整驗證後安裝，重開資料庫仍可讀；移除題包不刪進度', async () => {
    const fetcher = vi.fn(async () => new Response(DOWNLOAD_TEXT, { status: 200 })) as typeof fetch
    const pack = await installEndgamePack(ENDGAME_PACK_CATALOG[0], fetcher)
    expect(pack.puzzles).toHaveLength(48)
    expect(fetcher).toHaveBeenCalledWith(
      '/endgames/shiqing-yaqu-selection-v1.json',
      { cache: 'no-store', credentials: 'same-origin' },
    )

    await recordEndgameAttempt(pack.puzzles[0].id, 1_000)
    db.close()
    await db.open()
    expect((await loadInstalledEndgamePacks()).map((item) => item.id)).toEqual([pack.id])

    await removeEndgamePack(pack.id)
    expect(await loadInstalledEndgamePacks()).toEqual([])
    expect((await loadEndgameProgress([pack.puzzles[0].id])).get(pack.puzzles[0].id)?.attempts).toBe(1)
  })

  it('下載錯誤、識別不符或 schema 錯誤時不留下部分安裝', async () => {
    await expect(installEndgamePack(
      ENDGAME_PACK_CATALOG[0],
      vi.fn(async () => new Response('', { status: 503 })) as typeof fetch,
    )).rejects.toThrow('HTTP 503')

    const wrong = JSON.parse(DOWNLOAD_TEXT)
    wrong.id = 'wrong-pack'
    await expect(installEndgamePack(
      ENDGAME_PACK_CATALOG[0],
      vi.fn(async () => new Response(JSON.stringify(wrong))) as typeof fetch,
    )).rejects.toThrow('識別或版本')

    const invalid = JSON.parse(DOWNLOAD_TEXT)
    invalid.puzzles[2].fen = 'broken'
    await expect(installEndgamePack(
      ENDGAME_PACK_CATALOG[0],
      vi.fn(async () => new Response(JSON.stringify(invalid))) as typeof fetch,
    )).rejects.toThrow('fen')

    const duplicate = JSON.parse(DOWNLOAD_TEXT)
    duplicate.puzzles[0].id = STARTER_ENDGAME_PACK.puzzles[0].id
    await expect(installEndgamePack(
      ENDGAME_PACK_CATALOG[0],
      vi.fn(async () => new Response(JSON.stringify(duplicate))) as typeof fetch,
    )).rejects.toThrow('與現有題庫重複')

    const externalFetcher = vi.fn(async () => new Response(DOWNLOAD_TEXT)) as typeof fetch
    await expect(installEndgamePack(
      { ...ENDGAME_PACK_CATALOG[0], url: 'https://example.com/endgames.json' },
      externalFetcher,
    )).rejects.toThrow('只能從本站')
    expect(externalFetcher).not.toHaveBeenCalled()
    expect(await db.settings.where('key').startsWith('endgame.pack.').count()).toBe(0)
  })

  it('嘗試與解出以較少提示保存，並容忍損壞的其他進度列', async () => {
    const puzzleId = STARTER_ENDGAME_PACK.puzzles[0].id
    await recordEndgameAttempt(puzzleId, 1_000)
    await recordEndgameAttempt(puzzleId, 2_000)
    await recordEndgameSolved(puzzleId, 3, 3_000)
    await recordEndgameSolved(puzzleId, 1, 4_000)
    await db.settings.put({ key: 'endgame.progress.bad', value: { schemaVersion: 99 } })

    const progress = await loadEndgameProgress([puzzleId, 'bad'])
    expect(progress.get(puzzleId)).toEqual({
      schemaVersion: 1,
      puzzleId,
      attempts: 2,
      solved: true,
      bestHints: 1,
      lastPlayedAt: 4_000,
      solvedAt: 3_000,
    })
    expect(progress.has('bad')).toBe(false)
  })

  it('解題建局保存自含來源、重設棋譜並增加嘗試次數', async () => {
    const puzzle = STARTER_ENDGAME_PACK.puzzles[0]
    const id = await createEndgameGame(
      STARTER_ENDGAME_PACK,
      puzzle,
      {
        mode: 'play',
        redName: '我',
        blackName: '解題引擎',
        playerSide: 'red',
        level: 0,
      },
      'solve',
    )
    const game = await db.games.get(id)
    expect(game).toMatchObject({
      initialFen: puzzle.fen,
      moveCount: 0,
      endgameSource: {
        puzzleId: puzzle.id,
        sourceOrdinal: puzzle.sourceOrdinal,
        launchMode: 'solve',
      },
    })
    expect(game?.tree.children).toEqual([])
    expect((await loadEndgameProgress([puzzle.id])).get(puzzle.id)?.attempts).toBe(1)
  })
})

async function resetDatabase() {
  db.close()
  await db.delete()
  await db.open()
}
