import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../App'
import { parseFen } from '../core/fen'
import type { EndgamePack, EndgamePuzzle } from '../endgames/schema'
import { playerNames } from '../store/db'
import { createEndgameGame } from '../store/endgameLibrary'
import { DEFAULT_LEVEL, engineName, levelAt, PLAY_LEVELS } from './playLevels'

type StartMode = 'record' | 'play'

interface Props {
  pack: EndgamePack
  puzzle: EndgamePuzzle
  initialMode: StartMode
  onClose: () => void
}

const SIDE_LABEL = { red: '紅方', black: '黑方' } as const

export default function StartFromEndgameDialog({ pack, puzzle, initialMode, onClose }: Props) {
  const { go } = useApp()
  const currentTurn = useMemo(() => parseFen(puzzle.fen).turn, [puzzle.fen])
  const [mode, setMode] = useState<StartMode>(initialMode)
  const [redName, setRedName] = useState('紅方')
  const [blackName, setBlackName] = useState('黑方')
  const [playerName, setPlayerName] = useState('我')
  const [playerSide, setPlayerSide] = useState(currentTurn)
  const [level, setLevel] = useState(DEFAULT_LEVEL)
  const [names, setNames] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)

  useEffect(() => {
    void playerNames().then(setNames)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  const start = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      if (mode === 'record') {
        const id = await createEndgameGame(
          pack,
          puzzle,
          { mode: 'record', redName, blackName },
          'record',
        )
        go({ name: 'record', gameId: id })
        return
      }

      const name = playerName.trim() || '我'
      const engineLabel = engineName(level)
      const id = await createEndgameGame(
        pack,
        puzzle,
        {
          mode: 'play',
          redName: playerSide === 'red' ? name : engineLabel,
          blackName: playerSide === 'black' ? name : engineLabel,
          playerSide,
          level,
        },
        'play',
      )
      go({ name: 'play', gameId: id })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '建立殘局新局失敗，請稍後再試')
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onClick={() => !saving && onClose()}>
      <div
        className="dialog continue-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="endgame-start-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="continue-dialog-heading">
          <div>
            <span className="continue-kicker">從經典殘局建立獨立棋局</span>
            <h3 id="endgame-start-dialog-title">{puzzle.title}</h3>
          </div>
          <button type="button" aria-label="關閉" onClick={onClose} disabled={saving}>×</button>
        </div>

        <div className="continue-context">
          <b>{pack.source.work}・原第 {puzzle.sourceOrdinal} 局</b>
          <span>目前輪到{SIDE_LABEL[currentTurn]}</span>
          <small>題庫難度 {puzzle.difficulty}／5（不是協會級段）</small>
        </div>

        <div className="continue-warning">
          題庫不會改動。新局從這個盤面重新計著；重複局面與自然限著統計也會重新開始。
        </div>

        <div>
          <div className="muted">開始方式</div>
          <div className="seg" aria-label="開始方式">
            <button type="button" className={mode === 'record' ? 'on' : ''} aria-pressed={mode === 'record'} onClick={() => setMode('record')}>
              實體記譜
            </button>
            <button type="button" className={mode === 'play' ? 'on' : ''} aria-pressed={mode === 'play'} onClick={() => setMode('play')}>
              人機對弈
            </button>
          </div>
        </div>

        {mode === 'record' ? (
          <div className="continue-fields">
            <label>
              <span className="muted">紅方姓名</span>
              <input list="endgame-player-names" value={redName} onChange={(event) => setRedName(event.target.value)} autoFocus />
            </label>
            <label>
              <span className="muted">黑方姓名</span>
              <input list="endgame-player-names" value={blackName} onChange={(event) => setBlackName(event.target.value)} />
            </label>
          </div>
        ) : (
          <>
            <label>
              <span className="muted">你的名字</span>
              <input list="endgame-player-names" value={playerName} onChange={(event) => setPlayerName(event.target.value)} autoFocus />
            </label>
            <div>
              <div className="muted">你執哪一方</div>
              <div className="seg">
                <button type="button" className={playerSide === 'red' ? 'on' : ''} aria-pressed={playerSide === 'red'} onClick={() => setPlayerSide('red')}>執紅</button>
                <button type="button" className={playerSide === 'black' ? 'on' : ''} aria-pressed={playerSide === 'black'} onClick={() => setPlayerSide('black')}>執黑</button>
              </div>
              {playerSide !== currentTurn && <div className="muted continue-first-move">目前由另一方走棋，因此引擎會先走。</div>}
            </div>
            <div>
              <div className="row">
                <span className="muted grow">人機難度</span>
                <b className="continue-level">{levelAt(level).label}</b>
              </div>
              <input aria-label="人機難度" type="range" min={0} max={PLAY_LEVELS.length - 1} value={level} onChange={(event) => setLevel(Number(event.target.value))} />
              <div className="continue-level-scale muted"><span>10 級</span><span>1 級</span><span>9 段</span></div>
              <div className="muted continue-rank-note">級／段為 App 相對階梯，尚未經協會認證。</div>
            </div>
          </>
        )}

        <datalist id="endgame-player-names">
          {names.map((name) => <option key={name} value={name} />)}
        </datalist>
        {error && <div className="continue-error" role="alert">{error}</div>}
        <div className="fab-row">
          <button type="button" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="primary" onClick={() => void start()} disabled={saving}>
            {saving ? '建立中…' : mode === 'record' ? '開始記錄' : '開始人機對弈'}
          </button>
        </div>
      </div>
    </div>
  )
}
