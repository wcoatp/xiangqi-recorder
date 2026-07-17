import { useEffect, useState, type FormEvent } from 'react'
import { useApp } from '../App'
import { START_FEN } from '../core/fen'
import { newRoot } from '../core/tree'
import { db, playerNames, rememberPlayer, type GameRow } from '../store/db'
import { DEFAULT_LEVEL, engineName, levelAt, PLAY_LEVELS } from './playLevels'

export default function PlaySetupPage() {
  const { go } = useApp()
  const [name, setName] = useState('我')
  const [side, setSide] = useState<'red' | 'black'>('red')
  const [level, setLevel] = useState(DEFAULT_LEVEL)
  const [names, setNames] = useState<string[]>([])
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void playerNames().then(setNames).catch(() => setNames([]))
  }, [])

  const start = async () => {
    if (starting) return
    setStarting(true)
    setError('')

    try {
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '無法建立對局，請稍後再試。')
      setStarting(false)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void start()
  }

  return (
    <div className="page play-setup-page">
      <div className="topbar play-setup-topbar">
        <button type="button" disabled={starting} onClick={() => go({ name: 'home' })}>← 返回首頁</button>
        <div className="title">人機對弈</div>
      </div>

      <section className="play-setup-hero" aria-labelledby="play-setup-title">
        <div className="play-setup-mark" aria-hidden="true">弈</div>
        <div>
          <span>本機引擎・全程自動記譜</span>
          <h1 id="play-setup-title">準備這一局</h1>
          <p>先選擇執紅或執黑與相對級段，開始後會直接進入棋盤。</p>
        </div>
      </section>

      <form className="card play-setup-card" onSubmit={submit}>
        <label className="play-setup-field" htmlFor="play-player-name">
          <span>你的名字</span>
          <small>只會保存在目前瀏覽器的玩家名冊。</small>
          <input
            id="play-player-name"
            list="play-player-names"
            value={name}
            autoComplete="name"
            disabled={starting}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <datalist id="play-player-names">
          {names.map((savedName) => <option key={savedName} value={savedName} />)}
        </datalist>

        <fieldset className="play-setup-fieldset">
          <legend>你執哪邊</legend>
          <p>紅方先行；棋盤會讓你執的一方朝下。</p>
          <div className="seg play-side-seg">
            <button
              type="button"
              className={side === 'red' ? 'on' : ''}
              aria-pressed={side === 'red'}
              disabled={starting}
              onClick={() => setSide('red')}
            >
              執紅（先手）
            </button>
            <button
              type="button"
              className={side === 'black' ? 'on' : ''}
              aria-pressed={side === 'black'}
              disabled={starting}
              onClick={() => setSide('black')}
            >
              執黑（後手）
            </button>
          </div>
        </fieldset>

        <div className="play-setup-field play-level-field">
          <div className="play-level-heading">
            <label htmlFor="play-level">難度</label>
            <strong>{levelAt(level).label}</strong>
          </div>
          <input
            id="play-level"
            type="range"
            min={0}
            max={PLAY_LEVELS.length - 1}
            value={level}
            disabled={starting}
            onChange={(event) => setLevel(Number(event.target.value))}
          />
          <div className="play-level-scale" aria-hidden="true">
            <span>10 級<br />最弱</span>
            <span>1 級</span>
            <span>9 段<br />引擎全力</span>
          </div>
          <p className="play-level-note">級／段是本 App 目前的相對棋力階梯，尚未經象棋協會認證。</p>
        </div>

        <div className="play-setup-summary">
          <span aria-hidden="true">譜</span>
          <p>對弈全程自動記譜；結束後可到「復盤紀錄」播放、建立變著或解棋。</p>
        </div>

        {error && <div className="play-setup-error" role="alert">建立對局失敗：{error}</div>}

        <div className="play-setup-actions">
          <button type="button" disabled={starting} onClick={() => go({ name: 'home' })}>取消</button>
          <button className="primary" type="submit" disabled={starting}>
            {starting ? '建立對局中…' : '開始對弈'}
          </button>
        </div>
      </form>
    </div>
  )
}
