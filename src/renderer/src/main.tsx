import './assets/globals.css'
import './i18n' // Import i18n configuration
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { router } from './router'
import { useAuthStore, useRepoStore, useSettingsStore, useDockerStore } from './store'
import { electron } from './lib/electron'
import i18n from './i18n'

async function bootstrap(): Promise<void> {
  const { setUser, setLoading } = useAuthStore.getState()
  const { setRepos } = useRepoStore.getState()
  const { setSettings } = useSettingsStore.getState()
  const { setStatus } = useDockerStore.getState()

  try {
    const user = await electron.auth.getUser()
    setUser(user)

    if (user) {
      // Load all data in parallel
      const [repos, settings, dockerStatus] = await Promise.all([
        electron.repos.list(),
        electron.settings.get(),
        electron.docker.status()
      ])
      setRepos(repos)
      setSettings(settings)
      setStatus(dockerStatus)

      // Sync i18n language with saved settings
      if (settings.language) {
        i18n.changeLanguage(settings.language)
      }
    } else {
      // Not logged in — go to login page
      router.navigate('/login', { replace: true })
    }
  } catch (err) {
    console.error('[Bootstrap] Error:', err)
    router.navigate('/login', { replace: true })
  } finally {
    setLoading(false)
  }
}

// Start bootstrap concurrently with render
bootstrap().catch(console.error)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
