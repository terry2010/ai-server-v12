# AI-Server-v12 阶段 0 结论：v12 UI 与架构规划

> 本文档记录「阶段 0：理解 v12 UI 与设计架构」的结论，用于后续阶段开发与评审时复核。
>
> 时间：2025-11-26

---

## 一、v12 UI 现状概览

### 1. 路由与页面结构

当前 `ui-ai-server-v12` 是一个纯前端 Demo 项目，技术栈为 React + TypeScript + Vite + Tailwind + shadcn/ui，结构清晰：

- **入口层**
  - `src/main.tsx`：`ReactDOM.createRoot` + `BrowserRouter + <App />`。
  - `src/App.tsx`：使用 `react-router-dom` 的 `<Routes>` 定义 SPA 路由，全部包裹在 `AppLayout` 下。

- **主布局**（`src/layouts/AppLayout.tsx`）
  - 顶部 TopBar：
    - 左：Logo + 标题（AI-Server / AI 服务管理平台）。
    - 中：模块 Tab（首页、n8n、Dify、OneAPI、RagFlow），带 `StatusDot` 显示状态。
    - 右：主题切换按钮（深/浅色）、“全局设置”按钮（跳到 `/settings`）、用户信息卡片（Avatar + 文案）。
  - 左侧 SideNav（桌面端）：
    - 菜单项：仪表盘（`/`）、在线教程（`/tutorial`）、AI 市场（`/market`）、系统设置（`/settings`）、系统日志（`/logs`）、性能监控（`/monitoring`）。
  - 移动端：
    - 顶部菜单按钮控制抽屉式侧边栏，内容与桌面侧边栏一致。
  - 主内容区域：
    - 右侧 `main` 区域使用 `<Outlet />` 渲染对应路由页面，`max-w-6xl` 水平居中。

- **页面一览（`src/pages`）**
  - `Dashboard.tsx` → `/`
    - 仪表盘首页：欢迎 Banner + 概览条（Docker 状态、运行服务数等）+ 服务卡片网格（n8n / Dify / OneAPI / RagFlow / Demo）。
  - `Settings.tsx` → `/settings`
    - 设置中心：左侧垂直 Tab（系统 / 网络 / 各模块 / 调试），右侧不同表单区域。
  - `Logs.tsx` → `/logs`
    - 系统日志：过滤工具栏（模块、级别）+ 表格 + 分页。
  - `Monitoring.tsx` → `/monitoring`
    - 性能监控：系统资源使用、服务状态、CPU/内存趋势图（CSS 模拟）。
  - `Tutorial.tsx` → `/tutorial`
    - 在线教程：三张教程卡片（基础入门 / 工作流实战 / RAG 知识库）。
  - `Market.tsx` → `/market`
    - AI 市场：多个应用卡片（客服对话助手、文档问答助手、工作流编排模板）。
  - `ModuleN8n.tsx` / `ModuleDify.tsx` / `ModuleOneApi.tsx` / `ModuleRagFlow.tsx`
    - 各模块占位页：顶部工具栏（后退/前进/刷新/返回首页/打开外部浏览器）+ 中部占位内容，未来将被 BrowserView 实际 Web 界面替换。

### 2. 数据来源与“假数据”情况

当前所有业务数据均为前端本地状态或常量，**尚未接入任何后端 / Electron / Docker / 配置文件**。

- **Dashboard 页面**
  - `initialServices: ServiceModule[]`：本地常量，包含 n8n / Dify / OneAPI / RagFlow / Demo 五个模块的：
    - `status`：`running` / `stopped` / `starting` / `stopping` / `error`；
    - `metrics`：CPU / 内存 / 端口 / 运行时间（均为假数据）。
  - `handleToggleService`：通过 `useState` + `setTimeout` 模拟“启动/停止/启动中”等状态流转，仅影响前端展示。
  - `dockerRunning = true`：Docker 状态目前被写死为“运行中”，仅用于演示 UI 文案与提示。

- **Settings 页面**
  - 系统设置 / 网络设置 / 各模块设置（端口、DB URL、环境变量）/ 调试设置：
    - 全部为表单 UI，未与真实配置或 IPC 绑定；
    - “保存设置”“重置为默认”“应用并重启”等按钮无实际后端逻辑，仅为 Demo 按钮；
    - 危险操作（停止/删除所有容器、清空数据卷、一键清理）目前只触发确认弹窗，不调用任何 Docker 逻辑。

- **Logs 页面**
  - `mockLogs: LogItem[]`：本地常量数组，包含 30 条左右示例日志，涵盖不同模块与级别；
  - 前端实现了：
    - 模块过滤（全部 / client / n8n / Dify / OneAPI / RagFlow）、
    - 级别过滤（error / warn / info / debug / all）、
    - 分页（page / pageSize + Pagination 组件）。
  - “刷新”“清空”按钮目前无实际行为，仅用于演示按钮视觉与交互风格。

- **Monitoring 页面**
  - `resourceMetrics` 等全部为静态假数据；
  - CPU / 内存趋势图使用纯 CSS + div 模拟，无真实监控数据来源。

- **Tutorial / Market / 模块占位页**
  - 内容完全静态，仅作为导航与信息展示，无外部依赖。

### 3. 通用组件与样式体系

- **视觉基础**
  - Tailwind + 自定义类名实现 Glassmorphism 风格；
  - 已有深/浅主题切换，使用 `useTheme` hook 控制 `document.documentElement.classList` 中的 `dark` 类，并存入 `localStorage`。

- **核心通用组件**
  - `GlassCard`：
    - 统一玻璃卡片：`bg-white/80 + border-white/30 + backdrop-blur-lg + shadow`，深色模式有对应样式；
    - 广泛用于 Dashboard Banner、Overview 条、Settings 容器、Monitoring 卡片等。
  - `StatusDot`：
    - 类型 `ServiceStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error'`；
    - 根据状态切换背景色、动画（running/starting/stopping 为 pulse，error 为自定义动画）。
  - `components/ui/*`：
    - 基于 shadcn/ui 封装的 Button / Card / Dialog / Input / Pagination / Select / Switch / Table 等；
    - 在各页面中已经大量复用，结构清晰，可直接搬迁到正式 `src/renderer`。

---

## 二、最终目录规划草案（新的 Electron 工程）

目标：在仓库根目录构建一个正式的 Electron + React + TypeScript 工程，将 `ui-ai-server-v12/` 仅作为 UI 参考，**不再参与正式运行/构建**，做到后期删除该目录也不影响应用。

### 1. 目标目录结构（草案）

```text
ai-server-v12/
  package.json              # 整个桌面应用的根 package
  tsconfig.json
  vite.config.ts            # renderer 打包配置（或 main/renderer 拆分配置）
  electron-builder.yml      # 打包配置（阶段 7 再补充）

  /src
    /main                   # Electron 主进程 & Docker 相关逻辑
      main.ts               # 主进程入口，创建 BrowserWindow / BrowserView
      docker/
        modules-registry.ts # 模块注册表（n8n / OneAPI 为首批，预留 Dify / RagFlow）
        docker-service.ts   # 封装 docker CLI / docker-compose 调用
        compose-templates/  # 各模块/场景的 compose 模板

    /preload                # 预加载脚本
      preload.ts            # 使用 contextBridge 暴露 window.api

    /renderer               # React 前端（v12 UI 迁移后的正式代码）
      main.tsx              # React 入口，替代 ui-ai-server-v12/src/main.tsx
      App.tsx               # 路由与顶层布局
      layouts/              # AppLayout 等
      pages/                # Dashboard / Settings / Logs / Monitoring / Modules ...
      components/           # GlassCard / StatusDot / ui/...
      hooks/                # useTheme / 未来的 useIpc / useI18n 等
      lib/                  # 工具函数（如 cn、格式化函数等）
      i18n/                 # 多语言资源与初始化

    /shared                 # 前后端共享类型与 IPC 协议
      ipc-contract.ts       # 所有 IPC 渠道、请求/响应类型
      types.ts              # 模块/配置/日志等通用类型

  /docker                   # 全局 docker-compose 模板（可选）
  /doc                      # 文档（包括总 Prompt、需求对齐结论、本阶段文档）
  /ui-ai-server-v12         # 仅作 UI 参考的 Demo，后期可删除
```

### 2. 模块职责划分

- **`src/main`（Electron 主进程）**
  - 创建主窗口：
    - 开发模式：加载 Vite Dev Server（`http://localhost:xxxx`）。
    - 生产模式：加载打包后的 HTML/资源。
  - BrowserView 管理：
    - 根据前端指令，在主窗口中创建/切换 BrowserView 来嵌入 n8n / OneAPI / Dify / RagFlow 等 Web 界面；
    - 提供后退/前进/刷新/返回主页/在外部浏览器打开等控制能力。
  - Docker 环境检测：
    - 判断 Docker Desktop 是否已安装（检测 `docker` 命令）；
    - 判断 Docker 是否正在运行（`docker version` / `docker info`）。
  - 模块注册表与 Docker 管理：
    - 保存模块配置（ID、名称、类型 basic/feature、依赖、默认端口、health check、compose 模板引用等）；
    - 对应 IPC 实现 `listModules` / `startModule` / `stopModule` / `getModuleStatus` 等；
    - 通过 docker CLI 或 dockerode 调用 Docker / docker-compose。
  - 日志与危险操作：
    - 聚合模块日志（`docker logs` + 事件）与客户端操作日志；
    - 执行危险清理操作（停止/删除容器、清空卷、一键清理），并进行安全防护（确认提示、标签过滤）。

- **`src/preload`（预加载脚本）**
  - 使用 `contextBridge.exposeInMainWorld` 暴露安全 API：
    - `window.api.getDockerStatus()`
    - `window.api.listModules()` / `startModule()` / `stopModule()`
    - `window.api.getLogs()` / `exportLogs()`
    - `window.api.getSettings()` / `updateSettings()`
    - 其他需要的只读/写操作。
  - 暴露环境信息：
    - 例如 `window.env.defaultLanguage`（根据主进程 `app.getLocale()` 计算）。

- **`src/renderer`（前端）**
  - 承载全部 UI 逻辑，完全迁移并重构自 `ui-ai-server-v12/src`：
    - 保持路由结构（Dashboard / Settings / Logs / Monitoring / Tutorial / Market / 模块页）；
    - 保持现有视觉风格与交互细节（Glassmorphism、动画、按钮效果等）；
    - 将「假数据」逐步改造为通过 `window.api` 获取/更新的真实数据。
  - 负责：
    - 展示 Docker 状态、模块列表与状态；
    - 提供启停按钮，并展示执行中的 loading 状态 / 错误提示；
    - 展示日志、过滤与分页；
    - 显示性能监控的基础信息（前期可仍为假数据，后续接真实接口）；
    - 嵌入模块 Web 界面（最终通过 BrowserView 控制）。

- **`src/shared`（共享类型/契约）**
  - 定义 IPC 渠道常量与类型，例如：

    ```ts
    type IpcChannel =
      | 'docker:getStatus'
      | 'modules:list'
      | 'modules:start'
      | 'modules:stop'
      | 'logs:list'
      | 'logs:export'
      | 'settings:get'
      | 'settings:update'
      | 'browserview:openModule'
      | ...
    ```

  - 定义请求/响应类型（TS interface），供主进程与前端同时引用，保证类型一致。
  - 定义模块定义、日志项、设置结构等核心类型。

- **`/docker` 目录**
  - 存放全局或按模块拆分的 docker-compose 模板；
  - 主进程 Docker 管理逻辑可以在运行时根据模块注册表 + 用户配置，拼出最终的 compose 配置再调用。

- **`/ui-ai-server-v12` 目录**
  - 仅作 UI 设计与代码参考；
  - 在完成阶段 1~3 并完成迁移后，删除该目录不会影响开发、构建和运行。

---

## 三、i18n（中英双语）方案草案

目标：

- v1 即支持 **中文 + 英文** 两种语言；
- 默认按**系统语言**自动选择：简/繁体 → 中文，其他 → 英文；
- 在 Settings 中允许用户手动切换语言或选择“自动”。

### 1. 语言判定策略

- Electron 主进程中使用 `app.getLocale()` 获取操作系统语言。
- 映射规则（示例）：
  - `zh`、`zh-CN`、`zh-SG`、`zh-TW`、`zh-HK` → 语言代码 `zh`；
  - 其他情况 → 语言代码 `en`。
- 将判定结果通过 preload 暴露给前端，例如：

  ```ts
  window.env.defaultLanguage = 'zh' | 'en'
  ```

- 前端启动时的语言决策：

  1. 若用户配置中有显式设置（`language: 'zh' | 'en' | 'auto'`）：
     - `zh` → 强制中文；
     - `en` → 强制英文；
     - `auto` → 使用 `window.env.defaultLanguage`；
  2. 若还没有任何配置（首次启动）：
     - 默认等价于 `auto`。

### 2. 技术选型与目录结构

考虑到项目需要较多文案、后续还可能扩展多语言，推荐使用 **i18next + react-i18next**：

- 目录规划（在 `src/renderer` 内）：

  ```text
  src/renderer/i18n/
    index.ts        # 初始化 i18next，导出 `I18nextProvider` / `useTranslation`
    zh.json         # 中文文案
    en.json         # 英文文案
  ```

- 文案组织方式：按功能模块分层，示例 key：
  - 布局相关：`layout.topbar.title`、`layout.sidenav.dashboard`；
  - Dashboard：`dashboard.hero.title`、`dashboard.hero.subtitle`、`dashboard.services.n8n.description`；
  - Settings：`settings.tabs.system`、`settings.system.title`、`settings.network.proxyMode.manual`；
  - Logs：`logs.title`、`logs.filters.level`、`logs.table.column.time`；
  - Monitoring：`monitoring.title`、`monitoring.cards.systemUsage.title`；
  - 模块页：`modules.n8n.title`、`modules.oneapi.openInBrowser` 等。

- 前端组件中：
  - 使用 `const { t } = useTranslation()`；
  - 逐步将现有硬编码中文字符串替换为 `t('xxx.yyy')`，以分阶段、可验证的方式完成，而不是一次性全改。

### 3. 与 Settings 页的集成

- 在共享配置类型中增加语言字段：

  ```ts
  type Language = 'zh' | 'en'
  type LanguageSetting = Language | 'auto'

  interface AppSettings {
    language: LanguageSetting
    logLevel: 'info' | 'warn' | 'error' | 'debug'
    // 其他设置项...
  }
  ```

- Settings 页面中的“界面语言”表单：
  - 选项：
    - 自动（跟随系统）
    - 简体中文
    - English
  - 行为：
    - 用户修改后，通过 IPC 调用 `settings:update`；
    - 后端将配置写入 `userData` 下的配置文件；
    - 前端收到成功回调后，更新 i18n 当前语言，并在 UI 即时生效。

### 4. 配置存储与可手工编辑

- 配置文件位置：
  - 使用 Electron 推荐的 `app.getPath('userData')` 目录，例如：
    - Windows：`C:\Users\<User>\AppData\Roaming\AI-Server-v12\config.json`（示例）；
  - 项目配置不放在仓库目录中，方便升级和迁移。

- 配置文件格式：
  - 使用 JSON（或 JSON + 若干拆分文件），保证：
    - 文本化、键名清晰、便于人工修改；
    - 一致的缩进与注释策略（如必要时用文档说明，而非在 JSON 中混杂注释）。

---

## 四、阶段 0 输出与后续阶段衔接

### 1. 阶段 0 主要结论

- 已充分理解并梳理 `ui-ai-server-v12` 的：
  - 路由结构与主要页面；
  - 数据组织形式与假数据范围；
  - 通用组件与视觉体系。
- 结合项目总 Prompt 与业务约束，给出了：
  - **正式 Electron 工程的目录规划草案**；
  - **中英双语 i18n 方案草案**（含语言判定、技术选型与 Settings 集成方式）。

### 2. 对后续阶段的影响

- 阶段 1（初始化 Electron + React 工程骨架）：
  - 将按照本文件中的目录规划，在根目录创建 `src/main` / `src/preload` / `src/renderer` / `src/shared` 等结构；
  - 从 `ui-ai-server-v12` 复制 / 迁移页面与组件到 `src/renderer`；
  - 实现最小 Electron 主进程和前端入口，使 `npm run dev` 可以打开桌面应用并看到 v12 风格 UI；
  - 确保构建与运行**完全不依赖** `ui-ai-server-v12` 目录。

- 后续阶段（2~7）：
  - 阶段 2 将在 `src/shared` 中补全 IPC 协议与类型；
  - 阶段 3 起逐步将 Dashboard/Settings/Logs 等页面与真实 Docker & 配置 & 日志逻辑打通；
  - 阶段 5~6 会在现有 Logs/Monitoring/模块页 UI 基础上接入真实数据与 BrowserView 管理；
  - 阶段 7 基于当前目录结构配置 electron-builder，完成 Windows 安装包打包与联调。

> 本文档与《AI-Server-v12-需求对齐结论.md》一同构成阶段 0 的设计基线。如后续架构方向或 i18n 策略有变更，应同步更新本文件。
