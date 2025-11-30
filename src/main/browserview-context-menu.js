import { BrowserWindow, Menu } from 'electron'

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

      /** @type {import('electron').MenuItemConstructorOptions[]} */
      const template = []

      // 通用：返回首页（可根据系统名称自定义文案）
      if (onBackToModules) {
        let backLabel = '返回模块列表'
        try {
          if (getBackLabel) {
            const custom = getBackLabel()
            if (typeof custom === 'string' && custom.trim()) {
              backLabel = custom.trim()
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
            label: '撤销',
            enabled: !!editFlags.canUndo,
            click: () => {
              try {
                wc.undo()
              } catch {}
            },
          },
          {
            label: '重做',
            enabled: !!editFlags.canRedo,
            click: () => {
              try {
                wc.redo()
              } catch {}
            },
          },
          { type: 'separator' },
          {
            label: '剪切',
            enabled: !!editFlags.canCut,
            click: () => {
              try {
                wc.cut()
              } catch {}
            },
          },
          {
            label: '复制',
            enabled: !!editFlags.canCopy,
            click: () => {
              try {
                wc.copy()
              } catch {}
            },
          },
          {
            label: '粘贴',
            enabled: !!editFlags.canPaste,
            click: () => {
              try {
                wc.paste()
              } catch {}
            },
          },
          {
            label: '全选',
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
          label: '复制',
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
            label: '前进',
            enabled: wc.canGoForward(),
            click: () => {
              try {
                if (wc.canGoForward()) wc.goForward()
              } catch {}
            },
          },
          {
            label: '后退',
            enabled: wc.canGoBack(),
            click: () => {
              try {
                if (wc.canGoBack()) wc.goBack()
              } catch {}
            },
          },
          {
            label: '刷新',
            click: () => {
              try {
                wc.reload()
              } catch {}
            },
          },
          { type: 'separator' },
          {
            label: '全选',
            click: () => {
              try {
                wc.selectAll()
              } catch {}
            },
          },
          {
            label: '打印',
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
