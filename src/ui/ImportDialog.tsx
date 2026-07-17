// 匯入棋譜／備份：備份一定先預覽，只有按下確認後才寫入 IndexedDB。
import { useEffect, useState } from 'react'
import { useApp } from '../App'
import { FORMAT_LABEL, importGameText } from '../core/importGame'
import { mainline } from '../core/tree'
import { db, rememberPlayer, type GameRow } from '../store/db'
import {
  MAX_BACKUP_TEXT_LENGTH,
  RankBackupAccessError,
  inspectBackup,
  isBackupJson,
  restoreBackup,
  type BackupInspection,
  type RestoreResult,
} from '../store/backup'

interface GamePreview {
  kind: 'game'
  label: string
  summary: string
  warnings: string[]
  row: Omit<GameRow, 'id'>
}

interface BackupPreview {
  kind: 'backup'
  raw: string
  inspection: BackupInspection
}

type Preview = GamePreview | BackupPreview

export default function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const { reloadSettings } = useApp()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [rankPin, setRankPin] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const analyse = (raw: string) => {
    setError('')
    setPreview(null)
    setRankPin('')
    const t = raw.trim()
    if (!t) return
    try {
      if (isBackupJson(t)) {
        setPreview({ kind: 'backup', raw: t, inspection: inspectBackup(t) })
        return
      }
      const g = importGameText(t)
      const moves = mainline(g.root)
      setPreview({
        kind: 'game',
        label: FORMAT_LABEL[g.format],
        summary: `${g.meta.red} vs ${g.meta.black}·${g.moveCount} 著·${moves
          .slice(0, 4)
          .map((n) => n.zh)
          .join(' ')}${moves.length > 4 ? ' …' : ''}`,
        warnings: g.warnings,
        row: {
          redName: g.meta.red,
          blackName: g.meta.black,
          startedAt: g.meta.startedAt,
          updatedAt: Date.now(),
          result: g.meta.result,
          initialFen: g.root.fenAfter,
          tree: g.root,
          moveCount: moves.length, // 主線長度(g.moveCount 含變着裡的著法)
        },
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const onText = (v: string) => {
    setText(v)
    if (v.trim().length > 10) analyse(v)
    else {
      setPreview(null)
      setError('')
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setPreview(null)
    setRankPin('')
    if (file.size > MAX_BACKUP_TEXT_LENGTH) {
      setError('檔案超過 50 MiB，為保護本機資料不予載入')
      return
    }
    setBusy(true)
    try {
      const raw = await file.text()
      if (isBackupJson(raw)) {
        setText('')
        setPreview({ kind: 'backup', raw, inspection: inspectBackup(raw) })
        return
      }
      setText(raw.slice(0, 20000))
      analyse(raw)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const doImport = async () => {
    if (!preview) return
    setError('')
    setBusy(true)
    try {
      if (preview.kind === 'backup') {
        const result = await restoreBackup(preview.raw, rankPin || undefined)
        let message = restoreMessage(result)
        try {
          await reloadSettings()
        } catch {
          message += '；資料已還原，但設定畫面重新載入失敗，請重新整理頁面'
        }
        onDone(message)
      } else {
        await db.transaction('rw', db.games, db.players, async () => {
          await db.games.add(preview.row as GameRow)
          await rememberPlayer(preview.row.redName)
          await rememberPlayer(preview.row.blackName)
        })
        onDone(`已匯入：${preview.row.redName} vs ${preview.row.blackName}`)
      }
    } catch (e) {
      if (e instanceof RankBackupAccessError) setRankPin('')
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay import-overlay" onClick={busy ? undefined : onClose}>
      <div className="dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="import-dialog-title">📥 匯入棋譜／備份</h3>
        <div className="muted">
          支援 <b>象棋 PGN</b>(象棋橋/象棋巫師)、<b>中文棋譜</b>文字、<b>東萍 DhtmlXQ</b> 代碼,
          以及本 App 的<b>備份檔</b>(.json)。備份選取後會先預覽，不會立即寫入。
        </div>
        <label
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-disabled={busy}
          onKeyDown={(event) => {
            if (!busy && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              event.currentTarget.click()
            }
          }}
          style={{ display: 'block', textAlign: 'center', padding: 12, border: '1px dashed var(--line)', borderRadius: 10 }}
        >
          📂 選擇檔案(.pgn / .txt / .json)
          <input
            type="file"
            accept=".pgn,.txt,.json,.dhtmlxq,text/plain,application/json"
            style={{ display: 'none' }}
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        <textarea
          className="import-textarea"
          rows={5}
          placeholder="…或直接貼上棋譜文字(例:1. 炮二平五 馬8進7)"
          value={text}
          disabled={busy}
          onChange={(e) => onText(e.target.value)}
        />
        {error && <div role="alert" style={{ color: 'var(--bad)' }}>⚠ {error}</div>}
        {preview?.kind === 'game' && (
          <div className="card">
            <div>
              <span className="result-badge">{preview.label}</span> {preview.summary}
            </div>
            {preview.warnings.length > 0 && (
              <div className="muted" style={{ color: 'var(--warn)' }}>
                {preview.warnings.join(';')}
              </div>
            )}
          </div>
        )}
        {preview?.kind === 'backup' && (
          <BackupPreviewCard
            inspection={preview.inspection}
            rankPin={rankPin}
            onRankPinChange={(pin) => {
              setRankPin(pin)
              setError('')
            }}
          />
        )}
        <div className="fab-row">
          <button disabled={busy} onClick={onClose}>取消</button>
          <button
            className="primary"
            disabled={!preview || busy || (preview.kind === 'backup' && backupNeedsRankPin(preview.inspection) && !/^\d{4,12}$/.test(rankPin))}
            onClick={() => void doImport()}
          >
            {busy ? '處理中…' : preview?.kind === 'backup' ? '確認還原備份' : '匯入棋譜'}
          </button>
        </div>
      </div>
    </div>
  )
}

function BackupPreviewCard({
  inspection,
  rankPin,
  onRankPinChange,
}: {
  inspection: BackupInspection
  rankPin: string
  onRankPinChange: (pin: string) => void
}) {
  const exportedAt = new Date(inspection.exportedAt).toLocaleString('zh-TW', { hour12: false })
  return (
    <div className="card backup-preview-card">
      <div className="row">
        <span className="result-badge">備份 v{inspection.version}</span>
        <b className="grow">確認內容後再還原</b>
      </div>
      <div className="muted">
        匯出時間：{exportedAt}
        {inspection.appVersion ? `・來源 App v${inspection.appVersion}` : ''}
      </div>
      <ul className="backup-preview-list">
        <li>棋局 {inspection.gameCount} 局、棋手名冊 {inspection.playerCount} 位</li>
        <li>段級協助者 {inspection.profileCount} 位、校準對局 {inspection.calibrationGameCount} 局</li>
        <li>{inspection.hasPreferences ? '包含五項一般偏好' : '不含一般偏好'}・{inspection.hasPieceCalibration ? '包含棋子辨識範本' : '不含棋子辨識範本'}</li>
      </ul>
      {inspection.isLegacyV1 ? (
        <div className="backup-warning">這是舊版 v1，只會合併棋局與相關姓名，不會變更設定或校準資料。</div>
      ) : (
        <div className="muted">
          還原採非破壞合併：不刪除本機資料，相同項目略過；五項一般偏好會套用備份值，若本機已有不同棋子範本則保留本機版本。
        </div>
      )}
      {inspection.omittedStaleReviewCount > 0 && (
        <div className="backup-warning">
          偵測到 {inspection.omittedStaleReviewCount} 份與目前主線不一致的舊分析；該衍生分析會略過，棋局仍可安全合併並重新解棋。
        </div>
      )}
      <div className="backup-warning">
        JSON 未加密，可能含棋手姓名、匿名校準代號、自報級段與校準備註；不含 API Token、段級 PIN 或門禁驗證資料。
      </div>
      {backupNeedsRankPin(inspection) && (
        <label className="backup-rank-pin">
          <span>本機段級 PIN</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="current-password"
            minLength={4}
            maxLength={12}
            value={rankPin}
            onChange={(event) => onRankPinChange(event.target.value.replace(/\D/g, '').slice(0, 12))}
          />
          <small>
            此檔含段級協助者或校準對局，還原前必須驗證目前瀏覽器的實驗室 PIN。換電腦時請先由 setup 入口建立本機 PIN。
          </small>
        </label>
      )}
    </div>
  )
}

function backupNeedsRankPin(inspection: BackupInspection): boolean {
  return inspection.profileCount > 0 || inspection.calibrationGameCount > 0
}

function restoreMessage(result: RestoreResult): string {
  const parts = [
    `棋局新增 ${result.games.added}／略過 ${result.games.skipped}`,
    `棋手新增 ${result.players.added}／略過 ${result.players.skipped}`,
  ]
  if (result.sourceVersion === 2) {
    parts.push(`協助者新增 ${result.profiles.added}／略過 ${result.profiles.skipped}`)
    parts.push(`校準局新增 ${result.calibrationGames.added}／略過 ${result.calibrationGames.skipped}`)
    if (result.preferencesRestored) parts.push('一般偏好已套用')
    if (result.pieceCalibration === 'restored') parts.push('棋子範本已還原')
    if (result.pieceCalibration === 'kept-local') parts.push('不同棋子範本已保留本機版本')
  }
  if (result.omittedStaleReviewCount > 0) {
    parts.push(`已略過 ${result.omittedStaleReviewCount} 份錯置舊分析`)
  }
  return `備份還原完成：${parts.join('；')}`
}
