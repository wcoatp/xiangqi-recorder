// 迷你拼音層:只涵蓋象棋口令詞彙 + 常見同音誤辨字。
// 目的:把 ASR 輸出與「當前局面合法著法」都投影到模糊拼音空間再比對,
// 同音字(馬/碼、士/四、相/象)、簡繁、數字格式全部在這層消解。

const GROUPS: ReadonlyArray<readonly [string, string]> = [
  ["ma", "馬马傌媽妈嗎吗碼码罵骂麻瑪玛螞蚂"],
  ["ju", "車车俥居局據据具菊橘駒驹巨句舉举"],
  ["che", "車车俥扯撤徹彻澈"],
  ["pao", "炮砲包泡跑袍拋抛刨咆"],
  ["bao", "包寶宝保報报抱爆暴堡"],
  ["bing", "兵冰餅饼丙秉柄並并病"],
  ["zu", "卒足族組组祖阻租"],
  ["shi", "士仕是事十時时詩诗師师試试世市式視视實实石食使史示似室"],
  ["si", "四死絲丝思私司寺肆"],
  ["xiang", "相象像向想項项香箱鄉乡響响巷橡祥翔詳详"],
  ["jiang", "將将講讲醬酱江疆薑姜降獎奖蔣蒋"],
  ["shuai", "帥帅摔甩率"],
  ["jin", "進进近金今晉晋斤盡尽勁劲禁緊紧"],
  ["tui", "退腿推"],
  ["ping", "平瓶評评憑凭萍蘋苹屏"],
  ["qian", "前錢钱千牽牵簽签鉛铅遷迁謙谦潛潜"],
  ["hou", "後后候厚侯猴吼"],
  ["zhong", "中鐘钟終终種种重眾众忠衷"],
  ["yi", "一衣醫医依意義义易億亿藝艺已以移遺遗宜壹"],
  ["er", "二兒儿而耳爾尔餌饵貳贰兩两"],
  ["san", "三傘伞散叁"],
  ["wu", "五無无武午舞屋烏乌誤误霧雾伍"],
  ["liu", "六流留劉刘柳陸陆"],
  ["qi", "七起氣气其棋期奇騎骑齊齐企器妻柒"],
  ["ba", "八把爸吧拔罷罢霸捌"],
  ["jiu", "九酒久舊旧救究玖韭"],
];

const DIGIT_SYL = ["", "yi", "er", "san", "si", "wu", "liu", "qi", "ba", "jiu"];

/** 口語填充詞:直接忽略 */
const FILLERS = new Set([
  ..."的呢啊喔哦嗯啦吧了呃唉欸嘿哈那個这個這就先來来走請请,。!?、.!? ",
]);

const CHAR_SYLS = new Map<string, string[]>();
for (const [syl, chars] of GROUPS) {
  for (const ch of chars) {
    const list = CHAR_SYLS.get(ch) ?? [];
    if (!list.includes(syl)) list.push(syl);
    CHAR_SYLS.set(ch, list);
  }
}

/** 模糊 key:平翹舌合併(zh→z 等)、前後鼻音合併(ng→n) */
export function fuzzyKey(syl: string): string {
  let s = syl;
  s = s.replace(/^zh/, "z").replace(/^ch/, "c").replace(/^sh/, "s");
  if (s.endsWith("ng")) s = s.slice(0, -1);
  return s;
}

/** 把文字轉成音節選項序列。
 * 詞彙外的字直接忽略(語音輸入常夾雜口語;合法著法約束才是真正的守門員,
 * 若因此變得模稜兩可,比對層會回傳候選清單而非誤套用)。 */
export function textToSyllables(text: string): string[][] {
  const out: string[][] = [];
  for (const ch of text) {
    if (FILLERS.has(ch)) continue;
    if (/[1-9]/.test(ch)) {
      out.push([DIGIT_SYL[parseInt(ch, 10)]]);
      continue;
    }
    if (/[1-9]/.test(String.fromCharCode(ch.charCodeAt(0) - 0xfee0))) {
      // 全形數字
      out.push([
        DIGIT_SYL[parseInt(String.fromCharCode(ch.charCodeAt(0) - 0xfee0), 10)],
      ]);
      continue;
    }
    const syls = CHAR_SYLS.get(ch);
    if (syls) out.push(syls.map(fuzzyKey));
  }
  return out;
}

/** 音節序列相似度(0..1):Levenshtein,替換成本 = 兩組選項無交集才算 1 */
export function syllableSimilarity(a: string[][], b: string[][]): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const match = a[i - 1].some((x) => b[j - 1].includes(x));
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (match ? 0 : 1),
      );
    }
  }
  return 1 - dp[n][m] / Math.max(n, m);
}
