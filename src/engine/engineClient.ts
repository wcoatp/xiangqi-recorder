// fairy-stockfish WASM 引擎客戶端(UCI over Worker)。
// 需要 crossOriginIsolated(COOP/COEP 標頭)才有 SharedArrayBuffer 可用;
// 不滿足時 supported() = false,UI 應停用分析功能並提示。
export interface PvLine {
  multipv: number
  depth: number
  scoreCp?: number
  mate?: number
  pv: string[]
}

export interface AnalyzeResult {
  lines: PvLine[]
  bestmove: string
}

export interface AnalyzeOptions {
  movetimeMs?: number
  depth?: number
  multipv?: number
  /** −20~20;預設 20(全力)。對弈的難度靠這個調弱;每次 go 前都會明確設定,
   * 所以弱棋力不會殘留污染解棋/殘局分析。 */
  skillLevel?: number
  /** 500–2850:啟用引擎的限制棋力模式。不給 = 不限制(全力)。
   * ⚠ 這個 Elo 刻度是 Stockfish 為西洋棋校準的,套在象棋上只保證「單調變強」,
   * 不是象棋等級分,所以 UI 不可宣稱它等於某個段位。 */
  elo?: number
  /** 每次 info 更新時回呼(串流顯示用) */
  onInfo?: (lines: PvLine[]) => void
}

/** 校準搜尋只接受固定 nodes 與 MultiPV，不接受 movetime 或引擎內建 Elo 弱化。 */
export interface CalibrationAnalyzeOptions {
  nodes: number
  multipv: number
  signal?: AbortSignal
}

export interface CalibrationAnalyzeResult extends AnalyzeResult {
  /** 回傳候選所屬的同一個完整（或最長連續）depth。 */
  completedDepth: number
  completeCandidateBatch: boolean
  /** 穩定、可保存的機器字串；順序固定為 batch 狀態後 bestmove 一致性。 */
  anomalies: string[]
}

export type EngineStatus = 'unsupported' | 'off' | 'loading' | 'ready' | 'error'

const MATE_BASE = 30000
const DEFAULT_HASH_MB = 32
const MAX_THREADS = 4
const MAX_MULTIPV = 256

/** 把 score 統一成「分」(centipawn);mate n → ±(30000 − n) */
export function scoreToCp(line: PvLine): number {
  if (line.mate !== undefined) {
    return line.mate > 0 ? MATE_BASE - line.mate : -MATE_BASE - line.mate
  }
  return line.scoreCp ?? 0
}

export const isMateScore = (cp: number): boolean => Math.abs(cp) > MATE_BASE - 1000

type LineHandler = (line: string) => void

/** Worker 的最小介面，讓 Node 測試能注入不載入 WASM 的 fake Worker。 */
export interface EngineWorkerLike {
  onerror: ((event: { message: string }) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(message: unknown): void
  terminate(): void
}

export interface EngineClientEnvironment {
  commandTimeoutMs: number
  createWorker: (url: string) => EngineWorkerLike
  drainTimeoutMs: number
  hardwareConcurrency: () => number
  isSupported: () => boolean
  searchTimeoutMs: number
}

const defaultEnvironment: EngineClientEnvironment = {
  commandTimeoutMs: 30000,
  createWorker: (url) => new Worker(url) as unknown as EngineWorkerLike,
  drainTimeoutMs: 5000,
  hardwareConcurrency: () =>
    typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4,
  isSupported: () =>
    typeof Worker !== 'undefined' &&
    typeof SharedArrayBuffer !== 'undefined' &&
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
  searchTimeoutMs: 120000,
}

interface QueueRequestContext {
  throwIfAborted(): void
  setActiveAbortHandler(handler: (() => void) | null): void
}

type QueueRequestState = 'queued' | 'active' | 'cancelled' | 'settled'

interface LineWaiter {
  cancel(): void
  promise: Promise<string>
}

function makeAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('引擎分析已取消', 'AbortError')
  }
  const error = new Error('引擎分析已取消')
  error.name = 'AbortError'
  return error
}

function parsePvLine(line: string): PvLine | null {
  const infoRe =
    /^info .*?\bdepth (\d+)\b(?:.*?\bmultipv (\d+))?.*?\bscore (cp|mate) (-?\d+)\b.*?\bpv (.+)$/
  const match = infoRe.exec(line)
  if (!match) return null
  const entry: PvLine = {
    depth: parseInt(match[1], 10),
    multipv: match[2] ? parseInt(match[2], 10) : 1,
    pv: match[5].trim().split(/\s+/),
  }
  if (match[3] === 'cp') entry.scoreCp = parseInt(match[4], 10)
  else entry.mate = parseInt(match[4], 10)
  return entry
}

function requirePositiveSafeInteger(value: number, field: string, max?: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || (max !== undefined && value > max)) {
    const range = max === undefined ? '正整數' : `1～${max} 的整數`
    throw new RangeError(`${field} 必須是${range}`)
  }
  return value
}

export class EngineClient {
  private worker: EngineWorkerLike | null = null
  private handlers = new Set<LineHandler>()
  private failureHandlers = new Set<(error: Error) => void>()
  private initPromise: Promise<void> | null = null
  private queue: Promise<void> = Promise.resolve()
  private defaultThreads = 1
  private bestmoveSequence = 0
  private readonly environment: EngineClientEnvironment
  status: EngineStatus = 'off'
  statusMessage = ''
  onStatusChange: ((s: EngineStatus) => void) | null = null

  constructor(environment: Partial<EngineClientEnvironment> = {}) {
    this.environment = { ...defaultEnvironment, ...environment }
  }

  supported(): boolean {
    return this.environment.isSupported()
  }

  private setStatus(s: EngineStatus, msg = '') {
    this.status = s
    this.statusMessage = msg
    this.onStatusChange?.(s)
  }

  /** 啟動引擎(冪等)。threads/hash 依裝置自動。 */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise
    if (!this.supported()) {
      this.setStatus('unsupported')
      return Promise.reject(new Error('此環境不支援引擎(需要 COOP/COEP 標頭與 SharedArrayBuffer)'))
    }
    this.setStatus('loading')
    let worker: EngineWorkerLike
    try {
      worker = this.environment.createWorker('/engine/uci-worker.js')
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      this.setStatus('error', error.message)
      return Promise.reject(error)
    }

    this.worker = worker
    let resolveInit!: () => void
    let rejectInit!: (reason?: unknown) => void
    const initPromise = new Promise<void>((resolve, reject) => {
      resolveInit = resolve
      rejectInit = reject
    })
    this.initPromise = initPromise
    let handshakeStarted = false

    worker.onerror = (event) => {
      if (this.worker !== worker) return
      const error = new Error(`引擎 worker 錯誤:${event.message}`)
      this.setStatus('error', event.message)
      this.broadcastFailure(error)
      rejectInit(error)
    }
    worker.onmessage = (event) => {
      // 已失敗或被重設的舊 generation 即使有排程中的延遲事件，也不可碰全域 waiter。
      if (this.worker !== worker) return
      const msg = (event.data || {}) as { type?: string; line?: string; message?: string }
      if (msg.type === 'line') {
        const line = msg.line ?? ''
        if (line.startsWith('bestmove')) this.bestmoveSequence += 1
        for (const handler of [...this.handlers]) handler(line)
      } else if (msg.type === 'ready') {
        if (handshakeStarted) return
        handshakeStarted = true
        this.handshake(worker).then(resolveInit, rejectInit)
      } else if (msg.type === 'error') {
        const error = new Error(`引擎初始化失敗:${msg.message ?? ''}`)
        this.setStatus('error', msg.message ?? '')
        this.broadcastFailure(error)
        rejectInit(error)
      }
    }
    try {
      worker.postMessage({ type: 'init', nnueUrl: '/engine/xiangqi.nnue' })
    } catch (error) {
      rejectInit(error)
    }

    void initPromise.catch((cause) => {
      const wasCurrent = this.worker === worker
      if (this.initPromise === initPromise) this.initPromise = null
      this.discardWorker(worker)
      if (wasCurrent && this.status !== 'error') {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        this.setStatus('error', error.message)
      }
    })
    return initPromise
  }

  private send(cmd: string) {
    this.worker?.postMessage({ type: 'cmd', cmd })
  }

  private broadcastFailure(error: Error): void {
    for (const handler of [...this.failureHandlers]) handler(error)
  }

  /** 建立可取消的行等待器；runtime worker failure 會立即拒絕，不等 120 秒 timeout。 */
  private createLineWaiter(
    pred: (line: string) => boolean,
    timeoutMs = this.environment.commandTimeoutMs,
  ): LineWaiter {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let lineHandler!: LineHandler
    let failureHandler!: (error: Error) => void
    const cleanup = () => {
      if (!active) return
      active = false
      clearTimeout(timer)
      this.handlers.delete(lineHandler)
      this.failureHandlers.delete(failureHandler)
    }
    const promise = new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => {
        cleanup()
        reject(new Error('引擎回應逾時'))
      }, timeoutMs)
      lineHandler = (line) => {
        if (pred(line)) {
          cleanup()
          resolve(line)
        }
      }
      failureHandler = (error) => {
        cleanup()
        reject(error)
      }
      this.handlers.add(lineHandler)
      this.failureHandlers.add(failureHandler)
    })
    return { cancel: cleanup, promise }
  }

  private sendAndWait(
    cmd: string,
    pred: (line: string) => boolean,
    timeoutMs = this.environment.commandTimeoutMs,
  ): Promise<string> {
    const waiter = this.createLineWaiter(pred, timeoutMs)
    try {
      this.send(cmd)
    } catch (error) {
      waiter.cancel()
      throw error
    }
    return waiter.promise
  }

  private async handshake(worker: EngineWorkerLike): Promise<void> {
    this.assertCurrentWorker(worker)
    await this.sendToWorkerAndWait(worker, 'uci', (line) => line === 'uciok')
    this.assertCurrentWorker(worker)
    const hardwareConcurrency = this.environment.hardwareConcurrency()
    const normalizedConcurrency =
      Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 ? hardwareConcurrency : 4
    this.defaultThreads = Math.max(1, Math.min(MAX_THREADS, Math.ceil(normalizedConcurrency / 2)))
    worker.postMessage({ type: 'cmd', cmd: 'setoption name UCI_Variant value xiangqi' })
    worker.postMessage({
      type: 'cmd',
      cmd: `setoption name Threads value ${this.defaultThreads}`,
    })
    worker.postMessage({ type: 'cmd', cmd: `setoption name Hash value ${DEFAULT_HASH_MB}` })
    worker.postMessage({ type: 'cmd', cmd: 'setoption name EvalFile value /xiangqi.nnue' })
    worker.postMessage({ type: 'cmd', cmd: 'setoption name Use NNUE value true' })
    await this.sendToWorkerAndWait(worker, 'isready', (line) => line === 'readyok')
    this.assertCurrentWorker(worker)
    this.setStatus('ready')
  }

  private sendToWorkerAndWait(
    worker: EngineWorkerLike,
    cmd: string,
    pred: (line: string) => boolean,
  ): Promise<string> {
    this.assertCurrentWorker(worker)
    const waiter = this.createLineWaiter(pred, this.environment.commandTimeoutMs)
    try {
      worker.postMessage({ type: 'cmd', cmd })
    } catch (error) {
      waiter.cancel()
      throw error
    }
    return waiter.promise
  }

  private assertCurrentWorker(worker: EngineWorkerLike): void {
    if (this.worker !== worker) throw new Error('引擎 Worker generation 已失效')
  }

  private discardWorker(worker: EngineWorkerLike): void {
    worker.onmessage = null
    worker.onerror = null
    try {
      worker.terminate()
    } catch {
      // 已失敗的 Worker 即使 terminate 本身拋錯，也必須先和目前 generation 隔離。
    }
    if (this.worker === worker) this.worker = null
  }

  /**
   * 共用單一 Worker queue。排隊中取消會立即拒絕且不送 stop；執行中只呼叫該 request
   * 登記的 abort handler，完成清理後才讓下一個 request 開始。
   */
  private enqueue<T>(
    run: (context: QueueRequestContext) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(makeAbortError())

    let state: QueueRequestState = 'queued'
    let abortRequested = false
    let activeAbortHandler: (() => void) | null = null
    let settled = false
    let resolveResult!: (value: T | PromiseLike<T>) => void
    let rejectResult!: (reason?: unknown) => void
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })

    const removeAbortListener = () => signal?.removeEventListener('abort', onAbort)
    const settleResolve = (value: T) => {
      if (settled) return
      settled = true
      removeAbortListener()
      resolveResult(value)
    }
    const settleReject = (reason: unknown) => {
      if (settled) return
      settled = true
      removeAbortListener()
      rejectResult(reason)
    }
    const onAbort = () => {
      abortRequested = true
      if (state === 'queued') {
        state = 'cancelled'
        settleReject(makeAbortError())
      } else if (state === 'active') {
        activeAbortHandler?.()
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const execute = async () => {
      if (state === 'cancelled') return
      state = 'active'
      const context: QueueRequestContext = {
        throwIfAborted: () => {
          if (abortRequested) throw makeAbortError()
        },
        setActiveAbortHandler: (handler) => {
          activeAbortHandler = handler
        },
      }
      try {
        const value = await run(context)
        context.throwIfAborted()
        settleResolve(value)
      } catch (error) {
        settleReject(error)
      } finally {
        activeAbortHandler = null
        state = 'settled'
        removeAbortListener()
      }
    }

    const turn = this.queue.then(execute, execute)
    this.queue = turn.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /** 分析單一局面;內部排隊,同時間只跑一個 go。既有 movetime/depth API 保持相容。 */
  analyze(fen: string, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
    return this.enqueue(async () => {
      await this.init()
      const multipv = opts.multipv ?? 1
      const lines = new Map<number, PvLine>()
      const sorted = () => [...lines.values()].sort((a, b) => a.multipv - b.multipv)
      const collector: LineHandler = (line) => {
        const entry = parsePvLine(line)
        if (!entry) return
        lines.set(entry.multipv, entry)
        opts.onInfo?.(sorted())
      }
      this.handlers.add(collector)
      let searchStarted = false
      let searchStartSequence = this.bestmoveSequence
      try {
        this.send('stop')
        this.send(`setoption name MultiPV value ${multipv}`)
        this.send(`setoption name Skill Level value ${opts.skillLevel ?? 20}`)
        if (opts.elo !== undefined) {
          this.send('setoption name UCI_LimitStrength value true')
          this.send(`setoption name UCI_Elo value ${Math.round(opts.elo)}`)
        } else {
          this.send('setoption name UCI_LimitStrength value false')
        }
        this.send(`position fen ${fen}`)
        const done = this.createLineWaiter(
          (line) => line.startsWith('bestmove'),
          this.environment.searchTimeoutMs,
        )
        searchStartSequence = this.bestmoveSequence
        try {
          if (opts.depth) this.send(`go depth ${opts.depth}`)
          else this.send(`go movetime ${opts.movetimeMs ?? 1000}`)
        } catch (error) {
          done.cancel()
          throw error
        }
        searchStarted = true
        const bestLine = await done.promise
        searchStarted = false
        const bestmove = bestLine.split(/\s+/)[1] ?? ''
        return { lines: sorted(), bestmove }
      } catch (error) {
        this.handlers.delete(collector)
        if (searchStarted) {
          try {
            await this.drainCalibrationSearch(searchStartSequence)
          } catch {
            this.invalidateWorker('一般分析未能安全停止，已重設本機引擎')
          }
        }
        throw error
      } finally {
        this.handlers.delete(collector)
      }
    })
  }

  /**
   * 供可重播校準使用的固定 nodes 搜尋。候選永遠取自同一 depth，且結束、取消或錯誤
   * 都會恢復一般分析的 Threads、MultiPV 與全力設定後才釋放 queue。
   */
  analyzeCalibration(
    fen: string,
    opts: CalibrationAnalyzeOptions,
  ): Promise<CalibrationAnalyzeResult> {
    let nodes: number
    let multipv: number
    try {
      nodes = requirePositiveSafeInteger(opts.nodes, 'nodes')
      multipv = requirePositiveSafeInteger(opts.multipv, 'multipv', MAX_MULTIPV)
    } catch (error) {
      return Promise.reject(error)
    }

    return this.enqueue(
      async (context) => {
        await this.init()
        context.throwIfAborted()

        const depthBuckets = new Map<number, Map<number, PvLine>>()
        const collector: LineHandler = (line) => {
          const entry = parsePvLine(line)
          if (!entry || entry.multipv < 1 || entry.multipv > multipv) return
          let bucket = depthBuckets.get(entry.depth)
          if (!bucket) {
            bucket = new Map<number, PvLine>()
            depthBuckets.set(entry.depth, bucket)
          }
          bucket.set(entry.multipv, entry)
        }

        let calibrationSettingsApplied = false
        let searchStarted = false
        let searchStartSequence = this.bestmoveSequence
        let primaryError: unknown
        let hasPrimaryError = false
        let cleanupError: unknown
        let workerInvalidated = false
        let result: CalibrationAnalyzeResult | undefined
        this.handlers.add(collector)
        try {
          calibrationSettingsApplied = true
          this.send('setoption name Threads value 1')
          this.send(`setoption name Hash value ${DEFAULT_HASH_MB}`)
          this.send(`setoption name MultiPV value ${multipv}`)
          this.send('setoption name Skill Level value 20')
          this.send('setoption name UCI_LimitStrength value false')
          this.send('ucinewgame')
          this.send('setoption name Clear Hash')
          await this.sendAndWait('isready', (line) => line === 'readyok')
          context.throwIfAborted()

          this.send(`position fen ${fen}`)
          context.throwIfAborted()
          const done = this.createLineWaiter(
            (line) => line.startsWith('bestmove'),
            this.environment.searchTimeoutMs,
          )
          context.setActiveAbortHandler(() => this.send('stop'))
          searchStartSequence = this.bestmoveSequence
          searchStarted = true
          try {
            this.send(`go nodes ${nodes}`)
          } catch (error) {
            done.cancel()
            throw error
          }
          const bestLine = await done.promise
          searchStarted = false
          context.setActiveAbortHandler(null)
          const bestmove = bestLine.split(/\s+/)[1] ?? ''
          const selected = this.selectCalibrationBatch(depthBuckets, multipv)
          const anomalies: string[] = []
          if (selected.lines.length === 0) {
            anomalies.push('missing-multipv-batch')
          } else if (!selected.complete) {
            anomalies.push(`incomplete-multipv-batch:${selected.lines.length}/${multipv}`)
          }
          if (selected.lines[0] && selected.lines[0].pv[0] !== bestmove) {
            anomalies.push('bestmove-mismatch')
          }
          result = {
            lines: selected.lines,
            bestmove,
            completedDepth: selected.depth,
            completeCandidateBatch: selected.complete,
            anomalies,
          }
        } catch (error) {
          hasPrimaryError = true
          primaryError = error
        } finally {
          context.setActiveAbortHandler(null)
          this.handlers.delete(collector)
          if (searchStarted) {
            try {
              await this.drainCalibrationSearch(searchStartSequence)
            } catch (error) {
              cleanupError = error
              workerInvalidated = true
              this.invalidateWorker('校準搜尋未能安全停止，已重設本機引擎')
            }
          }
          if (calibrationSettingsApplied && !workerInvalidated) {
            try {
              await this.restoreDefaultAnalysisSettings()
            } catch (error) {
              if (cleanupError === undefined) cleanupError = error
              workerInvalidated = true
              this.invalidateWorker('校準搜尋設定恢復失敗，已重設本機引擎')
            }
          }
        }
        try {
          context.throwIfAborted()
        } catch (error) {
          if (!hasPrimaryError) {
            hasPrimaryError = true
            primaryError = error
          }
        }
        if (hasPrimaryError) throw primaryError
        if (cleanupError !== undefined) throw cleanupError
        if (!result) throw new Error('校準搜尋沒有產生結果')
        return result
      },
      opts.signal,
    )
  }

  private selectCalibrationBatch(
    depthBuckets: ReadonlyMap<number, ReadonlyMap<number, PvLine>>,
    multipv: number,
  ): { lines: PvLine[]; depth: number; complete: boolean } {
    const batches = [...depthBuckets.entries()].map(([depth, bucket]) => {
      const lines: PvLine[] = []
      for (let index = 1; index <= multipv; index += 1) {
        const line = bucket.get(index)
        if (!line) break
        lines.push(line)
      }
      return { depth, lines }
    })
    const complete = batches
      .filter((batch) => batch.lines.length === multipv)
      .sort((a, b) => b.depth - a.depth)[0]
    if (complete) return { ...complete, complete: true }

    const longest = batches.sort(
      (a, b) => b.lines.length - a.lines.length || b.depth - a.depth,
    )[0]
    if (!longest) return { lines: [], depth: 0, complete: false }
    return { ...longest, complete: false }
  }

  private async restoreDefaultAnalysisSettings(): Promise<void> {
    this.send(`setoption name Threads value ${this.defaultThreads}`)
    this.send('setoption name MultiPV value 1')
    this.send('setoption name Skill Level value 20')
    this.send('setoption name UCI_LimitStrength value false')
    await this.sendAndWait('isready', (line) => line === 'readyok')
  }

  /** timeout/runtime error 後先 stop，並在有限時間內吃掉本次 bestmove 才恢復設定。 */
  private async drainCalibrationSearch(searchStartSequence: number): Promise<void> {
    if (this.bestmoveSequence > searchStartSequence) return
    const drained = this.createLineWaiter(
      (line) => line.startsWith('bestmove'),
      this.environment.drainTimeoutMs,
    )
    try {
      this.send('stop')
    } catch (error) {
      drained.cancel()
      throw error
    }
    await drained.promise
  }

  /** 無法安全 drain/restore 時終止該 Worker；下一個 queue request 會重新初始化乾淨引擎。 */
  private invalidateWorker(message: string): void {
    const worker = this.worker
    if (worker) this.discardWorker(worker)
    this.initPromise = null
    this.setStatus('error', message)
  }

  /** 中止目前的 go(排隊中的下一個分析會照常進行)。 */
  stop() {
    this.send('stop')
  }
}

export const engine = new EngineClient()
