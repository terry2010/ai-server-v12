# AI-Server-v12 Browser Agent 开发计划（v1 草案）

> 本文档基于《AI-Server-v12 Browser Agent 设计方案（v1）》编写，拆分为三个开发阶段：
> 1. 核心功能 + 完整 UI + 本机 n8n 调用 + 完整文本日志；
> 2. 远程调用（机房内网）+ 异步任务 + 回调；
> 3. n8n 社区节点 + 试运行优化与缺陷修复。
>
> 内部浏览器控制技术路线：**Playwright-core + Electron 自带 Chromium（BrowserWindow）**。

---

## 1. 总体目标与约束

### 1.1 总体目标

- 为 AI-Server 客户端提供一套可复用的本地 Browser Agent 能力：
  - 统一封装浏览器自动化动作（导航、点击、填写、截图、内容提取、文件下载 / 上传等）；
  - 通过 HTTP/JSON 与外部编排系统（优先是 n8n）集成；
  - 提供 AI 浏览器内部 UI，支持任务监控、调试、审计与回放。

- 演进路线：
  - **阶段 1**：聚焦单机场景，打好功能与 UI 基础；
  - **阶段 2**：拓展到机房多客户端 + n8n 集群，通过内网远程调用与异步任务；
  - **阶段 3**：封装 n8n 社区节点，支撑更大规模试运行，并针对反馈做优化。

### 1.2 关键约束

- 技术路线：
  - 使用 **Playwright-core** 驱动 Electron 自带 Chromium，控制专用 BrowserWindow；
  - 不引入独立 Chrome/Chromium 二进制，尽可能控制安装包体积。

- 安全与部署：
  - 阶段 1：仅监听 127.0.0.1，只支持本机 n8n 调用；
  - 阶段 2：仅支持机房内网远程调用，不考虑公网暴露场景；
  - 始终通过受控 API 暴露动作，不提供原始 CDP / 任意 JS 执行能力。

- 日志与审计：
  - 阶段 1 即实现 **完整文本日志**（风格类似当前 main 日志）+ 结构化元数据；
  - 日志与元数据必须支持后续“导出 / 导入 + 回放”的需求，用于审计与讲解。

---

## 2. 阶段划分与时间预估（粗略）

> 以下工期为单人开发的粗略估算，仅供排期参考，实际可按优先级微调。

- **阶段 1：核心功能 + 完整 UI + 本机 n8n + 完整文本日志**
  - 预估：约 **10–15 个工作日**。

- **阶段 2：远程调用（内网）+ 异步任务 + 回调**
  - 预估：约 **8–12 个工作日**。

- **阶段 3：n8n 社区节点 + 试运行优化与修复**
  - 预估：约 **8–12 个工作日**（随试运行规模和反馈而变）。

整体结束时长预期：**约 4–6 周** 的开发 + 联调周期。

---

## 3. 阶段 1：核心功能 + 完整 UI + 本机 n8n + 完整文本日志

### 3.1 阶段目标

- 在单机环境完成 Browser Agent 的 v1 能力闭环：
  - Playwright-core + BrowserWindow 的最小可用集成；
  - 同步 HTTP API（会话管理 + 核心动作）；
  - 完整的文本日志 + 元数据落盘；
  - AI 浏览器内部 UI：总览、任务列表、任务详情、搜索、导出/导入 + 回放；
  - 支持本机 n8n 通过 HTTP 节点调用。

### 3.2 主要工作项

#### 3.2.1 技术 Spike：Playwright-core + BrowserWindow

- 在 Electron 主进程中引入 Playwright-core：
  - 选型：仅安装 `playwright-core`，不附带浏览器二进制；
  - 通过 Electron 提供的调试端口或直接集成，建立 Playwright 与 BrowserWindow 的连接。
- PoC 验证：
  - 创建一个专用 BrowserWindow；
  - 使用 Playwright 打开指定 URL，执行简单 `click` / `fill` / `screenshot` 操作；
  - 验证与现有主窗口 / BrowserView 的隔离性与稳定性。
- 调试接口（内部使用）：
  - 暂定提供 `GET/POST /debug/playwright-spike`；
  - 打开一个新窗口访问 `https://www.baidu.com/?agent_spike=...` 并截取页面截图，返回 `screenshotPath` 等调试信息；
  - 主要用于验证：Electron `remote-debugging-port`、`playwright-core` 安装是否正常；
  - 文档中给出的 cURL 示例采用 **类 Unix 风格**（`curl --location ... --header ...`），可直接粘贴到 Postman 的 Import → Raw text 中导入，不使用 PowerShell 的 `^` 换行符。

#### 3.2.2 Browser Agent HTTP 服务（仅本机）

- 在主进程中启动一个仅监听 127.0.0.1 的 HTTP 服务：
  - 端口可配置（系统设置 + 配置文件）：
    - 在客户端“设置中心 → Agent 设置”标签页中配置 `enabled`、`port`、`token`、`dataRoot`；
    - `enabled` 控制是否启动 Browser Agent HTTP 服务；
    - `port` 为监听的本地端口，当前版本端口变更建议通过重启应用生效；
    - `token` 字段预留为访问令牌配置项，**阶段 1 的实现中暂未启用鉴权逻辑**，便于本机调试；
    - `dataRoot` 为可选数据目录，供日志与 NDJSON 元数据模块使用。
  - 简单 token 鉴权（环境变量或配置）的设计预留：
    - 目标形态是：UI 中的 `token` 优先，其次是环境变量 `AI_SERVER_BROWSER_AGENT_TOKEN`；
    - 支持 `X-Browser-Agent-Token: <token>` 或 `Authorization: Bearer <token>` 两种写法；
    - 但在 v1 实现阶段，HTTP 服务不会根据 token 做校验，后续阶段再按设计开启鉴权并更新文档示例。

- 实现基础路由分层：
  - `/sessions/*`：会话管理；
  - `/actions/*`：面向单 session 的原子动作（也可设计为 `/sessions/{id}/...` 风格）；
  - `/logs/*`、`/files/*` 等后续扩展接口预留。

#### 3.2.3 会话管理与生命周期

- `POST /sessions`：创建会话
  - 创建专用 BrowserWindow；
  - 绑定 profile（如业务系统标识）、viewport、userAgent 等；
  - 返回 `sessionId`。

- `GET /sessions` / `/sessions/{id}`：查询会话状态
  - 当前 URL、状态（running/idle/completed/failed/timeout）、最近错误等。

- `DELETE /sessions/{id}`：关闭会话
  - 销毁 BrowserWindow，释放相关 Playwright/page 对象。

- 生命周期与超时：
  - 实现 `maxSessionDuration` / `maxIdleDuration`（全局配置 + 每会话可覆盖）；
  - 超时自动：记录日志 + 最终截图 + 关闭会话。

#### 3.2.4 核心同步动作 API

- 页面导航与等待：
  - `navigate(url, waitUntil, timeoutMs, onTimeout)`；
  - `waitForSelector` / `waitForText` / `waitForUrlContains`；
  - 明确超时错误码 + 可选 onTimeout 行为（如截图 + 记录）。

- DOM 级交互：
  - `click(selector)`、`fill(selector, text)`、`scrollIntoView(selector)`；
  - 支持简单的输入节奏控制与 basic 错误处理（selector 不存在 / 不可见等）。

- 坐标级交互：
  - `clickPoint(x, y)`；
  - `dragPath(path[{x,y,tMs}])`：满足滑块验证码等复杂行为的基本需要。

- 截图：
  - 视口 / 元素 / 指定区域；
  - 生成文件放到本地目录，返回 fileId/path；
  - 可附带描述（用于任务时间线和审计）。

- 内容提取（基础版）：
  - `getHtml()`、`getText(scope/page or selector)`；
  - `extractTable(selector)`：简单结构化表格为二维数组或对象数组。

- 文件下载管理（基础版）：
  - 拦截下载，保存到 `data/browser-agent/{sessionId}/files`；
  - `listFiles(sessionId)` + `getFile(fileId)` 接口。

#### 3.2.5 日志与元数据

- 文本日志（类似 main 日志）：
  - 每个 HTTP 调用记录一行：时间戳、sessionId、client（本机）、动作类型、入参摘要、结果、错误。
  - 日志文件按日期滚动，配置最大大小与保留天数。

- 结构化元数据（v1）：
  - 不引入 SQLite 等本地数据库，优先采用“纯文本 + JSON/NDJSON 文件 + 简单索引”的方案：
    - `sessions.ndjson`：每行一个会话记录，包含 sessionId、profile、clientId、状态、时间等；
    - `actions.ndjson`：每行一个动作记录，包含 sessionId、actionType、params、时间戳、结果等；
    - `files.ndjson` / `snapshots.ndjson`：文件与截图元数据；
  - 通过内存索引或简单的倒排索引文件（例如按日期 / clientId / profile 分片的索引）支撑常见查询和 UI 过滤；
  - 设计 JSON 结构时尽量靠近关系型表结构，以便未来如需迁移到 PgSQL / MySQL，只需实现一次性导入脚本即可。

- 为“导出 / 导入 + 回放”预留字段：
  - 确保 actions 中记录足够信息（type、params、时间序列）可在后续阶段回放；
  - 文本日志主要用于人工阅读，回放更依赖 `browser_actions` 等结构化表。

#### 3.2.6 AI 浏览器前端 UI（完整）

- 总览页：
  - Agent 启用状态、端口、最大并发、当前 session 数 / 历史任务总数；
  - 快捷入口：打开配置、清理空闲会话等。

- 任务列表页：
  - 列表字段：sessionId、profile、状态、开始/结束时间、总耗时、最近错误摘要；
  - 筛选：按时间区间、profile、状态；
  - 搜索：按任务 ID、错误片段、备注关键字等搜索历史任务。

- 任务详情页：
  - 时间线：按顺序展示所有动作（navigate/click/fill/...），包含时间、耗时、结果；
  - 截图区：缩略图预览 + 点击放大；
  - 文件区：列出下载文件（文件名、大小、时间）与操作按钮；
  - 控制区：打开任务窗口、终止任务、标记为人工介入。

- 历史任务导出 / 导入 + 回放：
  - 导出：
    - 支持按筛选条件（时间范围、profile、状态等）导出一批任务数据（sessions + actions + snapshots 元数据引用）为 JSON/NDJSON；
  - 导入：
    - 可以在 UI 中导入导出的任务数据，在“回放模式”下复现时间线与截图；
    - 回放时不实际操作浏览器，只基于历史动作与截图做可视化重现，用于审计与培训讲解。

- 调试增强（可视化日志）：
  - 在任务详情页中展示与该 session 相关的文本日志片段，便于快速排查问题。

#### 3.2.7 与本机 n8n 的集成

- 使用 n8n 自带 HTTP Request 节点：
  - 演示创建 session、导航、截图、点击、等待等基本流程；
  - 演示下载文件并在 n8n 中继续处理；
  - 推荐统一通过「Agent 设置」页中展示的 `http://127.0.0.1:{port}` 作为 Base URL。

- 编写简要使用说明：
  - 配置项：Browser Agent 端口、token（在「Agent 设置」页中配置，**阶段 1 实现中 token 仅作预留，不参与鉴权**）；
  - HTTP Request 节点推荐模板（示意）：
    - Base URL：`http://127.0.0.1:26080`（或实际配置的端口）；
    - 示例中的 Header（如 token）在当前阶段可以省略；如需为未来版本提前预留，可按 `X-Browser-Agent-Token` 或 `Authorization: Bearer` 的形式书写；
    - 本文档及相关技术说明中给出的 cURL 示例统一采用 **Postman 兼容的类 Unix 风格**（`curl --location ... --header ...`，不包含 PowerShell 的 `^` 换行），便于在 Postman Import → Raw text 中直接粘贴导入；
    - 用例：
      - `POST /sessions` 创建会话；
      - `POST /sessions/{sessionId}/navigate` 导航到目标页面；
      - `POST /sessions/{sessionId}/dom/fill` / `dom/click` 执行表单填写与按钮点击；
      - `POST /sessions/{sessionId}/screenshot` 在关键步骤截取页面；
    - 可通过 n8n 的变量与条件节点编排“登录 → 导出 → 下载文件”等通用流程；
  - 常见调用模式示例（例如“登录 + 导出文件”通用流程），不含任何真实业务细节。

### 3.3 阶段 1 验收标准（建议）

- 能在单机启动 AI-Server，打开 AI 浏览器 tab：
  - 查看正在运行和历史任务；
  - 搜索历史任务并查看详情（时间线、截图、文件）。
- 能通过本机 n8n HTTP 节点调用 Browser Agent：
  - 完成至少一条端到端流程（例如：打开某公共网站 → 提取一段文本 → 截图 → 下载简单文件）。
- 能将某时间段内的任务导出为 JSON，并在另一个环境导入后回放查看。

---

## 4. 阶段 2：远程调用（内网）+ 异步任务 + 回调

### 4.1 阶段目标

- 支持在机房内，n8n 集群远程调用多台安装了 AI-Server 的客户端；
- 在现有同步动作 API 之上，增加异步“任务脚本”与回调能力；
- 加强安全与配额控制，确保在多调用方、多 Agent 环境下可控运行。

### 4.2 主要工作项

#### 4.2.1 网络与监听配置

- 将 Browser Agent 的监听地址从仅 127.0.0.1 扩展为可配置：
  - 支持监听特定内网 IP 或 0.0.0.0（仅限机房环境）；
  - 强制要求在防火墙 / 安全组层面限制来源 IP（仅 n8n 集群网段）。

- 文档中明确部署拓扑：
  - 多台客户端 + 中央 n8n 集群；
  - 推荐通过内网负载均衡或服务发现机制管理 Agent 节点列表。

#### 4.2.2 鉴权与配额（内网场景）

- 为每个调用方（clientId）配置独立凭证：
  - 支持 HTTP Basic / Bearer Token；
  - 维护 `clientId -> token` 映射。

- per-client 配额与授权：
  - `allowedProfiles`：可访问的 profile 列表；
  - `maxConcurrentSessions`：最大并发会话数；
  - `rateLimit`：最大 QPS/RPM；
  - `maxActionsPerSession`：限制单 session 的动作数量，防止长时间挂起。

- 基础防滥用：
  - 超配额 / 访问未授权 profile / 域名时返回明确错误并记安全日志；
  - 对频繁异常的 clientId 提供暂时封禁或降级机制（简单实现即可）。

#### 4.2.3 异步任务与回调

- 引入 `/tasks` 概念（独立于 `/sessions`）：
  - `POST /tasks`：提交由一组原子动作组成的任务脚本，内部管理 session 生命周期；
  - `GET /tasks/{id}`：查询任务状态与进度；
  - `DELETE /tasks/{id}`：取消任务。

- 回调机制：
  - 创建任务时可配置：
    - `callbackUrl`（限制在内网白名单域名/IP 范围内）；
    - `callbackMethod`（默认 POST）；
    - `callbackHeaders`（用于携带认证信息）；
    - `callbackPayloadTemplate`（字段白名单 + 模板），避免回传敏感数据。
  - 任务完成 / 失败 / 超时后，Agent 主动调用回调，通知结果与关键信息。

- 与阶段 1 的兼容性：
  - 保持原有同步动作 API 不变；
  - 异步任务内部尽量复用已有动作实现和日志体系。

#### 4.2.4 公网网站与异常场景处理增强（逻辑层）

- 网络与 HTTP 错误：
  - 区分 DNS 失败、连接失败、超时、HTTP 4xx/5xx 等；
  - 使用统一错误码表示，附带截图/HTML 摘要辅助排查。

- 反垃圾 / 验证页面识别：
  - 利用 URL、title、页面关键字等简单规则识别常见“人机验证 / 访问过于频繁”等页面；
  - 将此类情况以专门错误类型上报（例如 `antiBotPage`）。

### 4.3 阶段 2 验收标准（建议）

- 能在机房环境中，由 n8n 集群远程调用多台客户端的 Browser Agent：
  - 完成至少一条由多步骤组成的异步任务，包含任务创建、轮询查询与回调；
- 能为不同 clientId 配置独立凭证与配额，并通过实际测试验证限流与授权策略生效；
- 异常情况下（网络错误 / 站点挂掉 / 反爬页面）能返回统一结构化错误，并在日志与 AI 浏览器 UI 中可见。

---

## 5. 阶段 3：n8n 社区节点 + 试运行优化与修复

### 5.1 阶段目标

- 为 Browser Agent 提供专门的 n8n 节点包，降低使用门槛；
- 在实际试运行中收集反馈，修复缺陷、优化性能与易用性；
- 补齐必要的监控与运维能力，使其适合作为长期运行组件。

### 5.2 主要工作项

#### 5.2.1 n8n 社区节点开发

- 节点包：`n8n-nodes-ai-server-browser-agent`（命名可调整）：
  - Credential：配置 Browser Agent 服务地址、端口、认证信息；
  - Resource / Operation：
    - Resource：Session / Action / Task / File 等；
    - Operation：Create/Close Session、Navigate、Click、Fill、Screenshot、Wait、Download、UploadFile、ExtractContent、DragPath 等。
  - 节点参数表单：
    - 为常用参数提供下拉 / 开关 / 校验；
    - 为高级参数提供 JSON 编辑器或可选配置区。

- 文档与示例：
  - 编写节点使用文档与典型 workflow 示例（使用抽象业务场景，不泄露真实系统细节）。

#### 5.2.2 试运行与反馈收集

- 在小规模生产环境中运行一段时间：
  - 观察稳定性（崩溃、内存、句柄泄露等）；
  - 分析失败任务日志，识别常见错误类型与可改进点。

- 根据反馈迭代：
  - 修复 bug（动作边界条件、超时策略不合理等）；
  - 优化 UI 交互（筛选、搜索、回放体验）；
  - 调整默认超时 / 重试策略等。

#### 5.2.3 监控与运维能力补强（可选但推荐）

- 指标：
  - 每台 Agent 的 session 数、动作数、错误率、平均耗时等；
  - 按 profile / clientId 的统计信息。

- 导出方式：
  - 简单版：在 AI 浏览器总览页展示核心指标；
  - 进阶版：通过 HTTP/Prometheus 格式暴露基础 metrics，方便接入现有监控系统。

### 5.3 阶段 3 验收标准（建议）

- n8n 节点包在目标环境中稳定可用，支持大部分常见操作；
- 已知主要问题均有记录并在迭代中解决，错误类型和告警机制相对完善；
- 运维人员能够通过 AI 浏览器 UI + 监控系统了解 Agent 运行状态，并根据日志与回放进行审计和问题分析。

---

## 6. 依赖与前置工作（建议）

- 明确 Playwright-core 版本与 Electron 版本的兼容性矩阵；
- 在机房环境中预先规划好：
  - n8n 集群与各客户端的网络拓扑与防火墙规则；
  - Browser Agent 数据目录（日志 / 截图 / 文件）所在磁盘与备份策略；
- 结合公司内部安全规范，对阶段 2 的鉴权与日志留存策略进行一次安全评审。

---

> 本计划为 v1 草案，可在实际开发过程中根据需求变化与试运行反馈迭代调整。
