import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import commonEn from './locales/en/common.json'
import commonZh from './locales/zh/common.json'
import dashboardEn from './locales/en/dashboard.json'
import dashboardZh from './locales/zh/dashboard.json'
import settingsEn from './locales/en/settings.json'
import settingsZh from './locales/zh/settings.json'
import logsEn from './locales/en/logs.json'
import logsZh from './locales/zh/logs.json'
import browserAgentEn from './locales/en/browserAgent.json'
import browserAgentZh from './locales/zh/browserAgent.json'
import monitoringEn from './locales/en/monitoring.json'
import monitoringZh from './locales/zh/monitoring.json'

export type SupportedLanguage = 'zh' | 'en'

export function resolveSystemLanguage(): SupportedLanguage {
  const lang = (navigator.language || '').toLowerCase()
  if (lang.startsWith('zh')) return 'zh'
  return 'en'
}

const resources = {
  en: {
    common: commonEn,
    dashboard: dashboardEn,
    settings: settingsEn,
    logs: logsEn,
    browserAgent: browserAgentEn,
    monitoring: monitoringEn,
  },
  zh: {
    common: commonZh,
    dashboard: dashboardZh,
    settings: settingsZh,
    logs: logsZh,
    browserAgent: browserAgentZh,
    monitoring: monitoringZh,
  },
}

const detector = new LanguageDetector()
detector.addDetector({
  name: 'appSettingsDetector',
  lookup(_options?: any): string | string[] | undefined {
    // 由 renderer 在初始化前同步设置 localStorage 中的 `ai-server-language`，作为优先来源
    const stored = localStorage.getItem('ai-server-language')
    if (stored === 'zh' || stored === 'en') return stored
    if (stored === 'auto') return resolveSystemLanguage()
    return undefined
  },
})

i18n
  .use(detector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['zh', 'en'],
    ns: ['common', 'dashboard', 'settings', 'logs', 'browserAgent', 'monitoring'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['appSettingsDetector', 'navigator'],
    },
  })

export default i18n
