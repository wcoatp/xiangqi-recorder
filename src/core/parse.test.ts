import { describe, expect, it } from "vitest";
import { applyMove, sq } from "./board";
import { parseFen, START_FEN } from "./fen";
import { parseMoveText, parseMoveVoice } from "./parse";

const start = parseFen(START_FEN);
const C25 = { from: sq(2, 7), to: sq(2, 4) }; // 炮二平五
const afterC25 = applyMove(start, C25);
const H87 = { from: sq(9, 7), to: sq(7, 6) }; // 馬8進7

describe("文字輸入解析", () => {
  it("中文(繁/簡/混用數字)", () => {
    for (const t of ["炮二平五", "炮2平5", "砲二平五", "炮 二 平 五"]) {
      const r = parseMoveText(start, t);
      expect(r.kind).toBe("exact");
      if (r.kind === "exact") expect(r.move).toEqual(C25);
    }
  });
  it("WXF(大小寫、E/H/B/N 同義)", () => {
    for (const t of ["C2=5", "c2=5", "C2.5"]) {
      const r = parseMoveText(start, t);
      expect(r.kind, `input=${t} got=${JSON.stringify(r)}`).toBe("exact");
      if (r.kind === "exact") expect(r.move).toEqual(C25);
    }
    const r2 = parseMoveText(afterC25, "h8+7");
    expect(r2.kind).toBe("exact");
    if (r2.kind === "exact") expect(r2.move).toEqual(H87);
    const r3 = parseMoveText(afterC25, "n8+7");
    expect(r3.kind).toBe("exact");
    if (r3.kind === "exact") expect(r3.move).toEqual(H87);
  });
  it("ICCS / UCI 座標", () => {
    const r = parseMoveText(start, "H2-E2");
    expect(r.kind).toBe("exact");
    if (r.kind === "exact") expect(r.move).toEqual(C25);
    const r2 = parseMoveText(start, "h3e3");
    expect(r2.kind).toBe("exact");
    if (r2.kind === "exact") expect(r2.move).toEqual(C25);
  });
  it("疊子輸入:前炮退二 / C+-2 / +C-2", () => {
    const pos = parseFen("4k4/9/9/4C4/9/9/9/9/4C4/4K4 w - - 0 1");
    const want = { from: sq(6, 4), to: sq(4, 4) };
    for (const t of ["前炮退二", "前炮退2", "C+-2", "+C-2"]) {
      const r = parseMoveText(pos, t);
      expect(r.kind, t).toBe("exact");
      if (r.kind === "exact") expect(r.move).toEqual(want);
    }
  });
  it("不合法/無意義輸入", () => {
    const r = parseMoveText(start, "哈囉你好");
    expect(r.kind).toBe("none");
  });
});

describe("語音模糊解析(同音字)", () => {
  it("碼兒進三 → 馬二進三", () => {
    const r = parseMoveVoice(start, ["碼兒進三"]);
    expect(r.kind === "auto" || r.kind === "exact").toBe(true);
    if (r.kind === "auto" || r.kind === "exact") {
      expect(r.zh).toBe("馬二進三");
    }
  });
  it("跑二瓶五 → 炮二平五", () => {
    const r = parseMoveVoice(start, ["跑二瓶五"]);
    expect(r.kind === "auto" || r.kind === "exact").toBe(true);
    if (r.kind === "auto" || r.kind === "exact") expect(r.zh).toBe("炮二平五");
  });
  it("簡體 ASR 輸出:马2进3(黑方)", () => {
    const r = parseMoveVoice(afterC25, ["马2进3"]);
    expect(r.kind).toBe("exact");
    if (r.kind === "exact") expect(r.zh).toBe("馬2進3");
  });
  it("居八進七(車 jū 誤辨)→ 車8進7? 不存在則不誤配", () => {
    // afterC25 黑方:車9進1 等存在;「居九進一」應命中 車9進1
    const r = parseMoveVoice(afterC25, ["居九進一"]);
    expect(r.kind === "auto" || r.kind === "exact").toBe(true);
    if (r.kind === "auto" || r.kind === "exact") expect(r.zh).toBe("車9進1");
  });
  it("多候選:取最好的一個", () => {
    const r = parseMoveVoice(start, ["罵而進傘", "馬二進三"]);
    expect(r.kind).toBe("exact");
    if (r.kind === "exact") expect(r.zh).toBe("馬二進三");
  });
  it("含填充詞:那個炮二平五啦", () => {
    const r = parseMoveVoice(start, ["那個炮二平五啦"]);
    expect(r.kind === "auto" || r.kind === "exact").toBe(true);
    if (r.kind === "auto" || r.kind === "exact") expect(r.zh).toBe("炮二平五");
  });
});
