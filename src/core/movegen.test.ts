import { describe, expect, it } from "vitest";
import { sq } from "./board";
import { parseFen, formatFen, START_FEN } from "./fen";
import {
  gameStatus,
  legalMoves,
  legalMovesFrom,
  perft,
  pseudoMovesFrom,
} from "./movegen";

describe("fen", () => {
  it("起始局面 round-trip", () => {
    const pos = parseFen(START_FEN);
    expect(formatFen(pos)).toBe(START_FEN);
  });
  it("接受 E/H 方言字母與 r 表紅方", () => {
    const pos = parseFen(
      "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR r - - 0 1",
    );
    expect(formatFen(pos)).toBe(START_FEN);
  });
});

describe("perft(走法產生正確性)", () => {
  const start = parseFen(START_FEN);
  it("d1 = 44", () => {
    expect(perft(start, 1)).toBe(44);
  });
  it("d2 = 1920", () => {
    expect(perft(start, 2)).toBe(1920);
  });
  it("d3 = 79666", () => {
    expect(perft(start, 3)).toBe(79666);
  });
});

describe("基本規則", () => {
  it("起手馬二進四被相蹩腿(塞象眼位置)", () => {
    const pos = parseFen(START_FEN);
    const horse = sq(0, 7);
    const targets = pseudoMovesFrom(pos, horse).map((m) => m.to);
    expect(targets).toContain(sq(2, 6)); // 馬二進三
    expect(targets).toContain(sq(2, 8)); // 馬二進一
    expect(targets).not.toContain(sq(1, 5)); // 馬二進四:被 f=6 的相蹩腿
  });
  it("相不能過河、塞象眼", () => {
    const pos = parseFen("4k4/9/9/9/9/9/9/4B4/3R5/4K4 w - - 0 1"); // 紅相在 (2,4),紅車在 (1,3) 塞左下象眼
    const bishop = sq(2, 4);
    const targets = pseudoMovesFrom(pos, bishop).map((m) => m.to);
    expect(targets).toContain(sq(4, 2)); // 未過河、象眼空
    expect(targets).toContain(sq(4, 6));
    expect(targets).toContain(sq(0, 6));
    expect(targets).not.toContain(sq(0, 2)); // 象眼 (1,3) 被塞
  });
  it("將帥不可對臉", () => {
    const pos = parseFen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1");
    const moves = legalMoves(pos);
    // 帥只能左右移(往前仍對臉)
    expect(moves).toHaveLength(2);
    expect(moves.map((m) => m.to).sort()).toEqual([sq(0, 3), sq(0, 5)]);
  });
  it("炮需要炮架才能吃子", () => {
    // 紅炮 (0,4),黑卒 (3,4),黑車 (5,4):炮可吃車(隔一子)不可吃卒(無架)
    const pos = parseFen("5k3/9/9/9/4r4/9/4p4/9/9/3KC4 w - - 0 1");
    const cannon = sq(0, 4);
    const targets = legalMovesFrom(pos, cannon).map((m) => m.to);
    expect(targets).toContain(sq(5, 4)); // 隔卒吃車
    expect(targets).not.toContain(sq(3, 4)); // 不能直接吃卒
    expect(targets).toContain(sq(1, 4)); // 空著可走
    expect(targets).not.toContain(sq(4, 4)); // 不能跳過卒空走
  });
  it("過河卒可橫走、不可回頭;未過河只能直進", () => {
    // 黑卒 (4,4) 已過河(黑方過河 = r ≤ 4)
    const pos = parseFen("4k4/9/9/9/9/4p4/9/9/9/4K4 b - - 0 1");
    const pawn = sq(4, 4);
    const targets = pseudoMovesFrom(pos, pawn).map((m) => m.to);
    expect(targets).toContain(sq(3, 4)); // 前進
    expect(targets).toContain(sq(4, 3));
    expect(targets).toContain(sq(4, 5));
    expect(targets).not.toContain(sq(5, 4)); // 不可退
    // 黑卒 (6,4) 未過河:只能直進
    const pos2 = parseFen("4k4/9/9/4p4/9/9/9/9/9/4K4 b - - 0 1");
    const targets2 = pseudoMovesFrom(pos2, sq(6, 4)).map((m) => m.to);
    expect(targets2).toEqual([sq(5, 4)]);
  });
});

describe("終局判定", () => {
  it("絕殺:黑被將死", () => {
    const pos = parseFen("R3k4/9/9/9/9/9/9/9/9/4K4 b - - 0 1");
    const st = gameStatus(pos);
    expect(st.over).toBe(true);
    expect(st.winner).toBe("red");
    expect(st.reason).toBe("checkmate");
    expect(st.inCheck).toBe(true);
  });
  it("困斃:無著可走即負(未被將)", () => {
    const pos = parseFen("4k4/3P1P3/9/9/9/9/9/9/9/3K5 b - - 0 1");
    const st = gameStatus(pos);
    expect(st.over).toBe(true);
    expect(st.winner).toBe("red");
    expect(st.reason).toBe("stalemate");
    expect(st.inCheck).toBe(false);
  });
});
