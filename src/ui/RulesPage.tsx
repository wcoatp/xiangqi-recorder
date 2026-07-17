import { useMemo, useState } from 'react'
import { judgeCycle, type CycleConduct, type CycleRuling } from '../core/adjudication'

const OFFICIAL_RULES_URL =
  'https://www.cccs.org.tw/Page?itemid=18&mid=35&IsShowRight=True'

const CONDUCT_OPTIONS: Array<{
  value: CycleConduct
  label: string
  help: string
}> = [
  { value: 'long-check', label: '長將', help: '同一方在循環中持續將軍' },
  { value: 'long-chase', label: '長捉', help: '同一方持續捉子，且不屬棋例豁免' },
  { value: 'none', label: '未犯例', help: '長殺、攔、獻、兌或其他未犯例著法' },
]

const RULING_COPY: Record<
  CycleRuling,
  { title: string; result: string; detail: string; tone: string }
> = {
  draw: {
    title: '和棋',
    result: '雙方不變作和',
    detail: '雙方分類相同：同為長將、同為長捉，或同為未犯例。',
    tone: 'draw',
  },
  'red-loses': {
    title: '黑方勝',
    result: '紅方不變作負',
    detail: '紅方犯例較重；長將重於長捉，長捉重於未犯例。',
    tone: 'black-wins',
  },
  'black-loses': {
    title: '紅方勝',
    result: '黑方不變作負',
    detail: '黑方犯例較重；長將重於長捉，長捉重於未犯例。',
    tone: 'red-wins',
  },
}

export default function RulesPage({ onBack }: { onBack: () => void }) {
  const [redConduct, setRedConduct] = useState<CycleConduct>('none')
  const [blackConduct, setBlackConduct] = useState<CycleConduct>('none')
  const ruling = useMemo(
    () => RULING_COPY[judgeCycle(redConduct, blackConduct)],
    [redConduct, blackConduct],
  )

  return (
    <div className="page rules-page">
      <div className="topbar">
        <button type="button" onClick={onBack}>← 返回</button>
        <div className="title">象棋棋規</div>
      </div>

      <section className="rules-hero" aria-labelledby="rules-title">
        <div className="rules-seal" aria-hidden="true">規</div>
        <div>
          <span className="rules-version">113 年修訂版整理</span>
          <h1 id="rules-title">勝負和與循環判決</h1>
          <p>聚焦 App 對局會用到的規則；正式賽事仍以當場章程與裁判判決為準。</p>
        </div>
      </section>

      <section className="card rules-scope-card" aria-labelledby="rules-scope-title">
        <h2 id="rules-scope-title">App 怎麼處理</h2>
        <div className="rules-scope-grid">
          <div className="rules-scope rules-scope-auto">
            <b>自動處理</b>
            <ul>
              <li>阻止不合法著法與將帥照面。</li>
              <li>無合法著法時，分辨絕殺或困斃並判對方勝。</li>
            </ul>
          </div>
          <div className="rules-scope rules-scope-review">
            <b>提醒後由棋友確認</b>
            <ul>
              <li>協議和、認輸、超時與自然限著。</li>
              <li>循環盤面的長將、長捉與棋例例外。</li>
            </ul>
          </div>
        </div>
        <p className="rules-caution">相同局面重複不等於自動和棋；必須先比較雙方是否犯例。</p>
      </section>

      <section className="card rules-section" aria-labelledby="rules-result-title">
        <div className="rules-heading">
          <span aria-hidden="true">勝</span>
          <div>
            <h2 id="rules-result-title">一般勝、負、和</h2>
            <p>App 能確定的直接判定，以及需要雙方／裁判確認的結果。</p>
          </div>
        </div>
        <div className="rules-result-grid">
          <article>
            <h3>勝負</h3>
            <ul>
              <li><b>絕殺：</b>將死對方即獲勝。</li>
              <li><b>困斃：</b>對方沒有任何合法著法，即使未被將軍也判負。</li>
              <li><b>其他：</b>認輸、超時或賽事犯規，由棋友或裁判確認後記錄。</li>
            </ul>
          </article>
          <article>
            <h3>和棋</h3>
            <ul>
              <li>雙方均無法取勝，或雙方同意作和。</li>
              <li>連續 50 回合、共 100 著未吃子，經審查可判和。</li>
              <li>循環三次仍不變著時，依下方犯例矩陣判決。</li>
            </ul>
          </article>
        </div>
        <p className="muted rules-footnote">
          自然限著尚涉及提出、審查與將軍著數等比賽程序，因此 App 達門檻時只提醒，不會擅自結束棋局。
        </p>
      </section>

      <section className="card cycle-guide" aria-labelledby="cycle-guide-title">
        <div className="rules-heading">
          <span aria-hidden="true">循</span>
          <div>
            <h2 id="cycle-guide-title">循環判定小幫手</h2>
            <p>先由棋友或裁判完成事實分類，App 再套用官方比較矩陣。</p>
          </div>
        </div>

        <ConductPicker
          side="紅方"
          value={redConduct}
          onChange={setRedConduct}
        />
        <ConductPicker
          side="黑方"
          value={blackConduct}
          onChange={setBlackConduct}
        />

        <output className={`cycle-ruling cycle-ruling-${ruling.tone}`} aria-live="polite">
          <span>判定輔助</span>
          <strong>{ruling.title}</strong>
          <b>{ruling.result}</b>
          <small>{ruling.detail}</small>
        </output>

        <div className="cycle-order" aria-label="犯例比較順序">
          <span>犯例嚴重度</span>
          <b>長將</b><i>›</i><b>長捉</b><i>›</i><b>未犯例</b>
        </div>
      </section>

      <section className="card rules-section" aria-labelledby="chase-title">
        <div className="rules-heading">
          <span aria-hidden="true">捉</span>
          <div>
            <h2 id="chase-title">判斷「長捉」前先檢查</h2>
            <p>不是每次反覆攻擊棋子都算犯例；以下是常見判斷重點。</p>
          </div>
        </div>
        <ul className="chase-checklist">
          <li><b>通常犯例：</b>同一子持續捉同一子，或兩子持續捉同一子。</li>
          <li><b>分捉多子：</b>一子輪流捉兩子以上，通常不算長捉。</li>
          <li><b>有根與同類子：</b>真根子、同類子通常有豁免，但受牽制不能離線等情況仍可能算長捉。</li>
          <li><b>將帥與兵卒：</b>由將帥或兵卒形成的長捉，棋例列為未犯例。</li>
          <li><b>其他未犯例：</b>長殺、長攔、長獻、長兌等不直接當作長捉。</li>
        </ul>
        <p className="rules-caution">
          長捉例外很多。本小幫手不會分析棋譜自動選項；有爭議時請查官方完整棋例或交由裁判。
        </p>
      </section>

      <section className="card rules-section rules-physical" aria-labelledby="physical-title">
        <div className="rules-heading">
          <span aria-hidden="true">盤</span>
          <div>
            <h2 id="physical-title">本 App 不處理的實體規則</h2>
            <p>這些規則仍可能適用於實體賽事，但無法由記譜 App 可靠觀察。</p>
          </div>
        </div>
        <div className="rules-tags" aria-label="不處理的實體規則">
          <span>摸子走子</span>
          <span>離手為定</span>
          <span>按鐘與超時</span>
          <span>遲到與犯規次數</span>
          <span>賽場與通訊裝置紀律</span>
        </div>
      </section>

      <section className="rules-source" aria-label="棋規資料來源">
        <p>資料來源：中華民國象棋文化協會《中華民國象棋規則 113 年修訂版》摘要，查閱日期 2026-07-17。</p>
        <a href={OFFICIAL_RULES_URL} target="_blank" rel="noreferrer">
          查看官方完整棋規 ↗
        </a>
      </section>
    </div>
  )
}

function ConductPicker({
  side,
  value,
  onChange,
}: {
  side: '紅方' | '黑方'
  value: CycleConduct
  onChange: (value: CycleConduct) => void
}) {
  return (
    <fieldset className={`conduct-picker conduct-picker-${side === '紅方' ? 'red' : 'black'}`}>
      <legend>{side}循環行為</legend>
      <div className="conduct-options">
        {CONDUCT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? 'on' : ''}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            <b>{option.label}</b>
            <small>{option.help}</small>
          </button>
        ))}
      </div>
    </fieldset>
  )
}
