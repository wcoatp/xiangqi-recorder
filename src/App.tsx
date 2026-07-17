import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from './store/db'
import { enableRankCalibrationGate } from './store/rankCalibration'
import AppMenu from './ui/AppMenu'
import EndgamePage from './ui/EndgamePage'
import GamesPage from './ui/GamesPage'
import GuidePage from './ui/GuidePage'
import HomePage from './ui/HomePage'
import PlayPage from './ui/PlayPage'
import PlaySetupPage from './ui/PlaySetupPage'
import RecordPage from './ui/RecordPage'
import ReplayPage from './ui/ReplayPage'
import RulesPage from './ui/RulesPage'
import SettingsPage from './ui/SettingsPage'
import RankCalibrationPage from './ui/RankCalibrationPage'

export type HomeAction = 'record' | 'feedback'

export type RulesReturnView =
  | { name: 'home'; action?: HomeAction }
  | { name: 'record'; gameId: number }
  | { name: 'play-setup' }
  | { name: 'play'; gameId: number }
  | { name: 'games'; intent: 'replay' | 'analyze' }
  | { name: 'replay'; gameId: number; analyze?: boolean }
  | { name: 'endgame' }
  | { name: 'settings' }
  | { name: 'guide' }

export type View =
  | RulesReturnView
  | { name: 'rules'; returnTo: RulesReturnView }
  | { name: 'rank-calibration' }

interface AppCtxValue {
  settings: AppSettings
  updateSettings: (p: Partial<AppSettings>) => void
  reloadSettings: () => Promise<void>
  go: (v: View) => void
}

const AppCtx = createContext<AppCtxValue>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
  reloadSettings: async () => {},
  go: () => {},
})

// eslint-disable-next-line react-refresh/only-export-components
export const useApp = () => useContext(AppCtx)

export default function App() {
  const [view, setView] = useState<View>({ name: 'home' })
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  const reloadSettings = useCallback(async () => {
    setSettings(await loadSettings())
  }, [])

  useEffect(() => {
    void reloadSettings()
  }, [reloadSettings])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('rank-calibration') !== 'setup') return
    url.searchParams.delete('rank-calibration')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    void enableRankCalibrationGate().then(
      () => setView({ name: 'rank-calibration' }),
      () => setView({ name: 'rank-calibration' }),
    )
  }, [])

  const updateSettings = useCallback((p: Partial<AppSettings>) => {
    setSettings((s) => ({ ...s, ...p }))
    void saveSettings(p)
  }, [])

  const ctx = useMemo<AppCtxValue>(
    () => ({ settings, updateSettings, reloadSettings, go: setView }),
    [reloadSettings, settings, updateSettings],
  )

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app-shell">
        <AppMenu currentView={view} />
        <main className="app-view">
          {view.name === 'home' && <HomePage action={view.action} />}
          {view.name === 'record' && <RecordPage gameId={view.gameId} />}
          {view.name === 'play-setup' && <PlaySetupPage />}
          {view.name === 'play' && <PlayPage gameId={view.gameId} />}
          {view.name === 'games' && <GamesPage intent={view.intent} />}
          {view.name === 'replay' && <ReplayPage gameId={view.gameId} autoAnalyze={view.analyze} />}
          {view.name === 'endgame' && <EndgamePage />}
          {view.name === 'settings' && <SettingsPage />}
          {view.name === 'guide' && <GuidePage />}
          {view.name === 'rules' && <RulesPage onBack={() => setView(view.returnTo)} />}
          {view.name === 'rank-calibration' && <RankCalibrationPage />}
        </main>
      </div>
    </AppCtx.Provider>
  )
}
