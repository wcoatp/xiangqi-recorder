import { useApp } from '../App'
import {
  COMPETITION_RESOURCES,
  FEATURE_GUIDES,
  OFFICIAL_ACTIVITY_URL,
  OFFICIAL_RULES_URL,
  OFFICIAL_SIGNUP_URL,
  RESOURCE_CHECKED_AT,
  TEACHING_RESOURCES,
  UPCOMING_SCHEDULE,
  type ExternalResource,
} from '../content/guide'

function displayCheckedAt(date: string) {
  const [year, month, day] = date.split('-')
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`
}

function ResourceLink({ resource }: { resource: ExternalResource }) {
  return (
    <a className="guide-resource-link" href={resource.url} target="_blank" rel="noreferrer">
      <span className="guide-seal" aria-hidden="true">{resource.seal}</span>
      <span>
        <b>{resource.title}</b>
        <small>{resource.description}</small>
        <em>來源：{resource.source}</em>
      </span>
      <i aria-hidden="true">↗</i>
    </a>
  )
}

export default function GuidePage() {
  const { go } = useApp()

  return (
    <div className="page guide-page">
      <div className="topbar">
        <button type="button" onClick={() => go({ name: 'home' })}>← 回首頁</button>
        <div className="title">功能與象棋資源</div>
      </div>

      <section className="guide-hero" aria-labelledby="guide-title">
        <div className="guide-hero-mark" aria-hidden="true">導</div>
        <div>
          <span>從記譜到參賽，一頁找到</span>
          <h1 id="guide-title">象棋記譜使用指南</h1>
          <p>App 功能可離線閱讀；台灣教學、棋規與賽程連結會另開官方網站。</p>
        </div>
      </section>

      <nav className="guide-jump-nav" aria-label="本頁章節">
        <a href="#guide-features">功能說明</a>
        <a href="#guide-learning">教學資源</a>
        <a href="#guide-rules">比賽規則</a>
        <a href="#guide-schedule">近期賽程</a>
      </nav>

      <section className="guide-start card" aria-labelledby="guide-start-title">
        <div className="guide-section-heading">
          <span>路</span>
          <div>
            <h2 id="guide-start-title">依目的快速開始</h2>
            <p>不知道從哪裡開始時，先選最接近現在情境的一條路。</p>
          </div>
        </div>
        <div className="guide-start-grid">
          <button type="button" onClick={() => go({ name: 'home', action: 'record' })}>
            <b>實體棋盤正在下</b><span>開始紀錄 →</span>
          </button>
          <button type="button" onClick={() => go({ name: 'play-setup' })}>
            <b>想找對手練棋</b><span>人機對弈 →</span>
          </button>
          <button type="button" onClick={() => go({ name: 'games', intent: 'analyze' })}>
            <b>想檢討已下棋局</b><span>進入解棋 →</span>
          </button>
          <button type="button" onClick={() => go({ name: 'endgame' })}>
            <b>想練經典殘局或自訂局面</b><span>進入殘局題庫 →</span>
          </button>
        </div>
      </section>

      <section id="guide-features" className="guide-section" aria-labelledby="guide-features-title">
        <div className="guide-section-heading">
          <span>用</span>
          <div>
            <h2 id="guide-features-title">完整功能說明</h2>
            <p>公開工具與本機資料界線一次看懂。</p>
          </div>
        </div>
        <div className="guide-feature-grid">
          {FEATURE_GUIDES.map((feature) => (
            <article key={feature.title} className="guide-feature-card card">
              <div>
                <span className="guide-seal" aria-hidden="true">{feature.seal}</span>
                <h3>{feature.title}</h3>
              </div>
              <p>{feature.summary}</p>
              <ul>
                {feature.points.map((point) => <li key={point}>{point}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section id="guide-learning" className="guide-section" aria-labelledby="guide-learning-title">
        <div className="guide-section-heading">
          <span>學</span>
          <div>
            <h2 id="guide-learning-title">台灣教學資源</h2>
            <p>第一版先收錄可追溯、由台灣象棋組織維護的官方頁面。</p>
          </div>
        </div>
        <div className="guide-resource-grid">
          {TEACHING_RESOURCES.map((resource) => <ResourceLink key={resource.title} resource={resource} />)}
        </div>
        <p className="guide-source-note">外部課程、費用、資格與內容可能調整，請以資源提供者最新公告為準；列入不代表商業合作或認證。</p>
      </section>

      <section id="guide-rules" className="guide-section" aria-labelledby="guide-rules-title">
        <div className="guide-section-heading">
          <span>規</span>
          <div>
            <h2 id="guide-rules-title">比賽規則與活動入口</h2>
            <p>先讀 App 摘要快速理解，再以主辦單位全文與當場裁判為準。</p>
          </div>
        </div>
        <div className="guide-rules-callout card">
          <div>
            <span>App 內可離線閱讀</span>
            <h3>勝負和、自然限著、長將與長捉</h3>
            <p>內建循環判定小幫手會套用官方比較矩陣，但不會冒充裁判自動分類長捉。</p>
          </div>
          <button type="button" className="primary" onClick={() => go({ name: 'rules', returnTo: { name: 'guide' } })}>
            開啟 App 棋規
          </button>
        </div>
        <div className="guide-resource-grid">
          {COMPETITION_RESOURCES.map((resource) => <ResourceLink key={resource.title} resource={resource} />)}
        </div>
      </section>

      <section id="guide-schedule" className="guide-section" aria-labelledby="guide-schedule-title">
        <div className="guide-section-heading">
          <span>賽</span>
          <div>
            <h2 id="guide-schedule-title">近期賽程</h2>
            <p>查閱日期：{displayCheckedAt(RESOURCE_CHECKED_AT)}；這是版本快照，不是即時同步。</p>
          </div>
        </div>
        <div className="guide-schedule-alert" role="note">
          <b>出發或報名前請再開官方公告確認</b>
          <span>日期、場地、資格、名額與是否成賽都可能由主辦單位調整。</span>
        </div>
        <div className="guide-schedule-list">
          {UPCOMING_SCHEDULE.map((event) => (
            <article key={event.title} className="guide-event card">
              <div className="guide-event-date">
                <time dateTime={event.dates[0]}>{event.dateLabel}</time>
                <span>{event.kind}</span>
              </div>
              <div className="guide-event-copy">
                <h3>{event.title}</h3>
                <p>{event.detail}</p>
                <small>{event.location}・來源：{event.source}</small>
              </div>
              <a href={event.url} target="_blank" rel="noreferrer">查看官方公告 ↗</a>
            </article>
          ))}
        </div>
        <div className="guide-schedule-actions">
          <a href={OFFICIAL_ACTIVITY_URL} target="_blank" rel="noreferrer">查看最新活動總表 ↗</a>
          <a href={OFFICIAL_SIGNUP_URL} target="_blank" rel="noreferrer">查看官方報名狀態 ↗</a>
        </div>
      </section>

      <section className="guide-local-note card" aria-labelledby="guide-local-title">
        <span className="guide-seal" aria-hidden="true">本</span>
        <div>
          <h2 id="guide-local-title">你的棋譜留在本機</h2>
          <p>這個 App 不會因你開啟教學或賽程連結，就把 IndexedDB 裡的棋譜、照片範本或校準資料送給外部網站。</p>
          <a href={OFFICIAL_RULES_URL} target="_blank" rel="noreferrer">官方棋規來源 ↗</a>
        </div>
      </section>
    </div>
  )
}
