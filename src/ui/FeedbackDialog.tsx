// 回饋及建議:把內容(可附診斷資訊)交給你自己的郵件 App 寄出。
// 用 mailto 而不是後端:零成本、零第三方、離線可用,而且「送出」這個動作
// 完全由使用者在自己的信箱裡按 —— App 不會偷偷替任何人寄信。
import { useEffect, useState } from 'react'
import { db } from '../store/db'
import { detectSpeechMode, isIOS, isStandalonePwa } from '../speech/speech'
import { loadTemplates } from '../vision/templates'

// 位址拆開組合:公開原始碼與 JS bundle 會被爬信箱,這擋得掉最粗糙的爬蟲(擋不掉認真的)
const FEEDBACK_TO = ['wcoatp', '@', 'gmail', '.', 'com'].join('')

export const APP_VERSION = '0.3.0'

type Kind = '建議' | '問題回報' | '其他'
const KINDS: Kind[] = ['建議', '問題回報', '其他']

const PLACEHOLDER: Record<Kind, string> = {
  建議: '希望增加什麼功能?哪裡用起來不順?',
  問題回報: '發生什麼事?在哪個畫面?怎麼重現?(例:拍照辨識把黑馬認成黑炮)',
  其他: '任何想說的…',
}

async function collectDiagnostics(): Promise<string> {
  const lines: string[] = []
  const add = (k: string, v: unknown) => lines.push(`${k}: ${v}`)
  add('版本', APP_VERSION)
  add('時間', new Date().toLocaleString('zh-TW', { hour12: false }))
  add('網址', location.origin)
  add('安裝模式', isStandalonePwa() ? '已加入主畫面' : '瀏覽器分頁')
  add('平台', isIOS() ? 'iOS' : navigator.platform || '?')
  add('瀏覽器', navigator.userAgent)
  add('語言', navigator.language)
  add('螢幕', `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`)
  add('語音模式', detectSpeechMode() === 'webspeech' ? '即時語音' : '鍵盤聽寫')
  add('引擎可用', typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated ? '是' : '否')
  try {
    const t = await loadTemplates()
    add('棋子校準', t ? `已校準(${new Date(t.createdAt).toLocaleDateString('zh-TW')})` : '未校準')
    add('對局數', await db.games.count())
  } catch {
    add('資料庫', '讀取失敗')
  }
  return lines.join('\n')
}

export default function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('建議')
  const [text, setText] = useState('')
  const [includeDiag, setIncludeDiag] = useState(true)
  const [diag, setDiag] = useState('')
  const [showDiag, setShowDiag] = useState(false)
  const [copied, setCopied] = useState('')
  const [fallbackText, setFallbackText] = useState('')

  useEffect(() => {
    void collectDiagnostics().then(setDiag)
  }, [])

  const body = `${text.trim()}\n\n${includeDiag ? `---- 診斷資訊(可在上方勾掉不附)----\n${diag}\n` : ''}`
  const subject = `[象棋記譜] ${kind}`
  const canSend = text.trim().length >= 2

  const plain = `收件人:${FEEDBACK_TO}\n主旨:${subject}\n\n${body}`

  const send = () => {
    // 用 <a> 而不是 location.href:對 mailto 較穩,也讓 E2E 測得到組出來的 URL
    const a = document.createElement('a')
    a.href = `mailto:${FEEDBACK_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const copy = () => {
    void navigator.clipboard
      .writeText(plain)
      .then(() => {
        setCopied('已複製,貼到信件寄給我即可')
        setFallbackText('')
      })
      .catch(() => {
        // 複製失敗就得真的把文字放出來讓人選 —— 不能只叫使用者「選取上面的文字」卻沒有文字
        setCopied('這個瀏覽器擋了自動複製,請直接選取下面的文字複製:')
        setFallbackText(plain)
      })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3 className="grow">💬 回饋及建議</h3>
          <button onClick={onClose}>關閉</button>
        </div>

        <div className="seg">
          {KINDS.map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>

        <textarea
          rows={5}
          placeholder={PLACEHOLDER[kind]}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ width: '100%', fontSize: 16 }}
        />

        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={includeDiag} onChange={(e) => setIncludeDiag(e.target.checked)} />
          <span className="grow">
            附上診斷資訊
            <div className="muted">版本、手機型號、語音/引擎狀態等,回報問題時很有幫助</div>
          </span>
          <button
            onClick={(e) => {
              e.preventDefault()
              setShowDiag(!showDiag)
            }}
          >
            {showDiag ? '隱藏' : '看內容'}
          </button>
        </label>
        {showDiag && (
          <pre
            className="muted"
            style={{ whiteSpace: 'pre-wrap', fontSize: 11, maxHeight: 140, overflowY: 'auto', margin: 0 }}
          >
            {diag}
          </pre>
        )}

        <div className="muted">
          按「用郵件寄出」會開啟你手機的郵件 App、內容都填好,你確認後自己按寄出(App 不會替你寄)。
          沒有郵件 App 就用「複製內容」。
        </div>
        {copied && <div className="muted">{copied}</div>}
        {fallbackText && (
          <textarea
            readOnly
            rows={6}
            value={fallbackText}
            onFocus={(e) => e.currentTarget.select()}
            style={{ width: '100%', fontSize: 12 }}
          />
        )}

        <div className="fab-row">
          <button onClick={copy} disabled={!canSend}>
            📋 複製內容
          </button>
          <button className="primary" onClick={send} disabled={!canSend}>
            ✉️ 用郵件寄出
          </button>
        </div>
      </div>
    </div>
  )
}
