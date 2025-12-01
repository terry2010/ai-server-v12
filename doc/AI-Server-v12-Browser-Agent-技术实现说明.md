# AI-Server-v12 Browser Agent 技术实现说明（v1）

> 本文档在《AI-Server-v12 Browser Agent 设计方案》《AI-Server-v12 Browser Agent 开发计划》的基础上，进一步说明 Browser Agent 的技术实现细节。
>
> v1 聚焦：单机环境 + 本机 n8n 调用 + 同步动作 API + 完整 UI + 纯文本日志 + JSON/NDJSON 元数据存储。

---

## 1. 范围与约定

### 1.1 范围

- 本文档主要覆盖：
  - 阶段 1 的实现技术细节；
  - 为阶段 2（远程调用 + 异步任务）预留的扩展点；
  - 日志与元数据的具体文件结构与字段设计；
  - 前端 "AI 浏览器" 标签页与主进程的交互方式。

### 1.2 术语约定

- **Agent**：Browser Agent HTTP 服务及其内部控制逻辑。
- **Session**：一次浏览器会话，对应一个专用 BrowserWindow。
- **Action**：一次原子动作（如 navigate / click / fill / wait / screenshot / dragPath 等）。
- **ClientId**：调用方标识。阶段 1 主要是本机 n8n，后续扩展多调用方时将发挥作用。

---

## 2. 模块划分与目录建议

> 以下为逻辑模块划分，具体文件名可以在实现时微调，建议保持语义清晰、职责单一。

### 2.1 主进程模块

1. **browser-agent-server（HTTP 层）**
   - 职责：
     - 监听 `127.0.0.1:{port}`，解析 HTTP 请求；
     - 预留 token 鉴权能力（未来扩展为 clientId/token 体系，**阶段 1 实现中为方便调试暂未启用**）；
     - 将请求路由到核心 Session/Action 模块；
     - 将结果封装为统一的 JSON 响应结构：`{ ok, errorCode, errorMessage, data }`。
   - 典型职责：
     - `/sessions` 系列路由；
     - `/actions` 系列路由；
     - `/files` / `/logs` 等辅助路由。

2. **browser-agent-core（业务核心层）**
   - 职责：
     - 管理 Session 生命周期（创建 / 查询 / 关闭 / 超时）；
     - 暴露同步 Action 接口（navigate/click/fill/wait/screenshot/...）；
     - 统一封装错误码与 onTimeout 策略；
     - 调用 Playwright 封装与存储层。
   - 关键点：
     - 维护内存态的 `sessionsMap: Map<sessionId, SessionContext>`；
     - SessionContext 中包含：BrowserWindow、Playwright Page 句柄、profile、clientId、创建时间、最后活跃时间等。

3. **browser-agent-playwright（Playwright 封装层）**
   - 职责：
     - 基于 Playwright-core 将 Electron 自带 Chromium 作为浏览器运行时；
     - 提供比原生 Playwright 更贴近业务的 API：
       - `openSessionWindow(profile, viewport, userAgent)`；
       - `navigate(page, url, options)`；
       - `domClick(page, selector, options)`；
       - `domFill(page, selector, text, options)`；
       - `mouseClickPoint(page, x, y, options)`；
       - `mouseDragPath(page, path, options)`；
       - `screenshot(page, mode, options)`；
       - `extractHtml/Text/Table(page, options)` 等。
   - 技术点：
     - 通过 Electron 配置 `remote-debugging-port` 或类似机制，将 Chromium 暴露为 CDP 端点；
     - 使用 `playwright-core` 的 `chromium.connectOverCDP()` 连接到该端点；
     - 根据 BrowserWindow 的标识（如 URL hash 中的 sessionId）匹配到对应的 Page 对象。

4. **browser-agent-storage（日志与 NDJSON 存储层）**
   - 职责：
     - 文本日志写入（类似当前 main 日志）；
     - NDJSON 元数据文件的读写与基本索引管理；
     - 提供查询接口供 UI 与 HTTP 路由使用。
   - 典型接口：
     - `logText(entry: LogEntry)`；
     - `appendSessionRecord(sessionRecord)`；
     - `appendActionRecord(actionRecord)`；
     - `appendFileRecord(fileRecord)`；
     - 查询：`querySessions(filter)`、`queryActions(filter)` 等。

5. **browser-agent-downloads（下载文件管理）**
   - 职责：
     - 挂接在 BrowserWindow session 的 `will-download` 事件上；
     - 将下载文件落盘到统一的数据目录，并在 storage 层登记元数据。

6. **browser-agent-ipc（主进程 <-> 渲染进程）**
   - 职责：
     - 暴露给 renderer 的查询接口，例如：
       - `browserAgent:listSessions`；
       - `browserAgent:getSessionDetail`；
       - `browserAgent:listSnapshots`；
       - `browserAgent:listFiles`；
       - `browserAgent:exportSessions` / `browserAgent:importSessions` 等。

### 2.2 渲染进程模块（React / 前端）

1. **AI 浏览器页容器组件**
   - 挂载在主布局的标签栏中，路径类似 `/browser-agent`；
   - 内部包含：总览区 + 任务列表区 + 详情/回放区。

2. **任务列表组件**
   - 调用 IPC/`window.api.browserAgent.listSessions(filter)` 获取数据；
   - 支持：按时间、profile、clientId、状态过滤；关键字搜索；分页。

3. **任务详情 / 回放组件**
   - 展示：
     - 时间线：从 actions NDJSON 中读取该 session 的动作序列；
     - 截图缩略图：从 snapshots 元数据中读取；
     - 文件列表：从 files 元数据中读取。
   - 回放模式：
     - 以时间线为主线，通过动画/高亮的方式依次展示历史动作和截图；
     - 不实际驱动浏览器，仅基于历史数据做可视化复现。

4. **导出 / 导入 UI**
   - 导出：
     - 前端构造过滤条件（时间范围、profile、clientId、状态），调用 IPC/HTTP 导出为 JSON/NDJSON 文件；
   - 导入：
     - 选择本地 JSON/NDJSON 文件上传给主进程，由 storage 层解析为“只读会话集”，用于回放查看。

---

## 2.3 系统设置中的 Browser Agent 配置

- AppSettings 中新增可选字段 `browserAgent`：
  - `enabled: boolean`：是否启动 Browser Agent HTTP 服务；
  - `port: number`：服务监听端口，默认 26080；
  - `token?: string`：访问令牌（阶段 1 实现中仅作为配置预留，HTTP 服务不会校验该字段）；
  - `dataRoot?: string`：数据目录根路径（供日志与 NDJSON 存储使用）。

- 前端设置入口：
  - 客户端“设置中心 → Agent 设置”标签页；
  - 通过 `window.api.getSettings()` / `updateSettings()` 读写 `browserAgent` 字段；
  - 保存后主进程会：
    - 当 `enabled` 从 false → true：调用 `startBrowserAgentServer()` 启动服务；
    - 当 `enabled` 从 true → false：调用 `stopBrowserAgentServer()` 停止服务；
    - `token` / `dataRoot` 变更后，HTTP 层会在后续请求中自动使用最新值；
    - `port` 仅在服务启动时生效，端口变更推荐通过重启应用或显式重启服务。

- 主进程 HTTP 层 `browser-agent-server` 通过 `getAppSettings()` 动态读取配置：
  - 每次请求时根据最新 `browserAgent` 判断是否启用、解析 dataRoot；
  - token 校验在设计上作为未来能力预留，**阶段 1 实现中不会根据 token 拒绝请求**；
  - 监听地址固定为 `127.0.0.1:{port}`（阶段 1），阶段 2 再拓展为可配置的内网监听地址。

---

## 3. HTTP API 详细说明（阶段 1，同步接口）

> 这里只列出阶段 1 的核心同步接口，URI/字段命名可在实现时适度微调，但建议尽量保持稳定，方便阶段 2/3 复用。

### 3.1 响应结构约定

```jsonc
{
  "ok": true,
  "errorCode": null,
  "errorMessage": null,
  "data": { /* ... */ }
}
```

- `ok`: 布尔，标记本次调用是否成功；
- `errorCode`: 失败时的错误码（如 `TIMEOUT`, `NETWORK_ERROR`, `NO_SUCH_ELEMENT` 等）；
- `errorMessage`: 人类可读的错误信息；
- `data`: 成功时返回的数据结构，随接口而变。

#### 3.1.1 健康检查接口

- `GET /health`
  - 功能：
    - 检查 Browser Agent 服务是否已启用并正常运行；
  - 返回：
    - `data.status = "ok"` 表示服务可用；
  - 典型用途：
    - n8n HTTP 节点或监控系统用来做探活检查；
    - 配合 Agent 设置页中展示的 Base URL，一键验证端口配置是否生效。

#### 3.1.2 调试接口：/debug/playwright-spike

- `GET /debug/playwright-spike` 或 `POST /debug/playwright-spike`
  - 功能：
    - 触发一次 Playwright Spike 调试流程，用于验证 Electron `remote-debugging-port` 和 `playwright-core` 安装是否正常；
  - 行为概述：
    - 在主进程中新建一个 BrowserWindow；
    - 加载 `https://www.baidu.com/?agent_spike=...`，等待页面加载完成；
    - 通过 `chromium.connectOverCDP()` 连接到 Electron 内部的 Chromium，匹配到对应 Page；
    - 在临时目录保存一张整页截图，并在响应中返回 `cdpEndpoint`、`pageUrl`、`pageTitle`、`screenshotPath` 等调试信息；
  - 使用示例（可直接导入 Postman 的 cURL）：

```bash
curl --location --request POST 'http://127.0.0.1:26080/debug/playwright-spike' \
  --header 'Content-Type: application/json'
```

- 注意：
  - 文档中的 cURL 示例均采用 **类 Unix 风格**（`curl --location ... --header ...`，使用 `\` 换行），不包含 PowerShell 的 `^` 换行符，方便直接在 Postman 的 Import → Raw text 中粘贴导入；
  - 阶段 1 实现中未启用 token 鉴权，上述示例不包含任何认证 Header。

### 3.2 会话管理

#### POST /sessions

- 功能：创建一个新的 Session（专用 BrowserWindow）。
- 请求体示例：

```jsonc
{
  "profile": "system-a",         // 业务系统标识
  "clientId": "local-n8n",       // 调用方标识，阶段 1 固定为本机调用
  "viewport": { "width": 1280, "height": 720 },
  "userAgent": "optional UA override"
}
```

- 返回示例：

```jsonc
{
  "ok": true,
  "data": {
    "sessionId": "sess_20250101_0001",
    "createdAt": "2025-01-01T10:00:00Z"
  }
}
```

#### GET /sessions

- 功能：查询当前所有活动 Session（可提供简易过滤）。
- 支持查询参数：`profile`、`clientId`、`status` 等。

#### GET /sessions/{sessionId}

- 功能：查询指定 Session 状态（URL、title、状态、最近错误等）。

#### DELETE /sessions/{sessionId}

- 功能：关闭 Session，销毁 BrowserWindow 与相关资源。

- 阶段 1 中，一个 Session 始终只绑定一个活动 BrowserWindow：
  - 多次调用 `POST /sessions/{sessionId}/navigate` 时，Agent 会优先复用已绑定的 BrowserWindow，在同一窗口中加载新的 URL，而不是为同一 Session 打开多个窗口；
  - 如需并发跑多条任务，应通过创建多个 Session 来实现“1 任务 1 Session 1 窗口”的模式，而不是让单个 Session 维护多窗口。

### 3.3 动作接口（示例）

#### POST /sessions/{sessionId}/navigate

- 请求体：

```jsonc
{
  "url": "https://example.com",
  "waitUntil": "load",              // load/domcontentloaded/networkidle
  "timeoutMs": 30000,
  "onTimeout": "screenshot_and_close"  // none/screenshot_only/refresh/close_session
}
```

- 返回：
  - 成功：当前 URL、title、加载耗时等；
  - 失败：`errorCode = TIMEOUT/NETWORK_ERROR/...`。

#### POST /sessions/{sessionId}/dom/click

```jsonc
{
  "selector": "button[type=submit]",
  "timeoutMs": 10000
}
```

#### POST /sessions/{sessionId}/dom/fill

```jsonc
{
  "selector": "input[name=username]",
  "text": "user1",
  "clearBefore": true,
  "timeoutMs": 10000
}
```

#### POST /sessions/{sessionId}/mouse/drag

```jsonc
{
  "path": [
    { "x": 300, "y": 400, "tMs": 0 },
    { "x": 320, "y": 402, "tMs": 120 },
    { "x": 360, "y": 405, "tMs": 260 }
  ],
  "button": "left",
  "timeoutMs": 10000
}
```

#### POST /sessions/{sessionId}/screenshot

```jsonc
{
  "mode": "viewport",          // full/viewport/element/region
  "selector": "#captcha",      // 当 mode=element 时
  "region": { "x": 0, "y": 0, "width": 800, "height": 600 }, // 当 mode=region 时
  "format": "png",
  "description": "before_login"
}
```

- 返回：`fileId`、文件路径、创建时间等。

#### POST /sessions/{sessionId}/content/html

- 返回当前页面 HTML，主要用于调试或离线分析。

#### POST /sessions/{sessionId}/content/text

- 按 `scope`（page/selector）返回纯文本。

#### POST /sessions/{sessionId}/content/table

- 按 selector 解析 `<table>`，返回结构化数据。

### 3.4 文件与元数据访问

#### GET /sessions/{sessionId}/files

- 返回该会话下载的文件列表（fileId、名称、大小、时间等）。

#### GET /files/{fileId}

- 直接下载指定 fileId 对应的文件内容。

#### GET /sessions/{sessionId}/snapshots

- 返回该会话的截图列表（snapshotId、描述、时间、文件路径等）。

---

## 4. 存储设计：文本日志 + JSON/NDJSON + 简单索引

### 4.1 根目录与路径规范

- 配置项：`browserAgent.dataRoot`，默认：`{应用工作目录}/data/browser-agent/`；
- 目录结构示例：

```text
{dataRoot}/
  logs/
    browser-agent-2025-01-01.log
    browser-agent-2025-01-02.log
  meta/
    sessions-2025-01-01.ndjson
    actions-2025-01-01.ndjson
    files-2025-01-01.ndjson
    snapshots-2025-01-01.ndjson
  sessions/
    {sessionId}/
      screenshots/
        {snapshotId}.png
      files/
        {fileId}.dat
```

- 可以按照日期分片存储 NDJSON 文件，避免单文件过大。

### 4.2 日志文件格式（文本）

- 类似当前 main 日志的格式，例如：

```text
2025-01-01T10:00:00.123Z [INFO] [BrowserAgent] [client=local-n8n] [session=sess_001] action=navigate url=https://example.com result=ok duration=1234ms
2025-01-01T10:00:01.456Z [ERROR] [BrowserAgent] [client=local-n8n] [session=sess_001] action=waitForSelector selector=#login error=TIMEOUT
```

- 阶段 1 的实现中，主进程会在每次 Browser Agent 动作完成后（如 `navigate` / `dom.fill` / `dom.click` / `screenshot` 等）输出一行日志，包含 `sessionId`、`action`、关键 selector（如适用）以及最终 `pageUrl`，便于排查例如“输入 → 点击”等动作链路中的 URL 变化情况。

- 主要用于：
  - 人工查看；
  - 在任务详情页中展示相关日志片段；
  - 必要时导出到集中日志平台。

### 4.3 NDJSON 元数据结构

#### 4.3.1 sessions.ndjson

每行一个 JSON 对象，例如：

```jsonc
{
  "sessionId": "sess_20250101_0001",
  "profile": "system-a",
  "clientId": "local-n8n",
  "status": "completed",        // running/idle/completed/failed/timeout/aborted
  "createdAt": "2025-01-01T10:00:00Z",
  "finishedAt": "2025-01-01T10:05:00Z",
  "lastErrorCode": null,
  "lastErrorMessage": null
}
```

#### 4.3.2 actions.ndjson

```jsonc
{
  "id": "act_001",
  "sessionId": "sess_20250101_0001",
  "type": "navigate",           // navigate/click/fill/wait/screenshot/...
  "params": {
    "url": "https://example.com",
    "waitUntil": "load"
  },
  "startAt": "2025-01-01T10:00:00.100Z",
  "endAt": "2025-01-01T10:00:01.200Z",
  "status": "ok",               // ok/failed/timeout
  "errorCode": null,
  "errorMessage": null,
  "snapshotId": "snap_001"     // 如有截图，可关联
}
```

#### 4.3.3 files.ndjson / snapshots.ndjson

- `files.ndjson`：

```jsonc
{
  "fileId": "file_001",
  "sessionId": "sess_20250101_0001",
  "path": "sessions/sess_20250101_0001/files/file_001.dat",
  "name": "report.xlsx",
  "size": 123456,
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "createdAt": "2025-01-01T10:03:00Z"
}
```

- `snapshots.ndjson`：

```jsonc
{
  "snapshotId": "snap_001",
  "sessionId": "sess_20250101_0001",
  "actionId": "act_005",
  "path": "sessions/sess_20250101_0001/screenshots/snap_001.png",
  "description": "login_page_before_submit",
  "createdAt": "2025-01-01T10:01:00Z"
}
```

### 4.4 简单索引与查询策略

- 内存索引：
  - 启动时可增量/按需加载最近一段时间的 sessions/actions 元数据到内存结构中（例如 Map/多级索引），支持：
    - 按 sessionId 快速查找；
    - 按 profile/clientId/status/timeRange 过滤；
  - 历史数据查询可走“按日期文件 + 顺序扫描”的方式，结合前端分页使用。

- 按调用方过滤：
  - 所有 Session/Action 记录中都带 `clientId` 字段；
  - UI 中的“调用方”过滤即转换为 `clientId` 维度的查询；
  - 阶段 1 中 `clientId` 主要是 `local-n8n`；阶段 2 以后支持更多调用方。

### 4.5 导出 / 导入与回放实现要点

- 导出：
  - 根据筛选条件选出一批 Session，对应地选出相关的 Actions/Snapshots/Files 元数据；
  - 组合成一个 JSON/NDJSON 包，供用户下载；
  - 不强制包含真实文件内容（截图/下载文件），可以通过路径与备份策略配合使用。

- 导入：
  - 将导入的数据写入单独的“只读回放空间”（不与实时运行数据混用）；
  - 在 UI 中将这些会话标记为 `replay` 类型，只用于展示与回放，不参与实际调度与调用。

---

## 5. 超时、错误码与 onTimeout 策略

### 5.1 错误码约定（示例）

- `TIMEOUT`：动作在指定 `timeoutMs` 内未完成；
- `NETWORK_ERROR`：DNS 失败、连接失败等；
- `HTTP_ERROR`：HTTP 状态码异常（4xx/5xx）；
- `NO_SUCH_ELEMENT`：目标元素不存在或不可见；
- `ANTI_BOT_PAGE`：识别到反爬/验证码/风控页面；
- `INTERNAL_ERROR`：未分类的内部异常。

### 5.2 onTimeout 策略

- 枚举值（初版建议）：
  - `none`：不做额外处理，仅返回 TIMEOUT 错误；
  - `screenshot_only`：记录当前页面截图与日志；
  - `refresh`：记录截图后刷新页面；
  - `close_session`：记录截图后关闭 Session。

- 策略执行：
  - 由 browser-agent-core 在捕获超时异常后，根据配置统一执行；
  - 执行结果写入 actions/snapshots NDJSON 与文本日志。

---

## 6. 与前端 UI 的集成要点

- 渲染进程不直接访问文件系统与 NDJSON 文件，一律通过主进程 IPC：
  - 列表查询：`browserAgent:listSessions(filter)`；
  - 详情查询：`browserAgent:getSessionDetail(sessionId)`；
  - 导出/导入：`browserAgent:exportSessions(filter)` / `browserAgent:importSessions(file)`。

- 前端只关注：
  - JSON 结构（sessions/actions/files/snapshots）；
  - 过滤参数（时间区间、profile、clientId、状态、关键字）；
  - 回放时的 UI 表现（时间线/截图/日志展示），不感知底层存储实现。

- **Dashboard 模块卡片与路由集成**：
  - 在首页 Dashboard 的模块列表区域增加一个「AI 浏览器」模块卡片，用于作为 Browser Agent 的唯一入口；
  - 卡片的显示条件：仅当 `appSettings.browserAgent?.enabled === true` 时才渲染；
    - 当 Browser Agent 在「系统设置 → Agent 设置」中被关闭时，首页不显示该卡片，避免出现实际不可用的入口；
  - 点击卡片的「打开」按钮后，路由跳转到 `/browser-agent` 页面：
    - 该页面挂载在现有 `AppLayout` 之下，复用顶部标签栏与整体布局风格；
    - 顶部标签栏继续展示 n8n/Dify/OneAPI/RagFlow 等模块标签，但 `/browser-agent` 页面本身不会创建 BrowserView 或绑定 Docker 模块，仅用于展示 AI 浏览器任务列表与详情；
  - 左侧 SideNav（仪表盘 / 在线教程 / AI 市场 / 系统设置 / 系统日志 / 性能监控）**不增加**「AI 浏览器」单独入口，避免导航层级过多，保持“从 Dashboard 进入模块”的统一模式。

### 6.3 与 n8n HTTP 节点的推荐配置

- 调用 Browser Agent 的基础配置：
  - Base URL：`http://127.0.0.1:{port}`，与「Agent 设置」页中展示的端口一致；
  - Headers：
    - 阶段 1 实现中 HTTP 服务不会校验 `browserAgent.token`，因此可以不设置任何鉴权 Header；
    - 若考虑与未来版本兼容，可提前按 `X-Browser-Agent-Token: <token>` 或 `Authorization: Bearer <token>` 的方式编写 Header，但当前不会影响行为。

- 典型 n8n HTTP Request 节点示例：
  - 创建会话：
    - Method: `POST`
    - URL: `{{ $json.baseUrl || "http://127.0.0.1:26080" }}/sessions`
    - Body (JSON)：`{ "profile": "system-a", "clientId": "local-n8n" }`
  - 页面导航：
    - Method: `POST`
    - URL: `{{ $json.baseUrl || "http://127.0.0.1:26080" }}/sessions/{{ $json.sessionId }}/navigate`
    - Body：`{ "url": "https://www.baidu.com", "waitUntil": "load", "timeoutMs": 30000 }`
  - 页面交互与截图：
    - 后续节点依次调用 `/dom/fill`、`/dom/click`、`/screenshot` 等接口，并在 n8n 中通过变量传递 `sessionId` 与关键字段。

- 文档中给出的示例仅为抽象流程（如“登录 + 导出文件”），实际业务系统名称与参数由使用方自行替换；所有 cURL 示例均按 **Postman 兼容的类 Unix 风格** 书写，可直接在 Postman 的 Import → Raw text 中粘贴导入。

---

## 7. 后续演进预留

- 若未来迁移至 PgSQL / MySQL：
  - 以当前 NDJSON 结构作为导入源，实现一次性 ETL 脚本；
  - 将 sessions/actions/files/snapshots 导入到对应关系表；
  - storage 层改为基于数据库的实现，但对上层 API 与前端 UI 保持兼容。

- 若未来需要更复杂的搜索（全文检索、聚合分析）：
  - 可将 NDJSON/数据库中的记录同步到 ELK / ClickHouse 等系统，供审计与数据分析使用。

---

> 本技术实现说明主要服务于开发阶段的模块划分与代码落地，实际编码过程中如有偏差，可在保持外部接口与数据结构稳定的前提下适当调整内部实现细节。
