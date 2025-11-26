# AI-Server-v12 阶段 2：IPC 协议与开发约定

> 本文档用于约束「主进程 / preload / renderer」三端之间的类型与通信方式，确保后续开发在统一的契约下演进。
>
> 时间：2025-11-26

---

## 一、共享领域类型（src/shared/types.ts）

所有与业务相关的核心类型统一定义在 `src/shared/types.ts` 中，主进程、preload、renderer **只能从这里 import**，避免各自定义散落导致不一致。

### 1. 模块相关类型

```ts
export type ModuleId = 'n8n' | 'dify' | 'oneapi' | 'ragflow'

export type ModuleCategory = 'core' | 'feature'

export type ModuleStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export interface ModuleInfo {
  id: ModuleId
  name: string
  description: string
  category: ModuleCategory
  enabled: boolean
  status: ModuleStatus
  port: number | null
  webUrl?: string | null
  tags?: string[]
}
```

约定：

- `ModuleId` 目前只包含四个核心模块，后续如增加模块（如 embedding service）统一在这里扩展；
- `ModuleStatus` 与前端的 `StatusDot` 状态一一对应，防止“文案 OK 但枚举不统一”；
- `ModuleInfo` 是前端展示和管理模块状态的基础结构：
  - `enabled` 表示是否在当前工作区启用该模块（例如禁用某些 feature 模块）；
  - `port` 是实际映射端口（可能为 null）；
  - `webUrl` 用于 BrowserView / 外部浏览器打开；
  - `tags` 预留给 UI 侧的标签展示（如 "core"、"beta" 等）。

### 2. Docker 状态

```ts
export interface DockerStatus {
  installed: boolean
  running: boolean
  version?: string
  platform?: string
  error?: string
}
```

约定：

- `installed` 用于判断是否检测到 `docker` 命令或 Docker Desktop 安装；
- `running` 表示 Docker daemon 是否可用（`docker info` 成功）；
- `error` 提供给 UI 友好展示的错误文案（如 CLI 执行错误信息摘要）。

### 3. 日志类型

```ts
export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export type LogModule = 'client' | 'n8n' | 'dify' | 'oneapi' | 'ragflow' | 'system'

export interface LogItem {
  id: number
  timestamp: string
  level: LogLevel
  module: LogModule
  service: string
  message: string
}
```

约定：

- `LogModule` 中的 `client` 指前端 UI / Electron shell 自身产生日志；
- `system` 用于记录 AI-Server 宿主或 Docker 管理逻辑的日志；
- `timestamp` 使用字符串（ISO 或 `YYYY-MM-DD HH:mm:ss`），具体格式由后端统一；
- `id` 为日志条目标识，可为自增 ID 或 hash，前端只保证当作 key 使用。

### 4. 设置与 i18n

```ts
export type Language = 'zh' | 'en'

export type LanguageSetting = Language | 'auto'

export interface DockerProxySettings {
  proxyMode: 'direct' | 'system' | 'manual'
  proxyHost: string
  proxyPort: number | null
}

export interface DockerSettings {
  mirrorUrls: string[]
  proxy: DockerProxySettings
}

export interface ModuleSettings {
  enabled: boolean
  port: number
  databaseUrl?: string
  env: Record<string, string>
}

export interface AppSettings {
  language: LanguageSetting
  logLevel: LogLevel
  autoStartOnBoot: boolean
  docker: DockerSettings
  modules: Record<ModuleId, ModuleSettings>
}
```

约定：

- 设置统一通过 `AppSettings` 读写，后端负责落盘到 `userData` 目录中的 JSON；
- `language` 支持 `auto`，按照阶段 0 文档约定映射到 `zh/en`；
- `docker.mirrorUrls`、`docker.proxy` 与 Settings 页的“镜像加速地址 / 代理模式”等字段一一对应；
- `modules` 按 `ModuleId` 组织各模块的配置，避免散落多个配置文件。

---

## 二、IPC 契约（src/shared/ipc-contract.ts）

IPC 通信统一在 `src/shared/ipc-contract.ts` 中定义：

- 所有 **通道名** 必须在这里登记；
- 每个通道都有对应的 **请求类型** 和 **响应类型**；
- 主进程和渲染进程都通过这里的泛型类型来约束 `invoke/handle` 的参数和返回值。

### 1. 通道名与请求 Map

```ts
export interface IpcRequestMap {
  'docker:getStatus': EmptyPayload
  'modules:list': EmptyPayload
  'modules:start': { moduleId: ModuleId }
  'modules:stop': { moduleId: ModuleId }
  'logs:list': {
    module?: LogModule | 'all'
    level?: LogLevel | 'all'
    page?: number
    pageSize?: number
  }
  'logs:export': {
    filename?: string
    module?: LogModule
    level?: LogLevel
  }
  'settings:get': EmptyPayload
  'settings:update': Partial<AppSettings>
}
```

约定：

- **请求体约束**：
  - 无参数的通道统一使用 `EmptyPayload = Record<string, never>`；
  - 列表接口使用 `page/pageSize`；
  - `logs:list` 支持 `module/level = 'all'` 表示不过滤；
  - `settings:update` 只传入 diff（Partial），主进程负责 merge 并返回完整 `AppSettings`。

### 2. 响应 Map

```ts
export interface IpcResponseMap {
  'docker:getStatus': DockerStatus
  'modules:list': ModuleInfo[]
  'modules:start': { success: boolean; error?: string }
  'modules:stop': { success: boolean; error?: string }
  'logs:list': { items: LogItem[]; total: number }
  'logs:export': { success: boolean; path?: string; error?: string }
  'settings:get': AppSettings
  'settings:update': AppSettings
}
```

约定：

- **状态类接口**（如 start/stop/export）统一返回 `{ success: boolean; error?: string }`，便于前端统一处理 Toast/提示；
- 设置相关接口总是返回完整的 `AppSettings`，避免前端状态与后端不一致；
- 日志列表接口返回 `items` + `total`，方便前端分页展示。

### 3. 通道与泛型辅助

```ts
export type IpcChannels = keyof IpcRequestMap

export type IpcRequest<Channel extends IpcChannels> = IpcRequestMap[Channel]

export type IpcResponse<Channel extends IpcChannels> = IpcResponseMap[Channel]
```

使用示例（伪代码）：

- 主进程：

  ```ts
  import { ipcMain } from 'electron'
  import type { IpcChannels, IpcRequest, IpcResponse } from '../shared/ipc-contract'

  function handle<Channel extends IpcChannels>(
    channel: Channel,
    handler: (payload: IpcRequest<Channel>) => Promise<IpcResponse<Channel>> | IpcResponse<Channel>,
  ) {
    ipcMain.handle(channel, async (_event, payload) => handler(payload))
  }

  handle('docker:getStatus', async () => ({ installed: true, running: true }))
  ```

- 渲染进程：

  ```ts
  import { ipcRenderer } from 'electron'
  import type { IpcChannels, IpcRequest, IpcResponse } from '../shared/ipc-contract'

  function invoke<Channel extends IpcChannels>(
    channel: Channel,
    payload: IpcRequest<Channel>,
  ): Promise<IpcResponse<Channel>> {
    return ipcRenderer.invoke(channel, payload)
  }
  ```

> 实际项目中，这层封装会放在 preload 和 main 的辅助模块中，renderer 只通过 `window.api` 访问。

---

## 三、window.api 规范（src/shared/window-api.ts + src/renderer/global.d.ts）

### 1. WindowApi 接口

`src/shared/window-api.ts` 中定义了 renderer 端可用的 API：

```ts
export interface WindowApi {
  ping(): string
  getDockerStatus(): Promise<DockerStatus>
  listModules(): Promise<ModuleInfo[]>
  startModule(moduleId: ModuleId): Promise<{ success: boolean; error?: string }>
  stopModule(moduleId: ModuleId): Promise<{ success: boolean; error?: string }>
  getLogs(params: {
    module?: LogModule | 'all'
    level?: LogLevel | 'all'
    page?: number
    pageSize?: number
  }): Promise<{ items: LogItem[]; total: number }>
  exportLogs(params: {
    filename?: string
    module?: LogModule
    level?: LogLevel
  }): Promise<{ success: boolean; path?: string; error?: string }>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
}
```

约定：

- `window.api` 是 renderer 获取后端能力的**唯一入口**，renderer 不直接使用 `ipcRenderer`；
- 每个方法对应一个或多个 IPC 通道，后续在 preload 中实现。

### 2. 全局类型声明

`src/renderer/global.d.ts` 中扩展全局 Window 接口：

```ts
import type { WindowApi } from '../shared/window-api'

declare global {
  interface Window {
    api: WindowApi
  }
}

export {}
```

约定：

- 任何 TS 文件中直接使用 `window.api` 会获得完整的类型提示；
- 不允许在 renderer 中手动为 `window.api` 声明 `any` 或重新定义类型。

---

## 四、后续实现顺序与注意事项

### 1. 主进程：基于契约实现 IPC handler（先用假数据）

- 在 `src/main` 下新增如 `ipc-handlers.ts`：
  - 使用 `ipcMain.handle('docker:getStatus', ...)` 等注册处理函数；
  - 初期返回与当前 UI 假数据契合的 mock 数据（DockerStatus / ModuleInfo / LogItem / AppSettings）。
- `main.ts` 引入并初始化这些 handler。

### 2. preload：封装 window.api

- 在 `src/preload/preload.js` 中：
  - 使用 `ipcRenderer.invoke` 封装 `WindowApi` 中的方法；
  - 通过 `contextBridge.exposeInMainWorld('api', windowApiImpl)` 暴露给 renderer；
  - 严禁在 renderer 直接引入 `ipcRenderer`。

### 3. renderer：从假数据迁移到 window.api

迁移顺序建议：

1. **SettingsPage**
   - `getSettings` / `updateSettings` 对应 Settings 页表单；
   - 先用 mock 落盘（无 Docker 依赖），验证配置读写流程。

2. **LogsPage**
   - 把当前 `mockLogs` 挪到主进程，用 `getLogs` 拉取；
   - 后续再把这些 mock 换成真实 `docker logs` / 文件日志聚合。

3. **DashboardPage**
   - 将 `initialServices` 状态搬到主进程，通过 `listModules` + `getDockerStatus` 拉取；
   - 启停按钮调用 `startModule` / `stopModule`，初期可以只改状态，不真的操作 Docker。

### 4. 采用“先假后真”的策略

- 当前阶段（2/3 的前半段）主进程 IPC handler 返回 **与现有 UI 假数据一致的结构**；
- 当 renderer 已完全改为 `window.api` 调用后，再逐步修改主进程的实现：
  - 将 Dockers 相关接口改为调用 `docker` CLI 或 `dockerode`；
  - 将日志接口改为从真实日志源读取；
  - 将设置读写改为访问配置文件。

这样可以最大程度减少前后端同时大改导致的混乱。

---

## 五、开发约定汇总

1. **类型集中管理**：
   - 所有共享领域类型必须定义在 `src/shared/types.ts`；
   - 不允许在 main/preload/renderer 内部重复定义等价结构。

2. **IPC 通道集中定义**：
   - 所有 IPC 通道名、请求/响应类型定义在 `src/shared/ipc-contract.ts`；
   - 新增通道时先修改该文件，再实现 main/preload/renderer 逻辑。

3. **前端访问统一走 window.api**：
   - renderer 不直接使用 `ipcRenderer`；
   - 所有跨进程操作都通过 `window.api` 封装的方法完成。

4. **逐步替换假数据**：
   - 先在主进程用 mock 数据实现 handler，保证接口稳定；
   - 然后再将 mock 替换为真实 Docker / 日志 / 配置逻辑，无需改前端调用方式。

本文件将作为阶段 2 的开发约定，若后续 IPC 设计或类型结构有重大调整，应同步更新。
