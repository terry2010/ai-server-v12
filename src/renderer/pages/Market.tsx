import { useEffect } from 'react'
import { useTheme } from '@/hooks/useTheme'

export function MarketPage() {
  const [theme] = useTheme()

  useEffect(() => {
    let cancelled = false

    const open = async () => {
      try {
        const mode = theme === 'light' || theme === 'dark' ? theme : 'dark'
        const result = await window.api.openSiteView('market', mode)
        if (!result || !result.success) {
          if (!cancelled) {
            window.alert(result?.error ?? '打开 AI 市场页面失败，请检查网站是否已启动。')
          }
        }
      } catch {
        if (!cancelled) {
          window.alert('打开 AI 市场页面失败，请检查网站是否已启动。')
        }
      }
    }

    open()

    return () => {
      cancelled = true
      try {
        window.api.closeSiteView().catch(() => {})
      } catch {
        // ignore
      }
    }
  }, [theme])

  return null
}
