# AI-Server-v12 Browser Agent HTTP API 参考

> 本文档基于《AI-Server-v12-Browser-Agent-设计方案》《AI-Server-v12-Browser-Agent-开发计划》编写，聚焦 **HTTP/JSON 接口** 说明，方便在 Postman / n8n 中直接调用。

---

## 1. 通用约定

### 1.1 Base URL

- 默认监听地址：`http://127.0.0.1:{port}`  
- `port` 由客户端设置中心中 Browser Agent 配置项决定，默认值为 `26080`。

> 当前版本仅监听 `127.0.0.1`，仅支持本机调用。

### 1.2 认证与鉴权

- 配置项中预留了 `token` 字段，但 **当前版本未启用鉴权逻辑**，所有本机请求免认证。
- 后续阶段将按设计支持 `X-Browser-Agent-Token` / `Authorization: Bearer` 等写法。

### 1.3 请求与响应格式

- 除下载类接口外，所有 API 使用 JSON 请求体，`Content-Type: application/json`。
- 响应统一包裹为：

```json
{
  "ok": true,
  "errorCode": null,
  "errorMessage": null,
  "data": { "..." }
}
```

- 错误响应统一结构：

```json
{
  "ok": false,
  "errorCode": "TIMEOUT",
  "errorMessage": "Timeout while waiting for ...",
  "errorDetails": {
    "sessionId": "sess_xxx",
    "action": "wait.url",
    "url": "https://...",
    "timeoutMs": 15000,
    "onTimeout": "screenshot_only"
  },
  "data": null
}
```

常见 `errorCode` 示例：

- 会话与服务类：`SERVICE_DISABLED`、`SESSION_NOT_FOUND`、`NOT_FOUND`、`METHOD_NOT_ALLOWED`、`BAD_REQUEST`、`BAD_JSON`、`REQUEST_ENTITY_TOO_LARGE`、`INTERNAL_ERROR`
- Playwright 相关：`PLAYWRIGHT_NOT_AVAILABLE`、`PLAYWRIGHT_ERROR`、`TIMEOUT`
- 文件相关：`FILE_NOT_FOUND`、`FILE_NOT_FOUND_ON_DISK`、`FILE_STREAM_ERROR`、`DATA_ROOT_UNAVAILABLE`

### 1.4 超时与截图策略（onTimeout）

部分同步动作支持 `onTimeout` 策略：

- 当前实现仅支持：
  - `"none"`：超时时直接返回错误；
  - `"screenshot_only"`：超时时先自动截一张当前页面截图，再返回错误。
- 其它枚举值仅为 **预留**，当前版本不会生效。

### 1.5 变量约定

- 文档中的 `{{sessionId}}` 表示由调用方保存的会话 ID 变量：
  - 在 Postman 中可写成 `{{sessionId}}` 变量；
  - 在 n8n 中可改成对应的表达式（如 `{{$json["data"]["sessionId"]}}`）。

### 1.6 文档维护约定

- **维护约定**：本文档中 **每个 HTTP API** 必须提供一段可在 Linux 终端直接执行、且可被 Postman Import → Raw text 导入的 `curl` 命令示例（采用类 Unix 风格，使用 `curl --location --request ... --header ... --data '...'` 形式，不使用 PowerShell 的 `^` 换行）。
- **后续规范**：未来 **新增或修改任意 Browser Agent HTTP API**，必须同步更新本文件，为该接口补充或修正对应的 `curl` 示例，保持文档与实现一致。

---

## 2. 健康检查与调试接口

### 2.1 `GET /health`

- 功能：检查 Browser Agent HTTP 服务是否可用。
- 请求：无请求体。
- 响应示例：

```json
{
  "ok": true,
  "errorCode": null,
  "errorMessage": null,
  "data": {
    "status": "ok"
  }
}
```

#### curl 示例（Linux / Postman 可导入）

```bash
curl --location --request GET 'http://127.0.0.1:26080/health'
```

### 2.2 `GET/POST /debug/playwright-spike`

- 功能：内部调试用，验证 `playwright-core` 与 Electron BrowserWindow 集成是否正常。
- 正常情况下返回一次导航 + 截图的调试信息，具体字段以实现为准。

> 仅用于开发/排障，不建议在生产流程中调用。

#### curl 示例（GET 调试调用）

```bash
curl --location --request GET 'http://127.0.0.1:26080/debug/playwright-spike'
```

### 2.3 `GET/POST /debug/mock-http`

- 功能：本地 HTTP Mock 调试接口。收到 GET / POST 请求时打开（或激活）一个独立的 Electron 窗口，在左侧展示请求列表，在右侧维护可编辑的返回模板，供人工选择后再把响应回写给调用方。
- 典型用途：
  - 在 Postman / n8n 中本地调试 Browser Agent 上层逻辑；
  - 手工构造各种 HTTP 返回（200/4xx/5xx/302 等），模拟第三方接口行为；
  - 排查请求内容（Headers / Query / Body）。

- 请求方式：
  - 支持 `GET` 与 `POST`；
  - Query 参数可以自定义（例如 `scene=login`），只做透传与展示，不做校验；
  - `POST` 请求体按纯文本读取，最大约 10MB，内容会原样展示在 Mock 窗口左侧。

- 返回行为：
  - 当你在 Mock 窗口中为某条请求选择一个模板并点击“发送”后：
    - HTTP 状态码：使用模板中的 `statusCode`；
    - `Content-Type`：使用模板中的 `contentType`；
    - Body：使用模板中的 `body` 原样返回；
  - 如果 5 分钟内没有选择模板（或窗口被关闭）：
    - 返回 `504 MOCK_TIMEOUT`，便于上层识别是调试超时；
  - 如果内部出现未捕获异常：
    - 返回 `500 MOCK_INTERNAL_ERROR`，同时在日志中记录详细错误。

- Mock 窗口行为说明（便于理解调试体验）：
  - **左侧请求列表**：
    - 每次有新请求到达 `/debug/mock-http`，都会在左侧顶部新增一条记录，展示：
      - 请求方法、完整 URL、来源地址（remoteAddress:remotePort）、接收时间；
      - Headers / Query / Body（Body 以文本形式展示，便于直接复制）。
    - 只会有 **最新一条请求默认展开**，其余历史请求默认折叠；
    - 点击某条请求的标题可在“展开 / 收起”之间切换；
    - 顶部提供“清除历史请求”按钮，可一次性清空左侧所有记录（不影响右侧模板）；
    - 每条请求右上角都有“删除”按钮，可单独删除该条历史请求，不影响其它记录和 HTTP 行为。
  - **右侧返回模板列表**：
    - 初始内置 3 个模板：
      - `200 OK JSON`：简单的 `{ "ok": true }`；
      - `500 Error JSON`：模拟通用错误结构；
      - `302 Redirect`：使用简单 HTML `meta refresh` 做跳转示例；
    - 可以通过“新增模板”按钮添加更多模板，新建模板会出现在列表顶部；
    - 每个模板包含：名称、HTTP 状态码、`Content-Type`、Body 文本；
    - Body 文本框默认高度约 **3 行**，支持拖拽拉伸；
    - 在左侧为某条请求选择模板并“发送”后，该条记录会标记为“已返回：模板名称”。

#### curl 示例（GET 调试调用）

```bash
curl --location --request GET 'http://127.0.0.1:26080/debug/mock-http?scene=demo&foo=bar'
```

#### curl 示例（POST JSON 调试调用）

```bash
curl --location --request POST 'http://127.0.0.1:26080/debug/mock-http?scene=login' \
  --header 'Content-Type: application/json' \
  --data '{
    "username": "alice",
    "password": "secret"
  }'
```

---

## 3. 会话管理 `/sessions`

### 3.1 创建会话 `POST /sessions`

- 功能：创建一个 Browser Agent 会话，对应一个专用 BrowserWindow。
- 请求体示例：

```json
{
  "profile": "demo-profile",
  "clientId": "local-n8n",
  "viewport": { "width": 1280, "height": 720 },
  "userAgent": "Optional UA string"
}
```

> 字段：
>
> - `profile`：可选，业务 profile 或系统标识；
> - `clientId`：可选，调用方 ID，阶段 1 主要用于日志标记；
> - `viewport`：可选，浏览器窗口尺寸；
> - `userAgent`：可选，自定义 UA。

- 成功响应 `data`：

```json
{
  "sessionId": "sess_xxx",
  "profile": "demo-profile",
  "clientId": "local-n8n",
  "status": "running",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "lastActiveAt": "2025-01-01T00:00:00.000Z",
  "viewport": { "width": 1280, "height": 720 },
  "userAgent": "..."
}
```

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions' \
  --header 'Content-Type: application/json' \
  --data '{
    "profile": "demo-profile",
    "clientId": "local-n8n",
    "viewport": { "width": 1280, "height": 720 },
    "userAgent": "Optional UA string"
  }'
```

### 3.2 列出会话 `GET /sessions`

- 查询当前与历史会话列表。
- Query 参数：
  - `profile`：可选，按 profile 过滤；
  - `clientId`：可选，按调用方过滤；
  - `status`：可选，按状态过滤（如 `running/closed/timeout` 等）。
- 成功响应 `data.items` 为会话数组。

#### curl 示例

```bash
curl --location --request GET 'http://127.0.0.1:26080/sessions?clientId=local-n8n&status=running'
```

### 3.3 查询单个会话 `GET /sessions/{{sessionId}}`

- 返回指定会话的完整信息（同创建响应结构）。

#### curl 示例

```bash
curl --location --request GET 'http://127.0.0.1:26080/sessions/{{sessionId}}'
```

### 3.4 关闭会话 `DELETE /sessions/{{sessionId}}`

- 功能：销毁会话及其 BrowserWindow，释放资源。
- 成功响应 `data` 为被关闭的会话对象，包含最终 `status/finishedAt/lastErrorCode/lastErrorMessage` 等字段。

#### curl 示例

```bash
curl --location --request DELETE 'http://127.0.0.1:26080/sessions/{{sessionId}}'
```

### 3.5 显示 / 隐藏会话窗口

- 显示窗口：`POST /sessions/{{sessionId}}/show`
- 隐藏窗口：`POST /sessions/{{sessionId}}/hide`
- 请求体：空 JSON `{}` 或忽略 body。
- 成功响应 `data` 为更新后的会话对象。

#### curl 示例

```bash
# 显示窗口
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/show'

# 隐藏窗口
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/hide'
```

### 3.6 列出会话文件 `GET /sessions/{{sessionId}}/files`

- 功能：列出指定会话产生的文件（下载文件、截图等）。
- Query 参数：
  - `date`：可选，`YYYY-MM-DD`，用于只扫描指定日期的 `files.ndjson` 文件；不传则按实现默认读取。
- 成功响应示例：

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "fileId": "file_xxx",
        "sessionId": "{{sessionId}}",
        "name": "export-2025-01-01.xlsx",
        "size": 12345,
        "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "path": "sessions/{{sessionId}}/files/export-2025-01-01.xlsx",
        "createdAt": "2025-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

#### curl 示例

```bash
curl --location --request GET 'http://127.0.0.1:26080/sessions/{{sessionId}}/files?date=2025-01-01'
```

---

## 4. 页面导航与等待

### 4.1 导航 `POST /sessions/{{sessionId}}/navigate`

- 功能：在会话窗口中打开指定 URL，并按需等待页面加载完成。
- 请求体字段：
  - `url`：要打开的 URL，必填；为空时会使用一个默认页面（如百度）；
  - `waitUntil`：可选，页面加载等待条件：
    - `"load"`（默认）
    - `"domcontentloaded"`
    - `"networkidle"`
  - `timeoutMs`：可选，加载超时时间（毫秒）；
  - `onTimeout`：可选，`"none"` 或 `"screenshot_only"`。

- 成功响应 `data` 由底层 `navigateOnce` 返回，一般包含页面 URL、标题、窗口 ID 等。
- 超时时：
  - HTTP 状态码：`504`；
  - `errorCode`: `TIMEOUT`；
  - 若 `onTimeout = "screenshot_only"`，会自动截一张当前页面截图并写入 `snapshots.ndjson` / `files.ndjson`。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/navigate' \
  --header 'Content-Type: application/json' \
  --data '{
    "url": "file:///C:/code/ai-server-v12/doc/browser-agent-test.html",
    "waitUntil": "load",
    "timeoutMs": 30000,
    "onTimeout": "screenshot_only"
  }'
```

### 4.2 等待元素 `POST /sessions/{{sessionId}}/wait/selector`

- 功能：等待某个元素达到指定状态。
- 请求体字段：
  - `selector`：必填，CSS 选择器；
  - `state`：可选，Playwright `waitForSelector` 的状态：
    - `"attached"`、`"visible"`、`"hidden"`、`"detached"`；
  - `timeoutMs`：可选，超时时间（毫秒）；
  - `onTimeout`：可选，`"none"` / `"screenshot_only"`。

- 成功：`data` 包含简单结果（如匹配到的当前 URL / 选择器信息等，具体以实现为准）。
- 超时：`504 TIMEOUT`，`errorDetails` 中包含 `selector/state/timeoutMs/onTimeout`。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/wait/selector' \
  --header 'Content-Type: application/json' \
  --data '{
    "selector": "#login-submit",
    "state": "visible",
    "timeoutMs": 15000,
    "onTimeout": "screenshot_only"
  }'
```

### 4.3 等待文本 `POST /sessions/{{sessionId}}/wait/text`

- 功能：等待页面或某个区域包含指定文本。
- 请求体字段：
  - `text`：必填，要等待出现的文本；
  - `scope`：可选，`"page"`（默认）或 `"selector"`；
  - `selector`：`scope = "selector"` 时必填，限定在该区域内查找文本；
  - `timeoutMs`：可选；
  - `onTimeout`：可选，`"none"` / `"screenshot_only"`。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/wait/text' \
  --header 'Content-Type: application/json' \
  --data '{
    "text": "点击 登录 按钮",
    "scope": "page",
    "selector": null,
    "timeoutMs": 10000,
    "onTimeout": "none"
  }'
```

### 4.4 等待 URL `POST /sessions/{{sessionId}}/wait/url`

- 功能：等待当前页面 URL 满足条件，可用于等待跳转或锚点变化。
- 请求体字段：
  - `equals`：可选，期待的完整 URL 字符串；
  - `contains`：可选，期待 URL 中包含的子串（如 `"#anchor-3"`）；
  - `timeoutMs`：可选；
  - `onTimeout`：可选，`"none"` / `"screenshot_only"`。

> `equals` 与 `contains` 二选一使用，另一个可设为 `null` 或省略。

- 成功响应：`data.currentUrl` 等字段。
- 超时时：行为同上，`errorDetails` 中包含 `contains/equals/timeoutMs/onTimeout`。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/wait/url' \
  --header 'Content-Type: application/json' \
  --data '{
    "equals": null,
    "contains": "#anchor-3",
    "timeoutMs": 10000,
    "onTimeout": "screenshot_only"
  }'
```

---

## 5. DOM 级交互与表单操作 `/sessions/{{sessionId}}/dom/*`

所有 DOM 动作均为 `POST` 请求，使用 JSON 请求体。

### 5.1 点击元素 `POST /sessions/{{sessionId}}/dom/click`

- 请求体：

```json
{
  "selector": "#login-submit",
  "timeoutMs": 5000
}
```

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/dom/click' \
  --header 'Content-Type: application/json' \
  --data '{
    "selector": "#login-submit",
    "timeoutMs": 5000
  }'
```

### 5.2 填写输入框 `POST /sessions/{{sessionId}}/dom/fill`

```json
{
  "selector": "#login-username",
  "text": "alice",
  "clearBefore": true,
  "timeoutMs": 5000
}
```

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/dom/fill' \
  --header 'Content-Type: application/json' \
  --data '{
    "selector": "#login-username",
    "text": "alice",
    "clearBefore": true,
    "timeoutMs": 5000
  }'
```

### 5.3 滚动到元素 `POST /sessions/{{sessionId}}/dom/scroll-into-view`

```json
{
  "selector": "#anchor-3",
  "timeoutMs": 8000
}
```

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/dom/scroll-into-view' \
  --header 'Content-Type: application/json' \
  --data '{
    "selector": "#anchor-3",
    "timeoutMs": 8000
  }'
```

### 5.4 页面滚动（带速度抖动） `POST /sessions/{{sessionId}}/dom/scroll`

- 请求体字段：
  - `mode`：滚动模式：
    - `"toPosition"`：滚动到指定绝对 Y 坐标；
    - `"byDelta"`：相对当前位置滚动；
    - `"toElement"`：滚动到指定元素附近；
  - `targetY`：`mode = "toPosition"` 时生效，目标 Y 像素；
  - `deltaY`：`mode = "byDelta"` 时生效，向下为正；
  - `selector`：`mode = "toElement"` 时生效；
  - `durationMs`：总滚动时长（毫秒）；
  - `stepMinMs` / `stepMaxMs`：相邻滚动步之间的最小/最大间隔（毫秒）；
  - `jitterRatio`：每步滚动距离的随机抖动比例（0~1）；
  - `timeoutMs`：可选，总体超时（毫秒）。

- 返回 `data` 中包含本次滚动的参数与最终位置等信息（以实现为准）。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/dom/scroll' \
  --header 'Content-Type: application/json' \
  --data '{
    "mode": "toPosition",
    "targetY": 800,
    "deltaY": null,
    "selector": null,
    "durationMs": 1500,
    "stepMinMs": 16,
    "stepMaxMs": 40,
    "jitterRatio": 0.25,
    "timeoutMs": 8000
  }'
```

### 5.5 Checkbox 勾选 `POST /sessions/{{sessionId}}/dom/set-checkbox`

```json
{
  "selector": "input[type=checkbox][name=rememberMe]",
  "checked": true,
  "timeoutMs": 5000
}
```

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/dom/set-checkbox' \
  --header 'Content-Type: application/json' \
  --data '{
    "selector": "input[type=checkbox][name=rememberMe]",
    "checked": true,
    "timeoutMs": 5000
  }'
```

### 5.6 Radio 选择 `POST /sessions/{{sessionId}}/dom/set-radio`

```json
{
  "selector": "input[type=radio][name=gender][value=female]",
  "timeoutMs": 5000
}
```

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/dom/set-radio' \
  --header 'Content-Type: application/json' \
  --data '{
    "selector": "input[type=radio][name=gender][value=female]",
    "timeoutMs": 5000
  }'
```

### 5.7 Select 选项选择 `POST /sessions/{{sessionId}}/dom/select-options`

```json
{
  "selector": "#country-select",
  "values": ["US"],
  "labels": null,
  "indexes": null,
  "timeoutMs": 5000
}
```

> `values` / `labels` / `indexes` 三者至少提供一种，均为数组形式；多选下可提供多个值。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/dom/select-options' \
  --header 'Content-Type: application/json' \
  --data '{
    "selector": "#country-select",
    "values": ["US"],
    "labels": null,
    "indexes": null,
    "timeoutMs": 5000
  }'
```

### 5.8 文件上传 `POST /sessions/{{sessionId}}/dom/upload-file`

```json
{
  "selector": "#single-file",
  "files": [
    "C:/Users/you/Desktop/demo1.txt"
  ],
  "timeoutMs": 10000
}
```

> `files` 为本机绝对路径数组，由 Browser Agent 运行所在机器可直接访问。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/dom/upload-file' \
  --header 'Content-Type: application/json' \
  --data '{
    "selector": "#single-file",
    "files": [
      "C:/Users/you/Desktop/demo1.txt"
    ],
    "timeoutMs": 10000
  }'
```

### 5.9 检查元素是否禁用 `POST /sessions/{{sessionId}}/dom/is-disabled`

```json
{
  "selector": "#login-submit",
  "timeoutMs": 5000
}
```

- 成功响应 `data` 示例：

```json
{
  "selector": "#login-submit",
  "disabled": true,
  "hasDisabledAttr": true,
  "ariaDisabled": null
}
```

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/dom/is-disabled' \
  --header 'Content-Type: application/json' \
  --data '{
    "selector": "#login-submit",
    "timeoutMs": 5000
  }'
```

### 5.10 获取表单数据 `POST /sessions/{{sessionId}}/dom/get-form-data`

```json
{
  "formSelector": "#login-form-area",
  "includeDisabled": false
}
```

- 若 `formSelector` 为空字符串或未提供，则默认扫描整个页面。
- 成功响应 `data.fields` 为表单字段数组，包含 name/value/checked/multiple/options 等信息，便于直接序列化为业务请求参数。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/dom/get-form-data' \
  --header 'Content-Type: application/json' \
  --data '{
    "formSelector": "#login-form-area",
    "includeDisabled": false
  }'
```

### 5.11 获取单个元素值 `POST /sessions/{{sessionId}}/dom/get-value`

```json
{
  "selector": "#country-select",
  "timeoutMs": 5000
}
```

- 成功响应 `data` 示例（字段视元素类型而定）：

```json
{
  "selector": "#country-select",
  "kind": "select",
  "type": null,
  "value": "US",
  "values": ["US"],
  "multiple": false,
  "options": [
    { "value": "CN", "label": "China", "selected": false, "disabled": false },
    { "value": "US", "label": "United States", "selected": true, "disabled": false }
  ],
  "disabled": false
}
```

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/dom/get-value' \
  --header 'Content-Type: application/json' \
  --data '{
    "selector": "#country-select",
    "timeoutMs": 5000
  }'
```

---

## 6. 坐标级鼠标动作 `/sessions/{{sessionId}}/mouse/*`

### 6.1 鼠标点击 `POST /sessions/{{sessionId}}/mouse/click`

- 请求体：

```json
{
  "x": 200,
  "y": 150,
  "button": "left",
  "timeoutMs": 5000
}
```

> `x`/`y` 为相对于页面视口左上角的像素坐标；`button` 可省略，默认左键。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/mouse/click' \
  --header 'Content-Type: application/json' \
  --data '{
    "x": 200,
    "y": 150,
    "button": "left",
    "timeoutMs": 5000
  }'
```

### 6.2 鼠标拖拽路径 `POST /sessions/{{sessionId}}/mouse/drag`

- 请求体：

```json
{
  "path": [
    { "x": 200, "y": 200, "tMs": 0 },
    { "x": 260, "y": 205, "tMs": 50 },
    { "x": 320, "y": 210, "tMs": 120 }
  ],
  "button": "left",
  "timeoutMs": 10000
}
```

> `path` 为一系列带时间戳的坐标点，内部会依次移动并保持按下状态，可用于模拟滑块等复杂拖拽。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/mouse/drag' \
  --header 'Content-Type: application/json' \
  --data '{
    "path": [
      { "x": 200, "y": 200, "tMs": 0 },
      { "x": 260, "y": 205, "tMs": 50 },
      { "x": 320, "y": 210, "tMs": 120 }
    ],
    "button": "left",
    "timeoutMs": 10000
  }'
```

---

## 7. 截图接口 `/sessions/{{sessionId}}/screenshot`

### 7.1 `POST /sessions/{{sessionId}}/screenshot`

- 功能：截取当前页面的截图，可按视口 / 元素 / 区域不同模式。
- 请求体字段：
  - `mode`：可选，`"viewport"`（默认）、`"element"`、`"region"`；
  - `selector`：`mode = "element"` 时使用的 CSS 选择器；
  - `region`：`mode = "region"` 时使用的裁剪区域 `{ x, y, width, height }`；
  - `format`：可选，`"png"`（默认）或 `"jpeg"`；
  - `description`：可选，截图说明文案，将写入 `snapshots.ndjson` 便于审计与回放。

- 成功响应：
  - `data.screenshotPath`：截图在本机磁盘上的绝对路径；
  - 其它字段由 `takeScreenshot` 返回，例如截取模式、页面 URL 等。
  - 同时会写入：
    - `snapshots.ndjson`：一条包含 `snapshotId/sessionId/actionId/path/description/createdAt` 的记录；
    - `files.ndjson`：一条可供 `/files/{fileId}` 下载的文件记录。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/screenshot' \
  --header 'Content-Type: application/json' \
  --data '{
    "mode": "viewport",
    "selector": null,
    "region": null,
    "format": "png",
    "description": "manual-screenshot"
  }'
```

---

## 8. 内容提取接口 `/sessions/{{sessionId}}/content/*`

### 8.1 HTML 提取 `POST /sessions/{{sessionId}}/content/html`

- 功能：提取页面 HTML，支持按选择器提取局部区域。
- 请求体：

```json
{
  "selector": "#article",   
  "outer": false             
}
```

> - 不提供 `selector` 时，返回整个文档的 HTML；
> - `outer = false` 表示返回 `innerHTML`，`true` 表示返回 `outerHTML`。

- 成功响应：

```json
{
  "ok": true,
  "data": {
    "html": "<p>...</p>"
  }
}
```

（具体字段以 `extractHtml` 实现为准，通常包含 HTML 字符串和一些上下文信息。）

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/content/html' \
  --header 'Content-Type: application/json' \
  --data '{
    "selector": "#article",
    "outer": false
  }'
```

### 8.2 文本提取 `POST /sessions/{{sessionId}}/content/text`

- 功能：提取页面或指定区域的纯文本。
- 请求体：

```json
{
  "scope": "selector",        
  "selector": "#page-log"     
}
```

> - `scope = "page"` 时忽略 `selector`，返回整页文本；
> - `scope = "selector"` 时仅返回该区域的文本。

- 成功响应通常包含提取到的 `text` 字段，便于后续 AI 处理或断言。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/content/text' \
  --header 'Content-Type: application/json' \
  --data '{
    "scope": "selector",
    "selector": "#page-log"
  }'
```

### 8.3 表格提取 `POST /sessions/{{sessionId}}/content/table`

- 功能：提取 HTML 表格为结构化数据。
- 请求体：

```json
{
  "selector": "#orders-table"
}
```

- 成功响应 `data`：
  - 一般包含表头与行数据，如 `headers` / `rows` 或等价结构，可直接在 n8n 中进行后续处理。

> 具体字段命名以 `extractTable` 实现为准；整体语义为“将 HTML `<table>` 转成结构化 JSON”。

#### curl 示例

```bash
curl --location --request POST 'http://127.0.0.1:26080/sessions/{{sessionId}}/content/table' \
  --header 'Content-Type: application/json' \
  --data '{
    "selector": "#orders-table"
  }'
```

---

## 9. 文件下载 `/files/{fileId}`

### 9.1 下载文件 `GET /files/{fileId}`

- 功能：根据 `fileId` 访问浏览器下载文件或截图文件。
- Query 参数：
  - `date`：可选，`YYYY-MM-DD`，指定读取哪天的 `files.ndjson` 元数据；不传则由实现选择默认日期范围。

- 成功响应：
  - HTTP 状态码 `200`；
  - 响应体为文件二进制流；
  - 响应头：
    - `Content-Type`: 对应文件 MIME 类型；
    - `Content-Length`: 文件大小；
    - `Content-Disposition: attachment; filename="..."`：用于浏览器或 HTTP 客户端自动下载。

- 典型错误：
  - `404 FILE_NOT_FOUND`：元数据中找不到对应 `fileId`；
  - `404 FILE_NOT_FOUND_ON_DISK`：磁盘上不存在对应文件；
  - `500 FILE_READ_ERROR` / `FILE_STREAM_ERROR`：读取或传输文件异常。

#### curl 示例

```bash
curl --location --request GET 'http://127.0.0.1:26080/files/{{fileId}}?date=2025-01-01' \
  --output downloaded-file.bin
```

---

## 10. 使用建议与调试技巧

- 开发与调试阶段推荐流程：
  1. `POST /sessions` 创建会话，保存 `sessionId`；
  2. `POST /sessions/{{sessionId}}/navigate` 打开目标页面；
  3. 使用 `/dom/*`、`/wait/*`、`/content/*` 等组合完成业务流程；
  4. 需要时调用 `/screenshot`、`/sessions/{{sessionId}}/files` 与 `/files/{fileId}` 获取截图或下载文件；
  5. 任务结束后 `DELETE /sessions/{{sessionId}}` 释放资源。
- 调试复杂问题时，可结合：
  - `data/browser-agent/meta/*.ndjson`（sessions/actions/files/snapshots）；
  - 本文档中的请求示例；
  - `browser-agent-test.html` 本地测试页面，作为端到端验收基线。

