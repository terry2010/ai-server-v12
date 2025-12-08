import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import App from './App'
import './index.css'
import i18n, { resolveSystemLanguage } from './i18n'

async function ensureLanguageFromSettings() {
  let nextLang: 'zh' | 'en' = resolveSystemLanguage()
  try {
    const settings = await window.api.getSettings()
    const lang = settings?.language
    if (lang === 'zh' || lang === 'en') {
      nextLang = lang
      localStorage.setItem('ai-server-language', lang)
    } else if (lang === 'auto') {
      nextLang = resolveSystemLanguage()
      localStorage.setItem('ai-server-language', 'auto')
    }
  } catch {
    // ignore, fallback to system
  }

  try {
    await i18n.changeLanguage(nextLang)
  } catch {
    // ignore
  }
}

async function bootstrap() {
  await ensureLanguageFromSettings()
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <HashRouter>
          <App />
        </HashRouter>
      </I18nextProvider>
    </React.StrictMode>,
  )
}

bootstrap()
