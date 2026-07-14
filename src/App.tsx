import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from './store/db'
import EndgamePage from './ui/EndgamePage'
import GamesPage from './ui/GamesPage'
import HomePage from './ui/HomePage'
import RecordPage from './ui/RecordPage'
import ReplayPage from './ui/ReplayPage'
import SettingsPage from './ui/SettingsPage'

export type View =
  | { name: 'home' }
  | { name: 'record'; gameId: number }
  | { name: 'games'; intent: 'replay' | 'analyze' }
  | { name: 'replay'; gameId: number; analyze?: boolean }
  | { name: 'endgame' }
  | { name: 'settings' }

interface AppCtxValue {
  settings: AppSettings
  updateSettings: (p: Partial<AppSettings>) => void
  go: (v: View) => void
}

const AppCtx = createContext<AppCtxValue>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
  go: () => {},
})

// eslint-disable-next-line react-refresh/only-export-components
export const useApp = () => useContext(AppCtx)

export default function App() {
  const [view, setView] = useState<View>({ name: 'home' })
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    void loadSettings().then(setSettings)
  }, [])

  const updateSettings = useCallback((p: Partial<AppSettings>) => {
    setSettings((s) => ({ ...s, ...p }))
    void saveSettings(p)
  }, [])

  const ctx = useMemo<AppCtxValue>(
    () => ({ settings, updateSettings, go: setView }),
    [settings, updateSettings],
  )

  return (
    <AppCtx.Provider value={ctx}>
      {view.name === 'home' && <HomePage />}
      {view.name === 'record' && <RecordPage gameId={view.gameId} />}
      {view.name === 'games' && <GamesPage intent={view.intent} />}
      {view.name === 'replay' && <ReplayPage gameId={view.gameId} autoAnalyze={view.analyze} />}
      {view.name === 'endgame' && <EndgamePage />}
      {view.name === 'settings' && <SettingsPage />}
    </AppCtx.Provider>
  )
}
