# n8n 模块功能与技术要点指南

> 本文档用于梳理当前项目中 **n8n 模块** 涉及到的所有主要功能点与技术实现要点，并作为未来添加新模块（如其它容器化服务）时的参考模板。
>
> 代码参考目录主要集中在：
>
> - 主进程：`src/main`
>   - `config.js`
>   - `app-settings.js`
>   - `docker-client.js`
>   - `docker-utils.js`
>   - `runtime-n8n.js`
>   - `ipc-handlers.js`
> - 预加载 & IPC 封装：
>   - `src/preload/preload.js`
>   - `src/shared/window-api.ts`
> - 渲染进程：`src/renderer`
>   - `pages/Dashboard.tsx`
>   - `pages/settings/ModuleSettings.tsx`（n8n 分支）
>   - `pages/ModuleN8n.tsx`
>
> 未来添加新模块时，可以按本文档的结构，对应地补齐各层逻辑。

---

## 一、n8n 模块的整体职责

- **作为核心工作流引擎**：
  - 通过 Docker 容器运行 n8n 服务（HTTP 端口默认 5678）。
  - 提供 Web 控制台与 Webhook 等功能。
- **自动管理依赖数据库**：
  - 默认使用托管模式，自动创建与管理 Postgres 容器与数据卷。
  - 也支持切换为“外部 PostgreSQL”，由用户在设置页输入连接参数。
- **与平台集成的能力**：
  - 通过统一 Dashboard 展示运行状态 / CPU / 内存 / 端口等信息。
  - 在 Settings 页面统一管理端口、日志级别、数据库模式和环境变量。
  - 支持“一键应用并重启”功能，自动重新创建/启动容器并做 HTTP 就绪检查。
  - 与 Logs & Monitoring 集成，支持系统日志查询和运行时指标展示。

---

## 二、主进程部分

### 2.1 模块配置（`config.js`）

关键数据结构：

- **导出的 `modules` 数组**（类型 `ModuleInfo[]`）：
  - n8n 条目示例：
    - `id: 'n8n'`
    - `name: 'n8n'`
    - `description: '工作流自动化与编排引擎'`
    - `category: 'core'`
    - `enabled: true`
    - `status: 'running'`（仅作为初始/默认值）
    - `port: 5678`
    - `webUrl: 'http://localhost:5678'`

- **`moduleDockerConfig`**：声明模块与 Docker 容器名的对应关系：
  - `n8n: { containerNames: ['ai-server-n8n', 'n8n'] }`
  - `ipc-handlers` 与 `logs`/`monitor` 会根据这些名字去查找容器状态。

- **`moduleImageMap`**：模块对应的镜像：
  - `n8n: 'docker.n8n.io/n8nio/n8n'`

- **网络与卷常量**（供 runtime 使用）：
  - `MANAGED_NETWORK_NAME = 'ai-server-net'`
  - `N8N_DB_IMAGE = 'postgres:16'`
  - `N8N_DB_CONTAINER_NAME = 'ai-server-postgres'`
  - `N8N_DATA_VOLUME_NAME = 'ai-server-n8n-data'`
  - `N8N_DB_VOLUME_NAME = 'ai-server-postgres-data'`

> 添加新模块时，需要在此处：
>
> - 向 `modules` 中增加一条条目（含端口、描述等）。
> - 在 `moduleDockerConfig` 中配置容器名列表。
> - 在 `moduleImageMap` 中维护镜像名。
> - 如有自建基础服务（DB/Redis 等），在此定义相关常量。

---

### 2.2 应用设置与 n8n 秘钥（`app-settings.js`）

- **默认设置 `defaultAppSettings.modules.n8n`**：
  - `enabled: true`
  - `port: 5678`
  - `databaseUrl: ''`（当前实际使用的是 env 模式，databaseUrl 保留）
  - `env: {}`

- **运行时全局 `appSettings`**：
  - 通过 `initAppSettingsFromDisk / getAppSettings / setAppSettings / updateAppSettings` 维护。
  - 持久化到用户目录下 `settings.json`，由 main 进程统一管理。

- **自动生成 n8n 的加密秘钥**：`ensureN8nSecretsInSettings()`：
  - 针对 `appSettings.modules.n8n.env`：
    - `N8N_ENCRYPTION_KEY`
    - `N8N_JWT_SECRET`
    - `N8N_USER_MANAGEMENT_JWT_SECRET`
  - 若为空则使用 `generateRandomPassword()` 生成随机秘钥，写回 settings 并落盘。

> 技术要点：
>
> - 秘钥的生成完全在主进程完成，对前端透明；前端只负责**展示和复制**，不允许用户直接编辑这些字段。
> - 新模块如需要类似“首次运行自动生成秘钥”的能力，可参考 `ensureN8nSecretsInSettings` 的实现模式：
>   - 读取当前 `appSettings`。
>   - 对目标模块 env 中的关键字段做检查与生成。
>   - 若有变更则回写 settings 并持久化。

---

### 2.3 Docker 工具与基础服务管理（`docker-utils.js`）

与 n8n 相关的关键点：

- **统一的 Docker 客户端与状态检测**：
  - 来自 `docker-client.js` 的 `getDockerClient`、`detectDockerStatus` 等。

- **主机时区注入**：
  - `applyHostTimeZoneToEnv(env)`：确保容器环境变量中包含 `TZ=...`，避免时区问题。

- **网络与数据卷确保存在**：
  - `ensureNetworkExists()`：检查/创建 `MANAGED_NETWORK_NAME`。
  - `ensureVolumeExists(volumeName)`：检查/创建所需数据卷。

- **镜像存在性检查与拉取**：
  - `ensureImagePresent(image)` / `ensureImagePresentForModule(moduleId)`：
    - 首先尝试在本地查找镜像（考虑 Docker registry 镜像加速前缀）。
    - 若不存在，则通过 Docker CLI 执行 `docker pull`（支持代理配置）。

- **基础服务引用关系**：
  - `moduleBaseServiceContainers`：
    - `n8n: [N8N_DB_CONTAINER_NAME]`，表明 n8n 依赖的基础 DB 服务。
  - `maybeStopBaseServicesForModule(moduleId, docker)`：
    - 在停止某模块后，检测该基础服务是否仍被其它模块使用，如无人使用则自动停止基础容器。

> 对新模块而言，需要：
>
> - 在此声明模块依赖的基础服务容器（若有共享 DB/Redis 等需求）。
> - 复用 `ensureNetworkExists` / `ensureVolumeExists` / `ensureImagePresent` 等工具函数。

---

### 2.4 n8n 运行时管理（`runtime-n8n.js`）

核心职责：**确保 n8n 运行时环境（Postgres + n8n 容器）就绪，并通过 HTTP 检查可用性。**

#### 2.4.1 Postgres 容器管理：`ensureN8nPostgres()`

- 目标：保证用于 n8n 的 Postgres 容器存在且在运行。
- 逻辑要点：
  - 使用 Docker 客户端检查：
    - 若已存在名为 `N8N_DB_CONTAINER_NAME` 的容器：
      - 读取其环境变量，解析当前 DB 用户/数据库/密码。
      - 确保容器加入 `MANAGED_NETWORK_NAME`。
      - 若未运行则 `container.start()`。
    - 若不存在容器但存在数据卷 `N8N_DB_VOLUME_NAME`：
      - 尝试删除“孤立数据卷”（若失败则继续复用）。
  - 对于全新创建流程：
    - `ensureVolumeExists(N8N_DB_VOLUME_NAME)` 确保卷存在。
    - `ensureImagePresent(N8N_DB_IMAGE)` 确保镜像在本地。
    - 使用随机密码创建新 Postgres 容器，并加入管理网络。
  - 返回结构：
    - `{ success: true, dbConfig: { host, port, database, user, password } }` 或 `{ success: false, error }`。

#### 2.4.2 n8n 容器管理：`ensureN8nContainer(dbConfig)`

- 负责创建/复用实际运行 n8n 的容器。
- 关键行为：
  - 查找名为 `ai-server-n8n` 的容器：
    - 若存在：
      - 确保加入 `MANAGED_NETWORK_NAME`。
      - 若已在运行，直接返回 success；否则执行 `start()`。
  - 若不存在：
    - 从 `appSettings` 中读取 n8n 模块端口：
      - `settings.modules.n8n.port`，若未设置则使用 `defaultAppSettings.modules.n8n.port`。
    - 组合环境变量 `env`：
      - 数据库相关：`DB_TYPE=postgresdb`、`DB_POSTGRESDB_HOST`/`PORT`/`DATABASE`/`USER`/`PASSWORD`。
      - 应用端口：`N8N_PORT=5678`。
      - 额外用户配置：`settings.modules.n8n.env` 中的 KV。
      - 调用 `applyHostTimeZoneToEnv(env)` 注入 TZ。
    - 通过 `resolveLocalImageReference(moduleImageMap.n8n)` 获取镜像引用。
    - 使用 HostConfig：
      - 将容器端口 `5678` 绑定到宿主机 `HostPort = basePort`。
      - Volume 绑定：`N8N_DATA_VOLUME_NAME:/home/node/.n8n`。

#### 2.4.3 HTTP 就绪检查：`waitForN8nReady(port, timeoutMs, intervalMs)`

- 通过 `http.request` 请求 `http://127.0.0.1:<port>/`。
- 判断条件：
  - 状态码在 2xx 且响应体不包含 "n8n is starting up" 时视为就绪。
- 若在超时时间内始终未通过检查，则抛出错误 `n8n HTTP ready timeout`。

#### 2.4.4 综合入口：`ensureN8nRuntime()`

- 调用顺序：
  1. 打日志：`[n8n] ensureN8nRuntime: start`（受 `isVerboseLoggingEnabled` 控制）。
  2. 调用 `ensureN8nSecretsInSettings()` 确保加密秘钥存在。
  3. `ensureN8nPostgres()` 确保 DB 容器就绪。
  4. `ensureN8nContainer(dbConfig)` 确保 n8n 容器就绪。
  5. 基于 `appSettings.modules.n8n.port` 做 HTTP 就绪检查 `waitForN8nReady(hostPort)`。
- 返回：
  - 成功：`{ success: true }`。
  - 失败：携带详细错误信息，主进程会把这个 error 传回渲染进程并展示给用户。

> 对新模块而言，建议仿照本文件：
>
> - 拆分为：
>   - `ensure<Module>Database()` / `ensure<Module>Redis()` 等基础服务函数。
>   - `ensure<Module>Container()`：实际应用容器管理。
>   - `waitFor<Module>Ready()`：HTTP/健康检查逻辑。
>   - `ensure<Module>Runtime()`：统一 orchestration 入口。

---

### 2.5 IPC 处理与模块生命周期（`ipc-handlers.js`）

#### 2.5.1 模块启动：`modules:start`

- IPC 通道：`'modules:start'`（preload 中封装为 `window.api.startModule`）。
- 针对 n8n 的分支：

```js
if (moduleId === 'n8n') {
  const runtimeResult = await ensureN8nRuntime()
  if (!runtimeResult || !runtimeResult.success) {
    return { success: false, error: runtimeResult?.error || '启动 n8n 运行环境失败。' }
  }
  return { success: true }
}
```

- 其他模块（oneapi/dify）也采用类似模式，各自调用自己的 `ensureXxxRuntime`。

#### 2.5.2 模块重启：`n8n:restart`

- IPC 通道：`'n8n:restart'`（preload 中封装为 `window.api.restartN8n`）。
- 逻辑：
  1. 检查 Docker 状态必须 installed & running。
  2. 清理旧容器：
     - 根据 `moduleDockerConfig.n8n` 找到所有相关容器。
     - 对运行中的容器执行 `stop()`，然后统一 `remove({ force: true })`。
  3. 调用 `ensureN8nRuntime()` 重新启动数据库与 n8n 容器，并做 HTTP 就绪检查。

#### 2.5.3 模块列表与状态：`modules:list`

- IPC 通道：`'modules:list'`（用于 Dashboard / Settings 获取模块列表及状态）。
- 对每个 `config.modules` 中定义的模块：
  - 基于 `moduleDockerConfig[moduleId].containerNames` 和 `docker.listContainers()` 判断容器状态：
    - running / restarting / dead / stopped
  - 合成 `ModuleInfo`：
    - `status` 与 `port` 可能会结合 Docker 实际端口进行覆盖。
    - `enabled` 字段则结合 `appSettings.modules[moduleId].enabled`。

#### 2.5.4 监控指标：`monitor:getModules`

- IPC 通道：`'monitor:getModules'`。
- 使用 `docker.stats()` 获取各容器的 CPU/内存使用比例，聚合为 `ModuleRuntimeMetrics[]`。
- Dashboard 前端会调用 `window.api.getModuleMetrics()` 获取这些信息，叠加到服务卡片中。

#### 2.5.5 日志与导出：`logs:list` / `logs:export`

- n8n、oneapi、dify 等容器的日志通过 Docker 容器日志收集：
  - 匹配容器名：根据 `moduleDockerConfig`。
  - 使用 `container.logs({ stdout: true/false, stderr: true/false, timestamps: true, since })` 拉取日志。
  - 解析时间戳、清理 ANSI 颜色码与前缀，统一转换为 `LogItem`。
- 渲染进程通过 `window.api.getLogs({ module: 'n8n', ... })` 进行查询。

---

## 三、预加载层与前端 API（`preload/preload.js` & `shared/window-api.ts`）

### 3.1 `preload/preload.js`

- 使用 `contextBridge.exposeInMainWorld('api', api)` 将一组 IPC 封装暴露给渲染进程。
- 与 n8n 模块相关的主要方法：
  - `listModules()` → `ipcRenderer.invoke('modules:list', {})`
  - `startModule(moduleId)` → `ipcRenderer.invoke('modules:start', { moduleId })`
  - `stopModule(moduleId)` → `ipcRenderer.invoke('modules:stop', { moduleId })`
  - `restartN8n()` → `ipcRenderer.invoke('n8n:restart', {})`
  - `getModuleMetrics()` → `ipcRenderer.invoke('monitor:getModules', {})`
  - `getLogs()` / `exportLogs()` / `clearLogs()`：供 Logs 页面使用。

### 3.2 `shared/window-api.ts`

- 定义渲染进程看到的 `WindowApi` TypeScript 类型：
  - 和 preload 中暴露的方法一一对应：
    - `restartN8n(): Promise<{ success: boolean; error?: string }>` 等。
- 通过声明 `window.api: WindowApi`，前端可以获得类型提示。

> 新模块要点：
>
> - 在 preload 中增加对应的 IPC 封装（例如 `restartMyModule`）。
> - 在 `window-api.ts` 中增加同名方法的类型定义。

---

## 四、渲染进程集成

### 4.1 Dashboard 主页（`pages/Dashboard.tsx`）

- 使用 `window.api.listModules()` 获取所有模块（含 n8n）的基础信息。
- 首次渲染：
  - 只用 `modules` + `AppSettings` 计算出启用的模块列表，映射为 `ServiceModule[]`（包括 n8n）。
- 后台异步拉取运行时指标：
  - 调用 `window.api.getModuleMetrics()`，将返回的 `ModuleRuntimeMetrics` 按 `moduleId` 归并到各服务卡片上，更新 CPU/内存百分比。
- 点击模块卡片上的“启动/停止”：
  - 启动：
    - `window.api.startModule('n8n')` → IPC `'modules:start'` → `ensureN8nRuntime()`。
  - 停止：
    - `window.api.stopModule('n8n')` → IPC `'modules:stop'` → 停止容器并可能停止基础服务。
- “打开”按钮路由跳转：
  - n8n 的路由：`/n8n`（对应 `ModuleN8n.tsx`）。

### 4.2 n8n 设置页（`pages/settings/ModuleSettings.tsx`）

在 `ModuleSettings` 组件内部，针对 `moduleKey === 'n8n'` 的分支实现了完整的 n8n 配置界面：

- **模块启用/禁用**：
  - `启用 n8n 模块` 开关：
    - 关闭前先通过 `window.api.listModules()` 检查当前 n8n 是否在运行：
      - 若 `running` 或 `starting`，阻止禁用并提示用户先在首页停止服务。

- **端口配置**：
  - `服务端口` 输入框：写入 `AppSettings.modules.n8n.port`。
  - `n8n 控制台 URL` / `Webhook 外网地址`：
    - 基于端口推导 `http://localhost:<port>` 和 `.../webhook`，仅用于展示参考。

- **日志等级**：
  - 下拉框选择 `error/warn/info/debug`：
    - 实际写入 `modules.n8n.env.N8N_LOG_LEVEL`，若未设置则默认使用 `settings.logLevel`。

- **数据库模式**：
  - `数据库模式（开发中）`：
    - `managed`：使用内置托管 Postgres（由 `runtime-n8n` 自动管理）。
    - `external`：使用外部 PostgreSQL，显示额外输入框：
      - `外部数据库主机` / `端口` / `数据库名称` / `数据库用户` / `数据库密码`。
    - 对应的值映射到 env：
      - `DB_POSTGRESDB_HOST` / `DB_POSTGRESDB_PORT` / `DB_POSTGRESDB_DATABASE` / `DB_POSTGRESDB_USER` / `DB_POSTGRESDB_PASSWORD`。

- **自定义环境变量**：
  - 文本区“一行一个 KEY=VALUE”：
    - 会被解析成 `modules.n8n.env` 中除保留字段（数据库相关、秘钥、N8N_LOG_LEVEL）以外的键值对。

- **安全秘钥展示与复制**：
  - UI 上列出三类秘钥：
    - `N8N_ENCRYPTION_KEY`
    - `N8N_JWT_SECRET`
    - `N8N_USER_MANAGEMENT_JWT_SECRET`
  - 行为：
    - 若未生成，则提示“尚未生成（启动 n8n 后将自动生成）”。
    - 支持“复制”与“显示/隐藏”操作。
    - 复制失败会通过 toast 提示用户。

- **保存与应用并重启**：
  - `保存 n8n 设置`：调用父级传入的 `onSave`（最终走 IPC `settings:update`）。
  - `应用并重启`：
    - 先调用 `onSave` 持久化设置。
    - 再调用 `window.api.restartN8n()`：
      - 后端走 `ipcMain.handle('n8n:restart')` → 清理旧容器 → `ensureN8nRuntime()`。

### 4.3 n8n 模块入口页（`pages/ModuleN8n.tsx`）

- 当前实现为简单占位：

```tsx
export function N8nModulePage() {
  return <ModulePlaceholder moduleId="n8n" />
}
```

- 未来可替换为：
  - 嵌入 n8n 控制台 iframe。
  - 或提供“打开浏览器访问 n8n 控制台”的跳转按钮等。

### 4.4 日志页面与 n8n

- `LogsPage` 通过 `useSearchParams` 读取 `?module=n8n`，自动选中 n8n 模块筛选。
- 通过 `window.api.getLogs({ module: 'n8n', ... })` 查询 n8n 模块相关日志。
- UI 中模块列表包含 `n8n` 选项。

---

## 五、以 n8n 为模板添加新模块的 Checklist

当需要添加一个新的模块（例如 `myservice`）时，可以以 n8n 的实现为蓝本，按以下步骤进行：

1. **类型层（`src/shared/types.ts`）**：
   - 在 `ModuleId` 中加入 `'myservice'`。
   - 如需日志模块枚举，在 `LogModule` 中加入 `'myservice'`。

2. **配置层（`src/main/config.js`）**：
   - 在 `modules` 数组中新增一条：
     - 配置 `id`、`name`、`description`、`category`、`port` 等。
   - 在 `moduleDockerConfig` 中增加：
     - `myservice: { containerNames: [...] }`。
   - 在 `moduleImageMap` 中增加镜像映射：
     - `myservice: 'your/image:tag'` 或拆成 `myserviceApi` / `myserviceWeb` 等。
   - 定义需要的网络、数据卷常量。

3. **应用设置层（`src/main/app-settings.js`）**：
   - 在 `defaultAppSettings.modules` 中增加 `myservice` 条目：
     - `enabled`、`port`、`databaseUrl`（可选）、`env` 等。
   - 如有秘钥自动生成需求：
     - 仿照 `ensureN8nSecretsInSettings` 实现 `ensureMyserviceSecretsInSettings`。

4. **Docker 工具层（`src/main/docker-utils.js`）**：
   - 在 `moduleBaseServiceContainers` 中声明对基础服务的依赖（如共享 DB/Redis）。
   - 若有特殊逻辑，可以借助或扩展现有工具函数。

5. **运行时 orchestration（`src/main/runtime-myservice.js`）**：
   - 参考 `runtime-n8n.js`：
     - `ensureMyserviceDatabase()` / `ensureMyserviceRedis()`；
     - `ensureMyserviceContainer()`；
     - `waitForMyserviceReady()`；
     - `ensureMyserviceRuntime()`。
   - 重点确保：
     - 正确使用 `config.js` 中的常量与镜像映射。
     - 对 HTTP 健康检查的路径与返回值判断逻辑符合新服务特性。

6. **IPC 层（`src/main/ipc-handlers.js`）**：
   - 在 `modules:start` 中为新模块添加分支：
     - 调用 `ensureMyserviceRuntime()`。
   - 如需“应用并重启”，增加 `myservice:restart` 的 IPC 处理：
     - 清理旧容器 → 调用 `ensureMyserviceRuntime()`。
   - 若需要特殊 logs/monitor 行为，则在相关 handler 中增加 case。

7. **预加载与类型（`src/preload/preload.js` & `src/shared/window-api.ts`）**：
   - 在 preload 中暴露：
     - `restartMyservice`、以及可能的其它操作。
   - 在 `window-api.ts` 中声明对应方法签名。

8. **前端 Dashboard 集成**：
   - Dashboard 已基于 `ModuleInfo` 与 `ModuleId` 泛型化，理论上新增模块后自动出现在服务列表中（前提是 `modules` 配置正确、`AppSettings.modules` 中 enabled）。
   - 如需独立路由页：
     - 在 router 中增加 `/myservice` 对应的页面组件。
     - 在 `DashboardPage.handleOpenModule` 的 `routeMap` 中加入 `myservice` 条目。

9. **Settings 集成（`ModuleSettings.tsx`）**：
   - 在 `ModuleSettingsProps['moduleKey']` union 中加入 `'myservice'`。
   - 在组件内部新增一个分支：
     - 类似 `if (moduleKey === 'n8n')` 的结构，为新模块提供专用设置 UI：
       - 启用/禁用；
       - 端口配置；
       - 日志级别 / 环境变量 / 外部依赖等；
       - “应用并重启”按钮（调用对应 `window.api.restartMyservice`）。

10. **Logs 页面集成**：
    - 在 `LogsPage` 模块筛选列表中增加 `myservice` 选项与显示文案。
    - 结合 `LogModule` 枚举，使 `getLogs({ module: 'myservice' })` 能正常工作。

---

## 六、小结

- n8n 模块在本项目中已经覆盖了一个**容器化核心服务**在平台内集成所需的完整链路：
  - Docker 层配置与运行时 orchestration；
  - IPC 通道与预加载封装；
  - Dashboard 状态展示与控制；
  - Settings 页中的详细配置与秘钥管理；
  - 日志与监控集成。
- 未来添加新模块时，只要沿着本指南的分层结构（类型 → 配置 → 运行时 → IPC → 预加载 → 前端 UI）逐步补齐，就可以快速扩展新的服务，并保持整体架构与用户体验的一致性。
