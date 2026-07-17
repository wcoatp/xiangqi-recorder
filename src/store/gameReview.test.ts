import { describe, expect, it } from 'vitest'
import { START_FEN } from '../core/fen'
import { newRoot } from '../core/tree'
import type { GameRow } from './db'
import { invalidateGameReview } from './gameReview'

function game(): GameRow {
  return {
    id: 1,
    redName: '紅方',
    blackName: '黑方',
    startedAt: 1,
    updatedAt: 1,
    result: '*',
    initialFen: START_FEN,
    tree: newRoot(START_FEN),
    moveCount: 0,
    review: {
      plies: [],
      judgments: [],
      counts: {
        red: { inacc: 0, mistake: 0, blunder: 0 },
        black: { inacc: 0, mistake: 0, blunder: 0 },
      },
      accuracy: { red: 100, black: 100 },
      movetimeMs: 500,
    },
    reviewedAt: 2,
  }
}

describe('invalidateGameReview', () => {
  it('removes both analysis payload and timestamp after a mainline change', () => {
    const row = game()
    expect(invalidateGameReview(row)).toBe(true)
    expect(row).not.toHaveProperty('review')
    expect(row).not.toHaveProperty('reviewedAt')
  })

  it('is a no-op when the game was never reviewed', () => {
    const row = game()
    delete row.review
    delete row.reviewedAt
    expect(invalidateGameReview(row)).toBe(false)
  })
})
