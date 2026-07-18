import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../App'
import { ENDGAME_PACK_CATALOG } from '../endgames/catalog'
import {
  ENDGAME_DIFFICULTY_LABEL,
  endgameGoalLabel,
  type EndgameDifficulty,
  type EndgamePack,
  type EndgamePuzzle,
} from '../endgames/schema'
import { STARTER_ENDGAME_PACK } from '../endgames/starterPack'
import {
  createEndgameGame,
  installEndgamePack,
  loadEndgameProgress,
  loadInstalledEndgamePacks,
  removeEndgamePack,
  type EndgameProgress,
} from '../store/endgameLibrary'
import Board from './Board'
import StartFromEndgameDialog from './StartFromEndgameDialog'
import { DEFAULT_LEVEL } from './playLevels'

interface Props {
  onAnalyze: (pack: EndgamePack, puzzle: EndgamePuzzle) => void
  onManual: () => void
}

interface LibraryEntry {
  pack: EndgamePack
  puzzle: EndgamePuzzle
  builtIn: boolean
}

type ProgressFilter = 'all' | 'untried' | 'solved'

export default function EndgameLibrary({ onAnalyze, onManual }: Props) {
  const { go } = useApp()
  const [installed, setInstalled] = useState<EndgamePack[]>([])
  const [progress, setProgress] = useState<Map<string, EndgameProgress>>(new Map())
  const [query, setQuery] = useState('')
  const [difficulty, setDifficulty] = useState<'all' | EndgameDifficulty>('all')
  const [packFilter, setPackFilter] = useState('all')
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>('all')
  const [selectedId, setSelectedId] = useState(STARTER_ENDGAME_PACK.puzzles[0].id)
  const [dialogMode, setDialogMode] = useState<'record' | 'play' | null>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const packs = useMemo(() => [STARTER_ENDGAME_PACK, ...installed], [installed])
  const entries = useMemo<LibraryEntry[]>(
    () => packs.flatMap((pack) => pack.puzzles.map((puzzle) => ({
      pack,
      puzzle,
      builtIn: pack.id === STARTER_ENDGAME_PACK.id,
    }))),
    [packs],
  )

  const refresh = async () => {
    const nextPacks = await loadInstalledEndgamePacks()
    const ids = [STARTER_ENDGAME_PACK, ...nextPacks].flatMap((pack) => pack.puzzles.map((puzzle) => puzzle.id))
    setInstalled(nextPacks)
    setProgress(await loadEndgameProgress(ids))
  }

  useEffect(() => {
    void refresh().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '讀取本機題庫失敗')
    })
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-Hant-TW')
    return entries.filter(({ pack, puzzle }) => {
      if (difficulty !== 'all' && puzzle.difficulty !== difficulty) return false
      if (packFilter !== 'all' && pack.id !== packFilter) return false
      const itemProgress = progress.get(puzzle.id)
      if (progressFilter === 'untried' && itemProgress) return false
      if (progressFilter === 'solved' && !itemProgress?.solved) return false
      if (!needle) return true
      return [puzzle.title, pack.name, ...puzzle.themes, String(puzzle.sourceOrdinal)]
        .some((value) => value.toLocaleLowerCase('zh-Hant-TW').includes(needle))
    })
  }, [difficulty, entries, packFilter, progress, progressFilter, query])

  const selected = filtered.find((entry) => entry.puzzle.id === selectedId)
    ?? filtered[0]

  const startSolve = async () => {
    if (!selected || busy) return
    setBusy('solve')
    setError('')
    try {
      const side = selected.puzzle.expectedWinner
      const id = await createEndgameGame(
        selected.pack,
        selected.puzzle,
        {
          mode: 'play',
          redName: side === 'red' ? '我' : '解題引擎',
          blackName: side === 'black' ? '我' : '解題引擎',
          playerSide: side,
          level: DEFAULT_LEVEL,
        },
        'solve',
      )
      go({ name: 'play', gameId: id })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '開始解題失敗')
      setBusy('')
    }
  }

  const install = async (id: string) => {
    const manifest = ENDGAME_PACK_CATALOG.find((item) => item.id === id)
    if (!manifest || busy) return
    setBusy(id)
    setError('')
    setMessage('')
    try {
      const pack = await installEndgamePack(manifest)
      await refresh()
      setPackFilter(pack.id)
      setSelectedId(pack.puzzles[0].id)
      setMessage(`已把「${pack.name}」${pack.puzzles.length} 題下載到這台裝置，可離線使用。`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '下載題包失敗，請稍後再試')
    } finally {
      setBusy('')
    }
  }

  const uninstall = async (id: string) => {
    if (busy || !window.confirm('移除此下載題包？已建立的棋局與練習進度會保留。')) return
    setBusy(id)
    setError('')
    try {
      await removeEndgamePack(id)
      setPackFilter('all')
      setSelectedId(STARTER_ENDGAME_PACK.puzzles[0].id)
      await refresh()
      setMessage('題包已從這台裝置移除；既有棋局與進度仍保留。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移除題包失敗')
    } finally {
      setBusy('')
    }
  }

  const installedIds = new Set(installed.map((pack) => pack.id))
  const solvedCount = [...progress.values()].filter((item) => item.solved).length

  return (
    <div className="page endgame-library-page">
      <div className="topbar">
        <button type="button" onClick={() => go({ name: 'home' })}>← 首頁</button>
        <div className="title">經典殘局題庫</div>
        <button type="button" onClick={onManual}>＋ 自行擺盤</button>
      </div>

      <section className="endgame-library-hero" aria-labelledby="endgame-library-heading">
        <div>
          <span className="endgame-library-seal" aria-hidden="true">殘</span>
          <div>
            <h2 id="endgame-library-heading">從古譜局面開始練</h2>
            <p>每題都能解題、帶到實體棋盤記錄、跟引擎對弈，或直接自由分析。</p>
          </div>
        </div>
        <div className="endgame-library-stats" aria-label="題庫統計">
          <b>{entries.length}</b><span>本機題目</span>
          <b>{solvedCount}</b><span>已解出</span>
        </div>
      </section>

      <section className="endgame-pack-shelf" aria-label="可下載題包">
        {ENDGAME_PACK_CATALOG.map((manifest) => {
          const isInstalled = installedIds.has(manifest.id)
          return (
            <article className={`endgame-pack-card ${isInstalled ? 'is-installed' : ''}`} key={manifest.id}>
              <div className="grow">
                <span className="endgame-pack-kicker">{isInstalled ? '已下載・離線可用' : '公版古譜擴充包'}</span>
                <b>{manifest.name}・{manifest.puzzleCount} 題</b>
                <small>{manifest.description} 約 {Math.ceil(manifest.approximateBytes / 1_000)} KB。</small>
              </div>
              {isInstalled ? (
                <button type="button" onClick={() => void uninstall(manifest.id)} disabled={!!busy}>移除</button>
              ) : (
                <button type="button" className="primary" onClick={() => void install(manifest.id)} disabled={!!busy}>
                  {busy === manifest.id ? '下載驗證中…' : '下載到這台裝置'}
                </button>
              )}
            </article>
          )
        })}
      </section>

      {message && <div className="endgame-library-message" role="status">{message}</div>}
      {error && <div className="continue-error" role="alert">{error}</div>}

      <section className="endgame-filter-card" aria-label="題庫篩選">
        <label className="endgame-search grow">
          <span className="muted">搜尋題名、標籤或原題序</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：馬、少子、435" />
        </label>
        <label>
          <span className="muted">難度</span>
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value === 'all' ? 'all' : Number(event.target.value) as EndgameDifficulty)}>
            <option value="all">全部五階</option>
            {([1, 2, 3, 4, 5] as EndgameDifficulty[]).map((level) => <option key={level} value={level}>{ENDGAME_DIFFICULTY_LABEL[level]}</option>)}
          </select>
        </label>
        <label>
          <span className="muted">題包</span>
          <select value={packFilter} onChange={(event) => setPackFilter(event.target.value)}>
            <option value="all">全部來源</option>
            {packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
          </select>
        </label>
        <label>
          <span className="muted">進度</span>
          <select value={progressFilter} onChange={(event) => setProgressFilter(event.target.value as ProgressFilter)}>
            <option value="all">全部進度</option>
            <option value="untried">尚未練習</option>
            <option value="solved">已解出</option>
          </select>
        </label>
      </section>

      <div className="endgame-library-workspace">
        <section className="endgame-puzzle-list" aria-label={`題目清單，共 ${filtered.length} 題`}>
          <div className="endgame-list-heading"><b>{filtered.length} 題</b><span>難度為 App 題庫分階，不是協會級段</span></div>
          {filtered.length === 0 && <div className="endgame-empty">找不到符合條件的題目，請調整篩選。</div>}
          {filtered.map(({ pack, puzzle, builtIn }) => {
            const itemProgress = progress.get(puzzle.id)
            return (
              <button
                type="button"
                className={`endgame-puzzle-row ${selected?.puzzle.id === puzzle.id ? 'is-selected' : ''}`}
                aria-pressed={selected?.puzzle.id === puzzle.id}
                key={puzzle.id}
                onClick={() => setSelectedId(puzzle.id)}
              >
                <span className={`endgame-difficulty difficulty-${puzzle.difficulty}`}>{puzzle.difficulty}</span>
                <span className="grow">
                  <b>{puzzle.title}</b>
                  <small>{pack.source.work}・原第 {puzzle.sourceOrdinal} 局</small>
                </span>
                <span className="endgame-row-status">{itemProgress?.solved ? '✓ 已解' : itemProgress ? `${itemProgress.attempts} 次` : builtIn ? '內建' : '新題'}</span>
              </button>
            )
          })}
        </section>

        {selected && (
          <section className="endgame-puzzle-detail" aria-labelledby="selected-endgame-title">
            <div className="endgame-detail-heading">
              <div>
                <span className="endgame-pack-kicker">{selected.pack.name}・原第 {selected.puzzle.sourceOrdinal} 局</span>
                <h2 id="selected-endgame-title">{selected.puzzle.title}</h2>
              </div>
              <span className={`endgame-difficulty large difficulty-${selected.puzzle.difficulty}`} aria-label={ENDGAME_DIFFICULTY_LABEL[selected.puzzle.difficulty]}>
                {selected.puzzle.difficulty}
              </span>
            </div>
            <div className="endgame-preview-board">
              <Board fen={selected.puzzle.fen} bottom={selected.puzzle.expectedWinner} />
            </div>
            <div className="endgame-puzzle-meta">
              <b>{endgameGoalLabel(selected.puzzle)}</b>
              <span>{ENDGAME_DIFFICULTY_LABEL[selected.puzzle.difficulty]}</span>
              {selected.puzzle.themes.map((theme) => <span key={theme}>{theme}</span>)}
            </div>
            <p className="muted endgame-rank-disclaimer">難度是本題庫的五階相對分級，尚未經真人棋手校準，不代表協會級段。</p>

            <div className="endgame-action-grid">
              <button type="button" className="primary endgame-action-main" onClick={() => void startSolve()} disabled={!!busy}>
                <b>{busy === 'solve' ? '建立中…' : '解題練習'}</b>
                <small>你走題目方，引擎全力防守；提示需主動開啟</small>
              </button>
              <button type="button" onClick={() => setDialogMode('record')}>
                <b>開始記錄</b><small>紅黑都由真人／實體棋盤走</small>
              </button>
              <button type="button" onClick={() => setDialogMode('play')}>
                <b>人機對弈</b><small>選執棋方與 App 相對級段</small>
              </button>
              <button type="button" onClick={() => onAnalyze(selected.pack, selected.puzzle)}>
                <b>自由分析</b><small>帶入多主變分析與試走</small>
              </button>
            </div>

            <details className="endgame-source-note">
              <summary>來源與版權說明</summary>
              <p><b>{selected.pack.source.work}</b>，{selected.pack.source.author}，{selected.pack.source.publishedYear} 年；本題為原第 {selected.puzzle.sourceOrdinal} 局。</p>
              <p>{selected.pack.rights.note}</p>
              <a href={selected.pack.source.sourceUrl} target="_blank" rel="noreferrer">查看公版館藏來源 ↗</a>
            </details>
          </section>
        )}
      </div>

      <p className="muted endgame-local-note">下載包與練習進度只保存在目前瀏覽器；清除網站資料會一併移除，本輪尚不隨完整備份搬移。</p>

      {selected && dialogMode && (
        <StartFromEndgameDialog pack={selected.pack} puzzle={selected.puzzle} initialMode={dialogMode} onClose={() => setDialogMode(null)} />
      )}
    </div>
  )
}
