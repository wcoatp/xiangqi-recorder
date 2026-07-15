// 棋子「可以出現在哪個交叉點」的擺放規則(與走法無關,是整局不變量):
//   帥/將只在九宮;士只在九宮 5 個定點;象/相只在己方 7 個定點;
//   兵/卒在己方半場只可能在兵位(rank 3/4、偶數路),過河後任意。
// 供殘局擺盤驗證與拍照辨識的類型指派共用。
import {
  fileOf,
  findKing,
  inPalace,
  opposite,
  rankOf,
  sq,
  type Board,
  type PieceType,
  type Side,
} from "./board";
import { inCheck } from "./movegen";

export const MAX_COUNT: Record<PieceType, number> = {
  K: 1,
  A: 2,
  B: 2,
  N: 2,
  R: 2,
  C: 2,
  P: 5,
};

/** side 的 type 是否可以合法地「擺」在 s 這個交叉點上 */
export function legalPlacement(
  side: Side,
  type: PieceType,
  s: number,
): boolean {
  const r = rankOf(s);
  const f = fileOf(s);
  const rr = side === "red" ? r : 9 - r; // 己方視角 rank
  switch (type) {
    case "K":
      return inPalace(side, r, f);
    case "A":
      return inPalace(side, r, f) && (rr + f) % 2 === 1;
    case "B":
      return (
        (rr === 0 || rr === 2 || rr === 4) && f % 2 === 0 && (rr + f) % 4 === 2
      );
    case "P":
      return rr > 4 || ((rr === 3 || rr === 4) && f % 2 === 0);
    default:
      return true;
  }
}

/** 某交叉點上、指定顏色的棋子,所有可能的類型 */
export function possibleTypes(side: Side, s: number): PieceType[] {
  return (Object.keys(MAX_COUNT) as PieceType[]).filter((t) =>
    legalPlacement(side, t, s),
  );
}

const PIECE_LABEL: Record<Side, Record<PieceType, string>> = {
  red: { K: "帥", A: "仕", B: "相", N: "馬", R: "車", C: "炮", P: "兵" },
  black: { K: "將", A: "士", B: "象", N: "馬", R: "車", C: "炮", P: "卒" },
};

/** 擺盤合法性檢查;回傳錯誤訊息或 null */
export function validatePosition(board: Board, turn: Side): string | null {
  for (const side of ["red", "black"] as Side[]) {
    const label = side === "red" ? "紅" : "黑";
    const count: Record<PieceType, number> = {
      K: 0,
      A: 0,
      B: 0,
      N: 0,
      R: 0,
      C: 0,
      P: 0,
    };
    for (let s = 0; s < 90; s++) {
      const p = board[s];
      if (!p || p.side !== side) continue;
      count[p.type]++;
      if (!legalPlacement(side, p.type, s)) {
        if (p.type === "K") return `${label}${PIECE_LABEL[side].K}必須在九宮內`;
        if (p.type === "A") return `${label}士只能放在九宮的五個定點`;
        if (p.type === "B") return `${label}象/相只能放在己方七個定點`;
        return `${label}未過河的兵/卒只能在自己一側的兵位上`;
      }
    }
    for (const t of Object.keys(count) as PieceType[]) {
      if (count[t] > MAX_COUNT[t])
        return `${label}${PIECE_LABEL[side][t]}超過 ${MAX_COUNT[t]} 只`;
    }
    if (count.K !== 1) return `${label}方必須恰好一個${PIECE_LABEL[side].K}`;
  }
  // 將帥對臉
  const rk = findKing(board, "red");
  const bk = findKing(board, "black");
  if (fileOf(rk) === fileOf(bk)) {
    let clear = true;
    for (let r = rankOf(rk) + 1; r < rankOf(bk); r++) {
      if (board[sq(r, fileOf(rk))]) {
        clear = false;
        break;
      }
    }
    if (clear) return "將帥不可對臉(同一直線且中間無子)";
  }
  // 非輪走方不可正被將軍(等同對方可直接吃將)
  if (inCheck(board, opposite(turn))) {
    return `${turn === "red" ? "黑" : "紅"}方(非輪走方)正被將軍,局面不合法;請改輪走方或調整棋子`;
  }
  return null;
}
