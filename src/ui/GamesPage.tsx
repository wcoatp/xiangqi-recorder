import { useEffect, useState } from 'react'
import { useApp } from '../App'
import { db, type GameRow } from '../store/db'

const RESULT_LABEL: Record<string, string> = {
  red: '紅勝',
  black: '黑勝',
  draw: '和棋',
  '*': '進行中',
}

export default function GamesPage({ intent }: { intent: 'replay' | 'analyze' }) {
  const { go } = useApp()
  const [games, setGames] = useState<GameRow[]>([])
  const [q, setQ] = useState('')

  const reload = () => void db.games.orderBy('startedAt').reverse().toArray().then(setGames)
  useEffect(reload, [])

  const filtered = games.filter((g) => {
    const key = q.trim()
    if (!key) return true
    return (
      g.redName.includes(key) ||
      g.blackName.includes(key) ||
      new Date(g.startedAt).toLocaleDateString('zh-TW').includes(key)
    )
  })

  const remove = async (g: GameRow) => {
    if (!window.confirm(`刪除「${g.redName} vs ${g.blackName}」這局紀錄?此動作無法復原。`)) return
    await db.games.delete(g.id)
    reload()
  }

  return (
    <div className="page">
      <div className="topbar">
        <button onClick={() => go({ name: 'home' })}>← 返回</button>
        <div className="title">{intent === 'analyze' ? '解棋:選擇對局' : '復盤紀錄'}</div>
      </div>
      <input
        placeholder="搜尋玩家姓名或日期…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%' }}
      />
      <div className="card" style={{ padding: 0 }}>
        {filtered.length === 0 && <div className="list-item muted">沒有紀錄</div>}
        {filtered.map((g) => (
          <div key={g.id} className="list-item">
            <div
              className="grow"
              onClick={() => go({ name: 'replay', gameId: g.id, analyze: intent === 'analyze' })}
            >
              <div>
                <b style={{ color: 'var(--red)' }}>{g.redName}</b> vs <b>{g.blackName}</b>{' '}
                <span className="result-badge">{RESULT_LABEL[g.result]}</span>
                {g.review && <span className="result-badge">已解棋</span>}
              </div>
              <div className="muted">
                {new Date(g.startedAt).toLocaleString('zh-TW', { hour12: false })}.{g.moveCount} 著
              </div>
            </div>
            <button className="danger" onClick={() => void remove(g)}>
              刪除
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
