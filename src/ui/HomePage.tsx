import { useEffect, useState } from 'react'
import { useApp } from '../App'
import { START_FEN } from '../core/fen'
import { newRoot } from '../core/tree'
import { db, playerNames, rememberPlayer, type GameRow } from '../store/db'
import FeedbackDialog from './FeedbackDialog'
import { DEFAULT_LEVEL, engineName, levelAt, PLAY_LEVELS } from './playLevels'

const RESULT_LABEL: Record<string, string> = {
  red: '紅勝',
  black: '黑勝',
  draw: '和棋',
  '*': '進行中',
}

export default function HomePage() {
  const { go } = useApp()
  const [showNew, setShowNew] = useState(false)
  const [showPlay, setShowPlay] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [recent, setRecent] = useState<GameRow[]>([])

  useEffect(() => {
    void db.games.orderBy('updatedAt').reverse().limit(3).toArray().then(setRecent)
  }, [])

  return (
    <div className="page">
      <div className="home-hero">
        <div className="logo">♟️</div>
        <h1>象棋記譜</h1>
        <div className="muted">面對面對局.語音記譜.引擎復盤</div>
      </div>
      <div className="menu-grid">
        <button className="menu-btn" onClick={() => setShowNew(true)}>
          <span className="icon">🔴</span>開始紀錄<span className="sub">語音/點按 即時記譜</span>
        </button>
        <button className="menu-btn" onClick={() => setShowPlay(true)}>
          <span className="icon">🤖</span>對弈<span className="sub">與引擎下棋.自動記譜</span>
        </button>
        <button className="menu-btn" onClick={() => go({ name: 'games', intent: 'replay' })}>
          <span className="icon">📖</span>復盤紀錄<span className="sub">播放.編輯.變着</span>
        </button>
        <button className="menu-btn" onClick={() => go({ name: 'games', intent: 'analyze' })}>
          <span className="icon">💡</span>解棋<span className="sub">引擎評分.關鍵著法</span>
        </button>
        <button className="menu-btn" onClick={() => go({ name: 'endgame' })}>
          <span className="icon">🧩</span>殘局解析<span className="sub">擺盤.引擎拆解</span>
        </button>
      </div>
      <div className="fab-row">
        <button className="grow" onClick={() => go({ name: 'settings' })}>
          ⚙️ 設定
        </button>
        <button className="grow" onClick={() => setShowFeedback(true)}>
          💬 回饋及建議
        </button>
      </div>

      {recent.length > 0 && (
        <div className="card">
          <h3>最近對局</h3>
          {recent.map((g) => (
            <div
              key={g.id}
              className="list-item"
              onClick={() =>
                go(
                  g.result === '*'
                    ? { name: g.mode === 'play' ? 'play' : 'record', gameId: g.id }
                    : { name: 'replay', gameId: g.id },
                )
              }
            >
              <div className="grow">
                <div>
                  {g.mode === 'play' && '🤖 '}
                  <b style={{ color: 'var(--red)' }}>{g.redName}</b> vs <b>{g.blackName}</b>
                </div>
                <div className="muted">
                  {new Date(g.startedAt).toLocaleString('zh-TW', { hour12: false })}.{g.moveCount} 著
                </div>
              </div>
              <span className="result-badge">{RESULT_LABEL[g.result]}</span>
            </div>
          ))}
        </div>
      )}

      {showNew && <NewGameDialog onClose={() => setShowNew(false)} />}
      {showPlay && <PlayDialog onClose={() => setShowPlay(false)} />}
      {showFeedback && <FeedbackDialog onClose={() => setShowFeedback(false)} />}
    </div>
  )
}

function PlayDialog({ onClose }: { onClose: () => void }) {
  const { go } = useApp()
  const [name, setName] = useState('我')
  const [side, setSide] = useState<'red' | 'black'>('red')
  const [level, setLevel] = useState(DEFAULT_LEVEL)
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    void playerNames().then(setNames)
  }, [])

  const start = async () => {
    const playerName = name.trim() || '我'
    await rememberPlayer(playerName)
    const now = Date.now()
    const engineLabel = engineName(level)
    const id = await db.games.add({
      redName: side === 'red' ? playerName : engineLabel,
      blackName: side === 'black' ? playerName : engineLabel,
      mode: 'play',
      playerSide: side,
      level,
      startedAt: now,
      updatedAt: now,
      result: '*',
      initialFen: START_FEN,
      tree: newRoot(START_FEN),
      moveCount: 0,
    } as GameRow)
    go({ name: 'play', gameId: id as number })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>🤖 對弈</h3>
        <label>
          <div className="muted">你的名字</div>
          <input list="player-names" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
        </label>
        <datalist id="player-names">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <div>
          <div className="muted">你執哪邊(紅方先行)</div>
          <div className="seg">
            <button className={side === 'red' ? 'on' : ''} onClick={() => setSide('red')}>
              執紅(先手)
            </button>
            <button className={side === 'black' ? 'on' : ''} onClick={() => setSide('black')}>
              執黑(後手)
            </button>
          </div>
        </div>
        <div>
          <div className="row">
            <span className="muted grow">難度</span>
            <b style={{ fontSize: 17, color: 'var(--accent)' }}>{levelAt(level).label}</b>
          </div>
          <input
            type="range"
            min={0}
            max={PLAY_LEVELS.length - 1}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <div className="row muted" style={{ fontSize: 11, justifyContent: 'space-between' }}>
            <span>10級(最弱)</span>
            <span>1級</span>
            <span>9段(引擎全力)</span>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            級/段只是本 App 內的相對階梯(引擎的限制棋力刻度是為西洋棋校準的),不是象棋棋力認證。
          </div>
        </div>
        <div className="muted">對弈全程自動記譜,結束後可復盤與解棋。</div>
        <div className="fab-row">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void start()}>
            開始對弈
          </button>
        </div>
      </div>
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
        <div className="muted">開始時間:{new Date().toLocaleString('zh-TW', { hour12: false })}(自動記錄)</div>
        <div className="fab-row">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void start()}>
            開始
          </button>
        </div>
      </div>
    </div>
  )
}
