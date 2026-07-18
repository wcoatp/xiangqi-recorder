export const RESOURCE_CHECKED_AT = '2026-07-17'

export type MenuGroup = '開始使用' | '棋譜工具' | '學習與支援'

export type MenuTarget =
  | 'home'
  | 'record'
  | 'play'
  | 'replay'
  | 'analyze'
  | 'endgame'
  | 'rules'
  | 'guide'
  | 'settings'
  | 'feedback'

export interface PublicMenuItem {
  target: MenuTarget
  group: MenuGroup
  seal: string
  label: string
  description: string
}

export const MENU_GROUPS: MenuGroup[] = ['開始使用', '棋譜工具', '學習與支援']

export const PUBLIC_MENU_ITEMS: PublicMenuItem[] = [
  { target: 'home', group: '開始使用', seal: '首', label: '首頁', description: '總覽與最近對局' },
  { target: 'record', group: '開始使用', seal: '錄', label: '開始紀錄', description: '語音、拍照或點棋盤記譜' },
  { target: 'play', group: '開始使用', seal: '弈', label: '人機對弈', description: '選擇相對段級與本機引擎下棋' },
  { target: 'replay', group: '棋譜工具', seal: '譜', label: '復盤紀錄', description: '播放、接續、變著與匯出' },
  { target: 'analyze', group: '棋譜工具', seal: '解', label: '解棋', description: '引擎評分、關鍵著法與建議線' },
  { target: 'endgame', group: '棋譜工具', seal: '殘', label: '經典殘局', description: '題庫解題、局面開局、擺盤與分析' },
  { target: 'rules', group: '學習與支援', seal: '規', label: '比賽棋規', description: '勝負和、限著與循環判決' },
  { target: 'guide', group: '學習與支援', seal: '資', label: '功能與資源', description: '完整說明、台灣教學與近期賽程' },
  { target: 'settings', group: '學習與支援', seal: '設', label: '設定', description: '語音、引擎、照片與本機資料' },
  { target: 'feedback', group: '學習與支援', seal: '言', label: '回饋及建議', description: '整理版本資訊後開啟郵件 App' },
]

export interface FeatureGuide {
  seal: string
  title: string
  summary: string
  points: string[]
}

export const FEATURE_GUIDES: FeatureGuide[] = [
  {
    seal: '錄',
    title: '開始紀錄',
    summary: '替面對面的實體象棋對局建立棋譜，棋局會隨每一著保存在這個瀏覽器。',
    points: ['輸入紅黑方姓名與先手後即可開始。', '可隨時續記、結束對局，之後再進入復盤或解棋。'],
  },
  {
    seal: '三',
    title: '三種等權輸入',
    summary: '語音、拍照與點棋盤都是主要路徑，可依現場環境隨時切換。',
    points: ['語音可唸中文著法；不支援即時辨識時可用系統聽寫。', '拍照在本機辨識盤面；點棋盤與 WXF 鍵盤可直接輸入。'],
  },
  {
    seal: '弈',
    title: '人機對弈',
    summary: '與本機象棋引擎對弈，雙方著法自動成為一筆正常棋譜。',
    points: ['難度使用台灣棋友熟悉的相對級／段標籤。', '標籤不是協會認證，也不代表擊敗引擎即可取得段位。'],
  },
  {
    seal: '譜',
    title: '復盤紀錄',
    summary: '逐著播放既有棋局，整理主線、變著、註解及棋局資訊。',
    points: [
      '支援匯入、中文棋譜／PGN 等格式匯出。',
      '停在開局、主線或變著局面，可另開獨立的實體記譜或人機對弈局；原棋譜不會改動。',
      '接續局從選中盤面重新計著，重複局面與自然限著統計也會重新開始。',
    ],
  },
  {
    seal: '解',
    title: '解棋',
    summary: '以本機引擎檢查棋局，查看評分變化、失誤標記與建議變化。',
    points: ['首次使用完整引擎可能需要下載棋力檔。', '提示與解棋使用完整分析，不受人機對弈難度設定影響。'],
  },
  {
    seal: '殘',
    title: '經典殘局與自行擺盤',
    summary: '從公版古譜挑題練習，也能手動或拍照建立自己的局面。',
    points: [
      '內建十二題可直接離線使用，額外精選包由使用者主動下載，驗證後只存目前瀏覽器。',
      '每題可選解題練習、實體棋盤開始記錄、人機對弈或自由分析；四種入口的控制方不混用。',
      '五階難度是 App 題庫相對分級，未經真人棋手校準，不代表協會級段。',
      '自行擺盤開始分析前會檢查棋子數量與基本局面合法性，可試走並查看多條候選變化。',
    ],
  },
  {
    seal: '規',
    title: '比賽棋規',
    summary: '內建 113 年修訂版的 App 適用摘要與循環判定小幫手。',
    points: ['合法著法、將死與困斃可由 App 自動確認。', '長將、長捉、自然限著等仍需棋友或裁判完成事實判斷。'],
  },
  {
    seal: '存',
    title: '設定與本機資料',
    summary: '調整語音、引擎與照片校準；棋局與設定預設不會上傳。',
    points: ['資料屬於目前瀏覽器 profile 與網站網址，換裝置不會自動出現。', '棋局清單可匯出備份；清除網站資料前應先自行保存。'],
  },
  {
    seal: '言',
    title: '回饋及建議',
    summary: 'App 會整理版本與環境資訊，再交由使用者在郵件 App 確認寄送。',
    points: ['不會在背景自動寄信。', '送出前可自行刪除不想分享的環境資訊。'],
  },
  {
    seal: '校',
    title: '段級校準實驗室',
    summary: '供未來帶電腦請協會棋手協助時使用，仍維持預設隱藏與 PIN 門禁。',
    points: ['校準 profile 與原始資料只留在開啟功能的這個瀏覽器。', '公開選單不提供入口，也不會自動把資料同步到其他裝置。'],
  },
]

export interface ExternalResource {
  seal: string
  title: string
  description: string
  source: string
  url: string
}

export const OFFICIAL_RULES_URL =
  'https://www.cccs.org.tw/Page?itemid=18&mid=35&IsShowRight=True'
export const OFFICIAL_ACTIVITY_URL = 'https://www.cccs.org.tw/Message?itemid=3&mid=2'
export const OFFICIAL_SIGNUP_URL = 'https://www.cccs.org.tw/SignUp?itemid=1&mid=45'

export const TEACHING_RESOURCES: ExternalResource[] = [
  {
    seal: '課',
    title: '象棋課程介紹',
    description: '從幼童、入門、級位到段位班的分級學習方向。',
    source: '中華民國象棋文化協會',
    url: 'https://www.cccs.org.tw/Page?IsShowRight=True&itemid=10&mid=17',
  },
  {
    seal: '新',
    title: '最新課程與體驗',
    description: '查看台灣在地課程、團體研習、私人課程及入門體驗資訊。',
    source: '中華民國象棋文化協會',
    url: 'https://www.cccs.org.tw/Page?IsShowRight=True&itemid=9&mid=16',
  },
  {
    seal: '試',
    title: '棋力測試',
    description: '由協會學園提供的預約測程度入口，適合不確定學習起點的棋友。',
    source: '中華民國象棋文化協會',
    url: 'https://www.cccs.org.tw/Page?IsShowRight=True&itemid=6&mid=12',
  },
  {
    seal: '譜',
    title: '棋譜棋評',
    description: '台灣賽事與精選對局的棋譜、評注資料。',
    source: '中華民國象棋文化協會',
    url: 'https://www.cccs.org.tw/Message?itemid=10&mid=33',
  },
  {
    seal: '級',
    title: '台灣棋力制度',
    description: '了解級位、段位、未認證棋力及正式證書制度的差別。',
    source: '中華民國象棋文化協會',
    url: 'https://www.cccs.org.tw/Page?itemid=19&mid=36',
  },
]

export const COMPETITION_RESOURCES: ExternalResource[] = [
  {
    seal: '規',
    title: '113 年修訂版完整棋規',
    description: '正式比賽的勝負和、循環、限著與賽場程序原文。',
    source: '中華民國象棋文化協會',
    url: OFFICIAL_RULES_URL,
  },
  {
    seal: '賽',
    title: '比賽／研習活動總表',
    description: '查看最新簡章、異動、名單、注意事項與賽事報導。',
    source: '中華民國象棋文化協會',
    url: OFFICIAL_ACTIVITY_URL,
  },
  {
    seal: '報',
    title: '官方報名系統',
    description: '查看目前開放的活動、地點、報名期限與名額狀態。',
    source: '中華民國象棋文化協會',
    url: OFFICIAL_SIGNUP_URL,
  },
]

export interface ScheduleItem {
  dates: string[]
  dateLabel: string
  kind: string
  title: string
  detail: string
  location: string
  source: string
  url: string
}

export const UPCOMING_SCHEDULE: ScheduleItem[] = [
  {
    dates: ['2026-07-19'],
    dateLabel: '7 月 19 日（日）',
    kind: '段位甲組',
    title: '2026 年第 29 屆名揚盃象棋錦標賽',
    detail: '系列賽最後一場，參加資格為 2～3 段棋力棋友；13:00 報到、13:30 開賽。',
    location: '臺北市・名揚分會會館',
    source: '中華民國象棋文化協會名揚分會',
    url: 'https://www.cccs.org.tw/Message/MessageView?GroupName=%E5%88%86%E6%9C%83%E6%B4%BB%E5%8B%95&itemid=4371&mid=2&page=0',
  },
  {
    dates: ['2026-07-26'],
    dateLabel: '7 月 26 日（日）',
    kind: '全國錦標賽',
    title: '115 年度臺北市中正盃全國象棋錦標賽',
    detail: '分段位、晉段、級位、入門及小棋手組；報名期限已過，參賽者請查最新名單與注意事項。',
    location: '臺北市・劍潭青年活動中心',
    source: '臺北市體育總會象棋協會',
    url: 'https://www.cccs.org.tw/Message/MessageView?GroupName=%E5%8D%94%E8%BE%A6&itemid=4378&mid=2',
  },
  {
    dates: ['2026-08-16', '2026-08-23'],
    dateLabel: '8 月 16 日、23 日（日）',
    kind: '級位檢定',
    title: '115 年暑期象棋級位檢定',
    detail: '8/16 為級位丙、丁組；8/23 為級位甲、乙組，皆為下午場。',
    location: '臺北市・古亭象棋學園',
    source: '中華民國象棋文化協會',
    url: 'https://www.cccs.org.tw/Message/MessageView?GroupName=%E4%B8%BB%E8%BE%A6&itemid=4379&mid=2',
  },
  {
    dates: ['2026-08-30', '2026-09-06'],
    dateLabel: '8 月 30 日、9 月 6 日（日）',
    kind: '段位檢定',
    title: '115 年暑期象棋段位檢定',
    detail: '包含晉升初段至陸段的分組；資格、梯次及是否成賽請查看主辦單位最新簡章。',
    location: '臺北市・古亭象棋學園',
    source: '中華民國象棋文化協會',
    url: OFFICIAL_ACTIVITY_URL,
  },
]
