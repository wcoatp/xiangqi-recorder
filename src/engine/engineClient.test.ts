import { describe, expect, it } from 'vitest'
import {
  EngineClient,
  type CalibrationAnalyzeResult,
  type EngineClientEnvironment,
  type EngineWorkerLike,
} from './engineClient'

interface SearchScript {
  bestmove: string
  hold?: boolean
  ignoreStop?: boolean
  lines: string[]
  restoreFailureCommand?: string
  runtimeError?: string
}

class FakeWorker implements EngineWorkerLike {
  readonly commands: string[] = []
  readonly searches: SearchScript[] = []
  respondToUci = true
  terminated = false
  throwOnceOnCommand: string | null = null
  private activeSearch: SearchScript | null = null
  private capturedErrorHandler: ((event: { message: string }) => void) | null = null
  private capturedMessageHandler: ((event: { data: unknown }) => void) | null = null
  private errorHandler: ((event: { message: string }) => void) | null = null
  private messageHandler: ((event: { data: unknown }) => void) | null = null

  get onerror(): ((event: { message: string }) => void) | null {
    return this.errorHandler
  }

  set onerror(handler: ((event: { message: string }) => void) | null) {
    this.errorHandler = handler
    if (handler) this.capturedErrorHandler = handler
  }

  get onmessage(): ((event: { data: unknown }) => void) | null {
    return this.messageHandler
  }

  set onmessage(handler: ((event: { data: unknown }) => void) | null) {
    this.messageHandler = handler
    if (handler) this.capturedMessageHandler = handler
  }

  postMessage(message: unknown): void {
    const parsed = message as { type?: string; cmd?: string }
    if (parsed.type === 'init') {
      this.emit({ type: 'ready' })
      return
    }
    if (parsed.type !== 'cmd' || typeof parsed.cmd !== 'string') return

    const command = parsed.cmd
    this.commands.push(command)
    if (this.throwOnceOnCommand === command) {
      this.throwOnceOnCommand = null
      throw new Error(`fake command failure:${command}`)
    }
    if (command === 'uci') {
      if (this.respondToUci) this.emitLine('uciok')
      return
    }
    if (command === 'isready') {
      this.emitLine('readyok')
      return
    }
    if (command === 'stop') {
      if (this.activeSearch && !this.activeSearch.ignoreStop) this.completeActiveSearch()
      return
    }
    if (command.startsWith('go ')) {
      const script = this.searches.shift() ?? defaultSearch()
      this.activeSearch = script
      if (script.runtimeError) {
        this.emit({ type: 'error', message: script.runtimeError })
        if (script.restoreFailureCommand) {
          this.throwOnceOnCommand = script.restoreFailureCommand
        }
        return
      }
      if (!script.hold) this.completeActiveSearch()
    }
  }

  queueSearch(script: SearchScript): void {
    this.searches.push(script)
  }

  terminate(): void {
    this.terminated = true
    this.activeSearch = null
  }

  emitCaptured(data: unknown): void {
    this.capturedMessageHandler?.({ data })
  }

  emitCapturedError(message: string): void {
    this.capturedErrorHandler?.({ message })
  }

  completeActiveSearch(): void {
    const script = this.activeSearch
    if (!script) throw new Error('沒有待完成的 fake search')
    this.activeSearch = null
    for (const line of script.lines) this.emitLine(line)
    this.emitLine(`bestmove ${script.bestmove}`)
  }

  private emit(data: unknown): void {
    this.messageHandler?.({ data })
  }

  private emitLine(line: string): void {
    this.emit({ type: 'line', line })
  }
}

function defaultSearch(): SearchScript {
  return {
    bestmove: 'a0a1',
    lines: ['info depth 8 multipv 1 score cp 20 nodes 10 pv a0a1 a9a8'],
  }
}

function createClient(worker: FakeWorker, hardwareConcurrency = 8): EngineClient {
  const environment: EngineClientEnvironment = {
    commandTimeoutMs: 1000,
    createWorker: () => worker,
    drainTimeoutMs: 100,
    hardwareConcurrency: () => hardwareConcurrency,
    isSupported: () => true,
    searchTimeoutMs: 1000,
  }
  return new EngineClient(environment)
}

function createShortTimeoutClient(worker: FakeWorker): EngineClient {
  return new EngineClient({
    commandTimeoutMs: 100,
    createWorker: () => worker,
    drainTimeoutMs: 100,
    hardwareConcurrency: () => 8,
    isSupported: () => true,
    searchTimeoutMs: 5,
  })
}

function info(depth: number, multipv: number, cp: number, move: string): string {
  return `info depth ${depth} seldepth ${depth + 2} multipv ${multipv} score cp ${cp} nodes 42 pv ${move} a9a8`
}

async function waitForCommand(worker: FakeWorker, command: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (worker.commands.includes(command)) return
    await Promise.resolve()
  }
  throw new Error(`fake Worker 未收到命令:${command}`)
}

function calibrationCommands(worker: FakeWorker): string[] {
  const start = worker.commands.indexOf('setoption name Threads value 1')
  if (start < 0) throw new Error('找不到校準命令起點')
  return worker.commands.slice(start)
}

function expectRestored(commands: readonly string[], defaultThreads = 4): void {
  expect(commands.slice(-5)).toEqual([
    `setoption name Threads value ${defaultThreads}`,
    'setoption name MultiPV value 1',
    'setoption name Skill Level value 20',
    'setoption name UCI_LimitStrength value false',
    'isready',
  ])
}

describe('EngineClient Worker generation 隔離', () => {
  it('握手失敗後終止舊 Worker，延遲 stale 事件不會污染重試的 waiter 或狀態', async () => {
    const staleWorker = new FakeWorker()
    staleWorker.respondToUci = false
    const freshWorker = new FakeWorker()
    freshWorker.queueSearch({
      bestmove: 'h0g2',
      hold: true,
      lines: [info(13, 1, 60, 'h0g2')],
    })
    const workers = [staleWorker, freshWorker]
    const client = new EngineClient({
      commandTimeoutMs: 5,
      createWorker: () => {
        const worker = workers.shift()
        if (!worker) throw new Error('沒有可用的 fake Worker')
        return worker
      },
      drainTimeoutMs: 100,
      hardwareConcurrency: () => 8,
      isSupported: () => true,
      searchTimeoutMs: 1000,
    })

    await expect(client.init()).rejects.toThrow('引擎回應逾時')
    expect(staleWorker.terminated).toBe(true)
    expect(staleWorker.onmessage).toBeNull()
    expect(staleWorker.onerror).toBeNull()

    const retry = client.analyze('fresh-generation-fen', { movetimeMs: 250 })
    await waitForCommand(freshWorker, 'go movetime 250')

    // 模擬 terminate 前已排進 event loop 的舊 callback；identity guard 必須全部忽略。
    staleWorker.emitCaptured({ type: 'line', line: 'uciok' })
    staleWorker.emitCaptured({ type: 'line', line: 'readyok' })
    staleWorker.emitCaptured({ type: 'line', line: 'bestmove stale0' })
    staleWorker.emitCaptured({ type: 'error', message: 'stale message error' })
    staleWorker.emitCapturedError('stale worker error')
    expect(client.status).toBe('ready')

    freshWorker.completeActiveSearch()
    const result = await retry
    expect(result.bestmove).toBe('h0g2')
    expect(result.lines.map((line) => line.pv[0])).toEqual(['h0g2'])
    expect(client.status).toBe('ready')
    expect(freshWorker.terminated).toBe(false)
  })
})

describe('EngineClient 校準搜尋', () => {
  it('使用 fixed nodes 命令並回傳最深的完整同步 MultiPV batch', async () => {
    const worker = new FakeWorker()
    worker.queueSearch({
      bestmove: 'b0c2',
      lines: [
        info(9, 1, 80, 'b0c2'),
        info(9, 2, 50, 'h0g2'),
        info(9, 3, 20, 'c0e2'),
        info(10, 1, 90, 'b0c2'),
        info(10, 2, 55, 'h0g2'),
        info(10, 3, 25, 'c0e2'),
        // depth 11 尚未湊齊，不可和 depth 10 拼在一起。
        info(11, 1, 95, 'b0c2'),
      ],
    })
    const client = createClient(worker)

    const result = await client.analyzeCalibration('test-fen', { nodes: 40000, multipv: 3 })

    expect(result).toEqual<CalibrationAnalyzeResult>({
      lines: [
        { depth: 10, multipv: 1, scoreCp: 90, pv: ['b0c2', 'a9a8'] },
        { depth: 10, multipv: 2, scoreCp: 55, pv: ['h0g2', 'a9a8'] },
        { depth: 10, multipv: 3, scoreCp: 25, pv: ['c0e2', 'a9a8'] },
      ],
      bestmove: 'b0c2',
      completedDepth: 10,
      completeCandidateBatch: true,
      anomalies: [],
    })
    expect(calibrationCommands(worker)).toEqual([
      'setoption name Threads value 1',
      'setoption name Hash value 32',
      'setoption name MultiPV value 3',
      'setoption name Skill Level value 20',
      'setoption name UCI_LimitStrength value false',
      'ucinewgame',
      'setoption name Clear Hash',
      'isready',
      'position fen test-fen',
      'go nodes 40000',
      'setoption name Threads value 4',
      'setoption name MultiPV value 1',
      'setoption name Skill Level value 20',
      'setoption name UCI_LimitStrength value false',
      'isready',
    ])
  })

  it('候選不足時選同 depth 的最長連續 batch，並固定 anomaly 順序', async () => {
    const worker = new FakeWorker()
    worker.queueSearch({
      bestmove: 'c0e2',
      lines: [
        info(14, 1, 70, 'b0c2'),
        info(14, 2, 35, 'h0g2'),
        info(15, 1, 75, 'b0c2'),
      ],
    })
    const client = createClient(worker)

    const result = await client.analyzeCalibration('test-fen', { nodes: 40000, multipv: 3 })

    expect(result.lines.map((line) => [line.depth, line.multipv])).toEqual([
      [14, 1],
      [14, 2],
    ])
    expect(result.completedDepth).toBe(14)
    expect(result.completeCandidateBatch).toBe(false)
    expect(result.anomalies).toEqual([
      'incomplete-multipv-batch:2/3',
      'bestmove-mismatch',
    ])
  })

  it('沒有任何候選時只標 missing batch，不虛構 completed depth', async () => {
    const worker = new FakeWorker()
    worker.queueSearch({ bestmove: '(none)', lines: [] })
    const client = createClient(worker)

    const result = await client.analyzeCalibration('terminal-fen', {
      nodes: 40000,
      multipv: 8,
    })

    expect(result.lines).toEqual([])
    expect(result.completedDepth).toBe(0)
    expect(result.completeCandidateBatch).toBe(false)
    expect(result.anomalies).toEqual(['missing-multipv-batch'])
  })

  it('校準命令發生錯誤時仍恢復初始化時保存的 Threads 與全力設定', async () => {
    const worker = new FakeWorker()
    worker.throwOnceOnCommand = 'position fen explode'
    const client = createClient(worker, 6)

    await expect(
      client.analyzeCalibration('explode', { nodes: 40000, multipv: 8 }),
    ).rejects.toThrow('fake command failure')

    expectRestored(worker.commands, 3)
  })

  it('搜尋 runtime error 會立即拒絕、stop 收斂該次 bestmove，再恢復設定', async () => {
    const worker = new FakeWorker()
    worker.queueSearch({
      bestmove: 'b0c2',
      lines: [info(12, 1, 80, 'b0c2')],
      runtimeError: 'search exploded',
    })
    const client = createClient(worker)

    await expect(
      client.analyzeCalibration('runtime-error-fen', { nodes: 40000, multipv: 1 }),
    ).rejects.toThrow('引擎初始化失敗:search exploded')

    expect(worker.commands.filter((command) => command === 'stop')).toHaveLength(1)
    expectRestored(worker.commands)
  })

  it('restore 本身失敗時仍保留原始搜尋錯誤', async () => {
    const worker = new FakeWorker()
    worker.queueSearch({
      bestmove: 'b0c2',
      lines: [info(12, 1, 80, 'b0c2')],
      restoreFailureCommand: 'setoption name Threads value 4',
      runtimeError: 'primary search error',
    })
    const client = createClient(worker)

    await expect(
      client.analyzeCalibration('double-error-fen', { nodes: 40000, multipv: 1 }),
    ).rejects.toThrow('引擎初始化失敗:primary search error')
    expect(worker.commands).toContain('setoption name Threads value 4')
    expect(worker.terminated).toBe(true)
  })

  it('搜尋逾時會 bounded stop/drain，且下一個 request 不會吃到舊 bestmove', async () => {
    const worker = new FakeWorker()
    worker.queueSearch({
      bestmove: 'b0c2',
      hold: true,
      lines: [info(12, 1, 80, 'b0c2')],
    })
    worker.queueSearch({
      bestmove: 'h0g2',
      lines: [info(13, 1, 60, 'h0g2')],
    })
    const client = createShortTimeoutClient(worker)

    await expect(
      client.analyzeCalibration('timeout-fen', { nodes: 40000, multipv: 1 }),
    ).rejects.toThrow('引擎回應逾時')
    expect(worker.commands.filter((command) => command === 'stop')).toHaveLength(1)
    expectRestored(worker.commands)

    const next = await client.analyzeCalibration('next-after-timeout', {
      nodes: 20000,
      multipv: 1,
    })
    expect(next.bestmove).toBe('h0g2')
  })

  it('bounded drain 仍無 bestmove 時終止污染 Worker，下一個 request 重新初始化', async () => {
    const stalledWorker = new FakeWorker()
    stalledWorker.queueSearch({
      bestmove: 'b0c2',
      hold: true,
      ignoreStop: true,
      lines: [info(12, 1, 80, 'b0c2')],
    })
    const freshWorker = new FakeWorker()
    freshWorker.queueSearch({
      bestmove: 'h0g2',
      lines: [info(13, 1, 60, 'h0g2')],
    })
    const workers = [stalledWorker, freshWorker]
    const client = new EngineClient({
      commandTimeoutMs: 100,
      createWorker: () => {
        const worker = workers.shift()
        if (!worker) throw new Error('沒有可用的 fake Worker')
        return worker
      },
      drainTimeoutMs: 5,
      hardwareConcurrency: () => 8,
      isSupported: () => true,
      searchTimeoutMs: 5,
    })

    await expect(
      client.analyzeCalibration('unresponsive-fen', { nodes: 40000, multipv: 1 }),
    ).rejects.toThrow('引擎回應逾時')
    expect(stalledWorker.terminated).toBe(true)

    const next = await client.analyzeCalibration('fresh-fen', { nodes: 20000, multipv: 1 })
    expect(next.bestmove).toBe('h0g2')
    expect(freshWorker.commands).toContain('uci')
  })

  it('排隊中的 request 取消會立即拒絕，不送 stop，也不送該 request 的搜尋命令', async () => {
    const worker = new FakeWorker()
    worker.queueSearch({
      bestmove: 'b0c2',
      hold: true,
      lines: [info(12, 1, 80, 'b0c2')],
    })
    const client = createClient(worker)
    const active = client.analyzeCalibration('first-fen', { nodes: 40000, multipv: 1 })
    await waitForCommand(worker, 'go nodes 40000')

    const controller = new AbortController()
    const queued = client.analyzeCalibration('queued-fen', {
      nodes: 12345,
      multipv: 2,
      signal: controller.signal,
    })
    controller.abort()

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.commands.filter((command) => command === 'stop')).toHaveLength(0)
    expect(worker.commands).not.toContain('position fen queued-fen')
    expect(worker.commands).not.toContain('go nodes 12345')

    worker.completeActiveSearch()
    await active
    await Promise.resolve()
    expect(worker.commands).not.toContain('position fen queued-fen')
    expect(worker.commands).not.toContain('go nodes 12345')
  })

  it('執行中的 request 取消只送一次 stop，收斂 bestmove 並恢復後才拒絕', async () => {
    const worker = new FakeWorker()
    worker.queueSearch({
      bestmove: 'b0c2',
      hold: true,
      lines: [info(12, 1, 80, 'b0c2')],
    })
    const client = createClient(worker)
    const controller = new AbortController()
    const request = client.analyzeCalibration('active-fen', {
      nodes: 40000,
      multipv: 1,
      signal: controller.signal,
    })
    await waitForCommand(worker, 'go nodes 40000')

    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.commands.filter((command) => command === 'stop')).toHaveLength(1)
    expectRestored(worker.commands)

    worker.queueSearch({
      bestmove: 'h0g2',
      lines: [info(13, 1, 60, 'h0g2')],
    })
    const next = await client.analyzeCalibration('next-fen', { nodes: 20000, multipv: 1 })
    expect(next.bestmove).toBe('h0g2')
  })

  it('拒絕無效 nodes 或 MultiPV，不啟動 Worker', async () => {
    const worker = new FakeWorker()
    const client = createClient(worker)

    await expect(client.analyzeCalibration('fen', { nodes: 0, multipv: 8 })).rejects.toThrow(
      'nodes 必須是正整數',
    )
    await expect(
      client.analyzeCalibration('fen', { nodes: 40000, multipv: 257 }),
    ).rejects.toThrow('multipv 必須是1～256 的整數')
    expect(worker.commands).toEqual([])
  })
})

describe('EngineClient 一般分析相容性', () => {
  it('校準後仍保留 depth/movetime、弱棋 Elo 與下一次全力重設命令', async () => {
    const worker = new FakeWorker()
    worker.queueSearch({
      bestmove: 'a0a1',
      lines: [info(10, 1, 40, 'a0a1')],
    })
    worker.queueSearch({
      bestmove: 'b0c2',
      lines: [info(8, 1, 20, 'b0c2'), info(8, 2, 10, 'h0g2')],
    })
    worker.queueSearch({
      bestmove: 'h0g2',
      lines: [info(9, 1, 30, 'h0g2')],
    })
    const client = createClient(worker)

    await client.analyzeCalibration('calibration-fen', { nodes: 40000, multipv: 1 })
    const weak = await client.analyze('weak-fen', {
      depth: 6,
      multipv: 2,
      skillLevel: 7,
      elo: 900,
    })
    const full = await client.analyze('full-fen', { movetimeMs: 250 })

    expect(weak.bestmove).toBe('b0c2')
    expect(weak.lines).toHaveLength(2)
    expect(full.bestmove).toBe('h0g2')
    expect(worker.commands).toEqual(
      expect.arrayContaining([
        'setoption name MultiPV value 2',
        'setoption name Skill Level value 7',
        'setoption name UCI_LimitStrength value true',
        'setoption name UCI_Elo value 900',
        'position fen weak-fen',
        'go depth 6',
        'setoption name MultiPV value 1',
        'setoption name Skill Level value 20',
        'setoption name UCI_LimitStrength value false',
        'position fen full-fen',
        'go movetime 250',
      ]),
    )
  })

  it('一般分析 runtime error 也先 drain，避免下一個 request 吃到舊 bestmove', async () => {
    const worker = new FakeWorker()
    worker.queueSearch({
      bestmove: 'b0c2',
      lines: [info(8, 1, 20, 'b0c2')],
      runtimeError: 'general search error',
    })
    worker.queueSearch({
      bestmove: 'h0g2',
      lines: [info(9, 1, 30, 'h0g2')],
    })
    const client = createClient(worker)

    await expect(client.analyze('broken-general-fen', { depth: 6 })).rejects.toThrow(
      '引擎初始化失敗:general search error',
    )
    const next = await client.analyze('next-general-fen', { movetimeMs: 250 })

    expect(next.bestmove).toBe('h0g2')
    expect(worker.terminated).toBe(false)
  })
})
