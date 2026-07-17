import { useEffect, useState, type FormEvent } from 'react'
import { useApp } from '../App'
import { exportBackup, RankBackupAccessError } from '../store/backup'
import { db, type GameRow } from '../store/db'
import ImportDialog from './ImportDialog'

const RESULT_LABEL: Record<string, string> = {
  red: '紅勝',
  black: '黑勝',
  draw: '和棋',
  '*': '進行中',
}

export default function GamesPage({ intent }: { intent: 'replay' | 'analyze' }) {
  const { go } = useApp()
  const [games, setGames] = useState<GameRow[]>([])
  const [q, setQ] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [showBackupPin, setShowBackupPin] = useState(false)
  const [flash, setFlash] = useState('')

  const reload = () => void db.games.orderBy('startedAt').reverse().toArray().then(setGames)
  useEffect(reload, [])

  const filtered = games.filter((g) => {
    const key = q.trim()
    if (!key) return true
    return (
      g.redName.includes(key) ||
      g.blackName.includes(key) ||
      new Date(g.startedAt).toLocaleDateString('zh-TW').includes(key)
    )
  })

  const remove = async (g: GameRow) => {
    if (!window.confirm(`刪除「${g.redName} vs ${g.blackName}」這局紀錄?此動作無法復原。`)) return
    await db.games.delete(g.id)
    reload()
  }

  return (
    <div className="page">
      <div className="topbar">
        <button onClick={() => go({ name: 'home' })}>← 返回</button>
        <div className="title">{intent === 'analyze' ? '解棋:選擇對局' : '復盤紀錄'}</div>
      </div>
      <input
        placeholder="搜尋玩家姓名或日期…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%' }}
      />
      <div className="fab-row">
        <button onClick={() => setShowImport(true)}>📥 匯入棋譜</button>
        <button
          onClick={() => void downloadBackup(undefined, setFlash).catch((error: unknown) => {
            if (error instanceof RankBackupAccessError && error.code === 'pin-required') {
              setFlash('備份含段級校準資料，請先驗證本機 PIN。')
              setShowBackupPin(true)
            } else {
              setFlash(`備份失敗：${errorMessage(error)}`)
            }
          })}
        >
          💾 完整備份
        </button>
      </div>
      <div className="muted backup-privacy-note">
        完整備份可在換電腦時搬移棋局、棋手名冊、一般偏好與本機校準資料。JSON 未加密，可能含姓名、自報級段與校準備註，請妥善保管；不含 API Token、段級 PIN 或門禁驗證資料。
      </div>
      {flash && <div className="muted">{flash}</div>}
      <div className="card" style={{ padding: 0 }}>
        {filtered.length === 0 && <div className="list-item muted">沒有紀錄</div>}
        {filtered.map((g) => (
          <div key={g.id} className="list-item">
            <div
              className="grow"
              onClick={() => go({ name: 'replay', gameId: g.id, analyze: intent === 'analyze' })}
            >
              <div>
                {g.mode === 'play' && '🤖 '}
                <b style={{ color: 'var(--red)' }}>{g.redName}</b> vs <b>{g.blackName}</b>{' '}
                <span className="result-badge">{RESULT_LABEL[g.result]}</span>
                {g.continuedFrom && <span className="result-badge continuation-badge">接續局</span>}
                {g.review && <span className="result-badge">已解棋</span>}
              </div>
              <div className="muted">
                {new Date(g.startedAt).toLocaleString('zh-TW', { hour12: false })}.{g.moveCount} 著
              </div>
            </div>
            {g.result === '*' && (
              <button
                onClick={() => go({ name: g.mode === 'play' ? 'play' : 'record', gameId: g.id })}
              >
                {g.mode === 'play' ? '續弈' : '續記'}
              </button>
            )}
            <button className="danger" onClick={() => void remove(g)}>
              刪除
            </button>
          </div>
        ))}
      </div>
      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onDone={(msg) => {
            setShowImport(false)
            setFlash(msg)
            reload()
          }}
        />
      )}
      {showBackupPin && (
        <BackupPinDialog
          onClose={() => setShowBackupPin(false)}
          onConfirm={async (pin) => {
            try {
              await downloadBackup(pin, setFlash)
              return null
            } catch (error) {
              const message = errorMessage(error)
              setFlash(`備份未下載：${message}`)
              return message
            }
          }}
        />
      )}
    </div>
  )
}

async function downloadBackup(rankPin: string | undefined, setFlash: (s: string) => void) {
  setFlash('正在整理完整本機備份…')
  const result = await exportBackup(rankPin)
  const blob = new Blob([result.json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `象棋記譜完整備份_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  const s = result.summary
  const reviewNotice = s.omittedStaleReviewCount > 0
    ? `；已略過 ${s.omittedStaleReviewCount} 份與目前主線不一致的舊分析，可重新解棋建立新分析`
    : ''
  setFlash(
    `已下載完整備份：${s.gameCount} 局、${s.playerCount} 位棋手、${s.profileCount} 位段級協助者、${s.calibrationGameCount} 局校準資料${s.hasPieceCalibration ? '，含棋子範本' : ''}${reviewNotice}`,
  )
}

function BackupPinDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (pin: string) => Promise<string | null>
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^\d{4,12}$/.test(pin) || busy) {
      setError('PIN 必須是 4～12 位數字')
      return
    }
    setBusy(true)
    setError('')
    const issue = await onConfirm(pin)
    setBusy(false)
    if (issue) {
      setPin('')
      setError(issue)
    } else {
      onClose()
    }
  }

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="dialog backup-pin-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-pin-title" onClick={(event) => event.stopPropagation()}>
        <h3 id="backup-pin-title">🔒 段級資料需要 PIN</h3>
        <p className="muted">
          這份完整備份包含協助者或校準對局。請輸入這個瀏覽器的段級實驗室 PIN；PIN 不會保存，也不會寫入備份檔。
        </p>
        <form className="rank-pin-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>本機段級 PIN</span>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="current-password"
              minLength={4}
              maxLength={12}
              value={pin}
              disabled={busy}
              autoFocus
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
            />
          </label>
          {error && <div className="rank-lab-error" role="alert">{error}</div>}
          <div className="fab-row">
            <button type="button" disabled={busy} onClick={onClose}>取消</button>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? '驗證中…' : '驗證並下載'}
            </button>
          </div>
        </form>
        <div className="rank-security-note">若這台電腦尚未設定 PIN，請先由段級實驗室 setup 入口建立。</div>
      </div>
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '無法讀取本機資料'
}
