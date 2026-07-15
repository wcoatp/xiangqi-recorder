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
  /** 0–20;預設 20(全力)。對弈的難度靠這個調弱;每次 go 前都會明確設定,
   * 所以弱棋力不會殘留污染解棋/殘局分析。 */
  skillLevel?: number
  /** 每次 info 更新時回呼(串流顯示用) */
  onInfo?: (lines: PvLine[]) => void
}

export type EngineStatus = 'unsupported' | 'off' | 'loading' | 'ready' | 'error'

const MATE_BASE = 30000

/** 把 score 統一成「分」(centipawn);mate n → ±(30000 − n) */
export function scoreToCp(line: PvLine): number {
  if (line.mate !== undefined) {
    return line.mate > 0 ? MATE_BASE - line.mate : -MATE_BASE - line.mate
  }
  return line.scoreCp ?? 0
}

export const isMateScore = (cp: number): boolean => Math.abs(cp) > MATE_BASE - 1000

type LineHandler = (line: string) => void

class EngineClient {
  private worker: Worker | null = null
  private handlers = new Set<LineHandler>()
  private initPromise: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  status: EngineStatus = 'off'
  statusMessage = ''
  onStatusChange: ((s: EngineStatus) => void) | null = null

  supported(): boolean {
    return (
      typeof Worker !== 'undefined' &&
      typeof SharedArrayBuffer !== 'undefined' &&
      (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
    )
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
    this.initPromise = new Promise<void>((resolve, reject) => {
      const worker = new Worker('/engine/uci-worker.js')
      this.worker = worker
      worker.onerror = (e) => {
        this.setStatus('error', e.message)
        reject(new Error(`引擎 worker 錯誤:${e.message}`))
      }
      worker.onmessage = (ev: MessageEvent) => {
        const msg = ev.data || {}
        if (msg.type === 'line') {
          for (const h of [...this.handlers]) h(msg.line as string)
        } else if (msg.type === 'ready') {
          this.handshake().then(resolve, reject)
        } else if (msg.type === 'error') {
          this.setStatus('error', msg.message)
          reject(new Error(`引擎初始化失敗:${msg.message}`))
        }
      }
      worker.postMessage({ type: 'init', nnueUrl: '/engine/xiangqi.nnue' })
    })
    this.initPromise.catch(() => {
      this.initPromise = null
    })
    return this.initPromise
  }

  private send(cmd: string) {
    this.worker?.postMessage({ type: 'cmd', cmd })
  }

  /** 等待出現符合條件的一行 */
  private waitLine(pred: (line: string) => boolean, timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handlers.delete(h)
        reject(new Error('引擎回應逾時'))
      }, timeoutMs)
      const h: LineHandler = (line) => {
        if (pred(line)) {
          clearTimeout(timer)
          this.handlers.delete(h)
          resolve(line)
        }
      }
      this.handlers.add(h)
    })
  }

  private async handshake(): Promise<void> {
    const uciok = this.waitLine((l) => l === 'uciok')
    this.send('uci')
    await uciok
    const hc = (navigator.hardwareConcurrency || 4) as number
    const threads = Math.max(1, Math.min(4, Math.ceil(hc / 2)))
    this.send('setoption name UCI_Variant value xiangqi')
    this.send(`setoption name Threads value ${threads}`)
    this.send('setoption name Hash value 32')
    this.send('setoption name EvalFile value /xiangqi.nnue')
    this.send('setoption name Use NNUE value true')
    const readyok = this.waitLine((l) => l === 'readyok')
    this.send('isready')
    await readyok
    this.setStatus('ready')
  }

  /** 分析單一局面;內部排隊,同時間只跑一個 go */
  analyze(fen: string, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
    const run = async (): Promise<AnalyzeResult> => {
      await this.init()
      const multipv = opts.multipv ?? 1
      const lines = new Map<number, PvLine>()
      const infoRe =
        /^info .*?\bdepth (\d+)\b(?:.*?\bmultipv (\d+))?.*?\bscore (cp|mate) (-?\d+)\b.*?\bpv (.+)$/
      const collector: LineHandler = (line) => {
        const m = infoRe.exec(line)
        if (!m) return
        const entry: PvLine = {
          depth: parseInt(m[1], 10),
          multipv: m[2] ? parseInt(m[2], 10) : 1,
          pv: m[5].trim().split(/\s+/),
        }
        if (m[3] === 'cp') entry.scoreCp = parseInt(m[4], 10)
        else entry.mate = parseInt(m[4], 10)
        lines.set(entry.multipv, entry)
        opts.onInfo?.(sorted())
      }
      const sorted = () => [...lines.values()].sort((a, b) => a.multipv - b.multipv)
      this.handlers.add(collector)
      try {
        this.send('stop')
        this.send(`setoption name MultiPV value ${multipv}`)
        this.send(`setoption name Skill Level value ${opts.skillLevel ?? 20}`)
        this.send(`position fen ${fen}`)
        const done = this.waitLine((l) => l.startsWith('bestmove'), 120000)
        if (opts.depth) this.send(`go depth ${opts.depth}`)
        else this.send(`go movetime ${opts.movetimeMs ?? 1000}`)
        const bestLine = await done
        const bestmove = bestLine.split(/\s+/)[1] ?? ''
        return { lines: sorted(), bestmove }
      } finally {
        this.handlers.delete(collector)
      }
    }
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => undefined)
    return p
  }

  /** 中止目前的 go(排隊中的下一個分析會照常進行) */
  stop() {
    this.send('stop')
  }
}

export const engine = new EngineClient()
