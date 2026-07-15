// 匯入:象棋 PGN 與中文棋譜文字(共用同一個著法文字解析器)。
// 著法可以是 ICCS(H2-E2)、UCCI(h2e2)、中文(炮二平五)或 WXF(C2=5)——
// parseMoveText 對當前局面做嚴格比對,所以四種混用也吃得下。
import { parseFen, START_FEN } from './fen'
import { parseMoveText } from './parse'
import type { GameMeta, GameResult } from './pgn'
import { addMove, newRoot, type GameNode } from './tree'

export interface ImportedGame {
  meta: GameMeta
  root: GameNode
  moveCount: number
  warnings: string[]
}

const RESULT_FROM_TAG: Record<string, GameResult> = {
  '1-0': 'red',
  '0-1': 'black',
  '1/2-1/2': 'draw',
  '0.5-0.5': 'draw',
  '*': '*',
}

type Token =
  | { t: 'comment'; v: string }
  | { t: 'varStart' }
  | { t: 'varEnd' }
  | { t: 'result'; v: string }
  | { t: 'num' }
  | { t: 'move'; v: string }

const TOKEN_RE =
  /\{([^}]*)\}|;([^\n]*)|(\()|(\))|(1-0|0-1|1\/2-1\/2|0\.5-0\.5|\*)|(\d+\s*\.(?:\s*\.\.)?)|(\$\d+)|([^\s()[\]{};]+)/g

export function tokenizeMovetext(text: string): Token[] {
  const out: Token[] = []
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m[1] !== undefined) out.push({ t: 'comment', v: m[1].trim() })
    else if (m[2] !== undefined) out.push({ t: 'comment', v: m[2].trim() })
    else if (m[3]) out.push({ t: 'varStart' })
    else if (m[4]) out.push({ t: 'varEnd' })
    else if (m[5]) out.push({ t: 'result', v: m[5] })
    else if (m[6]) out.push({ t: 'num' })
    else if (m[7]) continue // NAG:忽略
    else if (m[8]) out.push({ t: 'move', v: m[8] })
  }
  return out
}

/** 中文棋譜常見「1.炮二平五 马8进7」兩著黏在一起的情況:8 字的 token 拆兩半 */
function splitGlued(v: string): string[] {
  if (v.length === 8 && /^[一-鿿０-９0-9]+$/.test(v)) {
    return [v.slice(0, 4), v.slice(4)]
  }
  return [v]
}

interface Frame {
  current: GameNode
  parent: GameNode | null
}

/** 把 movetext 灌進 root(支援變着括號與 {註解}) */
export function parseMovetext(text: string, root: GameNode): { moveCount: number; warnings: string[] } {
  const tokens = tokenizeMovetext(text)
  const warnings: string[] = []
  const stack: Frame[] = []
  let current = root
  let parent: GameNode | null = null
  let moveCount = 0
  let failures = 0

  for (const tk of tokens) {
    if (tk.t === 'num' || tk.t === 'result') continue
    if (tk.t === 'comment') {
      if (tk.v && current !== root) current.comment = current.comment ? `${current.comment} ${tk.v}` : tk.v
      continue
    }
    if (tk.t === 'varStart') {
      if (!parent) {
        warnings.push('略過無主著法的變着括號')
        stack.push({ current, parent })
        continue
      }
      stack.push({ current, parent })
      current = parent
      parent = null
      continue
    }
    if (tk.t === 'varEnd') {
      const f = stack.pop()
      if (f) {
        current = f.current
        parent = f.parent
      }
      continue
    }
    for (const piece of splitGlued(tk.v)) {
      const pos = parseFen(current.fenAfter)
      const r = parseMoveText(pos, piece, undefined)
      if (r.kind !== 'exact') {
        failures++
        if (failures <= 3) warnings.push(`無法解析著法「${piece}」(第 ${moveCount + 1} 著附近),已略過`)
        continue
      }
      const { node } = addMove(current, r.move)
      parent = current
      current = node
      moveCount++
    }
  }
  if (failures > 3) warnings.push(`另有 ${failures - 3} 個著法無法解析`)
  return { moveCount, warnings }
}

function parseTags(text: string): Record<string, string> {
  const tags: Record<string, string> = {}
  const re = /\[\s*(\w+)\s*"([^"]*)"\s*\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) tags[m[1].toLowerCase()] = m[2]
  return tags
}

function parseDateTag(v: string | undefined): number | null {
  if (!v) return null
  const m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(v.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
  return isNaN(d.getTime()) ? null : d.getTime()
}

/** 象棋 PGN */
export function parsePgn(text: string): ImportedGame {
  const tags = parseTags(text)
  const bodyStart = text.lastIndexOf(']')
  const body = bodyStart >= 0 ? text.slice(bodyStart + 1) : text
  const fen = tags.fen && tags.fen.trim() ? tags.fen.trim() : START_FEN
  parseFen(fen) // 先驗證,壞 FEN 直接丟例外
  const root = newRoot(fen)
  const { moveCount, warnings } = parseMovetext(body, root)
  const meta: GameMeta = {
    red: tags.red || tags.white || '紅方',
    black: tags.black || '黑方',
    startedAt: parseDateTag(tags.date) ?? Date.now(),
    result: RESULT_FROM_TAG[(tags.result || '*').trim()] ?? '*',
    event: tags.event && tags.event !== '-' ? tags.event : undefined,
  }
  return { meta, root, moveCount, warnings }
}

/** 我們自己匯出的中文棋譜文字(也吃得下多數手打的中文棋譜) */
export function parseChineseText(text: string): ImportedGame {
  const lines = text.split(/\r?\n/)
  let red = '紅方'
  let black = '黑方'
  let startedAt = Date.now()
  let result: GameResult = '*'
  let fen = START_FEN
  const bodyLines: string[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const names = /^紅方[::]\s*(.+?)\s{2,}黑方[::]\s*(.+)$/.exec(line)
    if (names) {
      red = names[1].trim()
      black = names[2].trim()
      continue
    }
    const info = /^時間[::]\s*([\d\-/: ]+)\s{2,}結果[::]\s*(\S+)/.exec(line)
    if (info) {
      const t = new Date(info[1].trim().replace(/-/g, '/'))
      if (!isNaN(t.getTime())) startedAt = t.getTime()
      const r = info[2]
      result = r.startsWith('紅勝') ? 'red' : r.startsWith('黑勝') ? 'black' : r.startsWith('和') ? 'draw' : '*'
      continue
    }
    const fenLine = /^起始局面\s*FEN[::]\s*(.+)$/.exec(line)
    if (fenLine) {
      fen = fenLine[1].trim()
      continue
    }
    if (/^\(共\s*\d+\s*著/.test(line)) continue // 我們自己的頁尾
    bodyLines.push(line)
  }

  parseFen(fen)
  const root = newRoot(fen)
  const { moveCount, warnings } = parseMovetext(bodyLines.join('\n'), root)
  return { meta: { red, black, startedAt, result }, root, moveCount, warnings }
}
