import { validateEndgamePack } from './schema'

/** 隨主程式發佈、首次離線即可使用且涵蓋五階難度的公版古譜題包。 */
export const STARTER_ENDGAME_PACK = validateEndgamePack({
  schemaVersion: 1,
  id: 'shiqing-yaqu-starter-v1',
  version: 1,
  name: '《適情雅趣》離線十二題',
  description: '隨 App 內建、涵蓋五階難度的十二個古典殘局，不需下載即可離線練習。',
  publishedAt: '2026-07-18',
  source: {
    work: '《適情雅趣》',
    author: '徐芝（明代原作）',
    publishedYear: 1570,
    editionNote: '依公版古籍原局面自行轉錄、驗證與重排；不收錄現代註解、解答或掃描頁。',
    sourceUrl: 'https://commons.wikimedia.org/wiki/Category:%E9%81%A9%E6%83%85%E9%9B%85%E8%B6%A3',
  },
  rights: {
    originalStatus: 'public-domain-original',
    editorialLicense: 'GPL-3.0-or-later',
    reviewedAt: '2026-07-18',
    note: '古籍原作已進入公版；本專案只散布自行整理的 FEN、繁中題名、標籤與難度。來源連結供核對，不代表可任意重製任何現代翻印或解說。',
  },
  puzzles: [
    { id: 'shiqing-0435', title: '獨行千里', fen: '3k1ab2/4a4/8b/9/9/9/9/9/4K4/8R w - - 0 1', difficulty: 1, expectedWinner: 'red', sourceOrdinal: 435, themes: ['少子殘局', '短線取勝'] },
    { id: 'shiqing-0443', title: '日月交蝕', fen: '2cCka3/3Pa4/9/9/9/9/9/9/9/4K4 w - - 0 1', difficulty: 1, expectedWinner: 'red', sourceOrdinal: 443, themes: ['少子殘局', '短線取勝'] },
    { id: 'shiqing-0444', title: '地網天羅', fen: '2b1C1b2/4PP3/3k5/9/9/9/9/9/9/5K3 w - - 0 1', difficulty: 1, expectedWinner: 'red', sourceOrdinal: 444, themes: ['少子殘局', '短線取勝'] },
    { id: 'shiqing-0082', title: '禍不單行', fen: '4k4/4a4/2P5n/5N3/9/5R3/9/9/2p2p2r/C3K4 w - - 0 1', difficulty: 2, expectedWinner: 'red', sourceOrdinal: 82, themes: ['古典殺法', '基礎練習'] },
    { id: 'shiqing-0084', title: '雙蜓點水', fen: '1C3k3/1N2P4/1nN1b4/9/9/9/9/4p4/3p1p3/4K4 w - - 0 1', difficulty: 2, expectedWinner: 'red', sourceOrdinal: 84, themes: ['古典殺法', '基礎練習'] },
    { id: 'shiqing-0092', title: '五丁鑿路', fen: '2bak4/C2Ra4/N3b3R/1C5n1/9/2Bn5/9/B8/c1rp1p3/4Kc3 w - - 0 1', difficulty: 2, expectedWinner: 'red', sourceOrdinal: 92, themes: ['古典殺法', '基礎練習'] },
    { id: 'shiqing-0085', title: '驥不稱力', fen: '3ak3C/4aP2n/4R3N/8N/9/9/9/9/2rp1p3/4K4 w - - 0 1', difficulty: 3, expectedWinner: 'red', sourceOrdinal: 85, themes: ['古典殺法', '攻守轉換'] },
    { id: 'shiqing-0086', title: '運籌決勝', fen: '4k4/5P3/3P5/9/6b2/9/9/2p3p2/4AK1nr/3A1C3 w - - 0 1', difficulty: 3, expectedWinner: 'red', sourceOrdinal: 86, themes: ['古典殺法', '攻守轉換'] },
    { id: 'shiqing-0430', title: '能為必勝', fen: '3a1k3/2R1a4/b8/9/2b6/9/9/9/9/4K4 w - - 0 1', difficulty: 3, expectedWinner: 'red', sourceOrdinal: 430, themes: ['古典殺法', '攻守轉換'] },
    { id: 'shiqing-0076', title: '鶯慵蝶懶', fen: '3a1a3/9/3k5/2P6/3P5/3N2C1C/9/1c3p3/4p4/3n1K3 w - - 0 1', difficulty: 4, expectedWinner: 'red', sourceOrdinal: 76, themes: ['連續攻勢', '進階計算'] },
    { id: 'shiqing-0096', title: '勇退急流', fen: '3akc3/4a4/4b1n2/C2RR2N1/4C4/5r3/9/3pB2r1/4p4/3K5 w - - 0 1', difficulty: 4, expectedWinner: 'red', sourceOrdinal: 96, themes: ['連續攻勢', '進階計算'] },
    { id: 'shiqing-0077', title: '雙蝶翻風', fen: '4ka1c1/9/3a5/9/6r1r/9/1RR6/4c4/3p1p3/C3K4 w - - 0 1', difficulty: 5, expectedWinner: 'red', sourceOrdinal: 77, themes: ['長線計算', '研習題'] },
  ],
})
