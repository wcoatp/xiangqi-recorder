import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeAppSettings } from './db'

describe('App 設定正規化', () => {
  it('舊資料沒有復盤方向時預設紅方在下', () => {
    expect(normalizeAppSettings({}).replayBottom).toBe('red')
  })

  it.each(['red', 'black'] as const)('接受復盤方向 %s', (replayBottom) => {
    expect(normalizeAppSettings({ replayBottom }).replayBottom).toBe(replayBottom)
  })

  it('拒絕未知復盤方向並保留其餘有效設定', () => {
    const settings = normalizeAppSettings({
      replayBottom: 'sideways',
      tabletop: false,
      voiceLang: 'zh-CN',
    })

    expect(settings.replayBottom).toBe(DEFAULT_SETTINGS.replayBottom)
    expect(settings.tabletop).toBe(false)
    expect(settings.voiceLang).toBe('zh-CN')
  })
})
