import { findNode, pathTo } from '../core/tree'
import type { GameRow } from './db'
import {
  buildPositionGameRow,
  createPositionGame,
  type NewGameRow,
  type PositionGameSetup,
} from './positionGame'

export type ContinuationSetup = PositionGameSetup

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

  try {
    return buildPositionGameRow(node.fenAfter, setup, {
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
    }, now)
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.startsWith('起始局面格式無效')) {
        throw new Error('來源局面格式無效，無法建立接續局')
      }
      if (error.message.startsWith('起始局面不合法：')) {
        throw new Error(error.message.replace('起始局面', '來源局面'))
      }
      if (error.message.startsWith('此局面已')) {
        throw new Error(error.message.replace('不能再開始走棋', '不能再接續走棋'))
      }
    }
    throw error
  }
}

/** 建立接續局與玩家名冊；任何一步失敗都由同一 transaction 回滾。 */
export async function createContinuationGame(
  source: GameRow,
  nodeId: string,
  setup: ContinuationSetup,
): Promise<number> {
  const row = buildContinuationRow(source, nodeId, setup)
  return createPositionGame(row.initialFen, setup, { continuedFrom: row.continuedFrom })
}
