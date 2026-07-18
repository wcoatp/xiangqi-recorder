import type { Side } from '../core/board'
import { parseFen } from '../core/fen'
import { gameStatus } from '../core/movegen'
import { validatePosition } from '../core/placement'

export type EndgameDifficulty = 1 | 2 | 3 | 4 | 5

export interface EndgamePuzzle {
  id: string
  title: string
  fen: string
  difficulty: EndgameDifficulty
  expectedWinner: Side
  sourceOrdinal: number
  themes: string[]
}

export interface EndgamePackSource {
  work: string
  author: string
  publishedYear: number
  editionNote: string
  sourceUrl: string
}

export interface EndgamePackRights {
  originalStatus: 'public-domain-original'
  editorialLicense: 'GPL-3.0-or-later'
  reviewedAt: string
  note: string
}

export interface EndgamePack {
  schemaVersion: 1
  id: string
  version: number
  name: string
  description: string
  publishedAt: string
  source: EndgamePackSource
  rights: EndgamePackRights
  puzzles: EndgamePuzzle[]
}

export interface EndgamePackManifest {
  id: string
  version: number
  name: string
  description: string
  puzzleCount: number
  approximateBytes: number
  url: string
  sourceWork: string
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} 必須是物件`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: string[], path: string): void {
  const allowed = new Set(keys)
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown) throw new Error(`${path}.${unknown} 是未支援欄位`)
  const missing = keys.find((key) => !(key in value))
  if (missing) throw new Error(`${path}.${missing} 不可省略`)
}

function stringAt(value: unknown, path: string, max = 512): string {
  if (typeof value !== 'string') throw new Error(`${path} 必須是文字`)
  const text = value.trim()
  if (!text || text.length > max) throw new Error(`${path} 長度無效`)
  return text
}

function positiveInteger(value: unknown, path: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > max) {
    throw new Error(`${path} 必須是 1～${max} 的整數`)
  }
  return value as number
}

function dateAt(value: unknown, path: string): string {
  const date = stringAt(value, path, 10)
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`${path} 必須是 YYYY-MM-DD`)
  }
  return date
}

function urlAt(value: unknown, path: string): string {
  const text = stringAt(value, path, 2_048)
  let url
  try {
    url = new URL(text)
  } catch {
    throw new Error(`${path} 不是有效網址`)
  }
  if (url.protocol !== 'https:') throw new Error(`${path} 必須使用 HTTPS`)
  return url.href
}

function normalizePuzzle(value: unknown, path: string): EndgamePuzzle {
  const puzzle = objectAt(value, path)
  exactKeys(puzzle, ['id', 'title', 'fen', 'difficulty', 'expectedWinner', 'sourceOrdinal', 'themes'], path)
  const id = stringAt(puzzle.id, `${path}.id`, 96)
  if (!ID_PATTERN.test(id)) throw new Error(`${path}.id 格式無效`)
  const fen = stringAt(puzzle.fen, `${path}.fen`, 256)
  const fenParts = fen.split(/\s+/)
  if (fenParts.length !== 6 || !['w', 'b'].includes(fenParts[1])) {
    throw new Error(`${path}.fen 必須是完整且明確標示輪走方的 FEN`)
  }
  let position
  try {
    position = parseFen(fen)
  } catch (error) {
    throw new Error(`${path}.fen 無效：${error instanceof Error ? error.message : String(error)}`)
  }
  const placementError = validatePosition(position.board, position.turn)
  if (placementError) throw new Error(`${path}.fen 局面不合法：${placementError}`)
  const status = gameStatus(position)
  if (status.over) throw new Error(`${path}.fen 已是終局`)
  const difficulty = positiveInteger(puzzle.difficulty, `${path}.difficulty`, 5) as EndgameDifficulty
  const expectedWinner = puzzle.expectedWinner
  if (expectedWinner !== 'red' && expectedWinner !== 'black') {
    throw new Error(`${path}.expectedWinner 必須是 red 或 black`)
  }
  if (expectedWinner !== position.turn) {
    throw new Error(`${path}.expectedWinner 必須等於題目輪走方`)
  }
  if (!Array.isArray(puzzle.themes) || puzzle.themes.length < 1 || puzzle.themes.length > 5) {
    throw new Error(`${path}.themes 必須有 1～5 個標籤`)
  }
  const themes = puzzle.themes.map((item, index) => stringAt(item, `${path}.themes[${index}]`, 24))
  if (new Set(themes).size !== themes.length) throw new Error(`${path}.themes 不可重複`)
  return {
    id,
    title: stringAt(puzzle.title, `${path}.title`, 80),
    fen,
    difficulty,
    expectedWinner,
    sourceOrdinal: positiveInteger(puzzle.sourceOrdinal, `${path}.sourceOrdinal`, 100_000),
    themes,
  }
}

/** 對下載與內建題包使用同一個嚴格 runtime allowlist。 */
export function validateEndgamePack(value: unknown, path = 'endgamePack'): EndgamePack {
  const pack = objectAt(value, path)
  exactKeys(pack, [
    'schemaVersion', 'id', 'version', 'name', 'description', 'publishedAt', 'source', 'rights', 'puzzles',
  ], path)
  if (pack.schemaVersion !== 1) throw new Error(`${path}.schemaVersion 只支援 1`)
  const id = stringAt(pack.id, `${path}.id`, 96)
  if (!ID_PATTERN.test(id)) throw new Error(`${path}.id 格式無效`)

  const sourceValue = objectAt(pack.source, `${path}.source`)
  exactKeys(sourceValue, ['work', 'author', 'publishedYear', 'editionNote', 'sourceUrl'], `${path}.source`)
  const source: EndgamePackSource = {
    work: stringAt(sourceValue.work, `${path}.source.work`, 120),
    author: stringAt(sourceValue.author, `${path}.source.author`, 120),
    publishedYear: positiveInteger(sourceValue.publishedYear, `${path}.source.publishedYear`, 9_999),
    editionNote: stringAt(sourceValue.editionNote, `${path}.source.editionNote`, 1_024),
    sourceUrl: urlAt(sourceValue.sourceUrl, `${path}.source.sourceUrl`),
  }

  const rightsValue = objectAt(pack.rights, `${path}.rights`)
  exactKeys(rightsValue, ['originalStatus', 'editorialLicense', 'reviewedAt', 'note'], `${path}.rights`)
  if (rightsValue.originalStatus !== 'public-domain-original') {
    throw new Error(`${path}.rights.originalStatus 必須是 public-domain-original`)
  }
  if (rightsValue.editorialLicense !== 'GPL-3.0-or-later') {
    throw new Error(`${path}.rights.editorialLicense 必須是 GPL-3.0-or-later`)
  }
  const rights: EndgamePackRights = {
    originalStatus: 'public-domain-original',
    editorialLicense: 'GPL-3.0-or-later',
    reviewedAt: dateAt(rightsValue.reviewedAt, `${path}.rights.reviewedAt`),
    note: stringAt(rightsValue.note, `${path}.rights.note`, 2_048),
  }

  if (!Array.isArray(pack.puzzles) || pack.puzzles.length < 1 || pack.puzzles.length > 2_000) {
    throw new Error(`${path}.puzzles 必須有 1～2000 題`)
  }
  const puzzles = pack.puzzles.map((item, index) => normalizePuzzle(item, `${path}.puzzles[${index}]`))
  const puzzleIds = new Set<string>()
  const ordinals = new Set<number>()
  for (const puzzle of puzzles) {
    if (puzzleIds.has(puzzle.id)) throw new Error(`${path}.puzzles 有重複 id：${puzzle.id}`)
    if (ordinals.has(puzzle.sourceOrdinal)) {
      throw new Error(`${path}.puzzles 有重複原題序：${puzzle.sourceOrdinal}`)
    }
    puzzleIds.add(puzzle.id)
    ordinals.add(puzzle.sourceOrdinal)
  }

  return {
    schemaVersion: 1,
    id,
    version: positiveInteger(pack.version, `${path}.version`, 10_000),
    name: stringAt(pack.name, `${path}.name`, 120),
    description: stringAt(pack.description, `${path}.description`, 1_024),
    publishedAt: dateAt(pack.publishedAt, `${path}.publishedAt`),
    source,
    rights,
    puzzles,
  }
}

export const ENDGAME_DIFFICULTY_LABEL: Record<EndgameDifficulty, string> = {
  1: '一階・入門',
  2: '二階・基礎',
  3: '三階・進階',
  4: '四階・挑戰',
  5: '五階・研習',
}

export function endgameGoalLabel(puzzle: EndgamePuzzle): string {
  return `${puzzle.expectedWinner === 'red' ? '紅方' : '黑方'}先行並取勝`
}
