import { useEffect, useState, type FormEvent } from 'react'
import { isValidCalibrationPin, setCalibrationPin, verifyCalibrationPin } from '../calibration/pin'
import type { RankCalibrationGate } from '../calibration/rankTypes'
import { saveRankCalibrationGate } from '../store/rankCalibration'

interface Props {
  gate: RankCalibrationGate
  notice?: string
  onGateUpdated: (gate: RankCalibrationGate) => void
  onUnlocked: () => void
}

export default function RankCalibrationUnlock({ gate, notice, onGateUpdated, onUnlocked }: Props) {
  const setupMode = !gate.pinSalt || !gate.pinVerifier
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [failures, setFailures] = useState(0)
  const [retryAfter, setRetryAfter] = useState(0)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (retryAfter <= Date.now()) return
    let timer = 0
    const tick = () => {
      const nextNow = Date.now()
      setNow(nextNow)
      if (nextNow >= retryAfter) {
        window.clearInterval(timer)
        setRetryAfter(0)
      }
    }
    timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [retryAfter])

  const remainingSeconds = Math.max(0, Math.ceil((retryAfter - now) / 1000))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (remainingSeconds > 0 || busy) return
    setError('')
    if (!isValidCalibrationPin(pin)) {
      setError('PIN 必須是 4～12 位數字')
      return
    }
    if (setupMode && pin !== confirmPin) {
      setError('兩次輸入的 PIN 不一致')
      return
    }
    setBusy(true)
    try {
      if (setupMode) {
        const updated = await setCalibrationPin(gate, pin)
        await saveRankCalibrationGate(updated)
        onGateUpdated(updated)
        onUnlocked()
        return
      }
      if (await verifyCalibrationPin(gate, pin)) {
        setFailures(0)
        onUnlocked()
        return
      }
      const nextFailures = failures + 1
      setFailures(nextFailures)
      setPin('')
      if (nextFailures >= 3) {
        const waitMs = Math.min(30_000, 5_000 * 2 ** (nextFailures - 3))
        setRetryAfter(Date.now() + waitMs)
        setNow(Date.now())
      }
      setError('PIN 錯誤，請再試一次')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN 驗證失敗')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card rank-lock-card">
      <div className="rank-lock-mark" aria-hidden="true">
        校
      </div>
      <div>
        <div className="rank-lab-eyebrow">LOCAL CALIBRATION LAB</div>
        <h2>{setupMode ? '設定本機校準 PIN' : '段級校準實驗室已上鎖'}</h2>
      </div>
      <p className="muted">
        {setupMode
          ? 'PIN 只用來避免平常誤入。請設定 4～12 位數字，PIN 明文不會保存。'
          : `輸入本機 PIN 解鎖；重新整理或閒置 ${gate.autoLockMinutes} 分鐘後會再次上鎖。`}
      </p>
      {notice && <div className="rank-lab-notice">{notice}</div>}
      <form className="rank-pin-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>{setupMode ? '建立 PIN' : 'PIN'}</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={setupMode ? 'new-password' : 'current-password'}
            minLength={4}
            maxLength={12}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
            autoFocus
          />
        </label>
        {setupMode && (
          <label>
            <span>再次輸入 PIN</span>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="new-password"
              minLength={4}
              maxLength={12}
              value={confirmPin}
              onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
            />
          </label>
        )}
        {error && <div className="rank-lab-error">{error}</div>}
        {remainingSeconds > 0 && <div className="muted">請等待 {remainingSeconds} 秒後再試。</div>}
        <button className="primary" type="submit" disabled={busy || remainingSeconds > 0}>
          {busy ? '處理中…' : setupMode ? '設定並解鎖' : '解鎖實驗室'}
        </button>
      </form>
      <div className="rank-security-note">
        此門禁不是強加密或管理員權限；能操作這台電腦與開發工具的人仍可能讀取本機資料。
      </div>
    </div>
  )
}
