# AI-Server-v12 通用右键菜单使用说明

> 版本：v0.1（草案）  
> 适用范围：AI-Server-v12 客户端主窗口 + 各模块 BrowserView 页面

---

## 1. 设计目标

- 为 **客户端自身页面（Dashboard、设置等）** 和 **各模块 BrowserView 页面** 提供统一的原生右键菜单：
  - 支持返回模块列表 / 导航（前进、后退、刷新）；
  - 支持常见编辑操作（撤销、重做、剪切、复制、粘贴、全选）；
  - 支持打印；
- 将右键菜单逻辑抽象为 **可复用的小模块**，方便在其他 Electron 项目中复制使用。

---

## 2. 核心模块与 API

### 2.1 文件位置

- 通用右键菜单模块：
  - `src/main/browserview-context-menu.js`

### 2.2 导出函数

```js
import { attachBrowserViewContextMenu } from './browserview-context-menu.js'
```

#### `attachBrowserViewContextMenu(options)`

- 入参 `options`：
  - `webContents: WebContents`  
    需要挂载右键菜单的目标 `WebContents` 实例，可来自：
    - `browserWindow.webContents`
    - `browserView.webContents`
  - `onBackToModules?: () => void`  
    可选回调，用于点击「返回模块列表」时触发自定义导航逻辑。

- 返回值：
  - `dispose: () => void`  
    移除右键菜单监听的函数，通常在销毁对应 `BrowserView` 或 `BrowserWindow` 时调用。

---

## 3. 菜单行为规则

右键菜单会根据 `WebContents` 提供的 `params` 自动区分 4 种场景：

1. **非输入框，未选中文字**
   - 菜单：
     - 返回模块列表
     - 分隔线
     - 前进
     - 后退
     - 刷新
     - 分隔线
     - 全选
     - 打印

2. **非输入框，选中了文字**
   - 菜单：
     - 返回模块列表
     - 分隔线
     - 复制

3. **输入框 / 可编辑区域，未选中文字**
   - 依据 `params.isEditable === true`，并使用 `editFlags` 控制可用状态。
   - 菜单：
     - 返回模块列表
     - 分隔线
     - 撤销（根据 `editFlags.canUndo` 启用/禁用）
     - 重做（根据 `editFlags.canRedo` 启用/禁用）
     - 分隔线
     - 剪切（根据 `editFlags.canCut`，无选中文字时通常为禁用）
     - 复制（根据 `editFlags.canCopy`，无选中文字时通常为禁用）
     - 粘贴（根据 `editFlags.canPaste`）
     - 全选（根据 `editFlags.canSelectAll`）

4. **输入框 / 可编辑区域，选中文字**
   - 菜单结构同上，但 `canCut` / `canCopy` 通常为 `true`，剪切与复制为可用态。

所有菜单行为最终通过 `webContents` 提供的 API 实现，例如：

- 导航：`goBack()` / `goForward()` / `reload()`
- 编辑：`undo()` / `redo()` / `cut()` / `copy()` / `paste()` / `selectAll()`
- 打印：`print()`

---

## 4. 在本项目中的集成方式

### 4.1 BrowserView 模块页面

集成文件：`src/main/browserview-manager.js`

- 在创建每个模块的 `BrowserView` 时：

```js
const view = new BrowserView({ webPreferences: { nodeIntegration: false, contextIsolation: true } })
entry = { moduleId, view, lastActiveAt: Date.now(), contextMenuDispose: null }
moduleViews[moduleId] = entry

entry.contextMenuDispose = attachBrowserViewContextMenu({
  webContents: view.webContents,
  onBackToModules: () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('browserView:backToModules')
    }
  },
})
```

- 在 BrowserView 被 GC 或销毁时：

```js
if (typeof entry.contextMenuDispose === 'function') {
  entry.contextMenuDispose()
}
entry.view.destroy()
```

- 这样，所有模块页面（n8n / OneAPI / Dify / RagFlow）的 BrowserView 内部，都使用同一套右键菜单逻辑。

### 4.2 客户端主窗口（React 所有页面）

集成文件：`src/main/main.js`

- 在创建主窗口 `BrowserWindow` 时，为其 `webContents` 附加右键菜单：

```js
mainWindow = new BrowserWindow({
  // ... 其他配置
})

mainWindowContextMenuDispose = attachBrowserViewContextMenu({
  webContents: mainWindow.webContents,
  onBackToModules: () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('browserView:backToModules')
    }
  },
})
```

- 在主窗口关闭时调用 `dispose`：

```js
mainWindow.on('closed', () => {
  if (typeof mainWindowContextMenuDispose === 'function') {
    mainWindowContextMenuDispose()
  }
  mainWindowContextMenuDispose = null
  mainWindow = null
})
```

这样，**Dashboard、设置页、日志页等所有 React 页面** 也会自动使用同一套右键菜单行为。

### 4.3 “返回模块列表” 的事件链

- 在主进程（BrowserView + 主窗口）中：
  - 右键菜单点击「返回模块列表」时，统一执行：

    ```js
    mainWindow.webContents.send('browserView:backToModules')
    ```

- 在 `preload`：`src/preload/preload.js`

  - 监听主进程消息，并在窗口内派发自定义事件：

    ```js
    ipcRenderer.on('browserView:backToModules', () => {
      window.dispatchEvent(new Event('browserViewBackToModules'))
    })
    ```

- 在前端布局：`src/renderer/layouts/AppLayout.tsx`

  - 监听自定义事件并导航回首页（模块列表）：

    ```ts
    useEffect(() => {
      const handler = () => {
        navigate('/')
      }

      window.addEventListener('browserViewBackToModules', handler as EventListener)
      return () => window.removeEventListener('browserViewBackToModules', handler as EventListener)
    }, [navigate])
    ```

> 效果：无论用户在 **模块 BrowserView 页面内部** 还是在 **客户端自身的 React 页面** 内，点击右键菜单中的「返回模块列表」，都会统一跳转回 Dashboard 首页。

---

## 5. 在其他项目中的复用方式

若需要在其他 Electron 项目中使用同样的右键菜单逻辑，只需：

1. 复制文件：
   - `src/main/browserview-context-menu.js`

2. 在 main 进程中，对需要右键菜单的 `BrowserWindow` / `BrowserView`：

   ```js
   import { attachBrowserViewContextMenu } from './browserview-context-menu.js'

   const dispose = attachBrowserViewContextMenu({
     webContents: someWebContents,
     onBackToModules: () => {
       // 可选：实现自己的“返回某个首页/列表”逻辑
     },
   })
   ```

3. 在窗口销毁或视图销毁时调用 `dispose()`，清理事件监听。

如需自定义菜单项（例如增加“检查元素”等），可以在复制出的模块基础上修改菜单模板，但建议保持 4 种基础场景的结构不变，以便行为一致。
