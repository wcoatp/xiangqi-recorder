import type { Side } from '../core/board'
import { parseFen } from '../core/fen'
import { gameStatus } from '../core/movegen'
import { validatePosition } from '../core/placement'
import { newRoot } from '../core/tree'
import {
  db,
  type EndgameGameSource,
  type GameContinuationSource,
  type GameRow,
  type PlayerRow,
} from './db'

export type PositionGameSetup =
  | {
      mode: 'record'
      redName: string
      blackName: string
    }
  | {
      mode: 'play'
      redName: string
      blackName: string
      playerSide: Side
      level: number
    }

export type NewGameRow = Omit<GameRow, 'id'>

export interface PositionGameProvenance {
  continuedFrom?: GameContinuationSource
  endgameSource?: EndgameGameSource
}

function requiredName(value: string, fallback: string): string {
  return value.trim() || fallback
}

/**
 * 從任意合法、尚未結束的 FEN 建立獨立新局。
 * 來源只以自含快照保存；新局不攜帶舊樹、註解、分析或歷史計數。
 */
export function buildPositionGameRow(
  fen: string,
  setup: PositionGameSetup,
  provenance: PositionGameProvenance = {},
  now = Date.now(),
): NewGameRow {
  let position
  try {
    position = parseFen(fen)
  } catch {
    throw new Error('起始局面格式無效，無法建立新局')
  }
  const positionError = validatePosition(position.board, position.turn)
  if (positionError) throw new Error(`起始局面不合法：${positionError}`)
  const status = gameStatus(position)
  if (status.over) {
    throw new Error(`此局面已${status.reason === 'checkmate' ? '絕殺' : '困斃'}，不能再開始走棋`)
  }
  if (!Number.isFinite(now) || now <= 0) throw new Error('新局開始時間無效')
  if (setup.mode === 'play') {
    if (setup.playerSide !== 'red' && setup.playerSide !== 'black') {
      throw new Error('執棋方設定無效')
    }
    if (!Number.isInteger(setup.level) || setup.level < 0) {
      throw new Error('對弈難度設定無效')
    }
  }
  if (provenance.continuedFrom && provenance.endgameSource) {
    throw new Error('新局只能有一種來源快照')
  }

  const row: NewGameRow = {
    redName: requiredName(setup.redName, '紅方'),
    blackName: requiredName(setup.blackName, '黑方'),
    mode: setup.mode,
    startedAt: now,
    updatedAt: now,
    result: '*',
    initialFen: fen,
    tree: newRoot(fen),
    moveCount: 0,
  }
  if (provenance.continuedFrom) row.continuedFrom = { ...provenance.continuedFrom }
  if (provenance.endgameSource) row.endgameSource = { ...provenance.endgameSource }
  if (setup.mode === 'play') {
    row.playerSide = setup.playerSide
    row.level = setup.level
  }
  return row
}

async function rememberPlayerInCurrentTransaction(name: string, now: number): Promise<void> {
  const existing = await db.players.where('name').equals(name).first()
  if (!existing) await db.players.add({ name, createdAt: now } as PlayerRow)
}

/** 建立任意局面新局與玩家名冊；任何一步失敗都由同一 transaction 回滾。 */
export async function createPositionGame(
  fen: string,
  setup: PositionGameSetup,
  provenance: PositionGameProvenance = {},
): Promise<number> {
  const now = Date.now()
  const row = buildPositionGameRow(fen, setup, provenance, now)
  return db.transaction('rw', db.games, db.players, async () => {
    if (setup.mode === 'record') {
      await rememberPlayerInCurrentTransaction(row.redName, now)
      await rememberPlayerInCurrentTransaction(row.blackName, now)
    } else {
      await rememberPlayerInCurrentTransaction(
        setup.playerSide === 'red' ? row.redName : row.blackName,
        now,
      )
    }
    return (await db.games.add(row as GameRow)) as number
  })
}
