# AI-Server-v12 阶段 6：BrowserView 集成设计

> 目标：在主窗口中为各模块（n8n / Dify / OneAPI / RagFlow）提供嵌入式 Web 管理界面，支持多模块间快速切换，并保持各自的浏览状态，增强一体化运维体验。

---

## 1. 场景与总体体验

### 1.1 模块模式（Module Mode）

- 当路由为下列之一时，进入「模块模式」：
  - `/n8n`
  - `/dify`
  - `/oneapi`
  - `/ragflow`
- 模块模式下：
  - **顶部整条 Header 保持现有布局**，分为四个功能区：
    1. 软件 Logo + 系统名称 + 首页入口；
    2. 模块标签区（支持折叠/展开、拖拽排序）；
    3. 当前模块功能区（首页 / 刷新 / 后退 / 前进 / 模块 CPU&内存 / 预留信息）；
    4. 右侧用户与设置区域。
  - **左侧导航隐藏**。
  - Header 之下的整个下半屏区域由 Electron **BrowserView 完全覆盖**，用于渲染模块自身的 Web UI。

- 退出模块模式（路由切换到 `/`、`/logs`、`/settings`、`/monitoring` 等）时：
  - 从主窗口 detach 所有 BrowserView；
  - 恢复左侧导航和中间 React 页面内容。

### 1.2 多模块 Tab 体验（类似浏览器多标签）

- 用户可能同时启用了多个模块（n8n + OneAPI + Dify + RagFlow），并在各模块内进行一系列操作。
- 设计目标：
  - 不同模块之间切换时，**恢复到该模块上次离开时的页面和状态**，尽量接近浏览器多 Tab 的体验；
  - 避免频繁销毁 Web 容器导致的重复加载和登录。

实现策略见「2. BrowserView 管理与生命周期」。

---

## 2. BrowserView 管理与生命周期

### 2.1 多 BrowserView 管理模型

- 采用「**每个模块一个 BrowserView**」的模型（最多 4 个 BrowserView）：

  ```ts
  type ModuleId = 'n8n' | 'dify' | 'oneapi' | 'ragflow'

  interface ModuleViewEntry {
    moduleId: ModuleId
    view: BrowserView
    lastActiveAt: number // 最近一次激活时间（Unix ms）
  }

  const moduleViews: Partial<Record<ModuleId, ModuleViewEntry>> = {}
  let currentModuleId: ModuleId | null = null
  ```

- 行为：
  - 第一次进入某模块（例如 `/n8n`）时：
    - 若无对应 BrowserView：创建一个新的 BrowserView，加载该模块的首页 URL；
    - attach 到主窗口（`mainWindow.addBrowserView(view)`）；
    - 记录 `currentModuleId = 'n8n'`，更新 `lastActiveAt`。
  - 再次进入该模块：
    - 复用已有 BrowserView（不重新创建、不清空 history），仅重新 attach；
    - 不主动改变当前 URL，使模块保持上次浏览的页面。
  - 在不同模块之间切换：
    - detach 当前 BrowserView；
    - attach 目标模块对应的 BrowserView；
    - 这样每个模块拥有独立的 WebContents、history 和运行状态。

### 2.2 布局与 Resize 行为

- BrowserView 的 Bounds：
  - `x = 0`；
  - `y = headerHeight`（约 56 px，具体以实际 CSS 确认后写成常量）；
  - `width = mainWindow.innerWidth`；
  - `height = mainWindow.innerHeight - headerHeight`。
- 在 `BrowserWindow` 的 `resize` 事件里：

  ```ts
  function updateBrowserViewBounds() {
    if (!currentModuleId) return
    const entry = moduleViews[currentModuleId]
    if (!entry) return

    const [width, height] = mainWindow.getContentSize()
    entry.view.setBounds({ x: 0, y: HEADER_HEIGHT, width, height: height - HEADER_HEIGHT })
  }
  ```

### 2.3 模块首页 URL 与导航

- 每个模块的默认首页 URL：
  - n8n：`http://localhost:<n8nPort>/`
  - Dify：`http://localhost:<difyPort>/`
  - OneAPI：`http://localhost:<oneapiPort>/`
  - RagFlow：`http://localhost:<ragflowPort>/`
- 端口来源：
  - 从现有的 runtime 逻辑和 `modules:list` 返回的 `ModuleInfo.port` 推导。
  - 若端口获取失败，使用占位错误页（见 2.5）。

- 「模块首页」动作：
  - 对当前模块 BrowserView 调用 `loadURL(homeUrl)`，并将当前 URL 视为「首页」。

### 2.4 销毁策略（内存控制 + 调试设置）

- 需求：
  - 某模块停止运行一段时间后，自动销毁对应 BrowserView 以释放内存；
  - 时间阈值（分钟）由用户在「系统设置 → 调试设置」中配置。

- 设置项：
  - 在 `AppSettings['debug']` 中新增字段：

    ```ts
    export interface DebugSettings {
      showDebugTools: boolean
      verboseLogging: boolean
      showSystemNameSetting: boolean
      browserViewIdleDestroyMinutes: number // 默认 1 分钟
    }
    ```

  - 在 Settings → DebugSettings 页面增加一个数值输入控件：
    - 标签示例：「模块 BrowserView 空闲销毁时间（分钟）」；
    - 默认值：1；
    - 取值范围：1 ~ 60（可配置）。

- 销毁逻辑：
  - 主进程维护一个定时器（例如每 30 秒检查一次）：

    ```ts
    function gcModuleViews() {
      const now = Date.now()
      const maxIdleMs = appSettings.debug.browserViewIdleDestroyMinutes * 60_000

      for (const [moduleId, entry] of Object.entries(moduleViews)) {
        if (!entry) continue

        const isCurrent = moduleId === currentModuleId
        if (isCurrent) continue

        const idleMs = now - entry.lastActiveAt
        if (idleMs < maxIdleMs) continue

        // 检查模块容器状态，如模块已经停止可更积极销毁
        // （可选：仅在模块 Docker 状态非 running 时销毁）

        mainWindow.removeBrowserView(entry.view)
        entry.view.destroy()
        delete moduleViews[moduleId as ModuleId]
      }
    }
    ```

  - 当用户在 Debug 设置中修改 `browserViewIdleDestroyMinutes` 时，立即生效。

- 注意：
  - 当前激活模块的 BrowserView 不会被 GC 线程销毁。
  - 被销毁的模块 BrowserView 下次再进入时会重新创建并加载首页 URL，浏览状态不再保留。

### 2.5 导航失败与自定义错误页

- 在为某模块 BrowserView 调用 `loadURL` 时，监听：
  - `did-fail-load` 事件；
  - 可选：设置超时（如 15 秒内未完成首屏加载则视为失败）。

- 导航失败时：
  - 记录错误信息（错误码、错误描述、URL 等）用于日志；
  - BrowserView 内部加载一个本地错误页，以统一风格提示：
    - 路径示例：`file://.../browserview-error.html?moduleId=n8n&code=...`；
    - 或使用 `loadURL('data:text/html,...')` 注入内联 HTML。

- 错误页视觉与文案建议：
  - 大图标 + 标题，例如：`n8n 模块无法访问`；
  - 说明：如「可能原因：模块未启动、端口未映射或网络错误」；
  - 操作按钮：
    - 「重试加载」：调用 `home` 动作重新尝试加载模块首页；
    - 「在首页检查模块状态」：提示用户回到 Dashboard 查看模块运行状态（该动作由顶部或侧边导航完成，不在错误页内直接跳转）。

---

## 3. 顶部 Header 行为设计

### 3.1 功能区划分

1. **功能区 1：软件 Logo + 系统名称 + 首页**
   - 保持现有样式和内容：
     - 左侧 Logo 圆块 + 绿色状态灯；
     - 右侧系统名称 `systemName` + 副标题「AI 服务管理平台」。
   - 点击「首页」或 Dashboard Tab：
     - `navigate('/')`；
     - 通过 IPC 调用 `browserView:close`（detach 当前 BrowserView）。

2. **功能区 2：模块标签区（折叠/展开 + 过滤 + 拖拽）**

   - 数据来源：
     - `window.api.listModules()`，得到 `ModuleInfo[]`。
   - 过滤规则：
     - 仅显示 `status === 'running'` 的模块；
     - `stopped` / `error` 状态的模块标签不显示。
   - 顺序规则：
     - 初次渲染按固定顺序：`n8n → Dify → OneAPI → RagFlow`；
     - 用户可在当前会话内通过拖拽调整顺序；
     - **拖拽结果不持久化到 AppSettings**，仅影响当前运行会话；
     - Dashboard 卡片顺序保持不变，不与顶部标签顺序联动。

   - 折叠/展开行为（仅在模块模式下）：
     - 默认折叠：
       - 仅显示当前模块一个标签（样式与激活态相同，带 `StatusDot`）。
     - 鼠标悬停在模块标签区时：
       - 展开为完整模块标签栏：
         - 渲染经过滤+排序后的所有模块标签；
         - 支持拖拽重排；
         - 点击标签：
           - `navigate('/<module>')`；
           - 调用 `window.api.openModuleView(moduleId)` 切换 BrowserView；
       - 同时隐藏功能区 3（当前模块功能条）。
     - 鼠标移出标签区域时：
       - 折叠回仅显示当前模块标签；
       - 恢复显示功能区 3。

3. **功能区 3：当前模块功能区（只在模块模式生效）**

   - 仅在「模块模式」**且模块标签区未展开**时显示。
   - 从左到右：
     1. 【模块首页】
        - 调用：`window.api.controlModuleView(moduleId, 'home')`；
        - 主进程：对当前模块 BrowserView 执行 `loadURL(homeUrl)`。
     2. 【刷新】
        - 调用：`window.api.controlModuleView(moduleId, 'reload')` → `webContents.reload()`。
     3. 【后退】
        - 调用：`window.api.controlModuleView(moduleId, 'back')` → `goBack()`；
        - 第一版允许始终可点击，后续可接入 `canGoBack` 状态做 disabled 处理。
     4. 【前进】
        - 类似后退，调用 `goForward()`。
     5. 【模块 CPU / 内存 数据】
        - 利用已实现的 `monitor:getModules`：
          - 前端每 5 秒执行 `window.api.getModuleMetrics()`；
          - 找到当前 `moduleId` 的 `ModuleRuntimeMetrics`；
          - 显示为：`CPU xx% · 内存 yy%`。
        - 若指标不可用：显示 `CPU — · 内存 —`。
     6. 【预留信息区】
        - 文案占位：`xx 条任务运行中`；
        - 后续可针对不同模块替换为真实业务指标（例如 n8n 工作流队列长度）。

4. **功能区 4：右侧用户与设置**

   - 保持现有实现：
     - 主题切换（Sun / Moon 图标）；
     - 进入系统设置的按钮；
     - 用户头像与「本地工作区」文案。

---

## 4. IPC 与 window.api 设计

### 4.1 主进程 IPC 通道

在 `ipc-handlers.js` 中新增：

1. `browserView:openModule`

   - 请求：

     ```ts
     interface OpenModulePayload {
       moduleId: ModuleId
     }
     ```

   - 行为：
     - 若 `moduleViews[moduleId]` 不存在：创建 BrowserView，并加载首页 URL；
     - detach 当前 `currentModuleId` 的 BrowserView（如有）；
     - attach 目标模块 BrowserView 到主窗口；
     - 更新 `currentModuleId` 与 `lastActiveAt`；
     - 调整 Bounds 与窗口大小；
     - 返回：`{ success: boolean; error?: string }`。

2. `browserView:close`

   - 请求：无；
   - 行为：
     - 若存在 `currentModuleId`，detach 其 BrowserView；
     - 不销毁 BrowserView 本身，仅移除与主窗口的关联；
     - `currentModuleId = null`；
     - 返回 `{ success: true }`。

3. `browserView:control`

   - 请求：

     ```ts
     interface ControlModuleViewPayload {
       moduleId: ModuleId
       action: 'home' | 'reload' | 'back' | 'forward'
     }
     ```

   - 行为：
     - 找到 `moduleViews[moduleId]`；若不存在，返回错误；
     - 仅当 `moduleId === currentModuleId` 时执行导航操作；
     - 根据 `action`：
       - `home`：`loadURL(homeUrl)`；
       - `reload`：`webContents.reload()`；
       - `back`：`goBack()`；
       - `forward`：`goForward()`；
     - 导航失败时返回 `{ success: false, error: '...' }`。

4. （可选）`browserView:getState`

   - 请求：`{ moduleId: ModuleId }`；
   - 返回：

     ```ts
     interface ModuleViewState {
       canGoBack: boolean
       canGoForward: boolean
       url?: string
     }
     ```

   - 用于前端控制「后退/前进」按钮的禁用状态；MVP 可以先不实现。

### 4.2 preload / window.api 扩展

#### WindowApi 扩展接口

在 `src/shared/window-api.ts` 中新增：

```ts
export interface WindowApi {
  // ... 现有方法

  openModuleView(moduleId: ModuleId): Promise<{ success: boolean; error?: string }>
  closeModuleView(): Promise<{ success: boolean; error?: string }>
  controlModuleView(
    moduleId: ModuleId,
    action: 'home' | 'reload' | 'back' | 'forward',
  ): Promise<{ success: boolean; error?: string }>
  // 可选
  // getModuleViewState(moduleId: ModuleId): Promise<{
  //   canGoBack: boolean
  //   canGoForward: boolean
  //   url?: string
  // }>
}
```

#### preload 实现

在 `src/preload/preload.js` 中：

```js
const api = {
  // ... 现有方法

  openModuleView: (moduleId) =>
    ipcRenderer.invoke('browserView:openModule', { moduleId }),

  closeModuleView: () => ipcRenderer.invoke('browserView:close', {}),

  controlModuleView: (moduleId, action) =>
    ipcRenderer.invoke('browserView:control', { moduleId, action }),
}
```

---

## 5. renderer（React）侧改造要点

### 5.1 AppLayout 顶部与布局

- 根据 `location.pathname` 判断是否处于模块模式：

  ```ts
  const isModuleRoute = ['/n8n', '/dify', '/oneapi', '/ragflow'].some((base) =>
    location.pathname.startsWith(base),
  )
  ```

- 模块模式下：
  - 隐藏左侧导航 `<aside>`；
  - 顶部导航按本设计中的四个功能区布局；
  - 主内容区域 `<main>` 不再渲染模块占位卡片，而是仅作为 BrowserView 的背景（可保留轻量占位以防 Debug）。

### 5.2 模块路由组件

- 为 `/n8n`、`/dify`、`/oneapi`、`/ragflow` 分别提供对应的 React 页面组件（可沿用/改造 `ModulePlaceholder`）。
- 通用行为：

  ```ts
  useEffect(() => {
    let cancelled = false

    const open = async () => {
      const result = await window.api.openModuleView(moduleId)
      if (!result || !result.success && !cancelled) {
        // TODO: 可在顶部显示 toast
      }
    }

    open()

    return () => {
      cancelled = true
      // 不在这里 close，以便切换到其他模块时仍保留 BrowserView 状态
      // 仅在完全离开所有模块路由时，由上层统一调用 closeModuleView
    }
  }, [moduleId])
  ```

- 判断「完全离开模块模式」的逻辑可以放在 AppLayout 中：
  - 当从模块路由跳到非模块路由时，调用 `window.api.closeModuleView()`。

### 5.3 顶部模块标签拖拽

- 仅影响当前运行会话中的顺序，不写回到 AppSettings。
- 实现可选方案：
  - 使用简单的 `onMouseDown` + `onMouseMove` + `onMouseUp` 处理；
  - 或引入轻量级拖拽库（如 `@dnd-kit`），视复杂度而定。

---

## 6. 后续扩展点（非 MVP）

- 为各模块提供更丰富的「预留信息区」内容：
  - n8n：正在运行的工作流数量、最近任务耗时；
  - Dify：活跃会话数、最近 QPS；
  - OneAPI：当前 token 消耗速率、请求错误率；
  - RagFlow：队列中文档数、索引构建状态等。
- 支持在错误页中直接提供「启动模块」按钮（通过 IPC 调用 `modules:start`），并在 UI 上提示风险与状态变化。
- 将 BrowserView 的状态（例如当前 URL）与日志系统结合，以便于问题排查。
