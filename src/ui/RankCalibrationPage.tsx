import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useApp } from '../App'
import { MAX_RANK_CALIBRATION_FILE_BYTES } from '../calibration/rankArchive'
import { PHASE2_ANCHORS, PHASE2_CONFIG_VERSION } from '../calibration/phase2Protocol'
import {
  RANK_SYSTEM_OPTIONS,
  TAIWAN_RANK_OPTIONS,
  type AnchorId,
  type CalibrationGame,
  type CalibrationGameV2,
  type CalibratorProfile,
  type RankCalibrationGate,
} from '../calibration/rankTypes'
import { buildCalibrationStats } from '../calibration/stats'
import { engine } from '../engine/engineClient'
import {
  createCalibratorProfile,
  disableRankCalibrationGate,
  exportRankCalibration,
  importRankCalibration,
  inspectRankCalibrationImport,
  listCalibrationGames,
  listCalibratorProfiles,
  loadRankCalibrationGate,
} from '../store/rankCalibration'
import { createCalibrationMatch } from '../store/rankCalibrationMatch'
import { APP_VERSION } from '../version'
import RankCalibrationMatch from './RankCalibrationMatch'
import RankCalibrationUnlock from './RankCalibrationUnlock'

type RankCalibrationInspection = ReturnType<typeof inspectRankCalibrationImport>

interface PendingRankCalibrationImport {
  fileName: string
  text: string
  inspection: RankCalibrationInspection
}

const formatImportTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleString('zh-TW', { hour12: false })

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError'

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
  const [pendingImport, setPendingImport] = useState<PendingRankCalibrationImport | null>(null)
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null)
  const [matchProfileId, setMatchProfileId] = useState('')
  const [matchAnchorId, setMatchAnchorId] = useState<AnchorId>('A05')
  const [matchSessionId, setMatchSessionId] = useState('__new__')
  const downloadTimer = useRef(0)
  const importFileInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const matchStartAbort = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    const [nextProfiles, nextGames] = await Promise.all([listCalibratorProfiles(), listCalibrationGames()])
    setProfiles(nextProfiles)
    setGames(nextGames)
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh().catch((err: unknown) => {
      if (mounted.current) setError(err instanceof Error ? err.message : '無法讀取本機校準資料')
    })
    return () => {
      mounted.current = false
      matchStartAbort.current?.abort()
      matchStartAbort.current = null
      window.clearTimeout(downloadTimer.current)
    }
  }, [refresh])

  useEffect(() => {
    if (!matchProfileId && profiles[0]) setMatchProfileId(profiles[0].id)
  }, [matchProfileId, profiles])

  const v2AnchorCounts = useMemo(() => {
    const result = new Map<string, number>()
    for (const game of games) {
      if (game.schemaVersion !== 2) continue
      result.set(game.anchorId, (result.get(game.anchorId) ?? 0) + 1)
    }
    return result
  }, [games])

  const stats = useMemo(() => buildCalibrationStats(profiles, games), [profiles, games])
  const v2GameCount = useMemo(
    () => games.reduce((count, game) => count + (game.schemaVersion === 2 ? 1 : 0), 0),
    [games],
  )
  const v2Status = useMemo(() => {
    const result = { completed: 0, aborted: 0, inProgress: 0 }
    for (const game of games) {
      if (game.schemaVersion !== 2) continue
      if (game.status === 'completed') result.completed += 1
      else if (game.status === 'aborted') result.aborted += 1
      else result.inProgress += 1
    }
    return result
  }, [games])
  const hasCompletedStats = stats.groups.some((group) => group.completed > 0)
  const inProgressGames = useMemo(
    () => games.filter(
      (game): game is CalibrationGameV2 => game.schemaVersion === 2 && game.status === 'in-progress',
    ),
    [games],
  )
  const matchSessions = useMemo(() => {
    const profile = profiles.find((entry) => entry.id === matchProfileId)
    if (!profile) return []
    const sessions = new Map<string, number>()
    for (const game of games) {
      if (
        game.schemaVersion !== 2 ||
        game.profileId !== profile.id ||
        game.profileRevision !== profile.revision ||
        game.appVersion !== APP_VERSION
      ) continue
      sessions.set(game.sessionId, Math.max(sessions.get(game.sessionId) ?? 0, game.startedAt))
    }
    return [...sessions.entries()]
      .map(([id, lastPlayedAt]) => ({ id, lastPlayedAt }))
      .sort((left, right) => right.lastPlayedAt - left.lastPlayedAt)
  }, [games, matchProfileId, profiles])

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
      const profile = await createCalibratorProfile({
        alias,
        claimedRank,
        rankSystem,
        notes,
        consentedAt: Date.now(),
      })
      setAlias('')
      setNotes('')
      setConsented(false)
      setMatchProfileId(profile.id)
      setMatchSessionId('__new__')
      setMessage('已建立匿名協助者資料。')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立協助者資料失敗')
    } finally {
      setBusy(false)
    }
  }

  const startCalibrationMatch = async () => {
    setMessage('')
    setError('')
    if (!matchProfileId) {
      setError('請先選擇匿名協助者')
      return
    }
    const profile = profiles.find((entry) => entry.id === matchProfileId)
    if (!profile) {
      setError('找不到所選協助者；請重新整理後再試')
      return
    }
    if (!engine.supported()) {
      setError('此瀏覽器目前無法啟動本機校準引擎；請確認使用 HTTPS 且 COOP／COEP 正常。尚未建立棋局。')
      return
    }
    const controller = new AbortController()
    matchStartAbort.current?.abort()
    matchStartAbort.current = controller
    setBusy(true)
    try {
      await engine.init()
      if (controller.signal.aborted || !mounted.current) return
      const game = await createCalibrationMatch({
        profileId: profile.id,
        profileRevision: profile.revision,
        anchorId: matchAnchorId,
        ...(matchSessionId === '__new__' ? {} : { sessionId: matchSessionId }),
        signal: controller.signal,
      })
      if (controller.signal.aborted || !mounted.current) return
      setMatchSessionId(game.sessionId)
      setActiveMatchId(game.id)
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err) || !mounted.current) return
      setError(err instanceof Error ? `校準引擎或建局失敗：${err.message}；尚未建立新局。` : '校準引擎或建局失敗；尚未建立新局。')
      await refresh().catch(() => undefined)
    } finally {
      if (matchStartAbort.current === controller) matchStartAbort.current = null
      if (mounted.current && !controller.signal.aborted) setBusy(false)
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
      setMessage(
        `已匯出 schema v2：${result.profileCount} 位協助者、${stats.legacyGameCount} 局 legacy v1、${v2GameCount} 局 v2；檔案未加密但不含 PIN。`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '匯出失敗')
    } finally {
      setBusy(false)
    }
  }

  const clearImportSelection = () => {
    setPendingImport(null)
    if (importFileInput.current) importFileInput.current.value = ''
  }

  const selectImportFile = async (file: File | undefined) => {
    setMessage('')
    setError('')
    setPendingImport(null)
    if (!file) return
    if (file.size > MAX_RANK_CALIBRATION_FILE_BYTES) {
      setError(`檔案超過 ${Math.floor(MAX_RANK_CALIBRATION_FILE_BYTES / 1024 / 1024)} MiB 上限，尚未讀取或匯入。`)
      if (importFileInput.current) importFileInput.current.value = ''
      return
    }

    setMessage('正在本機讀取並驗證檔案；尚未寫入資料庫。')
    setBusy(true)
    try {
      const text = await file.text()
      const byteLength = new TextEncoder().encode(text).byteLength
      if (byteLength > MAX_RANK_CALIBRATION_FILE_BYTES) {
        throw new Error(`檔案超過 ${Math.floor(MAX_RANK_CALIBRATION_FILE_BYTES / 1024 / 1024)} MiB 上限`)
      }
      const inspection = inspectRankCalibrationImport(text)
      setPendingImport({ fileName: file.name, text, inspection })
      setMessage('預覽完成；資料尚未寫入。請核對摘要後再明確確認匯入。')
    } catch (err) {
      setMessage('')
      setError(err instanceof Error ? err.message : '無法讀取或驗證這份校準 JSON')
      if (importFileInput.current) importFileInput.current.value = ''
    } finally {
      setBusy(false)
    }
  }

  const cancelImport = () => {
    clearImportSelection()
    setError('')
    setMessage('已取消待匯入資料；本機資料沒有變更。')
  }

  const confirmImport = async () => {
    if (!pendingImport) return
    setMessage('正在以單一交易匯入；完成前不會套用部分資料。')
    setError('')
    setBusy(true)
    try {
      const result = await importRankCalibration(pendingImport.text)
      clearImportSelection()
      setMessage(
        `已匯入 schema v${result.sourceVersion}：協助者新增 ${result.profiles.added}、略過 ${result.profiles.skipped}；棋局新增 ${result.games.added}、略過 ${result.games.skipped}。`,
      )
      try {
        await refresh()
      } catch {
        setError('匯入已完成，但畫面摘要刷新失敗；請重新進入實驗室確認。')
      }
    } catch (err) {
      setMessage('')
      const detail = err instanceof Error ? err.message : '無法匯入這份資料'
      setError(`${detail}；本機資料沒有變更。`)
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

  if (activeMatchId) {
    return (
      <RankCalibrationMatch
        gameId={activeMatchId}
        onLeave={(sessionId) => {
          setActiveMatchId(null)
          setMatchSessionId(sessionId ?? '__new__')
          void refresh().catch((err: unknown) => {
            setError(err instanceof Error ? err.message : '棋局已保存，但儀表板刷新失敗')
          })
        }}
      />
    )
  }

  return (
    <>
      <section className="card rank-lab-intro">
        <div>
          <div className="rank-lab-eyebrow">PHASE 2C・PIN-GATED・LOCAL ONLY</div>
          <h2>本機段級校準實驗室</h2>
          <p>可開始逐著保存的現場校準對弈，並安全搬移、合併與重建版本隔離統計；結果不會自動更動公開難度。</p>
        </div>
        <span className="rank-local-badge">只存這台電腦</span>
      </section>

      <section className="rank-summary" aria-label="校準資料摘要">
        <div><b>{profiles.length}</b><span>協助者</span></div>
        <div><b>{stats.legacyGameCount}</b><span>legacy v1 局</span></div>
        <div><b>{v2GameCount}</b><span>schema v2 局</span></div>
        <div><b>{PHASE2_ANCHORS.length}</b><span>固定錨點</span></div>
      </section>

      {message && <div className="rank-lab-notice" role="status" aria-live="polite">{message}</div>}
      {error && <div className="rank-lab-error" role="alert" aria-live="assertive">{error}</div>}

      <section className="card rank-match-launch" aria-busy={busy}>
        <div className="rank-section-heading">
          <div>
            <div className="rank-lab-eyebrow">FIELD MATCH・SCHEMA V2</div>
            <h3>現場校準對弈</h3>
          </div>
          <span className="muted">無提示・無悔棋</span>
        </div>
        <p className="muted">
          先選協助者、固定錨點與收集時段；App 會依同一版本序號自動交替紅黑方。A01～A10 仍是內部相對錨點，不代表正式級／段。
        </p>
        {inProgressGames.length > 0 ? (
          <div className="rank-resume-list">
            <b>有 {inProgressGames.length} 局尚未結束；請先續下或明確中止，才能建立新局。</b>
            {inProgressGames.map((game) => {
              const profile = profiles.find((entry) => entry.id === game.profileId)
              return (
                <div className="rank-resume-item" key={game.id}>
                  <div>
                    <b>{profile?.alias ?? game.profileSnapshot.alias}・{game.anchorId}</b>
                    <span>
                      協助者執{game.playerSide === 'red' ? '紅' : '黑'}・第 {game.currentPly} 著・App {game.appVersion}
                    </span>
                  </div>
                  <button
                    className="primary"
                    type="button"
                    onClick={() => setActiveMatchId(game.id)}
                  >
                    {game.appVersion === APP_VERSION ? '繼續對弈' : '唯讀／中止'}
                  </button>
                </div>
              )
            })}
          </div>
        ) : profiles.length === 0 ? (
          <div className="rank-stat-empty">請先在下方建立一位已同意資料收集的匿名協助者。</div>
        ) : (
          <div className="rank-match-form">
            <label>
              <span>匿名協助者</span>
              <select
                value={matchProfileId}
                onChange={(event) => {
                  setMatchProfileId(event.target.value)
                  setMatchSessionId('__new__')
                }}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.alias}・{profile.claimedRank}・{profile.rankSystem}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>固定錨點（由弱至強）</span>
              <select value={matchAnchorId} onChange={(event) => setMatchAnchorId(event.target.value as AnchorId)}>
                {PHASE2_ANCHORS.map((anchor) => (
                  <option key={anchor.id} value={anchor.id}>{anchor.id}・第 {anchor.order}／10 階</option>
                ))}
              </select>
            </label>
            <label>
              <span>現場收集時段</span>
              <select value={matchSessionId} onChange={(event) => setMatchSessionId(event.target.value)}>
                <option value="__new__">建立新時段</option>
                {matchSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    接續 {formatImportTime(session.lastPlayedAt)} 的時段
                  </option>
                ))}
              </select>
            </label>
            <div className="rank-match-confirmation">
              <span>建立後會先保存 ply 0，再開啟棋盤；紅黑方由 App 自動分派。</span>
              <button className="primary" type="button" disabled={busy} onClick={() => void startCalibrationMatch()}>
                {busy ? '建立中…' : '確認並開始校準局'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card" aria-busy={busy}>
        <div className="rank-section-heading">
          <div>
            <div className="rank-lab-eyebrow">SCHEMA V2・LOCAL TRANSFER</div>
            <h3>匯出與匯入校準 JSON</h3>
          </div>
          <span className="muted">上限 {Math.floor(MAX_RANK_CALIBRATION_FILE_BYTES / 1024 / 1024)} MiB</span>
        </div>
        <div className="rank-transfer-stack">
          <p className="muted">
            匯出檔未加密，可能包含匿名代號、自報級段、備註、完整棋局、局面與候選著；請妥善保管。
            檔案不含 PIN、salt、verifier 或解鎖狀態。
          </p>
          <div className="rank-transfer-actions">
            <div className="grow">
              <b>匯出 schema v2</b>
              <div className="muted">含 legacy v1 與 {PHASE2_CONFIG_VERSION} v2 原始資料</div>
            </div>
            <button className="primary" onClick={() => void downloadExport()} disabled={busy}>
              {busy ? '處理中…' : '匯出 JSON'}
            </button>
          </div>
          <div>
            <label htmlFor="rank-calibration-import"><b>匯入校準 JSON</b></label>
            <div className="muted" id="rank-calibration-import-help">
              選檔只會在本機讀取並顯示預覽；按下「確認匯入」前不會寫入資料庫。
            </div>
          </div>
          <input
            ref={importFileInput}
            className="rank-import-file"
            id="rank-calibration-import"
            type="file"
            accept="application/json,.json"
            aria-describedby="rank-calibration-import-help"
            disabled={busy}
            onChange={(event) => void selectImportFile(event.currentTarget.files?.[0])}
          />
          {pendingImport && (
            <div className="rank-import-preview" aria-label="待匯入資料預覽">
              <h4>{pendingImport.fileName}</h4>
              <div className="muted">
                schema v{pendingImport.inspection.schemaVersion}・來源 App {pendingImport.inspection.appVersion}・匯出時間{' '}
                {formatImportTime(pendingImport.inspection.exportedAt)}
              </div>
              <div className="rank-preview-grid">
                <div><b>{pendingImport.inspection.profileCount}</b><span>協助者</span></div>
                <div><b>{pendingImport.inspection.legacyGameCount}</b><span>legacy v1 局</span></div>
                <div><b>{pendingImport.inspection.v2GameCount}</b><span>schema v2 局</span></div>
                <div><b>{pendingImport.inspection.completedCount}</b><span>v2 完成</span></div>
                <div><b>{pendingImport.inspection.abortedCount}</b><span>v2 中止</span></div>
                <div><b>{pendingImport.inspection.inProgressCount}</b><span>v2 進行中</span></div>
              </div>
              <div className="rank-preview-actions">
                <button type="button" onClick={cancelImport} disabled={busy}>取消</button>
                <button className="primary" type="button" onClick={() => void confirmImport()} disabled={busy}>
                  {busy ? '匯入中…' : '確認匯入'}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="rank-section-heading">
          <div>
            <div className="rank-lab-eyebrow">ANCHORS {PHASE2_CONFIG_VERSION}</div>
            <h3>Phase 2 固定錨點</h3>
          </div>
          <span className="muted">由弱至強</span>
        </div>
        <div className="rank-anchor-grid">
          {PHASE2_ANCHORS.map((anchor) => (
            <div className="rank-anchor" key={anchor.id}>
              <b>{anchor.id}</b>
              <span>第 {anchor.order}／10 階</span>
              <em>{v2AnchorCounts.get(anchor.id) ?? 0} 局 v2</em>
            </div>
          ))}
        </div>
        <div className="muted rank-footnote">錨點尚未對應正式級／段；不同協定、引擎、搜尋或 App 版本不會混成同一統計。</div>
      </section>

      <section className="card" aria-label="版本隔離統計">
        <div className="rank-section-heading">
          <div>
            <div className="rank-lab-eyebrow">DESCRIPTIVE STATISTICS</div>
            <h3>版本隔離統計</h3>
          </div>
          <span className="muted">玩家視角</span>
        </div>
        <div className="muted">
          v2 共 {v2GameCount} 局：完成 {v2Status.completed}、中止 {v2Status.aborted}、進行中 {v2Status.inProgress}。
          中止與進行中不列入勝和負；legacy v1 只保留數量。
        </div>
        {!hasCompletedStats ? (
          <div className="rank-stat-empty">
            尚無 schema v2 完成局，因此目前沒有可解讀的勝和負統計。匯入或日後完成真實校準局後，系統會從原始資料重建；不會把中止、進行中或 legacy v1 當成完成局。
          </div>
        ) : (
          <div className="rank-stats-grid">
            {stats.groups.map((group) => (
              <article className="rank-stat-group" key={group.key}>
                <div className="rank-stat-title">
                  <h4>{group.anchorId}・{group.claimedRank}</h4>
                  <span>{group.playerSide === 'red' ? '人類執紅' : '人類執黑'}</span>
                </div>
                <div className="rank-stat-meta">
                  {group.rankSystem}・App {group.appVersion}・{group.anchorConfigVersion}<br />
                  collection {group.dimensions.collectionProtocolVersion}・{group.dimensions.sideAssignmentVersion}<br />
                  policy {group.policyVersion}（top {group.dimensions.policy.topK}／溫度 {group.dimensions.policy.temperatureCp}／容許失分 {group.dimensions.policy.maxLossCp}）<br />
                  engine {group.engineProtocol}/{group.engineCommit}・WASM {group.dimensions.engine.wasmSha256.slice(0, 8)}・NNUE {group.dimensions.engine.nnueSha256.slice(0, 8)}<br />
                  nodes {group.searchNodes}・MultiPV {group.searchMultiPv}・threads {group.dimensions.search.threads}・hash {group.dimensions.search.hashMb} MiB
                </div>
                <div className="rank-stat-metrics">
                  <div><b>{group.total}</b><span>全部</span></div>
                  <div><b>{group.completed}</b><span>完成</span></div>
                  <div><b>{group.wins}</b><span>勝</span></div>
                  <div><b>{group.draws}</b><span>和</span></div>
                  <div><b>{group.losses}</b><span>負</span></div>
                  <div><b>{group.aborted}</b><span>中止</span></div>
                  <div><b>{group.inProgress}</b><span>進行中</span></div>
                  <div><b>{group.anomalousDecisionCount}</b><span>異常決策</span></div>
                </div>
                <div className="rank-stat-footnote">
                  {group.distinctProfiles} 位協助者・{group.distinctSessions} 個 session・{group.decisionCount} 筆引擎決策・{group.anomalousGameCount} 局含異常
                </div>
              </article>
            ))}
          </div>
        )}
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
