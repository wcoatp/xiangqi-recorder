import type { Side } from '../core/board'
import { parseFen } from '../core/fen'
import { gameStatus } from '../core/movegen'
import { validatePosition } from '../core/placement'
import { findNode, newRoot, pathTo } from '../core/tree'
import { db, type GameRow, type PlayerRow } from './db'

export type ContinuationSetup =
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

function requiredName(value: string, fallback: string): string {
  return value.trim() || fallback
}

/**
 * 從來源棋譜的一個節點建立獨立新局資料。
 * 只讀來源樹；新局不複製來源 children、註解、分析或時間軸。
 */
export function buildContinuationRow(
  source: GameRow,
  nodeId: string,
  setup: ContinuationSetup,
  now = Date.now(),
): NewGameRow {
  const node = findNode(source.tree, nodeId)
  const path = pathTo(source.tree, nodeId)
  if (!node || path === null) throw new Error('找不到要接續的來源局面')

  let position
  try {
    position = parseFen(node.fenAfter)
  } catch {
    throw new Error('來源局面格式無效，無法建立接續局')
  }
  const positionError = validatePosition(position.board, position.turn)
  if (positionError) throw new Error(`來源局面不合法：${positionError}`)
  const status = gameStatus(position)
  if (status.over) {
    throw new Error(`此局面已${status.reason === 'checkmate' ? '絕殺' : '困斃'}，不能再接續走棋`)
  }
  if (!Number.isFinite(now) || now <= 0) throw new Error('新局開始時間無效')
  if (setup.mode === 'play' && (!Number.isInteger(setup.level) || setup.level < 0)) {
    throw new Error('對弈難度設定無效')
  }

  const redName = requiredName(setup.redName, '紅方')
  const blackName = requiredName(setup.blackName, '黑方')
  const row: NewGameRow = {
    redName,
    blackName,
    mode: setup.mode,
    startedAt: now,
    updatedAt: now,
    result: '*',
    initialFen: node.fenAfter,
    tree: newRoot(node.fenAfter),
    moveCount: 0,
    continuedFrom: {
      schemaVersion: 1,
      sourceGameIdAtCreation: source.id,
      sourceRootId: source.tree.id,
      sourceNodeId: node.id,
      sourcePly: path.length,
      sourceStartedAt: source.startedAt,
      sourceRedName: source.redName,
      sourceBlackName: source.blackName,
      sourceFen: node.fenAfter,
      sourceNodeLabel: node.move ? node.zh : '開局局面',
    },
  }

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

/** 建立接續局與玩家名冊；任何一步失敗都由同一 transaction 回滾。 */
export async function createContinuationGame(
  source: GameRow,
  nodeId: string,
  setup: ContinuationSetup,
): Promise<number> {
  const now = Date.now()
  const row = buildContinuationRow(source, nodeId, setup, now)
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
