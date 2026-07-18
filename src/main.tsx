import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { pwaUpdateController } from './pwa/updateController'
import { parseAppVersionManifest } from './pwa/versionManifest'
import './styles.css'

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh: () => {
    void pwaUpdateController.announceUpdate()
  },
  onRegisterError: (error) => {
    console.warn('Service Worker 註冊失敗，App 仍可連線使用。', error)
  },
})

pwaUpdateController.setUpdateServiceWorker(updateServiceWorker)

if (import.meta.env.DEV) {
  const previewVersion = new URL(window.location.href).searchParams.get('pwa-update-preview')
  const previewManifest = parseAppVersionManifest({ version: previewVersion })
  if (previewManifest) {
    pwaUpdateController.setUpdateServiceWorker(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 450))
      throw new Error('這是開發模式的更新失敗預覽')
    })
    void pwaUpdateController.announceUpdate(async () => previewManifest.version)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
