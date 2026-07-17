import type { GameRow } from './db'

/** 主線一旦改變，既有逐著分析就不再對應；移除後必須重新解棋。 */
export function invalidateGameReview(game: GameRow): boolean {
  const hadReview = game.review !== undefined || game.reviewedAt !== undefined
  if (!hadReview) return false
  delete game.review
  delete game.reviewedAt
  return true
}
