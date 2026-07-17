import { describe, expect, it } from 'vitest'
import {
  COMPETITION_RESOURCES,
  MENU_GROUPS,
  PUBLIC_MENU_ITEMS,
  RESOURCE_CHECKED_AT,
  TEACHING_RESOURCES,
  UPCOMING_SCHEDULE,
  type MenuTarget,
} from './guide'

describe('全站公開功能選單', () => {
  it('收齊所有公開入口且沒有重複', () => {
    const required: MenuTarget[] = [
      'home',
      'record',
      'play',
      'replay',
      'analyze',
      'endgame',
      'rules',
      'guide',
      'settings',
      'feedback',
    ]
    const targets = PUBLIC_MENU_ITEMS.map((item) => item.target)
    expect(targets).toEqual(required)
    expect(new Set(targets).size).toBe(targets.length)
    expect(PUBLIC_MENU_ITEMS.every((item) => MENU_GROUPS.includes(item.group))).toBe(true)
    expect(targets).not.toContain('rank-calibration')
  })
})

describe('台灣官方資源', () => {
  it('只使用可追溯的 HTTPS 連結', () => {
    const resources = [...TEACHING_RESOURCES, ...COMPETITION_RESOURCES]
    expect(resources.length).toBeGreaterThanOrEqual(7)
    for (const resource of resources) {
      const url = new URL(resource.url)
      expect(url.protocol).toBe('https:')
      expect(url.hostname).toMatch(/(^|\.)cccs\.org\.tw$/)
      expect(resource.source).toBe('中華民國象棋文化協會')
    }
  })
})

describe('近期賽程快照', () => {
  it('固定查閱日期並涵蓋已核對的近期日期', () => {
    expect(RESOURCE_CHECKED_AT).toBe('2026-07-17')
    expect(UPCOMING_SCHEDULE).toHaveLength(4)
    expect(UPCOMING_SCHEDULE.flatMap((item) => item.dates)).toEqual([
      '2026-07-19',
      '2026-07-26',
      '2026-08-16',
      '2026-08-23',
      '2026-08-30',
      '2026-09-06',
    ])
  })

  it('日期有效、依首日排序，且來源連結安全', () => {
    const firstDates = UPCOMING_SCHEDULE.map((item) => item.dates[0])
    expect(firstDates).toEqual([...firstDates].sort())
    for (const item of UPCOMING_SCHEDULE) {
      expect(item.dates.every((date) => !Number.isNaN(Date.parse(`${date}T00:00:00+08:00`)))).toBe(true)
      expect(item.dates.every((date) => date > RESOURCE_CHECKED_AT)).toBe(true)
      expect(new URL(item.url).protocol).toBe('https:')
      expect(item.source.length).toBeGreaterThan(0)
    }
  })
})
