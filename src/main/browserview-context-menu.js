import { app, BrowserWindow, Menu } from 'electron'
import { defaultAppSettings, getAppSettings } from './app-settings.js'

/**
 * @typedef {'zh' | 'en'} UiLanguage
 */

/** @type {{ [K in UiLanguage]: { backToModules: string; undo: string; redo: string; cut: string; copy: string; paste: string; selectAll: string; forward: string; back: string; reload: string; print: string } }} */
const MENU_LABELS = {
  zh: {
    backToModules: '返回模块列表',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    forward: '前进',
    back: '后退',
    reload: '刷新',
    print: '打印',
  },
  en: {
    backToModules: 'Back to modules',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select all',
    forward: 'Forward',
    back: 'Back',
    reload: 'Reload',
    print: 'Print',
  },
}

/**
 * 根据系统 locale 推断默认语言（仅区分中/英）。
 * @returns {UiLanguage}
 */
function resolveSystemLanguageForMenu() {
  try {
    const locale = (app.getLocale && app.getLocale()) || ''
    const lower = String(locale).toLowerCase()
    if (lower.startsWith('zh')) return 'zh'
  } catch {}
  return 'en'
}

/**
 * 依据 AppSettings.language（auto/zh/en）和系统语言，确定当前 UI 语言。
 * @returns {UiLanguage}
 */
function getCurrentMenuLanguage() {
  try {
    const settings = (typeof getAppSettings === 'function' && getAppSettings()) || defaultAppSettings
    const lang = settings && settings.language
    if (lang === 'zh' || lang === 'en') return lang
  } catch {}
  return resolveSystemLanguageForMenu()
}

/**
 * 为 BrowserView / WebContents 附加通用右键菜单。
 * 该函数只依赖 electron，自身与具体业务解耦，方便在其他项目中复用。
 *
 * @param {object} options
 * @param {import('electron').WebContents} options.webContents - 目标 WebContents
 * @param {() => void} [options.onBackToModules] - 点击「返回首页」时的回调
 * @param {() => string} [options.getBackLabel] - 可选：动态生成“返回 xxx 首页”的文案
 * @returns {() => void} dispose 函数，用于移除事件监听
 */
export function attachBrowserViewContextMenu(options) {
  const wc = options && options.webContents
  const onBackToModules = options && typeof options.onBackToModules === 'function' ? options.onBackToModules : null
  const getBackLabel = options && typeof options.getBackLabel === 'function' ? options.getBackLabel : null

  if (!wc || typeof wc.on !== 'function') {
    return () => {}
  }

  const handleContextMenu = (_event, params) => {
    try {
      if (!params) return

      const isEditable = !!params.isEditable
      const selectionText = typeof params.selectionText === 'string' ? params.selectionText : ''
      const hasSelection = selectionText.trim().length > 0
      const editFlags = params.editFlags || {}

      const lang = getCurrentMenuLanguage()
      const labels = MENU_LABELS[lang] || MENU_LABELS.en

      /** @type {import('electron').MenuItemConstructorOptions[]} */
      const template = []

      // 通用：返回首页（可根据系统名称自定义文案）
      if (onBackToModules) {
        let backLabel = labels.backToModules
        try {
          if (getBackLabel) {
            const custom = getBackLabel()
            if (typeof custom === 'string' && custom.trim()) {
              const name = custom.trim()
              backLabel = lang === 'zh' ? `返回${name}首页` : `Back to ${name} home`
            }
          }
        } catch {}

        template.push({
          label: backLabel,
          click: () => {
            try {
              onBackToModules()
            } catch {}
          },
        })
        template.push({ type: 'separator' })
      }

      if (isEditable) {
        // 输入框场景（包括 textarea / input / contentEditable）
        template.push(
          {
            label: labels.undo,
            enabled: !!editFlags.canUndo,
            click: () => {
              try {
                wc.undo()
              } catch {}
            },
          },
          {
            label: labels.redo,
            enabled: !!editFlags.canRedo,
            click: () => {
              try {
                wc.redo()
              } catch {}
            },
          },
          { type: 'separator' },
          {
            label: labels.cut,
            enabled: !!editFlags.canCut,
            click: () => {
              try {
                wc.cut()
              } catch {}
            },
          },
          {
            label: labels.copy,
            enabled: !!editFlags.canCopy,
            click: () => {
              try {
                wc.copy()
              } catch {}
            },
          },
          {
            label: labels.paste,
            enabled: !!editFlags.canPaste,
            click: () => {
              try {
                wc.paste()
              } catch {}
            },
          },
          {
            label: labels.selectAll,
            enabled: !!editFlags.canSelectAll,
            click: () => {
              try {
                wc.selectAll()
              } catch {}
            },
          },
        )
      } else if (hasSelection) {
        // 普通页面文字被选中时：只提供复制
        template.push({
          label: labels.copy,
          click: () => {
            try {
              wc.copy()
            } catch {}
          },
        })
      } else {
        // 普通页面无选中：导航 + 全选 / 打印
        template.push(
          {
            label: labels.forward,
            enabled: wc.canGoForward(),
            click: () => {
              try {
                if (wc.canGoForward()) wc.goForward()
              } catch {}
            },
          },
          {
            label: labels.back,
            enabled: wc.canGoBack(),
            click: () => {
              try {
                if (wc.canGoBack()) wc.goBack()
              } catch {}
            },
          },
          {
            label: labels.reload,
            click: () => {
              try {
                wc.reload()
              } catch {}
            },
          },
          { type: 'separator' },
          {
            label: labels.selectAll,
            click: () => {
              try {
                wc.selectAll()
              } catch {}
            },
          },
          {
            label: labels.print,
            click: () => {
              try {
                wc.print({})
              } catch {}
            },
          },
        )
      }

      if (!template.length) return

      const menu = Menu.buildFromTemplate(template)
      const win = BrowserWindow.fromWebContents(wc) || undefined

      menu.popup({ window: win })
    } catch {
      // 忽略单次右键菜单错误，避免影响页面正常使用
    }
  }

  wc.on('context-menu', handleContextMenu)

  return () => {
    try {
      wc.removeListener('context-menu', handleContextMenu)
    } catch {}
  }
}
