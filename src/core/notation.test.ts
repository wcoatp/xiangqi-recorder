// 黃金範例交叉驗證(xqbase 規範 + 研究報告換算表):
//   炮二平五 ≡ C2=5 ≡ ICCS H2-E2 ≡ UCI h3e3
//   馬8進7 ≡ H8+7 ≡ ICCS H9-G7 ≡ UCI h10g8
//   馬二進三 ≡ ICCS H0-G2
//   前炮退二 ≡ C+-2 ≡ ICCS E6-E4
//   一兵平五 ≡ ICCS F8-E8(兩路各二兵的跨路序數)
import { describe, expect, it } from "vitest";
import type { Move } from "./board";
import { applyMove, sq } from "./board";
import { parseFen, START_FEN } from "./fen";
import {
  chineseMove,
  iccsMove,
  parseIccsMove,
  parseUciMove,
  uciMove,
  wxfMove,
} from "./notation";

const M = (fr: number, ff: number, tr: number, tf: number): Move => ({
  from: sq(fr, ff),
  to: sq(tr, tf),
});

describe("記譜黃金範例", () => {
  it("炮二平五(紅)", () => {
    const pos = parseFen(START_FEN);
    const m = M(2, 7, 2, 4);
    expect(chineseMove(pos, m)).toBe("炮二平五");
    expect(wxfMove(pos, m)).toBe("C2=5");
    expect(iccsMove(m)).toBe("H2-E2");
    expect(uciMove(m)).toBe("h3e3");
  });
  it("馬8進7(黑)", () => {
    const pos = applyMove(parseFen(START_FEN), M(2, 7, 2, 4));
    const m = M(9, 7, 7, 6);
    expect(chineseMove(pos, m)).toBe("馬8進7");
    expect(wxfMove(pos, m)).toBe("H8+7");
    expect(iccsMove(m)).toBe("H9-G7");
    expect(uciMove(m)).toBe("h10g8");
  });
  it("馬二進三(紅)= ICCS H0-G2", () => {
    const pos = parseFen(START_FEN);
    const m = M(0, 7, 2, 6);
    expect(chineseMove(pos, m)).toBe("馬二進三");
    expect(iccsMove(m)).toBe("H0-G2");
  });
  it("士四進五 / 帥五平四", () => {
    const pos = parseFen(START_FEN);
    expect(chineseMove(pos, M(0, 5, 1, 4))).toBe("仕四進五");
    // 紅方路數從己方右手邊數:f5 = 四路、f3 = 六路
    const pos2 = parseFen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1");
    expect(chineseMove(pos2, M(0, 4, 0, 5))).toBe("帥五平四");
    expect(chineseMove(pos2, M(0, 4, 0, 3))).toBe("帥五平六");
  });
});

describe("疊子(前後)", () => {
  it("前炮退二 = C+-2 = ICCS E6-E4", () => {
    const pos = parseFen("4k4/9/9/4C4/9/9/9/9/4C4/4K4 w - - 0 1");
    const m = M(6, 4, 4, 4);
    expect(chineseMove(pos, m)).toBe("前炮退二");
    expect(wxfMove(pos, m)).toBe("C+-2");
    expect(iccsMove(m)).toBe("E6-E4");
  });
  it("後炮平七", () => {
    const pos = parseFen("4k4/9/9/4C4/9/9/9/9/4C4/4K4 w - - 0 1");
    const m = M(1, 4, 1, 2);
    expect(chineseMove(pos, m)).toBe("後炮平七");
    expect(wxfMove(pos, m)).toBe("C-=7");
  });
  it("同線雙馬:前馬/後馬", () => {
    // 紅馬 (4,4) 與 (2,4)
    const pos = parseFen("4k4/9/9/9/9/4N4/9/4N4/9/4K4 w - - 0 1");
    expect(chineseMove(pos, M(4, 4, 6, 3))).toBe("前馬進六");
    expect(chineseMove(pos, M(2, 4, 1, 2))).toBe("後馬退七");
  });
  it("士象不用前後(方向已可區分)", () => {
    // 兩仕同在四路:(0,5) 與 (2,5)
    const pos = parseFen("4k4/9/9/9/9/9/9/5A3/9/4KA3 w - - 0 1");
    expect(chineseMove(pos, M(0, 5, 1, 4))).toBe("仕四進五");
    expect(chineseMove(pos, M(2, 5, 1, 4))).toBe("仕四退五");
  });
});

describe("多兵序數", () => {
  it("三兵同線:前中後", () => {
    // 紅兵 (7,4)、(6,4)、(5,4)
    const pos = parseFen("4k4/9/4P4/4P4/4P4/9/9/9/9/4K4 w - - 0 1");
    expect(chineseMove(pos, M(7, 4, 8, 4))).toBe("前兵進一");
    expect(chineseMove(pos, M(6, 4, 6, 3))).toBe("中兵平六");
    expect(chineseMove(pos, M(5, 4, 5, 5))).toBe("後兵平四");
  });
  it("兩路各二兵:跨路序數(xqbase 範例:一兵平五 = F8-E8)", () => {
    // 紅兵:四路 (8,5)、(7,5);六路 (7,3)、(6,3)
    const pos = parseFen("4k4/5P3/3P1P3/3P5/9/9/9/9/9/4K4 w - - 0 1");
    const m = M(8, 5, 8, 4);
    expect(chineseMove(pos, m)).toBe("一兵平五");
    expect(iccsMove(m)).toBe("F8-E8");
    expect(chineseMove(pos, M(7, 5, 7, 4))).toBe("二兵平五");
    expect(chineseMove(pos, M(7, 3, 7, 4))).toBe("三兵平五");
    expect(chineseMove(pos, M(6, 3, 7, 3))).toBe("四兵進一");
  });
});

describe("座標記法解析", () => {
  it("UCI / ICCS 解析", () => {
    expect(parseUciMove("h3e3")).toEqual(M(2, 7, 2, 4));
    expect(parseUciMove("h10g8")).toEqual(M(9, 7, 7, 6));
    expect(parseIccsMove("H2-E2")).toEqual(M(2, 7, 2, 4));
    expect(parseIccsMove("h9-g7")).toEqual(M(9, 7, 7, 6));
  });
});
