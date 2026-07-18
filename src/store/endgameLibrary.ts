import { parseFen } from '../core/fen'
import type { EndgamePack, EndgamePackManifest, EndgamePuzzle } from '../endgames/schema'
import { validateEndgamePack } from '../endgames/schema'
import { STARTER_ENDGAME_PACK } from '../endgames/starterPack'
import { db, type EndgameGameSource } from './db'
import { createPositionGame, type PositionGameSetup } from './positionGame'

const PACK_PREFIX = 'endgame.pack.'
const PROGRESS_PREFIX = 'endgame.progress.'
const MAX_PACK_BYTES = 2 * 1024 * 1024

export interface EndgameProgress {
  schemaVersion: 1
  puzzleId: string
  attempts: number
  solved: boolean
  bestHints?: number
  lastPlayedAt: number
  solvedAt?: number
}

function progressKey(puzzleId: string): string {
  return `${PROGRESS_PREFIX}${puzzleId}`
}

function packKey(packId: string): string {
  return `${PACK_PREFIX}${packId}`
}

function normalizeProgress(value: unknown, puzzleId: string): EndgameProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Partial<EndgameProgress>
  if (
    item.schemaVersion !== 1 ||
    item.puzzleId !== puzzleId ||
    !Number.isSafeInteger(item.attempts) ||
    (item.attempts ?? -1) < 0 ||
    typeof item.solved !== 'boolean' ||
    !Number.isFinite(item.lastPlayedAt) ||
    (item.lastPlayedAt ?? 0) <= 0
  ) return null
  if (item.bestHints !== undefined && (!Number.isSafeInteger(item.bestHints) || item.bestHints < 0)) return null
  if (item.solvedAt !== undefined && (!Number.isFinite(item.solvedAt) || item.solvedAt <= 0)) return null
  return item as EndgameProgress
}

export async function loadInstalledEndgamePacks(): Promise<EndgamePack[]> {
  const rows = await db.settings.where('key').startsWith(PACK_PREFIX).sortBy('key')
  const packs: EndgamePack[] = []
  const puzzleIds = new Set(STARTER_ENDGAME_PACK.puzzles.map((puzzle) => puzzle.id))
  for (const row of rows) {
    try {
      const pack = validateEndgamePack(row.value, row.key)
      if (pack.puzzles.some((puzzle) => puzzleIds.has(puzzle.id))) continue
      packs.push(pack)
      pack.puzzles.forEach((puzzle) => puzzleIds.add(puzzle.id))
    } catch {
      // 損壞或舊版快取不參與題庫；不在讀取路徑靜默改寫使用者資料。
    }
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant-TW'))
}

export async function installEndgamePack(
  manifest: EndgamePackManifest,
  fetcher: typeof fetch = fetch,
): Promise<EndgamePack> {
  if (!/^\/endgames\/[a-z0-9][a-z0-9-]*\.json$/.test(manifest.url)) {
    throw new Error('題包只能從本站 /endgames/ 靜態目錄下載')
  }
  const response = await fetcher(manifest.url, { cache: 'no-store', credentials: 'same-origin' })
  if (!response.ok) throw new Error(`題包下載失敗（HTTP ${response.status}）`)
  const text = await response.text()
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes > MAX_PACK_BYTES) throw new Error('題包超過 2 MB 安全上限')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('題包不是有效 JSON')
  }
  const pack = validateEndgamePack(raw)
  if (pack.id !== manifest.id || pack.version !== manifest.version) {
    throw new Error('題包識別或版本與目錄不一致')
  }
  if (pack.puzzles.length !== manifest.puzzleCount) {
    throw new Error(`題包題數不符（預期 ${manifest.puzzleCount}，實際 ${pack.puzzles.length}）`)
  }
  const otherPacks = [
    STARTER_ENDGAME_PACK,
    ...(await loadInstalledEndgamePacks()).filter((installed) => installed.id !== pack.id),
  ]
  const existingPuzzleIds = new Set(otherPacks.flatMap((item) => item.puzzles.map((puzzle) => puzzle.id)))
  const duplicate = pack.puzzles.find((puzzle) => existingPuzzleIds.has(puzzle.id))
  if (duplicate) throw new Error(`題目 ID 與現有題庫重複：${duplicate.id}`)
  await db.settings.put({ key: packKey(pack.id), value: pack })
  return pack
}

export async function removeEndgamePack(packId: string): Promise<void> {
  await db.settings.delete(packKey(packId))
}

export async function loadEndgameProgress(puzzleIds: string[]): Promise<Map<string, EndgameProgress>> {
  const rows = await db.settings.bulkGet(puzzleIds.map(progressKey))
  const result = new Map<string, EndgameProgress>()
  rows.forEach((row, index) => {
    const progress = row ? normalizeProgress(row.value, puzzleIds[index]) : null
    if (progress) result.set(progress.puzzleId, progress)
  })
  return result
}

export async function recordEndgameAttempt(puzzleId: string, now = Date.now()): Promise<EndgameProgress> {
  if (!Number.isFinite(now) || now <= 0) throw new Error('練習時間無效')
  return db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get(progressKey(puzzleId))
    const current = row ? normalizeProgress(row.value, puzzleId) : null
    const next: EndgameProgress = {
      schemaVersion: 1,
      puzzleId,
      attempts: (current?.attempts ?? 0) + 1,
      solved: current?.solved ?? false,
      lastPlayedAt: now,
    }
    if (current?.bestHints !== undefined) next.bestHints = current.bestHints
    if (current?.solvedAt !== undefined) next.solvedAt = current.solvedAt
    await db.settings.put({ key: progressKey(puzzleId), value: next })
    return next
  })
}

export async function recordEndgameSolved(
  puzzleId: string,
  hints: number,
  now = Date.now(),
): Promise<EndgameProgress> {
  if (!Number.isSafeInteger(hints) || hints < 0) throw new Error('提示次數無效')
  return db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get(progressKey(puzzleId))
    const current = row ? normalizeProgress(row.value, puzzleId) : null
    const next: EndgameProgress = {
      schemaVersion: 1,
      puzzleId,
      attempts: current?.attempts ?? 1,
      solved: true,
      bestHints: current?.bestHints === undefined ? hints : Math.min(current.bestHints, hints),
      lastPlayedAt: now,
      solvedAt: current?.solvedAt ?? now,
    }
    await db.settings.put({ key: progressKey(puzzleId), value: next })
    return next
  })
}

export function endgameSourceFor(
  pack: EndgamePack,
  puzzle: EndgamePuzzle,
  launchMode: EndgameGameSource['launchMode'],
): EndgameGameSource {
  return {
    schemaVersion: 1,
    packId: pack.id,
    puzzleId: puzzle.id,
    title: puzzle.title,
    sourceWork: pack.source.work,
    sourceOrdinal: puzzle.sourceOrdinal,
    sourceFen: puzzle.fen,
    launchMode,
  }
}

export async function createEndgameGame(
  pack: EndgamePack,
  puzzle: EndgamePuzzle,
  setup: PositionGameSetup,
  launchMode: EndgameGameSource['launchMode'],
): Promise<number> {
  const id = await createPositionGame(
    puzzle.fen,
    setup,
    { endgameSource: endgameSourceFor(pack, puzzle, launchMode) },
  )
  if (launchMode === 'solve') await recordEndgameAttempt(puzzle.id)
  return id
}

export function puzzleTurn(puzzle: EndgamePuzzle) {
  return parseFen(puzzle.fen).turn
}
