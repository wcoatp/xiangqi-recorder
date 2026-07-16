import type { AnchorDefinition, AnchorId } from './rankTypes'

export const ANCHOR_SET_VERSION = '2026.07-v1'

const anchor = (
  id: AnchorId,
  order: number,
  uciElo: number | undefined,
  movetimeMs: number,
): AnchorDefinition => ({
  id,
  order,
  configVersion: ANCHOR_SET_VERSION,
  engineConfig: {
    limitStrength: uciElo !== undefined,
    ...(uciElo === undefined ? {} : { uciElo }),
    skillLevel: 20,
    movetimeMs,
    multiPv: 5,
  },
  // Phase 1 不會開始校準局；Phase 2 實作 humanized policy 時必須建立新 config version。
  movePolicyVersion: 'not-active-phase1',
})

/**
 * Phase 1 固定錨點。UI 只能顯示 ID 與相對順序；底層限制尺度不是中國象棋段級。
 * 修改任一參數時必須改 ANCHOR_SET_VERSION，不能覆寫既有匯出檔的語意。
 */
const definitions: AnchorDefinition[] = [
  anchor('A01', 1, 500, 120),
  anchor('A02', 2, 700, 160),
  anchor('A03', 3, 900, 220),
  anchor('A04', 4, 1100, 300),
  anchor('A05', 5, 1300, 400),
  anchor('A06', 6, 1550, 550),
  anchor('A07', 7, 1800, 700),
  anchor('A08', 8, 2050, 900),
  anchor('A09', 9, 2350, 1200),
  anchor('A10', 10, undefined, 1800),
]

for (const definition of definitions) {
  Object.freeze(definition.engineConfig)
  Object.freeze(definition)
}

export const RANK_ANCHORS: readonly AnchorDefinition[] = Object.freeze(definitions)

export const anchorById = (id: AnchorId): AnchorDefinition => {
  const found = RANK_ANCHORS.find((entry) => entry.id === id)
  if (!found) throw new Error(`未知校準錨點：${id}`)
  return found
}
