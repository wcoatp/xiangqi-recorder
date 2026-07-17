import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from './version'

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<string, unknown>
}

describe('app version and install metadata', () => {
  it('injects the root package version into the runtime and lockfile', () => {
    const packageJson = readJson('../package.json')
    const packageLock = readJson('../package-lock.json')
    const lockPackages = packageLock.packages as Record<string, { version?: unknown }>

    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/)
    expect(APP_VERSION).toBe(packageJson.version)
    expect(lockPackages[''].version).toBe(packageJson.version)
  })

  it('describes all three primary input paths in package, HTML and PWA metadata', () => {
    const packageDescription = String(readJson('../package.json').description)
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')

    for (const label of ['語音', '拍照', '點棋盤']) {
      expect(packageDescription).toContain(label)
      expect(html).toContain(label)
      expect(viteConfig).toContain(label)
    }

    expect(viteConfig).toMatch(/id:\s*["']\/["']/)
    expect(viteConfig).toMatch(/scope:\s*["']\/["']/)
    expect(viteConfig).toMatch(/start_url:\s*["']\/["']/)
  })
})
