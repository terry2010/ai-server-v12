# AI-Server-v12 阶段 7：打包与交付设计

> 本文档定义 AI-Server-v12 在阶段 7 的打包与交付方案，覆盖 Windows 安装包 + 绿色版、macOS dmg 与 Mac App Store 版本，以及代码签名策略与后续可选方案。

---

## 一、阶段目标

- **Windows**
  - 产出标准安装包（NSIS 或等价形式），支持普通用户一步安装。
  - 产出真正意义上的「绿色版」便携包：解压到任意目录即可运行，配置与数据随目录移动。
  - 为后续上架 Microsoft Store 预留打包与签名路径（但不一定在阶段 7 完成上架）。

- **macOS**
  - 支持根据打包命令分别产出 x64、arm64、universal 架构的 dmg 安装镜像。
  - 预备 Mac App Store 上架所需的工程结构与打包方式（沙盒、签名、notarize 等），不做功能弱化版。

- **通用**
  - 建立一套在本机可执行的「一键打包」脚本：从 `vite build` 到最终安装包 / 绿色版 / dmg。
  - 在干净环境（仅安装 Docker Desktop）的 Windows 与 macOS 上完成端到端验证：安装 → 启动 → Docker 检测与模块启停 → 日志 & 监控 → BrowserView 模块页。
  - 当前阶段优先完成 Windows 版本的打包与验证，macOS 相关打包在 Windows 稳定后逐步补齐。

---

## 二、技术路线与工具

### 2.1 打包工具

- 统一使用 **electron-builder** 作为 Electron 打包工具：
  - Windows 目标：`nsis` + `portable` + 后续的 `appx/msix`（用于 Store）。
  - macOS 目标：`dmg` + 后续的 `mas`（用于 Mac App Store）。
- 配置方式：
  - 初期在 `package.json` 中新增 `build` 字段；
  - 若配置变复杂，再拆分为 `electron-builder.yml`。

### 2.2 构建流程总览

1. `vite build` → 生成 renderer 的 `dist/`。
2. electron-builder 读取：
   - `dist/**`（renderer 静态资源），
   - `src/main/**`、`src/preload/**`，
   - 必要的配置与额外资源（Docker 模板等），
   并生成对应平台的安装包 / 绿色版 / dmg。
3. 在本机验证产物可正常运行；后续再考虑迁移到 CI。

---

## 三、Windows 打包方案

### 3.1 目标与产物

- **安装包（Installer）**：
  - 目标：`win.nsis`。
  - 形态：`AI-Server-Setup-x.y.z.exe`，支持自定义安装路径。

- **绿色版（Portable）**：
  - 目标：`win.portable`。
  - 形态：`AI-Server-Portable-x.y.z.exe` 或解压目录。
  - 要求：将整个目录拷贝到 U 盘或其它机器后，程序与配置、日志一并跟随，能直接运行。

- **后续预留：Microsoft Store**
  - 目标：`appx`/`msix`。
  - 阶段 7 中仅预留结构与脚本，不必完成上架流程。

### 3.2 electron-builder 配置要点（规划）

- `appId`: `com.yourcompany.aiserver.v12`（待最终确定）。
- `productName`: `AI-Server`。
- `directories`：
  - `output`: `release/`，集中存放打包产物；
  - `buildResources`: `build/`（应用图标等资源）。
- `files`：
  - `dist/**`，
  - `src/main/**`，
  - `src/preload/**`，
  - Docker 与配置模板所需的资源。
- `extraResources`：
  - 如需要在运行时从相对路径加载的 docker-compose 模板、默认配置等，放入 `resources/`。

### 3.3 绿色版（Portable 模式）设计

#### 3.3.1 便携模式判定

- 在应用根目录增加一个标志文件，例如：`portable.flag`。
- 主进程启动时：
  - 若检测到该标志文件，则认为当前运行于「便携模式」。
  - 否则按「常规安装版」处理。

#### 3.3.2 配置与日志路径策略

- 常规安装版：
  - 保持现有行为，使用 `app.getPath('userData')` 作为配置与日志路径，符合桌面应用规范。

- 便携模式：
  - 配置与日志路径改为 **相对应用目录** 的子目录，例如：
    - `data/config/`（配置 JSON）、
    - `data/logs/`（日志聚合文件）、
    - `data/runtime/`（必要的运行时状态）。
  - 需要在集中封装的配置/日志模块中引入「路径策略」：
    - 对外暴露统一的 `getConfigPath()` / `getLogsPath()` 等方法；
    - 内部根据是否为 portable 模式选择 `userData` 或相对路径。

#### 3.3.3 影响范围与改动评估

- 只要所有配置与日志 I/O 都通过统一模块（例如 `app-settings.js` 和日志管理模块）访问，
  则改动主要集中在：
  - 路径计算逻辑；
  - electron-builder 打包时将 `data/` 目录放入 portable 产物。
- Renderer 与 IPC 调用层基本无需改动。

### 3.4 Windows 代码签名策略（阶段 7）

- 阶段 7 主要工作：
  - 保证安装包 / 绿色版在**不签名**的情况下可正常运行，用于内测与技术用户体验；
  - 在文档中记录未来可选的签名方案：
    - 传统 CA 证书（如 Sectigo Standard Code Signing Certificate，`.pfx`），
    - Azure Trusted Signing（原 Azure Code Signing）等云签名服务，
    - 以及可能的开源签名服务（适用于转为开源时）。
- 签名接入的时间点：
  - 等产品接近公开发布阶段，再根据价格、运维成本选择具体方案并接入 electron-builder。

---

## 四、macOS 打包方案

### 4.1 目标与产物

- **dmg 安装镜像**：
  - 目标：`mac.dmg` 相关变体。
  - 架构：支持通过不同打包命令分别产出：
    - `x64` dmg（仅 Intel）；
    - `arm64` dmg（仅 Apple Silicon）；
    - `universal` dmg（x64 + arm64，单一安装包同时支持两种架构）。
  - 形态：`AI-Server-x.y.z-[arch].dmg`，包含拖拽安装到 Applications 的界面，其中 `[arch]` 可为 `x64` / `arm64` / `universal`。

- **Mac App Store 版本**：
  - 目标：`mas`。
  - 功能：
    - 不做功能弱化版，保持与 dmg 相同的 Docker 控制与 BrowserView 能力；
    - 若审核对本机 Docker 操作有限制，再根据最新规则评估取舍。

### 4.2 签名与 notarize 策略

- dmg 分发版本：
  - 未来需要使用 Apple Developer ID Application 证书签名，并走 notarize + staple 流程，
    以降低 Gatekeeper 警告等级；
  - 阶段 7 先以「可在开发者本机 / 内测机上运行」为目标，记录 notarize 流程，待后续接入。

- Mac App Store 版本：
  - 使用 Apple 提供的 `3rd Party Mac Developer Application` 等证书完成 `mas` 构建与上架；
  - 需要在 macOS 环境下完成打包与提审（不考虑外包开发）。

> 注意：macOS 的签名与 notarization 完全独立于 Windows，需单独规划 Apple 开发者账号与证书获取流程。

---

## 五、构建脚本与开发流程

### 5.1 新增 npm scripts 规划

- `build:renderer`: `vite build`
- `build:win`: `npm run build:renderer && electron-builder --win nsis portable`
- `build:mac:x64`: `npm run build:renderer && electron-builder --mac dmg --x64`
- `build:mac:arm64`: `npm run build:renderer && electron-builder --mac dmg --arm64`
- `build:mac:universal`: `npm run build:renderer && electron-builder --mac dmg`
- `build:mas`（后续）：`npm run build:renderer && electron-builder --mac mas`

> 阶段 7 目标是保证上述命令在开发机上可成功执行并产出可运行的安装包 / dmg，
> CI 自动化构建留待后续阶段实现。

### 5.2 手动验证流程

- Windows：
  1. 在开发机上运行 `npm run build:win`。
  2. 在虚拟机或干净环境中：
     - 安装 NSIS 安装包，验证：
       - 应用可启动；
       - Docker 检测、模块启停、日志/监控、BrowserView 正常；
       - 配置确实写入 `userData` 目录。
     - 解压或运行 Portable 版本，验证：
       - 便携目录中的 `data/` 路径工作正常；
       - 将整个目录拷贝到其它路径/磁盘后，配置与日志随目录迁移，无需重新配置。

- macOS：
  1. 在 macOS 开发机上运行 `npm run build:mac`。
  2. 在目标 macOS 版本（Intel 与 Apple Silicon 至少一种）上：
     - 安装 dmg 至 Applications；
     - 验证与 Windows 相同的 UI 与 Docker 功能链路。

---

## 六、后续待决事项与风险

- **Windows 代码签名方案选择**：
  - 传统 CA 证书（Sectigo 等） vs Azure Trusted Signing；
  - 价格、管理成本、与未来 CI 集成方式有待正式产品阶段再决策。

- **Mac App Store 审核规则变动**：
  - 若未来审核对本机 Docker 控制有额外限制，需要根据当时规则评估：
    - 是否可以直接上架完整能力，或
    - 采用「Store 版本 + 官网完整版 dmg」的双轨策略。

- **CI/CD 集成**：
  - 当前阶段不要求；
  - 待产品进入稳定发布期后，再将打包与（可能的）签名流程迁移到 CI 平台统一管理。

---

## 七、阶段 7 验收标准（初版）

- 在开发机上：
  - `npm run build:win` 能产出可安装的 NSIS 安装包和 Portable 版本；
  - `npm run build:mac:x64` / `build:mac:arm64` / `build:mac:universal` 能分别产出对应架构的 dmg，并可在至少一台 macOS 机器上正常安装和运行（可先从其中一种架构开始，逐步补齐其余两种）。

- 在干净环境上：
  - Windows：安装版与绿色版均可完成基础体验（含 Docker 检测、模块启停、日志/监控、BrowserView）。
  - macOS：dmg 版可完成同等体验，功能与 Windows 基本一致。

- 文档层面：
  - 阶段 7 的打包与交付设计文档（即本文）被确认可行；
  - 阶段规划总览中的阶段 7 描述与本文保持一致。
