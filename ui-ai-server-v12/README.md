# AI-Server UI 复刻 Prompt（React + Tailwind CSS + shadcn/ui）

> 这是一份**自包含**的需求说明，供「会写 React + Tailwind + shadcn/ui」的 AI 使用。你只会看到本文件，不会看到任何旧代码。
>
> 你的任务：从零实现一个前端项目 Demo，展示一个「AI 服务管理平台」的 UI。重点是**界面布局、风格和交互细节**，不要求接真实后端。
>
> 目标技术栈：
> - 框架：React + TypeScript
> - 构建：Vite（推荐）或 Next.js（二选一，若你不确定，请使用 Vite + React + TS 模板）
> - 样式：Tailwind CSS（必须配置自定义主题）
> - 组件库：shadcn/ui（基于 Radix UI）

---

## 一、产品概念与整体布局

### 1. 产品概念

实现一个桌面应用风格的「AI 服务管理平台」的 Web UI，用来统一管理多个 AI 服务模块（例如：n8n、Dify、OneAPI、RagFlow），包括：

- 查看各服务的运行状态
- 启动/停止服务（UI 按钮即可，实际调用可以先用假逻辑）
- 查看系统日志（用假数据渲染）
- 查看性能监控（用假数据和 CSS 图表表示）
- 配置系统/网络等参数（表单样式为主）

### 2. 全局布局结构

要求实现一个**三段式布局**：

1. 顶部：固定高度的导航栏 TopBar（约 56px 高）
2. 左侧：固定宽度的侧边导航 SideNav（约 260px 宽），从 TopBar 下方延伸到底部
3. 右侧：主内容区域 Content，随路由切换不同页面

具体要求：

- TopBar 包含：
  - 左侧：品牌 Logo 和标题
  - 中间：模块级 Tab 导航（首页 + 各服务模块 + 其他页面）
  - 右侧：用户信息（头像 + 用户名 + 下拉菜单）和设置按钮
- SideNav 包含：
  - 顶部区域：产品名/小 Logo
  - 菜单项：
    - 仪表盘（首页）
    - 在线教程
    - AI 市场
    - 系统设置
    - 系统日志
    - 性能监控
- Content 区域：根据路由渲染不同页面，使用居中最大宽度（例如 `max-w-6xl` 或 `max-w-7xl`），上下留白适中。

### 3. 响应式要求

- 宽屏（≥ 1024px）：显示完整 TopBar + 左侧固定 SideNav。
- 平板/窄屏（< 1024px）：
  - SideNav 折叠为抽屉式菜单，由 TopBar 左侧的“菜单”按钮触发。
  - Content 区域占满屏宽。

你需要为此实现一个顶层布局组件，例如：

- `src/layouts/AppLayout.tsx` 或类似结构
- 内部使用 shadcn/ui 的组件（例如 `NavigationMenu`, `DropdownMenu`, `Button`, `Avatar`, `Tabs` 等）结合 Tailwind 进行样式定制。

---

## 二、视觉风格与设计系统

### 1. 主题与色彩（Tailwind 配置）

请在 Tailwind 配置中定义一套统一的主题色和字体：

- **主色（primary）**：明亮蓝色，建议 `#007AFF`，用于：
  - 主要按钮
  - Tab 激活状态
  - 主要高亮线条/图表
- **辅色（accent / warning）**：橙色，建议 `#FF9500`，用于：
  - 警告按钮
  - 提示条和图表中的警示元素
- **错误色（destructive）**：红色，建议 `#FF3B30`
- **文本与背景**：
  - 主文本：近黑色或深灰色，如 `#111827` 或类似
  - 次级文本：中灰色，如 `#6B7280`
  - 页面背景：浅灰 `#F2F2F7` 或 `#F3F4F6`

字体：

- Sans：`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- Mono（用于日志和技术信息）：`'SF Mono', 'Cascadia Code', 'Menlo', 'Consolas', monospace`

### 2. 玻璃拟物（Glassmorphism）

核心区域（例如顶部栏、侧边栏、主要卡片）统一采用“玻璃”风格：

- 背景：`bg-white/80`（浅色模式）
- 边框：`border border-white/30`
- 模糊：`backdrop-blur-md` 或 `backdrop-blur-lg`
- 阴影：`shadow-lg shadow-black/10`
- 圆角：统一使用 `rounded-2xl` 或 `rounded-xl`

请封装一个通用的 GlassCard 组件（可以只是一组 className），用于复用在首页卡片、设置页面板、日志卡片和监控卡片等处。

### 3. 按钮风格（基于 shadcn/ui Button）

使用 shadcn/ui 的 Button 组件，并基于 Tailwind 定制样式：

- 基础按钮：
  - 圆角：`rounded-lg`
  - 字重：`font-medium`
  - 过渡：`transition-all duration-150 ease-out`
  - hover：轻微上移 `-translate-y-px` 或 `-translate-y-0.5`，阴影增强
- 主按钮（primary）：
  - 背景：蓝色渐变，例如 `bg-gradient-to-r from-primary to-primary/80`
  - 文本：白色
  - hover：变亮 + 阴影更重
- 危险按钮（destructive）：
  - 背景：红色渐变
  - 适用于停止、删除等操作
- 特殊效果：
  - 对“启动/停止/保存/刷新”类按钮，在 Button 内部增加一个 `before` 伪元素，模拟一条从左向右划过的高光条，hover 时启动动画。

### 4. 状态指示器组件

实现一个可复用的 `StatusDot` 组件，用于显示服务或模块的状态：

- 外观：
  - 小圆点，直径 8~10px
  - 使用 `rounded-full`
- 状态：
  - `running`：蓝绿色渐变 + `animate-pulse`
  - `stopped`：中性色灰，无动画
  - `error`：红色 + 轻微闪烁动画（可自定义 `@keyframes`）

该组件需要在：

- 顶部模块 Tab
- 服务卡片
- 设置/监控页面的状态展示

中重复使用，保持统一视觉语言。

### 5. 动效与交互

- 所有交互元素（按钮、卡片、菜单项、Tab）：
  - hover：轻微上移、阴影增强、背景亮度提升
  - focus：明显的焦点高亮（例如外环光晕）
- 过渡统一使用 Tailwind 的 `transition` 工具类，不要使用突兀的长动画。

---

## 三、需要实现的主要页面

### 1. 仪表盘首页（Dashboard）

路由：`/`

布局结构：

1. 顶部欢迎 Banner：
   - 占整个内容区域宽度，使用 Glass + 渐变背景
   - 左侧：
     - 主标题：例如“欢迎使用 AI-Server 管理平台”
     - 副标题：简要描述平台用途
   - 下方 3 个小指标：
     - 运行服务：例如 `2 / 4`
     - 系统状态：例如“正常”、“有异常”等
     - 已运行时间：例如“2 小时 15 分钟”
   - 背景中可以加入一些圆形/线条几何装饰，用 CSS 动画模拟缓慢浮动

2. 概览条（Overview Bar）：
   - 一条横向卡片，内容包括：
     - Docker 服务状态（已启动/未启动）
     - 运行服务数量（running / total）
     - 当前时间或简易运行时间
     - 右侧按钮：
       - 刷新状态
       - 启动所有服务
   - 注意按钮使用上文定义的主按钮样式

3. 服务卡片网格：
   - 一个 2~3 列的卡片布局，展示各 AI 服务模块：
     - n8n：工作流自动化
     - Dify：AI 应用开发平台
     - OneAPI：统一 AI API 网关
     - RagFlow：RAG 知识库问答系统
   - 每张卡片包含：
     - 图标 + 名称 + 简短描述
     - 状态点 + 状态文本（运行中 / 已停止 / 异常 / 加载中）
     - 几个指标展示（可以用假数据）：CPU 使用率 / 内存使用率 / 映射端口 / 运行时间
     - 底部操作按钮：
       - 启动/停止（根据状态切换文案和颜色）
       - 打开（跳转到对应模块页面）
       - 日志（跳转到日志页并带上该模块过滤条件）

> 在本 Demo 中，服务状态和指标可以来自前端假数据或简单的 `useState` 随机生成，不需要真实后端。

### 2. 系统设置页（Settings）

路由：`/settings`

布局：

- 整个页面中间放置一张较大的 Glass 卡片，左右分为：
  - 左侧：垂直选项卡（Vertical Tabs），包含：
    - 系统设置
    - 网络设置
    - n8n 设置
    - Dify 设置
    - OneAPI 设置
    - RagFlow 设置
    - 调试设置
  - 右侧：对应 Tab 的表单内容

表单内容示例（不必全部完整）：

- 系统设置：
  - 系统名称（输入框）
  - 语言（中/英文下拉）
  - 日志等级（下拉）
  - 自动启动开关（开关控件）
  - 底部“保存设置”“重置为默认”按钮
- 网络设置：
  - 镜像加速地址列表（可增删行）
  - 代理模式下拉（直连 / 系统代理 / 手动）
  - 若选择“手动”，显示代理主机/端口输入框
- 模块设置：
  - 各模块的端口、数据库 URL、环境变量多行文本等
- 调试设置：
  - 一些开关项（例如“显示调试工具”、“输出详细日志”）
  - 一组危险操作按钮：
    - 停止所有容器
    - 删除所有容器
    - 清空所有数据卷
    - 一键清理
  - 点击危险按钮需要弹出确认对话框（使用 shadcn/ui 的 Dialog 或 AlertDialog 组件）

### 3. 系统日志页（Logs）

路由：`/logs`

布局：

1. 顶部工具栏：
   - 标题“系统日志”
   - 模块下拉选择（包含：全部、client、n8n、Dify、OneAPI、RagFlow）
   - 日志级别下拉（全部 / error / warn / info / debug）
   - 按钮：清空日志（红色）、刷新日志（蓝色）

2. 日志列表卡片：
   - 使用 Glass 卡片容器
   - 内部使用等宽字体展示日志列表
   - 每行日志采用 Grid 布局，包括：
     - 时间戳（例如 `2025-09-16 19:22:10`）
     - 级别（彩色标签，如 error 红底白字）
     - 模块名
     - 服务名
     - 消息文本
   - 行 hover 时浅色高亮

> 日志数据可以是本地假数据数组即可。

### 4. 性能监控页（Monitoring）

路由：`/monitoring`

布局：

- 顶部：标题“性能监控”，右侧有时间范围下拉（1h / 6h / 24h / 7d）和刷新按钮。
- 内容：2×2 的卡片网格，示例：
  - 系统资源使用率：
    - CPU / 内存 / 磁盘 / 网络 使用率，以进度条 + 数值形式展示
  - 服务状态监控：
    - 列出各服务的状态（运行中/已停止/异常）和轻量 CPU/内存/响应时间指标
  - CPU 使用趋势图：
    - 使用纯 CSS + `div` 模拟折线图（背景渐变、发光点、时间标签）
  - 内存使用趋势图：
    - 同上，不需要真正的图表库

> 所有数据可随机生成，重点是 UI 结构和视觉。

### 5. 各 AI 模块占位页（Module Pages）

路由示例：`/n8n`, `/dify`, `/oneapi`, `/ragflow`

- 顶部工具栏：
  - 按钮：后退 / 前进 / 刷新 / 返回首页
  - 中间：URL 文本，如果没有有效 URL，则显示“模块未运行或端口未映射”的警告文案
- 内容区域：
  - 当前可以只放一个空白占位区，说明“这里未来会嵌入模块 Web 界面（如通过 iframe 或 WebView）”。

---

## 四、代码结构与实现要求

1. 使用 TypeScript，给页面 props、服务状态、日志项等核心数据结构定义类型。
2. 按模块组织代码，例如：
   - `src/layouts/`：AppLayout、TopBar、SideNav 等
   - `src/components/`：StatusDot、GlassCard、ServiceCard、OverviewBar 等
   - `src/pages/` 或 `src/routes/`：Dashboard、Settings、Logs、Monitoring、Module pages
3. 使用 shadcn/ui 官方推荐的方式引入和组织组件（如 `components/ui/button.tsx`, `components/ui/input.tsx` 等）。
4. 使用 Tailwind 的原子类组织样式，避免在组件里写大量手写 CSS；仅在必要的地方用少量自定义 CSS。
5. 在项目根 README 或注释中说明：
   - 如何安装依赖（`npm install` 或 `pnpm install`）
   - 如何启动开发服务器（`npm run dev`）

---

## 五、你需要输出的内容（对 AI 的要求）

当你基于本 Prompt 生成项目时，请完成：

1. 初始化一个 React + TypeScript + Tailwind + shadcn/ui 项目：
   - 配置好 Tailwind 主题（包含 primary/warning/destructive 等颜色与字体）。
   - 引入并配置好 shadcn/ui 组件基础（Button、Card、Tabs、Dialog、DropdownMenu、Input、Switch 等）。
2. 按上述说明实现：
   - 顶层布局（TopBar + SideNav + Content）
   - 仪表盘首页（Banner + Overview 条 + 服务卡片网格）
   - 系统设置页（垂直 Tab + 多表单区 + 危险操作按钮）
   - 系统日志页（过滤工具栏 + 日志列表卡片）
   - 性能监控页（4 张监控卡片 + 假数据）
   - 模块占位页（带工具栏的占位内容）
3. 项目需要可以直接运行（假数据即可），整体界面风格统一、现代、精致，适合继续扩展。

> 请将重心放在「UI 设计质量」和「代码结构清晰度」上，而不是功能的后端实现。本项目 Demo 将作为后续真实功能开发的前端基础。
