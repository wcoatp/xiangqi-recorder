import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useApp, type RulesReturnView, type View } from '../App'
import {
  MENU_GROUPS,
  PUBLIC_MENU_ITEMS,
  type MenuTarget,
} from '../content/guide'

function currentTitle(view: View): string {
  switch (view.name) {
    case 'home':
      if (view.action === 'record') return '開始紀錄'
      if (view.action === 'feedback') return '回饋及建議'
      return '首頁'
    case 'record': return '實體記譜'
    case 'play-setup': return '人機對弈設定'
    case 'play': return '人機對弈'
    case 'games': return view.intent === 'analyze' ? '選擇解棋' : '復盤紀錄'
    case 'replay': return view.analyze ? '解棋' : '復盤'
    case 'endgame': return '殘局解析'
    case 'settings': return '設定'
    case 'rules': return '比賽棋規'
    case 'guide': return '功能與資源'
    case 'rank-calibration': return '段級校準'
  }
}

function activeTarget(view: View): MenuTarget | null {
  switch (view.name) {
    case 'home': return view.action ?? 'home'
    case 'record': return 'record'
    case 'play-setup': return 'play'
    case 'play': return 'play'
    case 'games': return view.intent
    case 'replay': return view.analyze ? 'analyze' : 'replay'
    case 'endgame': return 'endgame'
    case 'settings': return 'settings'
    case 'rules': return 'rules'
    case 'guide': return 'guide'
    case 'rank-calibration': return null
  }
}

function returnView(view: View): RulesReturnView {
  if (view.name === 'rules') return view.returnTo
  if (view.name === 'rank-calibration') return { name: 'home' }
  return view
}

export default function AppMenu({ currentView }: { currentView: View }) {
  const { go } = useApp()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const active = activeTarget(currentView)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus())
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousOverflow
      triggerRef.current?.focus()
    }
  }, [open])

  const navigate = (target: MenuTarget) => {
    setOpen(false)
    switch (target) {
      case 'home': go({ name: 'home' }); break
      case 'record': go({ name: 'home', action: 'record' }); break
      case 'play': go({ name: 'play-setup' }); break
      case 'replay': go({ name: 'games', intent: 'replay' }); break
      case 'analyze': go({ name: 'games', intent: 'analyze' }); break
      case 'endgame': go({ name: 'endgame' }); break
      case 'rules': go({ name: 'rules', returnTo: returnView(currentView) }); break
      case 'guide': go({ name: 'guide' }); break
      case 'settings': go({ name: 'settings' }); break
      case 'feedback': go({ name: 'home', action: 'feedback' }); break
    }
  }

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !drawerRef.current) return
    const focusable = Array.from(
      drawerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'),
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <header className="app-header">
        <button
          ref={triggerRef}
          className="app-menu-trigger"
          type="button"
          aria-label="開啟功能選單"
          aria-controls="app-drawer"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
        <img src="/icons/icon.svg" width="34" height="34" alt="" />
        <div className="app-header-copy">
          <b>象棋記譜</b>
          <span>{currentTitle(currentView)}</span>
        </div>
      </header>

      {open && (
        <div className="app-drawer-layer">
          <div className="app-drawer-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
          <aside
            id="app-drawer"
            ref={drawerRef}
            className="app-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="全部功能"
            onKeyDown={trapFocus}
          >
            <div className="app-drawer-head">
              <img src="/icons/icon.svg" width="52" height="52" alt="" />
              <div>
                <span>實體對局好幫手</span>
                <strong>全部功能</strong>
              </div>
              <button ref={closeRef} type="button" aria-label="關閉功能選單" onClick={() => setOpen(false)}>×</button>
            </div>

            <nav className="app-drawer-nav" aria-label="功能導覽">
              {MENU_GROUPS.map((group) => (
                <section key={group} aria-labelledby={`menu-${group}`}>
                  <h2 id={`menu-${group}`}>{group}</h2>
                  {PUBLIC_MENU_ITEMS.filter((item) => item.group === group).map((item) => (
                    <button
                      key={item.target}
                      type="button"
                      className={active === item.target ? 'active' : ''}
                      aria-current={active === item.target ? 'page' : undefined}
                      onClick={() => navigate(item.target)}
                    >
                      <span className="app-menu-seal" aria-hidden="true">{item.seal}</span>
                      <span className="app-menu-copy">
                        <b>{item.label}</b>
                        <small>{item.description}</small>
                      </span>
                      <span className="app-menu-arrow" aria-hidden="true">›</span>
                    </button>
                  ))}
                </section>
              ))}
            </nav>

            <p className="app-drawer-foot">
              棋譜與設定預設只存在這個瀏覽器；外部資源需連接網路。
            </p>
          </aside>
        </div>
      )}
    </>
  )
}
