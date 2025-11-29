import { useEffect } from 'react'

export function N8nModulePage() {
  useEffect(() => {
    let cancelled = false

    const open = async () => {
      try {
        const result = await window.api.openModuleView('n8n')
        if (!result || !result.success) {
          if (!cancelled) {
            window.alert(result?.error ?? '打开 n8n 模块页面失败，请检查模块是否已启动。')
          }
        }
      } catch {
        if (!cancelled) {
          window.alert('打开 n8n 模块页面失败，请检查模块是否已启动。')
        }
      }
    }

    open()

    return () => {
      cancelled = true
      try {
        window.api.closeModuleView().catch(() => {})
      } catch {
        // ignore
      }
    }
  }, [])

  return null
}
