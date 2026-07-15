// 對弈難度階梯:業餘10級 → 1級 → 1段 → 9段。
//
// ⚠ 誠實界線:名稱借用棋界「級/段」的習慣,但這是**本 App 內的相對階梯**,不是棋力認證。
// 引擎的 UCI_Elo 刻度是 Stockfish 為「西洋棋」校準的,套到象棋只保證單調變強,
// 絕不等於象棋等級分 —— 所以 UI 必須明講,不可暗示「贏了 3 段 = 你有 3 段」。
// 手感要靠實玩回饋調這張表。
export interface PlayLevel {
  label: string
  group: '級' | '段'
  /** 500–2850;undefined = 不限制棋力(全力) */
  elo?: number
  movetimeMs: number
}

const kyu = (n: number, elo: number, movetimeMs: number): PlayLevel => ({
  label: `業餘${n}級`,
  group: '級',
  elo,
  movetimeMs,
})
const dan = (n: number, elo: number | undefined, movetimeMs: number): PlayLevel => ({
  label: `業餘${n}段`,
  group: '段',
  elo,
  movetimeMs,
})

export const PLAY_LEVELS: PlayLevel[] = [
  kyu(10, 500, 100),
  kyu(9, 600, 120),
  kyu(8, 700, 140),
  kyu(7, 800, 160),
  kyu(6, 900, 180),
  kyu(5, 1000, 200),
  kyu(4, 1100, 220),
  kyu(3, 1200, 250),
  kyu(2, 1300, 280),
  kyu(1, 1400, 320),
  dan(1, 1550, 400),
  dan(2, 1700, 500),
  dan(3, 1850, 600),
  dan(4, 2000, 700),
  dan(5, 2150, 850),
  dan(6, 2300, 1000),
  dan(7, 2450, 1200),
  dan(8, 2650, 1500),
  dan(9, undefined, 2000), // 不限制 = 引擎全力
]

export const DEFAULT_LEVEL = 9 // 業餘1級

export const levelAt = (i: number | undefined): PlayLevel => PLAY_LEVELS[i ?? DEFAULT_LEVEL] ?? PLAY_LEVELS[DEFAULT_LEVEL]

/** 對局紀錄裡的引擎名字(存進 GameRow.redName/blackName,之後不受本表改動影響) */
export const engineName = (i: number | undefined): string => `引擎.${levelAt(i).label}`
