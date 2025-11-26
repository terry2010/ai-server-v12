# AI-Server 管理平台（v12 UI，新仓库）项目说明与总 Prompt

> **使用方式（给未来的新会话）：**
> 
> 你在一个全新文件夹中新建了一个仓库，只包含：
> 
> - `ui-ai-server-v12/` 目录：现成的 React + TypeScript UI Demo；
> - `AI-Server-v12-项目说明与总Prompt.md`（本文件）。
> 
> 在新会话里，你只把这份文件的全文贴给 AI，不再提供其它上下文。AI 需要按照本文件，从零开始把整个桌面应用完整开发出来。

---

## 一、项目背景与目标

### 1.1 背景

- 本项目要做的是一个 **AI-Server 管理平台桌面应用**，用于在 Windows 客户环境中：
  - 一键部署和管理多种 AI 相关服务（例如 n8n、Dify、OneAPI、RagFlow 等）；
  - 统一查看运行状态、日志、性能指标；
  - 提供友好的首次使用体验（尤其是在客户机上还没有安装 Docker 的情况下）。

- 应用形态：
  - 使用 **Electron + React + TypeScript** 开发的桌面客户端；
  - UI 设计与交互完全以 `ui-ai-server-v12` 这个 React 项目为基础；
  - 通过 **Docker / docker-compose** 在本机启动和管理各种后端模块。

### 1.2 运行环境与约束

- **开发机环境（你现在的电脑）：**
  - 操作系统：Windows 10；
  - 已安装 Docker Desktop（含 Docker Engine 和 docker compose）；
  - 可以自由安装 Node.js、npm、全局工具等。

- **客户机目标环境：**
  - 操作系统：Windows 10 / Windows 11 / macOS（例如 macOS 12+，同时考虑 Intel 与 Apple Silicon 芯片）；
  - 客户机在第一次安装本应用时，**很可能尚未安装 Docker**（包括 Windows 上的 Docker Desktop，或 macOS 上的 Docker Desktop / 其他容器运行方案）；
  - 客户机可能缺乏开发环境（没有 Node.js / npm / git 等）。

- **因此要求：**
  - 应用在启动时需要检测 Docker 是否安装/运行（兼容 Windows 与 macOS 环境的检测方式）；
  - 若未安装 Docker，需要在 UI 中给出明确提示和引导（例如跳转到 Docker Desktop 官网、展示安装步骤说明，必要时区分 Windows/macOS）；
  - 不强制在程序内静默安装 Docker（避免侵犯用户环境和授权问题），但可以提供“在 Windows 上尝试启动 Docker Desktop”等辅助功能（macOS 上以引导说明为主）。

### 1.3 项目总体目标

基于 `ui-ai-server-v12` 提供的 UI Demo，在一个新的仓库中从零构建一个完整产品：

- **Electron 桌面应用**，支持：
  - 创建主窗口、无边框 UI、托盘/菜单（如有需要）；
  - 提供 IPC 通道给 React 前端调用；
  - 管理 BrowserView 嵌入外部 Web 服务（n8n / Dify / OneAPI / RagFlow / 在线教程 / AI 市场等）。

- **Docker / 模块管理后端能力**，支持：
  - 维护一个模块注册表，描述各个模块：
    - 名称、类型（feature/basic）、依赖关系、端口、健康检查方式、镜像/Compose 文件等；
  - 通过 Docker / docker-compose 启动、停止模块：
    - 启动 feature 模块时自动处理其依赖的基础服务；
    - 检查端口冲突，避免占用系统已有端口；
  - 检测模块运行状态，暴露给前端；
  - 提供适度的“清理/重置”能力（删除相关容器/卷/网络）；
  - 设计为**高度可扩展**的模块体系，使得未来新增 AI 项目（如 Ollama Web 端、本地大模型服务等）时，主要通过新增/调整模块注册表与 Compose 模板即可完成集成，而不需要大规模改动核心代码。

- **前端 React 管理端（v12 UI）**，支持：
  - 仪表盘（Dashboard）：
    - 显示 Docker 状态、模块运行概况；
    - 各模块卡片（启停按钮、状态、端口、快捷入口）。
  - 设置中心（Settings）：
    - 系统设置：语言、窗口行为、新窗口打开方式、日志级别等；
    - 网络设置：镜像加速地址、代理配置；
    - 模块设置：端口、数据库连接、环境变量等；
    - 调试与危险操作：打开 DevTools、清空数据、清理 Docker 资源等。
  - 日志中心（Logs）：
    - 容器日志、客户端操作日志；
    - 按模块/级别过滤与分页展示。
  - 性能监控页面（Monitoring）：
    - 第一阶段可以用假数据 + CSS 图表展示；
    - 有条件时可接入真实 Docker 或系统指标接口。
  - 模块 Web 页：
    - 在 Electron 中通过 BrowserView 打开 n8n / Dify / OneAPI / RagFlow / 在线教程 / AI 市场；
    - 顶部有导航工具栏（后退/前进/刷新/回到首页/在系统浏览器中打开）。

- **打包与分发：**
  - 使用 electron-builder 或等价工具，生成 Windows 安装包（NSIS 或其它安装器），**优先保证 Windows 体验完善**；
  - 预留 macOS 打包能力（如 `.dmg` / `.app`），确保主流程在 macOS 上也能运行，但可以作为后续阶段逐步完善；
  - 最终要求：客户机（Win10/11/macOS）只需安装本应用 + 手动安装 Docker，即可使用主要功能。


## 二、给新会话中 AI 的硬性约束

> 以下是对“未来新会话里的 AI”（也就是你）的要求。

### 2.1 初始仓库假设

在新会话中，你必须假设：

- 仓库根目录只包含：
  - `ui-ai-server-v12/`：React + TypeScript 的前端 UI Demo；
  - `AI-Server-v12-项目说明与总Prompt.md`：本文件.
- **不存在**任何现成的 Electron 主进程代码、Docker 编排代码、Node 后端逻辑或脚本可以直接复用；
- 你不能依赖“之前 ai-server 仓库里已有的某某文件”，所有后端/主进程/Docker 相关代码都要在本新会话中从零设计和实现.

### 2.2 技术栈与架构方向

- 主框架：Electron + React + TypeScript.
- 前端：
  - 使用 `ui-ai-server-v12` 作为唯一 UI 设计与代码基线，在项目初期从中复制/迁移页面与组件.
  - 最终正式前端代码必须放在新建的正式目录（例如 `src/renderer`），并约定所有实际使用的 React 代码都放在其中，以保证后续可以删除 `ui-ai-server-v12/` 而不影响开发与运行.
- 后端 / 主进程：
  - 使用 Node.js + TypeScript 编写 Electron 主进程与所有业务逻辑（环境检测、Docker 调用、配置管理、日志、BrowserView 管理等）；
- 容器管理：
  - 使用 Docker / docker-compose；
  - 所有对 Docker 的调用通过 Node 侧封装（比如 child_process 调用 docker CLI、或 dockerode 等库）；
- 打包：
  - 推荐使用 electron-builder；
  - 若需，可在后期增加 NSIS 配置等.

### 2.3 UI 相关约束

- 不再使用 Vue；所有管理端功能都通过 React（v12 UI）实现.
- 开发时可以重构 v12 UI 里的组件/hook/状态管理，但：
  - 页面信息架构要与 Demo 保持一致（Dashboard / Settings / Logs / Monitoring / 模块页等）；
  - 视觉风格尽量保持统一，避免“东拼西凑”的样子.

### 2.4 关于 `ui-ai-server-v12` 目录的要求

- `ui-ai-server-v12/` 仅作为初始 React UI Demo 与设计参考，不是最终工程代码的一部分.
- 在完成阶段 1~3 后，所有被应用实际使用的 React 代码、样式、路由等，必须已经迁移到正式前端目录（如 `src/renderer`），并以该目录为唯一前端入口.
- 根目录的 `package.json`、Vite/Electron 配置以及 `npm run dev`、`npm run build`、`npm run dist` 等脚本，必须只依赖正式前端目录中的代码与构建结果，不得在运行时或构建脚本中直接引用 `ui-ai-server-v12` 目录.
- 最终要求：**删除 `ui-ai-server-v12/` 目录不会影响继续开发、构建和运行应用**.


## 三、功能需求拆解（给 AI 的详细说明）

下面是更细粒度的功能需求，供你在设计和编码时对照：

### 3.1 环境检测与首次使用体验

1. **检测 Docker 是否安装**：
   - 检查 `docker` 命令是否存在（如通过 `where docker` 或尝试执行 `docker version`）；
   - 或尝试连接本地 Docker Engine（Windows 上的命名管道）.

2. **检测 Docker 是否正在运行**：
   - 执行 `docker version` 或 `docker info`，能成功返回则视为运行中.

3. **UI 表达**：
   - 在 Dashboard 顶部或专门的“环境诊断”区域用清晰的状态指示：
     - 已安装 & 运行中；
     - 已安装但未运行；
     - 未安装.
   - 对于“未安装”或“未运行”场景给出：
     - 文本提示；
     - 按钮：
       - 打开 Docker Desktop 官网；
       - 在 Windows 上尝试启动 Docker Desktop（如果已安装但未运行）.

4. **首次使用引导（可选但推荐）**：
   - 第一次启动应用时，展示简单的引导流程：
     - 步骤 1：检查 Docker；
     - 步骤 2：选择要启用的模块；
     - 步骤 3：提示磁盘占用 / 网络下载量 / 基本风险说明.


## 四、开发阶段与协作方式（给 AI 的行动指南）

在新会话中，你应该：

1. **阶段 0：理解现有 v12 UI 与设计架构**
   - 阅读：
     - `ui-ai-server-v12/README.md`；
     - `ui-ai-server-v12/src/layouts`、`src/pages`、`src/components` 目录；
   - 输出：
     - 对现有 UI Demo 的简要总结（有哪些页面/组件、目前用的是假数据还是实数据）；
     - 一个建议的整体架构与目录规划（如何放置 Electron 主进程、共享类型、Docker 配置等）；
     - 一个按阶段划分的开发路线图（阶段 1~7）；
     - 一个明确的最终目录规划：在仓库根目录下新建正式前端目录（如 `src/renderer`），并约定所有实际使用的 React 代码都放在其中，以保证后续可以删除 `ui-ai-server-v12/` 而不影响开发与运行.

2. **阶段 1：初始化 Electron + React 工程骨架**
   - 在仓库根目录下新建正式前端工程目录（如 `src/renderer`），并将 `ui-ai-server-v12/src` 中的页面/组件按规划迁移到该目录（可以复制后调整结构）；
   - 新建主进程目录（如 `src/main` 或 `electron-main`）；
   - 编写最小化 Electron 主进程入口、创建窗口、加载**正式前端工程**（开发模式下通过仓库根目录的 Vite dev server，而不是直接引用 `ui-ai-server-v12` 目录中的脚本）；
   - 为后续 IPC 通信预留 preload 文件；
   - 在仓库根目录新增 npm 脚本，说明如何在开发环境启动应用（如 `npm run dev`），并确保这些脚本只依赖正式前端目录与主进程目录，不依赖 `ui-ai-server-v12` 目录.

3. **阶段 2：设计 IPC 协议与类型**
   - 设计共享的 IPC 通道常量与 TypeScript 类型（可以新建 `shared/ipc-contract.ts`）；
   - 在主进程中实现这些 IPC 的 stub（先返回假数据，等待后续接入 Docker 等真实逻辑）；
   - 在 React 端封装统一的 IPC 客户端（如 `ipcClient.ts` 或 hooks）.
4. **阶段 3：接入 Dashboard & 模块管理基础流**
   - 先实现一个简单的模块注册表示例；
   - 让 Dashboard 能从 IPC 获取模块列表和状态（哪怕一开始是模拟值）；
   - 实现“启动/停止模块”按钮与最小化逻辑（可先用假数据模拟成功，再逐步接入 Docker）。
   - 在设计注册表和 IPC 返回结构时，就考虑**扩展性**：未来新增模块（例如 Ollama Web 端）时，主要通过新增配置 + 少量 UI 代码即可完成集成。

5. **阶段 4：接入 Settings 与配置持久化**
   - 设计配置文件结构（如 `config.json` + `modules/*.json` 等）；
   - 让 Settings 页能读取和保存配置，影响后端行为（端口/代理/窗口行为等）。

6. **阶段 5：实现日志系统与 Logs 页面对接**
   - 后端实现模块日志和 Ops 日志的获取接口；
   - 前端 Logs 页实现真实数据加载与筛选展示。

7. **阶段 6：BrowserView 嵌入与模块 Web 页**
   - 在主进程实现 BrowserView 管理与 URL 路由；
   - 前端模块页实现对 BrowserView 的控制（显示/隐藏、后退/前进/刷新/打开浏览器）。

8. **阶段 7：打包与 Windows 联调**
   - 配置 electron-builder 并输出 Windows 安装包；
   - 指导用户在 Win10/11 上安装测试，针对问题进行修正。

在每个阶段：

- 开始前：
  - 用简短文字说明本阶段要做什么、打算改哪些部分；
- 结束时：
  - 总结已经完成的内容；
  - 列出仍然待办的事项；
  - 告诉用户需要在本地运行哪些命令、点击哪些界面来验证。


## 五、行为规范与交流约定

1. **默认使用中文交流**（包括说明、注释、文档），除非用户要求英文。
2. **先理解再编码**：任何较大的结构/接口变更前，先给出设计思路，让用户有机会确认或微调。
3. **小步快跑**：避免一次性大改大量文件，优先做可验证的小增量。
4. **显式维护 TODO / 里程碑**：在对话中维护简明的 TODO 清单（可以用 `[ ]` / `[x]`），反映各功能模块完成度。
5. **重点关注 Windows 行为，同时兼顾 macOS**：路径、权限、PowerShell 与 cmd 差异、Docker Desktop 特性等都要考虑；对于 macOS 要注意路径大小写、权限提示、应用沙箱等。
6. **对危险操作要有安全防护**：如大规模删除 Docker 资源前增加确认提示、日志记录，并在说明中明确风险。

---

> 当你（AI）在新会话里拿到这份“AI-Server-v12-项目说明与总Prompt.md”时，请从“阶段 0：理解 v12 UI 与设计架构”开始，遵循上述约定一步步实现整个项目。
