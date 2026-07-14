// 匯出:中文棋譜文字 / 象棋 PGN(xqbase 慣例,ICCS 著法 + Variant 標籤)
import { parseFen, START_FEN } from './fen'
import { iccsMove } from './notation'
import type { GameNode } from './tree'
import { mainline } from './tree'

export type GameResult = 'red' | 'black' | 'draw' | '*'

export interface GameMeta {
  red: string
  black: string
  startedAt: number // epoch ms
  result: GameResult
  resultReason?: string
  event?: string
}

const resultTag = (r: GameResult): string =>
  r === 'red' ? '1-0' : r === 'black' ? '0-1' : r === 'draw' ? '1/2-1/2' : '*'

const ZH_RESULT: Record<GameResult, string> = {
  red: '紅勝',
  black: '黑勝',
  draw: '和棋',
  '*': '未終局',
}

function dateTag(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

function timeStr(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const sameBoard = (fenA: string, fenB: string): boolean =>
  fenA.split(' ').slice(0, 2).join(' ') === fenB.split(' ').slice(0, 2).join(' ')

/** 中文棋譜文字(人讀) */
export function exportChineseText(meta: GameMeta, root: GameNode): string {
  const lines: string[] = []
  lines.push(`紅方:${meta.red}  黑方:${meta.black}`)
  lines.push(`時間:${timeStr(meta.startedAt)}  結果:${ZH_RESULT[meta.result]}${meta.resultReason ? `(${meta.resultReason})` : ''}`)
  if (!sameBoard(root.fenAfter, START_FEN)) lines.push(`起始局面 FEN:${root.fenAfter}`)
  lines.push('')
  const moves = mainline(root)
  const startTurn = parseFen(root.fenAfter).turn
  let i = 0
  let no = 1
  if (startTurn === 'black' && moves.length > 0) {
    lines.push(`${no}. ……　${moves[0].zh}${moves[0].comment ? `　{${moves[0].comment}}` : ''}`)
    i = 1
    no = 2
  }
  for (; i < moves.length; i += 2, no++) {
    const a = moves[i]
    const b = moves[i + 1]
    let line = `${no}. ${a.zh}`
    if (a.comment) line += `　{${a.comment}}`
    if (b) {
      line += `　${b.zh}`
      if (b.comment) line += `　{${b.comment}}`
    }
    lines.push(line)
  }
  lines.push('')
  lines.push(`(共 ${moves.length} 著,由「象棋記譜」匯出)`)
  return lines.join('\n')
}

/** 象棋 PGN(ICCS 著法;象棋橋 / 象棋巫師 / pychess 生態可讀) */
export function exportPgn(meta: GameMeta, root: GameNode): string {
  const tags: string[] = []
  const tag = (k: string, v: string) => tags.push(`[${k} "${v.replace(/"/g, "'")}"]`)
  tag('Game', 'Chinese Chess')
  tag('Event', meta.event ?? '對局紀錄')
  tag('Site', '-')
  tag('Date', dateTag(meta.startedAt))
  tag('Round', '-')
  tag('Red', meta.red)
  tag('Black', meta.black)
  tag('Result', resultTag(meta.result))
  tag('Variant', 'xiangqi')
  tag('Format', 'ICCS')
  if (!sameBoard(root.fenAfter, START_FEN)) {
    tag('SetUp', '1')
    tag('FEN', root.fenAfter)
  }

  const moves = mainline(root)
  const startTurn = parseFen(root.fenAfter).turn
  const body: string[] = []
  let i = 0
  let no = 1
  const fmt = (n: GameNode) => `${iccsMove(n.move!)}${n.comment ? ` {${n.comment.replace(/[{}]/g, '')}}` : ''}`
  if (startTurn === 'black' && moves.length > 0) {
    body.push(`${no}... ${fmt(moves[0])}`)
    i = 1
    no = 2
  }
  for (; i < moves.length; i += 2, no++) {
    const a = moves[i]
    const b = moves[i + 1]
    body.push(`${no}. ${fmt(a)}${b ? ` ${fmt(b)}` : ''}`)
  }
  body.push(resultTag(meta.result))
  return `${tags.join('\n')}\n\n${body.join(' ')}\n`
}
