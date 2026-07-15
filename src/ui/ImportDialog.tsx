// 匯入棋譜:貼上文字或選檔案(PGN / 中文棋譜 / 東萍 DhtmlXQ / 本 App 備份)。
import { useState } from 'react'
import { FORMAT_LABEL, importGameText } from '../core/importGame'
import { mainline } from '../core/tree'
import { db, rememberPlayer, type GameRow } from '../store/db'
import { isBackupJson, restoreBackup } from '../store/backup'

interface Preview {
  kind: 'game'
  label: string
  summary: string
  warnings: string[]
  row: Omit<GameRow, 'id'>
}

export default function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)

  const analyse = (raw: string) => {
    setError('')
    setPreview(null)
    const t = raw.trim()
    if (!t) return
    try {
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
    const raw = await file.text()
    setBusy(true)
    try {
      if (isBackupJson(raw)) {
        const r = await restoreBackup(raw)
        onDone(`已還原 ${r.added} 局${r.skipped > 0 ? `(略過重複 ${r.skipped} 局)` : ''}`)
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
    setBusy(true)
    try {
      await db.games.add(preview.row as GameRow)
      await rememberPlayer(preview.row.redName)
      await rememberPlayer(preview.row.blackName)
      onDone(`已匯入:${preview.row.redName} vs ${preview.row.blackName}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>📥 匯入棋譜</h3>
        <div className="muted">
          支援 <b>象棋 PGN</b>(象棋橋/象棋巫師)、<b>中文棋譜</b>文字、<b>東萍 DhtmlXQ</b> 代碼,
          以及本 App 的<b>備份檔</b>(.json,會整批還原)。
        </div>
        <label style={{ display: 'block', textAlign: 'center', padding: 12, border: '1px dashed var(--line)', borderRadius: 10 }}>
          📂 選擇檔案(.pgn / .txt / .json)
          <input
            type="file"
            accept=".pgn,.txt,.json,.dhtmlxq,text/plain,application/json"
            style={{ display: 'none' }}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        <textarea
          rows={5}
          placeholder="…或直接貼上棋譜文字(例:1. 炮二平五 馬8進7)"
          value={text}
          onChange={(e) => onText(e.target.value)}
          style={{ width: '100%', fontSize: 16 }}
        />
        {error && <div style={{ color: 'var(--bad)' }}>⚠ {error}</div>}
        {preview && (
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
        <div className="fab-row">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!preview || busy} onClick={() => void doImport()}>
            匯入
          </button>
        </div>
      </div>
    </div>
  )
}
