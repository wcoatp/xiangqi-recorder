// 匯入入口:嗅探格式後分派。
import { isDhtmlXq, parseDhtmlXq } from './dhtmlxq'
import { parseChineseText, parsePgn, type ImportedGame } from './pgnImport'

export type ImportFormat = 'dhtmlxq' | 'pgn' | 'chinese'

export function sniffFormat(text: string): ImportFormat {
  if (isDhtmlXq(text)) return 'dhtmlxq'
  if (/\[\s*(Game|Event|Red|Black|Result|FEN|Variant|White)\s*"/i.test(text)) return 'pgn'
  if (/^\s*紅方[::]/m.test(text)) return 'chinese'
  // 沒有標頭:有中文著法字就當中文棋譜,否則丟給 PGN 的著法解析器
  return /[車俥车馬傌马炮砲包兵卒仕士相象將将帥帅]/.test(text) ? 'chinese' : 'pgn'
}

export const FORMAT_LABEL: Record<ImportFormat, string> = {
  dhtmlxq: '東萍 DhtmlXQ',
  pgn: '象棋 PGN',
  chinese: '中文棋譜',
}

export function importGameText(text: string): ImportedGame & { format: ImportFormat } {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('內容是空的')
  const format = sniffFormat(trimmed)
  const game =
    format === 'dhtmlxq' ? parseDhtmlXq(trimmed) : format === 'pgn' ? parsePgn(trimmed) : parseChineseText(trimmed)
  if (game.moveCount === 0 && game.warnings.length > 0) {
    throw new Error(`無法解析任何著法(${FORMAT_LABEL[format]}):${game.warnings[0]}`)
  }
  return { ...game, format }
}
