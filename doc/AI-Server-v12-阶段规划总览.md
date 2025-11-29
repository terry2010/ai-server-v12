# AI-Server-v12 阶段规划总览（0 ~ 7）

> 本文档汇总 AI-Server-v12 桌面应用从阶段 0 到阶段 7 的整体规划，用于：
>
> - 回顾每个阶段的目标、主要工作内容、关键产出；
> - 作为阶段性验收的参考标准；
> - 串联已有的详细设计文档（需求对齐、UI 与架构规划、IPC 与开发约定等）。
>
> 如后续阶段规划发生重大调整，应同步更新本文档。

---

## 阶段 0：需求对齐与 v12 UI/架构规划

- **目标**
  - 理解项目总体需求与约束（见《AI-Server-v12-项目说明与总Prompt.md》）。
  - 对齐实现范围、技术栈、模块优先级、Docker 假设、网络与安全策略、i18n、日志与配置等关键问题。
  - 充分理解现有 `ui-ai-server-v12` 的 UI 结构与设计风格，并给出新工程的目录规划与 i18n 方案。

- **主要工作内容**
  - 阅读并拆解项目总 Prompt，形成问答与确认列表；
  - 与用户对齐：
    - 首期重点模块：n8n + OneAPI；
    - Docker Desktop 为必需环境（不支持 Podman/minikube 等替代）；
    - 使用全新 Docker/docker-compose 设计，不沿用旧版本；
    - 配置持久化到 `userData` 目录 JSON；
    - Windows 为主力环境，npm 为包管理工具；
    - v1 就支持中/英双语（系统语言自动 + 设置页切换）；
  - 梳理 `ui-ai-server-v12`：路由、页面、假数据情况、通用组件与视觉体系；
  - 设计新工程目录（main / preload / renderer / shared / docker / doc 等）与 i18n 方案草案。

- **关键产出**
  - 《AI-Server-v12-需求对齐结论.md》
  - 《AI-Server-v12-阶段0-UI与架构规划.md》

- **验收标准**
  - 需求与约束无重大歧义；
  - 阶段 0 文档被用户确认“无问题，可以按此进入阶段 1”。

---

## 阶段 1：工程骨架与 v12 UI 迁移

- **目标**
  - 在仓库根目录初始化 Electron + React + TypeScript + Vite 工程骨架；
  - 将 `ui-ai-server-v12` 的 UI 代码迁移到新工程的 `src/renderer`，实现完整 v12 UI；
  - 通过 `npm run dev` 启动 Electron 应用，在桌面窗口中看到 v12 风格 UI；
  - 构建与运行完全不再依赖 `ui-ai-server-v12` 目录（其仅作参考）。

- **主要工作内容**
  - 新建根级配置：
    - `package.json`（脚本：dev/dev:renderer/dev:main/build，依赖 React/Electron/Vite/Tailwind 等）；
    - `tsconfig.json`（`@` → `src/renderer`，包含 `src/renderer` + `src/shared`）；
    - `vite.config.ts`（React SWC 插件 + alias 设置）；
    - `tailwind.config.js` / `postcss.config.js` / `index.html`；
  - 初始化源码结构：
    - `src/main/main.js`：最小 Electron 主进程（dev 加载 Vite，prod 加载 dist，配置 preload）；
    - `src/preload/preload.js`：初始 `window.api.ping()`，使用 CommonJS 写法以避免 ESM 语法错误；
    - `src/shared/ipc-contract.ts`：初始为空；
    - `src/renderer`：`main.tsx` / `App.tsx` / `index.css` 占位。
  - 从 `ui-ai-server-v12` 迁移 UI 到 `src/renderer`：
    - 通用：`lib/utils.ts (cn)`、`hooks/useTheme.ts`；
    - 组件：`GlassCard`、`StatusDot`、`components/ui/*`；
    - 布局：`layouts/AppLayout.tsx`；
    - 页面：Dashboard / Settings / Logs / Monitoring / Tutorial / Market / Module*；
    - 路由：在 `App.tsx` 中使用 `Routes + AppLayout`，在 `main.tsx` 中包裹 `BrowserRouter`。

- **关键产出**
  - 可运行的 Electron + React 应用骨架；
  - 完整迁移的 v12 UI（布局、路由、页面、组件、样式），现阶段数据源仍为前端假数据；
  - 修复 preload 的 ESM 导致的 `Cannot use import statement outside a module` 错误。

- **验收标准**
  - 用户在测试机上运行 `npm run dev`：
    - Electron 窗口正常弹出；
    - 各页面（仪表盘/设置/日志/监控/教程/市场/模块）可进入且无报错；
    - 不再出现 preload 语法错误导致的报错；
  - 用户确认“阶段 1 验收通过，UI 正常”。

---

## 阶段 2：共享类型与 IPC 契约设计

- **目标**
  - 在 `src/shared` 中统一定义核心领域类型（模块、Docker 状态、日志、设置/i18n 等）；
  - 在 `src/shared/ipc-contract.ts` 中统一定义 IPC 通道名及其请求/响应类型；
  - 在 `src/shared/window-api.ts` + `src/renderer/global.d.ts` 中定义并暴露 `window.api` 类型；
  - 为后续 main/preload/renderer 之间的调用提供稳定契约。

- **主要工作内容**
  - `src/shared/types.ts`：
    - 模块：`ModuleId / ModuleStatus / ModuleInfo`；
    - Docker：`DockerStatus`；
    - 日志：`LogLevel / LogModule / LogItem`；
    - 设置 & i18n：`Language / LanguageSetting / Docker*Settings / ModuleSettings / AppSettings`。
  - `src/shared/ipc-contract.ts`：
    - 通道名：
      - `docker:getStatus`；
      - `modules:list` / `modules:start` / `modules:stop`；
      - `logs:list` / `logs:export`；
      - `settings:get` / `settings:update`；
    - `IpcRequestMap` / `IpcResponseMap`：定义每个通道的请求/响应类型；
    - 泛型辅助：`IpcChannels` / `IpcRequest<C>` / `IpcResponse<C>`。
  - `src/shared/window-api.ts`：

    ```ts
    export interface WindowApi {
      ping(): string
      getDockerStatus(): Promise<DockerStatus>
      listModules(): Promise<ModuleInfo[]>
      startModule(moduleId: ModuleId): Promise<{ success: boolean; error?: string }>
      stopModule(moduleId: ModuleId): Promise<{ success: boolean; error?: string }>
      getLogs(...): Promise<{ items: LogItem[]; total: number }>
      exportLogs(...): Promise<{ success: boolean; path?: string; error?: string }>
      getSettings(): Promise<AppSettings>
      updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
    }
    ```

  - `src/renderer/global.d.ts`：将 `api: WindowApi` 挂到全局 Window。
  - 文档化约定：
    - 所有共享类型集中在 `src/shared/types.ts`；
    - 所有 IPC 通道名/请求/响应集中在 `src/shared/ipc-contract.ts`；
    - renderer 统一通过 `window.api` 访问，不直接使用 `ipcRenderer`；
    - 先用主进程 mock 实现 IPC handler，再逐步替换为真实逻辑。

- **关键产出**
  - 《AI-Server-v12-阶段2-IPC与开发约定.md》
  - `src/shared/types.ts` / `ipc-contract.ts` / `window-api.ts` / `src/renderer/global.d.ts`

- **验收标准**
  - 所有后续 main/preload/renderer 代码均以这些类型和契约为准；
  - 不再在各层重复定义等价类型或随意新增 IPC 通道。

---

## 阶段 3：main & preload：IPC handler 与 window.api 初始实现

- **目标**
  - 在主进程基于阶段 2 的契约，先用 **假数据** 实现 IPC handler；
  - 在 preload 中基于 `ipcRenderer.invoke` 实现 `window.api`；
  - 保持 renderer 的业务逻辑暂时仍使用本地假数据，为后续迁移做准备。

- **主要工作内容**
  - 在 `src/main` 新增如 `ipc-handlers.js/ts`：
    - `docker:getStatus`：返回固定的 DockerStatus（如 `installed: true, running: true`）；
    - `modules:list`：返回内存中的 `ModuleInfo[]`，与 Dashboard 中的服务列表含义一致；
    - `modules:start/stop`：仅修改内存中 `ModuleInfo.status`，暂不操作 Docker；
    - `logs:list`：根据阶段 1 中 Logs 页的 mock 日志数据，实现过滤+分页；
    - `logs:export`：先返回 `{ success: true, path: 'mock.log' }` 占位；
    - `settings:get` / `settings:update`：使用内存中的 `AppSettings` 对象，暂不落盘。
  - 在 `src/main/main.js` 中引入并注册这些 handler。
  - 在 `src/preload/preload.js` 中：
    - 使用 CommonJS 形式 `const { contextBridge, ipcRenderer } = require('electron')`；
    - 基于类型 `WindowApi` 实现对应方法，并通过 `contextBridge.exposeInMainWorld('api', impl)` 暴露给 renderer。

- **关键产出**
  - 主进程 IPC handler 的初始实现（全部使用假数据）；
  - preload 层对 `window.api` 的封装实现。

- **验收标准**
  - 在 DevTools console 内可以验证 `window.api.ping()`、`window.api.getDockerStatus()` 等调用返回合理的 mock 数据；
  - renderer 不使用 `ipcRenderer`，只访问 `window.api`。

---

## 阶段 4：renderer 迁移到 window.api（替换假数据）

- **目标**
  - 逐步将各个页面的本地假数据替换为 `window.api` 调用；
  - 在不改变 UI 行为的前提下，让页面逻辑完全围绕 IPC 契约编写。

- **主要工作内容**
  - `SettingsPage`：
    - 初始载入时调用 `window.api.getSettings()`，将结果注入表单初始值；
    - 保存时调用 `window.api.updateSettings(patch)`，并使用返回的 `AppSettings` 更新本地状态；
    - 暂时不改 UI 表单结构，仅替换数据来源与保存逻辑。
  - `LogsPage`：
    - 把 `mockLogs` 源从 renderer 挪到 main 侧，通过 `window.api.getLogs()` 获取分页数据；
    - 保持原有过滤、分页 UI 逻辑不变，只替换数据拉取方式。
  - `DashboardPage`：
    - 使用 `window.api.listModules()` 填充服务列表；
    - 启停按钮调用 `window.api.startModule/stopModule`；
    - Docker 状态使用 `window.api.getDockerStatus()` 的结果。
  - 其他页面（Monitoring/Tutorial/Market/模块页）可在后续阶段与真实数据逐步打通。

- **关键产出**
  - Dashboard/Settings/Logs 三个核心页完全基于 `window.api` 工作；
  - UI 行为与阶段 1 基本一致（只是数据来源变更为 IPC）。

- **验收标准**
  - 断开 main 中的 mock 支持时，renderer 因类型约束可以明确知道缺失的通道/字段；
  - 所有跨进程数据流都清晰、可追踪。

---

## 阶段 5：Docker 真能力接入（启动/停止/状态）

- **目标**
  - 将主进程中与 Docker 相关的逻辑从假实现替换为真实实现；
  - 在不改动前端调用方式的前提下，让 Dashboard/Settings 部分功能真正控制 Docker 容器。

- **主要工作内容**
  - 在主进程中接入 Docker CLI / docker-compose（或 dockerode）：
    - `docker:getStatus`：检测是否安装 Docker、是否运行、版本与 platform；
    - `modules:list`：依据模块注册表与 Docker 容器状态计算 `ModuleInfo`；
    - `modules:start/stop`：通过 docker/docker-compose 启动/停止对应模块容器。
  - 设计并实现模块注册表（`src/main/docker/modules-registry.*`）：
    - 定义各模块的镜像、容器名、端口、依赖关系等；
    - 与 `ModuleId` 对齐。
  - 将危险操作（停止/删除容器、清空卷、一键清理）实现为开发选项，严格防呆。

- **关键产出**
  - 可在 Dashboard/Settings 中实际启动/停止 Docker 容器；
  - `DockerStatus` 与模块状态真实反映 Docker 环境。

- **验收标准**
  - 在本地安装 Docker Desktop 的前提下，用户可以通过 UI 启停 n8n / OneAPI 等容器；
  - 出现错误时（镜像缺失、端口冲突、Docker 未运行等）有明确可读的错误提示。

---

## 阶段 6：日志 / 监控 / BrowserView 集成

- **目标**
  - 将日志与监控页面接入真实数据；
  - 将模块页（n8n/Dify/OneAPI/RagFlow）从占位 UI 改为真正嵌入其 Web 界面（BrowserView）。

- **主要工作内容**
  - 日志：
    - 将 `logs:list` / `logs:export` 接入真实日志源（文件/容器日志聚合）；
    - 支持按模块/级别/时间范围过滤和导出。
  - 监控：
    - 为 MonitoringPage 提供基础指标（CPU、内存、磁盘、网络、关键服务状态等）；
    - 先实现简单采样与展示（不做复杂时序库）。
  - BrowserView：
    - 在主进程管理 BrowserView 对象，在模块 Tab / 模块页面中切换显示；
    - 通过 IPC 或 window.api 暴露后退/前进/刷新/返回首页/在外部浏览器打开等能力；
    - 确保 BrowserView 与主窗口布局和主题风格兼容。

- **关键产出**
  - 基于真实数据的日志与监控页面；
  - 模块页不再只是提示，而是真正嵌入各自 Web 管理界面。

- **验收标准**
  - 可以在应用内查看实时日志和基本监控数据；
  - 可以在应用内使用 n8n / OneAPI 等 Web 控制台（BrowserView 嵌入）。

---

## 阶段 7：打包与交付（electron-builder）

- **目标**
  - 使用 electron-builder（或等价工具）为 Windows（优先）和 macOS 生成安装包；
  - 完成从开发环境到安装包的完整构建与验证流程。

- **主要工作内容**
  - 新增构建配置文件（如 `electron-builder.yml` 或在 `package.json` 中配置 build 字段）：
    - 应用名称、版本、图标；
    - Windows 目标（例如 nsis）；
    - macOS 目标（如 dmg，可选）。
  - 调整打包流程：
    - 先 `vite build` 打包 renderer；
    - 再打包 Electron 主进程与 preload；
    - 产出可安装的安装包或便携版。
  - 在测试机上安装运行，验证：
    - 可正常启动并加载 UI；
    - Docker 检测、模块控制、日志/监控等核心功能可用；
    - 配置读写路径正确位于用户 `userData` 目录。

- **关键产出**
  - Windows 安装包（优先）；
  - 必要时的 macOS 包。

- **验收标准**
  - 用户可以在干净环境（只装 Node + Docker Desktop）上：
    - 安装 AI-Server-v12；
    - 成功启动并完成基础功能体验。

---

> 目前进度：
> - 阶段 0：已完成（需求对齐 + UI/架构规划文档）。
> - 阶段 1：已完成（工程骨架 + v12 UI 迁移 + preload 修复）。
> - 阶段 2：已完成（共享类型与 IPC 契约设计 + 开发约定文档）。
> - 阶段 3：已完成（main & preload 的 IPC handler 与 window.api 初始实现，已按共享契约接入 Docker 状态、模块列表、设置等核心通道）。
> - 阶段 4：已完成（Dashboard / Settings / Logs 等核心页面已全部迁移到 window.api，不再依赖前端假数据）。
> - 阶段 5：已完成（接入真实 Docker 能力，可在 UI 中检测 Docker 状态并启停 n8n / OneAPI / Dify / RagFlow 等模块，包含基础错误提示与防呆逻辑）。
> - 阶段 6：部分完成（日志聚合/导出与系统 + 模块监控已接入真实数据；模块页的 BrowserView 嵌入尚未实现）。
> - 阶段 7：未开始（尚未配置 electron-builder 打包与安装包产出）。
