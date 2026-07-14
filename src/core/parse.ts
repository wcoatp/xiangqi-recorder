// 統一著法輸入解析:中文縱線 / WXF / ICCS / UCI / 語音模糊比對。
// 策略:對「當前局面的每個合法著法」產生正規化 key,輸入正規化後查表;
// 查不到再退到拼音模糊比對(語音路徑)。
import type { Move, Position } from "./board";
import { legalMoves } from "./movegen";
import { chineseMove, parseIccsMove, parseUciMove, wxfMove } from "./notation";
import { syllableSimilarity, textToSyllables } from "./pinyin";

export interface ScoredCandidate {
  move: Move;
  zh: string;
  wxf: string;
  score: number;
}

export type ParseResult =
  | { kind: "exact"; move: Move; zh: string; wxf: string }
  | {
      kind: "auto";
      move: Move;
      zh: string;
      wxf: string;
      candidates: ScoredCandidate[];
    }
  | { kind: "ambiguous"; candidates: ScoredCandidate[] }
  | { kind: "none"; candidates: ScoredCandidate[] };

// 字元 → 正規 key 字元(內部棋子字母 + 阿拉伯數字 + 方向符號)
const CHAR_MAP: Record<string, string> = {};
const addAll = (chars: string, to: string) => {
  for (const ch of chars) CHAR_MAP[ch] = to;
};
addAll("車俥车R", "R");
addAll("馬傌马NH", "N");
addAll("炮砲包C", "C");
addAll("兵卒P", "P");
addAll("仕士AG", "A"); // G = Guard(舊式 WXF)
addAll("相象BEM", "B"); // E = Elephant、M = Minister
addAll("帥將帅将K", "K");
addAll("進进上+", "+");
addAll("退下-−—", "-");
addAll("平=", "=");
addAll("前", "+");
addAll("後后", "-");
addAll("中.", ".");
addAll("一1１", "1");
addAll("二2２兩两", "2");
addAll("三3３", "3");
addAll("四4４", "4");
addAll("五5５", "5");
addAll("六6６", "6");
addAll("七7７", "7");
addAll("八8８", "8");
addAll("九9９", "9");

// 注意:ASCII「.」是 WXF 的符號(平/中),不可跳過
const SKIP = new Set([
  ..." \t\r\n,。,!?!?、;;::「」『』()()的呢啊喔哦嗯啦吧了",
]);

/** 任何記法 → 正規化 key(無法對映的字元 → '?') */
export function canonKey(text: string): string {
  let out = "";
  for (const raw of text) {
    if (SKIP.has(raw)) continue;
    const ch = /[a-z]/.test(raw) ? raw.toUpperCase() : raw;
    out += CHAR_MAP[ch] ?? "?";
  }
  return out;
}

export interface MoveIndexEntry {
  move: Move;
  zh: string;
  wxf: string;
  keys: string[];
}

/** 當前局面所有合法著法的記譜與正規化 key */
export function buildMoveIndex(pos: Position): MoveIndexEntry[] {
  return legalMoves(pos).map((move) => {
    const zh = chineseMove(pos, move);
    const wxf = wxfMove(pos, move);
    const keys = [...new Set([canonKey(zh), canonKey(wxf)])];
    return { move, zh, wxf, keys };
  });
}

/** WXF 允許用「.」表示平(如 C2.5、14.5):產生等價 key 變體 */
function keyVariants(key: string): string[] {
  const out = [key];
  const dotAsFlat = key.replace(
    /^([KABNRCP][1-9]|[1-9][1-9])\.([1-9])$/,
    "$1=$2",
  );
  if (dotAsFlat !== key) out.push(dotAsFlat);
  return out;
}

function lookupExact(idx: MoveIndexEntry[], text: string): MoveIndexEntry[] {
  const key = canonKey(text);
  if (key.length < 3) return [];
  const variants = keyVariants(key);
  return idx.filter((e) => variants.some((v) => e.keys.includes(v)));
}

function coordMove(pos: Position, text: string): Move | null {
  const t = text.trim();
  const m = parseUciMove(t) ?? parseIccsMove(t);
  if (!m) return null;
  const legal = legalMoves(pos).some((x) => x.from === m.from && x.to === m.to);
  return legal ? m : null;
}

/** 文字輸入(打字 / 鍵盤聽寫)解析 */
export function parseMoveText(
  pos: Position,
  text: string,
  index?: MoveIndexEntry[],
): ParseResult {
  const coord = coordMove(pos, text);
  const idx = index ?? buildMoveIndex(pos);
  if (coord) {
    const e = idx.find(
      (x) => x.move.from === coord.from && x.move.to === coord.to,
    );
    if (e) return { kind: "exact", move: e.move, zh: e.zh, wxf: e.wxf };
  }
  const hits = lookupExact(idx, text);
  if (hits.length === 1) {
    const e = hits[0];
    return { kind: "exact", move: e.move, zh: e.zh, wxf: e.wxf };
  }
  return fuzzyMatch(pos, text, idx);
}

/** 語音輸入解析:先精確、再拼音模糊 */
export function parseMoveVoice(
  pos: Position,
  alternatives: string[],
  index?: MoveIndexEntry[],
): ParseResult {
  const idx = index ?? buildMoveIndex(pos);
  // 任一候選能精確命中就用
  for (const text of alternatives) {
    const hits = lookupExact(idx, text);
    if (hits.length === 1) {
      const e = hits[0];
      return { kind: "exact", move: e.move, zh: e.zh, wxf: e.wxf };
    }
  }
  // 模糊:取所有候選中最高分
  let best: ParseResult | null = null;
  for (const text of alternatives) {
    const r = fuzzyMatch(pos, text, idx);
    if (!best || rank(r) > rank(best) || topScore(r) > topScore(best)) best = r;
  }
  return best ?? { kind: "none", candidates: [] };
}

const rank = (r: ParseResult): number =>
  r.kind === "exact"
    ? 3
    : r.kind === "auto"
      ? 2
      : r.kind === "ambiguous"
        ? 1
        : 0;
const topScore = (r: ParseResult): number =>
  r.kind === "exact" ? 1 : ("candidates" in r && r.candidates[0]?.score) || 0;

const AUTO_SCORE = 0.72;
const AUTO_LEAD = 0.12;
const MIN_SCORE = 0.45;

function fuzzyMatch(
  pos: Position,
  text: string,
  idx: MoveIndexEntry[],
): ParseResult {
  const inputSyl = textToSyllables(text);
  if (inputSyl.length < 2) return { kind: "none", candidates: [] };
  const scored: ScoredCandidate[] = idx
    .map((e) => ({
      move: e.move,
      zh: e.zh,
      wxf: e.wxf,
      score: syllableSimilarity(inputSyl, textToSyllables(e.zh)),
    }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < MIN_SCORE)
    return { kind: "none", candidates: scored.slice(0, 3) };
  const lead = top.score - (scored[1]?.score ?? 0);
  if (top.score >= AUTO_SCORE && lead >= AUTO_LEAD) {
    return {
      kind: "auto",
      move: top.move,
      zh: top.zh,
      wxf: top.wxf,
      candidates: scored.slice(0, 3),
    };
  }
  return { kind: "ambiguous", candidates: scored.slice(0, 3) };
}
