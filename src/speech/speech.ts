// 語音輸入能力偵測與單次辨識。
// 平台現實(2026-07 查證):
//   - Android Chrome(含已安裝 PWA):Web Speech API 可用(雲端辨識,需網路)
//   - iOS Safari 分頁:Web Speech API 可用(Siri 引擎)
//   - iOS「加入主畫面」standalone PWA:SpeechRecognition 被 WebKit 封鎖(bug 225298)
//     → 主路徑改用「聚焦輸入框 + 系統鍵盤聽寫鍵」(on-device、離線可用)
// 策略:執行期偵測 + 首次失敗自動降級,未來 WebKit 修復即自動受益。

export type SpeechMode = 'webspeech' | 'dictation'

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((ev: SpeechResultEventLike) => void) | null
  onerror: ((ev: { error?: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechResultEventLike {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    length: number
    [i: number]: { transcript: string }
  }>
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isStandalonePwa(): boolean {
  const nav = navigator as unknown as { standalone?: boolean }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

export function isIOS(): boolean {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** 已知 iOS standalone PWA 不支援 SpeechRecognition;其餘依 API 存在與否 */
export function detectSpeechMode(): SpeechMode {
  if (!getCtor()) return 'dictation'
  if (isIOS() && isStandalonePwa()) return 'dictation'
  return 'webspeech'
}

export interface ListenSession {
  /** resolve:最終辨識的候選字串(最多 5 個);reject:error code 字串 */
  promise: Promise<string[]>
  /** 中止聆聽 */
  cancel: () => void
  /** 中途結果回呼(顯示 interim 字幕) */
  onInterim: (cb: (text: string) => void) => void
}

/** 單次聆聽一句(說完或靜音即結束) */
export function listenOnce(lang: string): ListenSession {
  const Ctor = getCtor()
  let interimCb: ((t: string) => void) | null = null
  let cancelFn = () => {}
  const promise = new Promise<string[]>((resolve, reject) => {
    if (!Ctor) {
      reject(new Error('unsupported'))
      return
    }
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 5
    let finished = false
    let lastInterim = ''
    // iOS Safari 事件序不可靠:自設安全逾時
    const hardTimer = setTimeout(() => {
      if (!finished) rec.stop()
    }, 8000)
    const finish = (alts: string[]) => {
      if (finished) return
      finished = true
      clearTimeout(hardTimer)
      if (alts.length > 0) resolve(alts)
      else if (lastInterim) resolve([lastInterim])
      else reject(new Error('no-speech'))
    }
    rec.onresult = (ev) => {
      const alts: string[] = []
      for (let i = 0; i < ev.results.length; i++) {
        const res = ev.results[i]
        if (res.isFinal) {
          for (let j = 0; j < res.length; j++) alts.push(res[j].transcript)
        } else if (res[0]) {
          lastInterim = res[0].transcript
          interimCb?.(lastInterim)
        }
      }
      if (alts.length > 0) {
        rec.stop()
        finish(alts)
      }
    }
    rec.onerror = (ev) => {
      if (finished) return
      finished = true
      clearTimeout(hardTimer)
      reject(new Error(ev.error || 'unknown'))
    }
    rec.onend = () => finish([])
    cancelFn = () => {
      if (!finished) {
        finished = true
        clearTimeout(hardTimer)
        try {
          rec.abort()
        } catch {
          /* noop */
        }
        reject(new Error('cancelled'))
      }
    }
    try {
      rec.start()
    } catch (e) {
      finished = true
      clearTimeout(hardTimer)
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
  return {
    promise,
    cancel: () => cancelFn(),
    onInterim: (cb) => {
      interimCb = cb
    },
  }
}

/** 語音覆誦(TTS) */
export function speak(text: string, lang: string): void {
  try {
    if (!('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = 1.1
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch {
    /* TTS 失敗不影響主流程 */
  }
}
