import { useEffect, useState } from 'react'
import { useApp, type HomeAction } from '../App'
import { START_FEN } from '../core/fen'
import { newRoot } from '../core/tree'
import { db, playerNames, rememberPlayer, type GameRow } from '../store/db'
import FeedbackDialog from './FeedbackDialog'

const RESULT_LABEL: Record<string, string> = {
  red: '紅勝',
  black: '黑勝',
  draw: '和棋',
  '*': '進行中',
}

type HomeIconName =
  | 'record'
  | 'play'
  | 'replay'
  | 'analyze'
  | 'endgame'
  | 'rules'
  | 'settings'
  | 'feedback'
  | 'microphone'
  | 'camera'
  | 'board'
  | 'arrow'

function HomeIcon({ name, size = 24, className }: { name: HomeIconName; size?: number; className?: string }) {
  const content = (() => {
    switch (name) {
      case 'record':
        return (
          <>
            <path d="M5 4.5h11.5v15H5z" />
            <path d="M8 8h5M8 11.5h4" />
            <path d="m13.5 17 1.9-.5 4.1-4.1-1.4-1.4-4.1 4.1z" />
          </>
        )
      case 'play':
        return (
          <>
            <circle cx="8" cy="8" r="4" />
            <circle cx="16" cy="16" r="4" />
            <path d="M6.5 8h3M14.5 16h3M11 6.5l2-2m0 15 2-2" />
          </>
        )
      case 'replay':
        return (
          <>
            <path d="M4 5.5c3.2-.8 5.9-.2 8 1.7v12c-2.1-1.9-4.8-2.5-8-1.7z" />
            <path d="M20 5.5c-3.2-.8-5.9-.2-8 1.7v12c2.1-1.9 4.8-2.5 8-1.7zM7 9h2.5M14.5 9H17" />
          </>
        )
      case 'analyze':
        return (
          <>
            <path d="M4 4.5v15h16" />
            <path d="m7 15 3.5-3.5 2.7 2.2 4.8-6" />
            <circle cx="18" cy="7.7" r="1.2" />
          </>
        )
      case 'endgame':
        return (
          <>
            <rect x="4" y="4" width="16" height="16" rx="1.5" />
            <path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16" />
            <circle cx="9.3" cy="9.3" r="1.8" fill="currentColor" stroke="none" />
            <circle cx="14.7" cy="14.7" r="1.8" fill="currentColor" stroke="none" />
          </>
        )
      case 'settings':
        return (
          <>
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5 7 7M17 17l1.5 1.5M18.5 5.5 17 7M7 17l-1.5 1.5" />
          </>
        )
      case 'rules':
        return (
          <>
            <path d="M5 4.5c2.7-.7 5-.2 7 1.5v13.5c-2-1.7-4.3-2.2-7-1.5z" />
            <path d="M19 4.5c-2.7-.7-5-.2-7 1.5v13.5c2-1.7 4.3-2.2 7-1.5z" />
            <path d="M8 9h2M14 9h2M8 12h2M14 12h2" />
          </>
        )
      case 'feedback':
        return (
          <>
            <path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
            <path d="M7.5 9.5h9M7.5 13h6" />
          </>
        )
      case 'microphone':
        return (
          <>
            <rect x="8.5" y="3" width="7" height="12" rx="3.5" />
            <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
          </>
        )
      case 'camera':
        return (
          <>
            <path d="M4 7.5h3l1.5-2h7l1.5 2h3v11H4z" />
            <circle cx="12" cy="13" r="3.2" />
          </>
        )
      case 'board':
        return (
          <>
            <rect x="4" y="3" width="16" height="18" rx="1.5" />
            <path d="M9.3 3v18M14.7 3v18M4 9h16M4 15h16" />
            <circle cx="14.7" cy="9" r="1.5" fill="currentColor" stroke="none" />
          </>
        )
      case 'arrow':
        return <path d="m9 5 7 7-7 7" />
    }
  })()

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {content}
    </svg>
  )
}

export default function HomePage({ action }: { action?: HomeAction }) {
  const { go } = useApp()
  const [showNew, setShowNew] = useState(action === 'record')
  const [showFeedback, setShowFeedback] = useState(action === 'feedback')
  const [recent, setRecent] = useState<GameRow[]>([])

  useEffect(() => {
    void db.games.orderBy('updatedAt').reverse().limit(3).toArray().then(setRecent)
  }, [])

  useEffect(() => {
    if (!action) return
    setShowNew(action === 'record')
    setShowFeedback(action === 'feedback')
  }, [action])

  const closeAction = (which: HomeAction) => {
    if (which === 'record') setShowNew(false)
    if (which === 'feedback') setShowFeedback(false)
    if (action === which) go({ name: 'home' })
  }

  return (
    <div className="page home-page">
      <div className="home-scenery" aria-hidden="true">
        <span className="home-sun" />
        <span className="home-mountain home-mountain-back" />
        <span className="home-mountain home-mountain-front" />
        <svg className="home-cloud home-cloud-one" viewBox="0 0 180 58" fill="none">
          <path d="M5 42h106c12 0 16-14 6-20-3-13-21-16-29-5-8-18-39-15-40 8-14-8-31 1-29 17" />
          <path d="M90 42h66c12 0 19-9 19-18M126 29c9-10 26-2 20 10M13 50h84" />
        </svg>
        <svg className="home-cloud home-cloud-two" viewBox="0 0 180 58" fill="none">
          <path d="M5 42h106c12 0 16-14 6-20-3-13-21-16-29-5-8-18-39-15-40 8-14-8-31 1-29 17" />
          <path d="M90 42h66c12 0 19-9 19-18M126 29c9-10 26-2 20 10M13 50h84" />
        </svg>
      </div>
      <header className="home-hero">
        <img className="home-logo" src="/icons/icon.svg" alt="" width="76" height="76" />
        <div className="home-brand">
          <span className="home-kicker">實體對局好幫手</span>
          <h1>象棋記譜</h1>
          <p>面對面對局・即時記譜・引擎復盤</p>
        </div>
      </header>

      <section className="menu-grid" aria-label="主要功能">
        <button className="menu-btn menu-btn-primary" type="button" onClick={() => setShowNew(true)}>
          <span className="menu-btn-head">
            <span className="menu-icon menu-icon-primary">
              <HomeIcon name="record" size={27} />
            </span>
            <span className="menu-copy">
              <span className="menu-title">開始紀錄</span>
              <span className="sub">建立一場面對面對局</span>
            </span>
            <HomeIcon name="arrow" size={19} className="menu-arrow" />
          </span>
          <span className="input-methods" aria-label="可使用語音、拍照或點棋盤輸入">
            <span className="input-method">
              <HomeIcon name="microphone" size={16} />語音
            </span>
            <span className="input-method">
              <HomeIcon name="camera" size={16} />拍照
            </span>
            <span className="input-method">
              <HomeIcon name="board" size={16} />點棋盤
            </span>
          </span>
        </button>
        <button className="menu-btn" type="button" onClick={() => go({ name: 'play-setup' })}>
          <span className="menu-icon">
            <HomeIcon name="play" />
          </span>
          <span className="menu-title">對弈</span>
          <span className="sub">與引擎下棋・自動記譜</span>
          <HomeIcon name="arrow" size={17} className="menu-arrow" />
        </button>
        <button className="menu-btn" type="button" onClick={() => go({ name: 'games', intent: 'replay' })}>
          <span className="menu-icon">
            <HomeIcon name="replay" />
          </span>
          <span className="menu-title">復盤紀錄</span>
          <span className="sub">播放・編輯・變著</span>
          <HomeIcon name="arrow" size={17} className="menu-arrow" />
        </button>
        <button className="menu-btn" type="button" onClick={() => go({ name: 'games', intent: 'analyze' })}>
          <span className="menu-icon">
            <HomeIcon name="analyze" />
          </span>
          <span className="menu-title">解棋</span>
          <span className="sub">引擎評分・關鍵著法</span>
          <HomeIcon name="arrow" size={17} className="menu-arrow" />
        </button>
        <button className="menu-btn" type="button" onClick={() => go({ name: 'endgame' })}>
          <span className="menu-icon">
            <HomeIcon name="endgame" />
          </span>
          <span className="menu-title">殘局解析</span>
          <span className="sub">擺盤・引擎拆解</span>
          <HomeIcon name="arrow" size={17} className="menu-arrow" />
        </button>
      </section>

      <nav className="home-actions" aria-label="其他功能">
        <button type="button" onClick={() => go({ name: 'rules', returnTo: { name: 'home' } })}>
          <HomeIcon name="rules" size={19} />
          <span>棋規</span>
        </button>
        <button type="button" onClick={() => go({ name: 'settings' })}>
          <HomeIcon name="settings" size={19} />
          <span>設定</span>
        </button>
        <button type="button" onClick={() => setShowFeedback(true)}>
          <HomeIcon name="feedback" size={19} />
          <span>回饋及建議</span>
        </button>
      </nav>

      {recent.length > 0 && (
        <section className="card recent-card" aria-labelledby="recent-title">
          <div className="recent-heading">
            <span className="recent-eyebrow">棋局足跡</span>
            <h2 id="recent-title">最近對局</h2>
          </div>
          <div className="recent-list">
            {recent.map((g) => (
              <button
                key={g.id}
                className="recent-game"
                type="button"
                onClick={() =>
                  go(
                    g.result === '*'
                      ? { name: g.mode === 'play' ? 'play' : 'record', gameId: g.id }
                      : { name: 'replay', gameId: g.id },
                  )
                }
              >
                {g.mode === 'play' && (
                  <span className="recent-mode" aria-label="人機對弈">
                    <HomeIcon name="play" size={16} />
                  </span>
                )}
                <span className="recent-main">
                  <span className="recent-players">
                    <b>{g.redName}</b>
                    <span>對</span>
                    <strong>{g.blackName}</strong>
                  </span>
                  <span className="recent-meta">
                    {new Date(g.startedAt).toLocaleString('zh-TW', { hour12: false })}・{g.moveCount} 著
                  </span>
                </span>
                <span className="result-badge">{RESULT_LABEL[g.result]}</span>
                <HomeIcon name="arrow" size={15} className="recent-arrow" />
              </button>
            ))}
          </div>
        </section>
      )}

      {showNew && <NewGameDialog onClose={() => closeAction('record')} />}
      {showFeedback && <FeedbackDialog onClose={() => closeAction('feedback')} />}
    </div>
  )
}

function NewGameDialog({ onClose }: { onClose: () => void }) {
  const { go } = useApp()
  const [red, setRed] = useState('紅方')
  const [black, setBlack] = useState('黑方')
  const [first, setFirst] = useState<'red' | 'black'>('red')
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    void playerNames().then(setNames)
  }, [])

  const start = async () => {
    const redName = red.trim() || '紅方'
    const blackName = black.trim() || '黑方'
    await rememberPlayer(redName)
    await rememberPlayer(blackName)
    const initialFen = first === 'red' ? START_FEN : START_FEN.replace(' w ', ' b ')
    const now = Date.now()
    const id = await db.games.add({
      redName,
      blackName,
      startedAt: now,
      updatedAt: now,
      result: '*',
      initialFen,
      tree: newRoot(initialFen),
      moveCount: 0,
    } as GameRow)
    go({ name: 'record', gameId: id as number })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>開始紀錄</h3>
        <label>
          <div className="muted">紅方姓名</div>
          <input list="player-names" value={red} onChange={(e) => setRed(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>
          <div className="muted">黑方姓名</div>
          <input list="player-names" value={black} onChange={(e) => setBlack(e.target.value)} style={{ width: '100%' }} />
        </label>
        <datalist id="player-names">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <div>
          <div className="muted">先手</div>
          <div className="seg">
            <button className={first === 'red' ? 'on' : ''} onClick={() => setFirst('red')}>
              紅方先
            </button>
            <button className={first === 'black' ? 'on' : ''} onClick={() => setFirst('black')}>
              黑方先
            </button>
          </div>
        </div>
        <div className="muted">開始時間：{new Date().toLocaleString('zh-TW', { hour12: false })}（自動記錄）</div>
        <div className="fab-row">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void start()}>
            開始紀錄
          </button>
        </div>
      </div>
    </div>
  )
}
