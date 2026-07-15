import { describe, expect, it } from 'vitest'
import { sq } from './board'
import { formatDhtmlXq, parseDhtmlXq } from './dhtmlxq'
import { parseFen, START_FEN } from './fen'
import { importGameText, sniffFormat } from './importGame'
import { exportChineseText, exportPgn, type GameMeta } from './pgn'
import { parsePgn } from './pgnImport'
import { addMove, mainline, newRoot } from './tree'

const META: GameMeta = {
  red: '王五',
  black: '李四',
  startedAt: new Date(2026, 6, 14, 21, 30).getTime(),
  result: 'red',
  resultReason: '絕殺',
}

/** 炮二平五 馬8進7 馬二進三 車9平8 */
function sampleGame() {
  const root = newRoot(START_FEN)
  let n = root
  for (const m of [
    { from: sq(2, 7), to: sq(2, 4) },
    { from: sq(9, 7), to: sq(7, 6) },
    { from: sq(0, 7), to: sq(2, 6) },
    { from: sq(9, 8), to: sq(9, 7) },
  ]) {
    n = addMove(n, m).node
  }
  return root
}

describe('PGN 往返', () => {
  it('匯出再匯入 = 同一局', () => {
    const root = sampleGame()
    const pgn = exportPgn(META, root)
    const back = parsePgn(pgn)
    expect(back.warnings).toEqual([])
    expect(back.moveCount).toBe(4)
    expect(back.meta.red).toBe('王五')
    expect(back.meta.black).toBe('李四')
    expect(back.meta.result).toBe('red')
    expect(mainline(back.root).map((n) => n.zh)).toEqual(['炮二平五', '馬8進7', '馬二進三', '車9平8'])
  })

  it('保留註解', () => {
    const root = sampleGame()
    mainline(root)[0].comment = '當頭炮'
    const back = parsePgn(exportPgn(META, root))
    expect(mainline(back.root)[0].comment).toBe('當頭炮')
  })

  it('殘局 FEN tag', () => {
    // 黑將擺在 4 路:否則紅炮是雙王之間唯一遮擋,平開即對臉(非法)
    const fen = '3k5/9/9/9/9/9/9/9/4C4/4K4 w - - 0 1'
    const root = newRoot(fen)
    addMove(root, { from: sq(1, 4), to: sq(1, 3) })
    const back = parsePgn(exportPgn({ ...META, result: '*' }, root))
    expect(back.root.fenAfter).toBe(fen)
    expect(mainline(back.root)[0].zh).toBe('炮五平六')
  })
})

describe('PGN 匯入(外部格式)', () => {
  it('中文著法 + 變着 + 數字編號', () => {
    const pgn = `[Game "Chinese Chess"]
[Red "胡榮華"]
[Black "柳大華"]
[Result "1/2-1/2"]
[Date "2025.03.08"]

1. 炮二平五 馬8進7 (1... 炮8平5 {順手炮} 2. 馬二進三) 2. 馬二進三 車9平8 1/2-1/2`
    const g = parsePgn(pgn)
    expect(g.meta.red).toBe('胡榮華')
    expect(g.meta.result).toBe('draw')
    expect(new Date(g.meta.startedAt).getFullYear()).toBe(2025)
    expect(mainline(g.root).map((n) => n.zh)).toEqual(['炮二平五', '馬8進7', '馬二進三', '車9平8'])
    // 變着掛在第 1 著之後,成為第 2 個 child
    const first = g.root.children[0]
    expect(first.children).toHaveLength(2)
    expect(first.children[1].zh).toBe('炮8平5')
    expect(first.children[1].comment).toBe('順手炮')
    expect(first.children[1].children[0].zh).toBe('馬二進三')
  })

  it('ICCS 與 WXF 著法混用也吃', () => {
    const g = parsePgn(`[Result "*"]\n\n1. H2-E2 h8+7 2. h1g3 R9=8 *`)
    expect(g.warnings).toEqual([])
    expect(mainline(g.root).map((n) => n.zh)).toEqual(['炮二平五', '馬8進7', '馬二進三', '車9平8'])
  })

  it('壞著法只略過不整包炸掉', () => {
    const g = parsePgn(`[Result "*"]\n\n1. 炮二平五 馬8進9999 2. 馬二進三 *`)
    expect(g.moveCount).toBe(2)
    expect(g.warnings.length).toBeGreaterThan(0)
  })
})

describe('中文棋譜往返', () => {
  it('匯出再匯入 = 同一局(含頁尾與時間)', () => {
    const root = sampleGame()
    const text = exportChineseText(META, root)
    const g = importGameText(text)
    expect(g.format).toBe('chinese')
    expect(g.warnings).toEqual([])
    expect(g.meta.red).toBe('王五')
    expect(g.meta.black).toBe('李四')
    expect(g.meta.result).toBe('red')
    expect(mainline(g.root).map((n) => n.zh)).toEqual(['炮二平五', '馬8進7', '馬二進三', '車9平8'])
  })

  it('黑先的中文棋譜', () => {
    const root = newRoot(START_FEN.replace(' w ', ' b '))
    addMove(root, { from: sq(9, 7), to: sq(7, 6) })
    const g = importGameText(exportChineseText({ ...META, result: '*' }, root))
    expect(parseFen(g.root.fenAfter).turn).toBe('black')
    expect(mainline(g.root)[0].zh).toBe('馬8進7')
  })

  it('簡體 + 兩著黏在一起', () => {
    const g = importGameText('1.炮二平五马8进7\n2.马二进三车9平8')
    expect(mainline(g.root).map((n) => n.zh)).toEqual(['炮二平五', '馬8進7', '馬二進三', '車9平8'])
  })
})

describe('東萍 DhtmlXQ', () => {
  it('起始局面 binit 往返', () => {
    const root = newRoot(START_FEN)
    const text = formatDhtmlXq(META, root)
    const g = parseDhtmlXq(text)
    expect(g.root.fenAfter).toBe(START_FEN)
  })

  it('匯出再匯入 = 同一局', () => {
    const root = sampleGame()
    const text = formatDhtmlXq(META, root)
    expect(text).toContain('[DhtmlXQ_movelist]7747')
    const g = importGameText(text)
    expect(g.format).toBe('dhtmlxq')
    expect(g.meta.red).toBe('王五')
    expect(g.meta.result).toBe('red')
    expect(mainline(g.root).map((n) => n.zh)).toEqual(['炮二平五', '馬8進7', '馬二進三', '車9平8'])
  })

  it('炮二平五 = 7747(研究報告的換算表)', () => {
    const root = newRoot(START_FEN)
    addMove(root, { from: sq(2, 7), to: sq(2, 4) })
    expect(formatDhtmlXq(META, root)).toContain('[DhtmlXQ_movelist]7747[/DhtmlXQ_movelist]')
  })

  it('殘局(缺子)binit 用 99 補位', () => {
    const fen = '3k5/9/9/9/9/9/9/9/4C4/4K4 w - - 0 1'
    const root = newRoot(fen)
    const text = formatDhtmlXq({ ...META, result: '*' }, root)
    expect(text).toContain('99')
    const g = parseDhtmlXq(text)
    expect(g.root.fenAfter).toBe(fen)
  })
})

describe('格式嗅探', () => {
  it('各格式都認得', () => {
    expect(sniffFormat('[DhtmlXQ][DhtmlXQ_binit]09...[/DhtmlXQ_binit]')).toBe('dhtmlxq')
    expect(sniffFormat('[Game "Chinese Chess"]\n\n1. H2-E2')).toBe('pgn')
    expect(sniffFormat('紅方:甲  黑方:乙\n\n1. 炮二平五')).toBe('chinese')
    expect(sniffFormat('1. 炮二平五 馬8進7')).toBe('chinese')
    expect(sniffFormat('1. H2-E2 H9-G7')).toBe('pgn')
  })
  it('空內容報錯', () => {
    expect(() => importGameText('   ')).toThrow()
  })
})
