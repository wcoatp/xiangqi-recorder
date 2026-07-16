import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useApp } from '../App'
import { ANCHOR_SET_VERSION, RANK_ANCHORS } from '../calibration/anchors'
import {
  RANK_SYSTEM_OPTIONS,
  TAIWAN_RANK_OPTIONS,
  type CalibrationGame,
  type CalibratorProfile,
  type RankCalibrationGate,
} from '../calibration/rankTypes'
import {
  createCalibratorProfile,
  disableRankCalibrationGate,
  exportRankCalibration,
  listCalibrationGames,
  listCalibratorProfiles,
  loadRankCalibrationGate,
} from '../store/rankCalibration'
import { APP_VERSION } from './FeedbackDialog'
import RankCalibrationUnlock from './RankCalibrationUnlock'

export default function RankCalibrationPage() {
  const { go } = useApp()
  const [gate, setGate] = useState<RankCalibrationGate | null>(null)
  const [gateError, setGateError] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [lockNotice, setLockNotice] = useState('')

  useEffect(() => {
    void loadRankCalibrationGate().then(setGate).catch((err: unknown) => {
      setGateError(err instanceof Error ? err.message : '無法讀取本機門禁設定')
    })
  }, [])

  useEffect(() => {
    if (!unlocked || !gate) return
    let timer = 0
    const arm = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(
        () => {
          setUnlocked(false)
          setLockNotice('因閒置已自動上鎖。')
        },
        gate.autoLockMinutes * 60_000,
      )
    }
    const lockWhenHidden = () => {
      if (document.hidden) {
        setUnlocked(false)
        setLockNotice('離開頁面後已上鎖。')
      }
    }
    arm()
    window.addEventListener('pointerdown', arm)
    window.addEventListener('keydown', arm)
    document.addEventListener('visibilitychange', lockWhenHidden)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', arm)
      window.removeEventListener('keydown', arm)
      document.removeEventListener('visibilitychange', lockWhenHidden)
    }
  }, [gate, unlocked])

  return (
    <div className="page rank-lab-page">
      <div className="topbar">
        <button onClick={() => go({ name: 'settings' })}>← 設定</button>
        <div className="title">段級校準實驗室</div>
        {unlocked && (
          <button
            onClick={() => {
              setUnlocked(false)
              setLockNotice('已手動上鎖。')
            }}
          >
            上鎖
          </button>
        )}
      </div>
      {gateError ? (
        <div className="rank-lab-error">{gateError}</div>
      ) : !gate ? (
        <div className="card">載入本機門禁設定…</div>
      ) : !gate.enabled ? (
        <div className="card">
          <h2>實驗室尚未啟用</h2>
          <p className="muted">請使用專案交接文件記載的 setup 網址，在這個瀏覽器 profile 啟用。</p>
        </div>
      ) : !unlocked ? (
        <RankCalibrationUnlock
          gate={gate}
          notice={lockNotice}
          onGateUpdated={setGate}
          onUnlocked={() => {
            setLockNotice('')
            setUnlocked(true)
          }}
        />
      ) : (
        <RankCalibrationDashboard
          gate={gate}
          onDisable={() => {
            setUnlocked(false)
            go({ name: 'settings' })
          }}
        />
      )}
    </div>
  )
}

function RankCalibrationDashboard({ gate, onDisable }: { gate: RankCalibrationGate; onDisable: () => void }) {
  const [profiles, setProfiles] = useState<CalibratorProfile[]>([])
  const [games, setGames] = useState<CalibrationGame[]>([])
  const [alias, setAlias] = useState('')
  const [claimedRank, setClaimedRank] = useState<string>(TAIWAN_RANK_OPTIONS[9])
  const [rankSystem, setRankSystem] = useState<string>(RANK_SYSTEM_OPTIONS[0])
  const [notes, setNotes] = useState('')
  const [consented, setConsented] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const downloadTimer = useRef(0)

  const refresh = useCallback(async () => {
    const [nextProfiles, nextGames] = await Promise.all([listCalibratorProfiles(), listCalibrationGames()])
    setProfiles(nextProfiles)
    setGames(nextGames)
  }, [])

  useEffect(() => {
    void refresh().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : '無法讀取本機校準資料')
    })
    return () => window.clearTimeout(downloadTimer.current)
  }, [refresh])

  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const game of games) result.set(game.anchorId, (result.get(game.anchorId) ?? 0) + 1)
    return result
  }, [games])

  const addProfile = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('')
    setError('')
    if (!consented) {
      setError('請先確認協助者同意本機保存與匯出這份資料')
      return
    }
    setBusy(true)
    try {
      await createCalibratorProfile({
        alias,
        claimedRank,
        rankSystem,
        notes,
        consentedAt: Date.now(),
      })
      setAlias('')
      setNotes('')
      setConsented(false)
      setMessage('已建立匿名協助者資料。')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立協助者資料失敗')
    } finally {
      setBusy(false)
    }
  }

  const downloadExport = async () => {
    setMessage('')
    setError('')
    setBusy(true)
    try {
      const result = await exportRankCalibration(APP_VERSION)
      const blob = new Blob([result.json], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `xiangqi-rank-calibration-${new Date().toISOString().slice(0, 10)}.json`
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
      downloadTimer.current = window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage(`已匯出 ${result.profileCount} 位協助者、${result.gameCount} 局；檔案不含 PIN。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '匯出失敗')
    } finally {
      setBusy(false)
    }
  }

  const disableGate = async () => {
    if (!window.confirm('要隱藏段級校準實驗室入口嗎？本機資料會保留。')) return
    setError('')
    try {
      await disableRankCalibrationGate()
      onDisable()
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法關閉實驗室入口')
    }
  }

  return (
    <>
      <section className="card rank-lab-intro">
        <div>
          <div className="rank-lab-eyebrow">PHASE 1・LOCAL ONLY</div>
          <h2>本機校準資料庫已就緒</h2>
          <p>目前只建立錨點與資料骨架，不會開始校準對弈，也不會更動公開難度。</p>
        </div>
        <span className="rank-local-badge">只存這台電腦</span>
      </section>

      <section className="rank-summary" aria-label="校準資料摘要">
        <div><b>{RANK_ANCHORS.length}</b><span>固定錨點</span></div>
        <div><b>{profiles.length}</b><span>協助者</span></div>
        <div><b>{games.length}</b><span>校準局</span></div>
      </section>

      <section className="card">
        <div className="row">
          <div className="grow">
            <h3>本機資料匯出</h3>
            <div className="muted">schema v1・錨點 {ANCHOR_SET_VERSION}・不含 PIN／salt／verifier</div>
          </div>
          <button className="primary" onClick={() => void downloadExport()} disabled={busy}>
            匯出 JSON
          </button>
        </div>
      </section>

      <section className="card">
        <div className="rank-section-heading">
          <div>
            <div className="rank-lab-eyebrow">ANCHORS {ANCHOR_SET_VERSION}</div>
            <h3>10 個固定錨點</h3>
          </div>
          <span className="muted">由弱至強</span>
        </div>
        <div className="rank-anchor-grid">
          {RANK_ANCHORS.map((anchor) => (
            <div className="rank-anchor" key={anchor.id}>
              <b>{anchor.id}</b>
              <span>第 {anchor.order}／10 階</span>
              <em>{counts.get(anchor.id) ?? 0} 局</em>
            </div>
          ))}
        </div>
        <div className="muted rank-footnote">錨點尚未對應正式級／段；畫面刻意不顯示底層引擎尺度。</div>
      </section>

      <section className="card">
        <div className="rank-section-heading">
          <div>
            <div className="rank-lab-eyebrow">CALIBRATOR PROFILE</div>
            <h3>新增匿名協助者</h3>
          </div>
          <span className="muted">Phase 1</span>
        </div>
        <form className="rank-profile-form" onSubmit={(event) => void addProfile(event)}>
          <label>
            <span>匿名代號</span>
            <input
              value={alias}
              maxLength={32}
              placeholder="例如：棋友 A（不要填真名）"
              onChange={(event) => setAlias(event.target.value)}
            />
          </label>
          <div className="rank-profile-pair">
            <label>
              <span>自報級／段</span>
              <select value={claimedRank} onChange={(event) => setClaimedRank(event.target.value)}>
                {TAIWAN_RANK_OPTIONS.map((rank) => <option key={rank}>{rank}</option>)}
              </select>
            </label>
            <label>
              <span>制度來源</span>
              <select value={rankSystem} onChange={(event) => setRankSystem(event.target.value)}>
                {RANK_SYSTEM_OPTIONS.map((system) => <option key={system}>{system}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span>備註（選填）</span>
            <textarea
              rows={2}
              maxLength={200}
              value={notes}
              placeholder="例如：近期比賽組別；避免填電話、地址等個資"
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <label className="rank-consent">
            <input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} />
            <span>協助者知道資料只存在本機，且作者之後可手動匯出 JSON 進行校準分析。</span>
          </label>
          <button className="primary" type="submit" disabled={busy}>建立協助者資料</button>
        </form>
        {profiles.length > 0 && (
          <div className="rank-profile-list">
            {profiles.map((profile) => (
              <div key={profile.id}>
                <b>{profile.alias}</b>
                <span>{profile.claimedRank}・{profile.rankSystem}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {message && <div className="rank-lab-notice">{message}</div>}
      {error && <div className="rank-lab-error">{error}</div>}

      <section className="card rank-lab-danger-zone">
        <div>
          <h3>隱藏實驗室入口</h3>
          <div className="muted">關閉後資料與 PIN 仍保留；再次使用 setup 網址即可重新顯示入口。</div>
        </div>
        <button className="danger" onClick={() => void disableGate()}>關閉入口</button>
      </section>

      <div className="rank-security-note">
        PIN 只是避免誤入，不是強加密。此 origin、瀏覽器 profile 與 localhost 的資料彼此不會自動同步。
        閒置 {gate.autoLockMinutes} 分鐘會上鎖。
      </div>
    </>
  )
}
