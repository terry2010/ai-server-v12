# AI-Server-v12 模块数据备份与恢复方案

> 版本：v0.1（草案）  
> 适用范围：当前 ai-server-v12 桌面应用，涵盖 n8n / OneAPI / Dify / RagFlow 四个模块

---

## 1. 设计目标与约束

### 1.1 设计目标

- 为每个模块提供 **模块级的一键备份 / 一键恢复** 能力：
  - n8n：完整迁移工作流、执行记录、用户与凭据。
  - OneAPI：完整迁移渠道、模型配置、额度与统计信息。
  - Dify：完整迁移应用配置、数据集配置，以及配套的对象存储与搜索索引。
  - RagFlow：完整迁移知识库配置、Agent 配置以及相关文件与索引。
- 对最终用户暴露的操作尽量简单：
  - 在「系统设置 → 模块设置」内，仅有两个按钮：`备份数据` / `恢复备份`。
  - 备份时使用系统「另存为」对话框，恢复时使用系统「打开文件」对话框。
- 在资源占用与实现复杂度之间做折中：
  - **不为每个模块单独起一套 MySQL/PG/MinIO/ES 容器**，避免资源浪费。
  - 使用「单容器 + 多库（多索引、前缀）」的模式进行逻辑隔离。

### 1.2 关键约束

- 运行环境：
  - Windows 10/11 为主，使用 Docker Desktop；
  - 通过 `docker` CLI 或 dockerode 访问容器。
- 安全性：
  - 恢复操作会覆盖现有数据，必须有明确二次确认；
  - 备份文件中可能包含敏感信息（API Key、凭据明文/密文），用户需自行妥善保存。
- 可运维性：
  - 所有备份/恢复逻辑均封装在 AI-Server 主进程，不要求用户手动执行 Docker/DB 命令。

---

## 2. 基础架构与数据映射

### 2.1 容器与数据服务总体布局

当前及目标布局：

- **关系型数据库**
  - `ai-server-mysql`（单一 MySQL 容器）
    - 数据卷：`ai-server-mysql-data`
    - 内部包含多个逻辑数据库：
      - `oneapi_db`：OneAPI 核心数据
      - `dify_db`：Dify 核心数据
      - `ragflow_db`：RagFlow 核心数据（如采用 MySQL）
  - `ai-server-postgres`（单一 Postgres 容器）
    - 数据卷：`ai-server-postgres-data`
    - 内部包含多个逻辑数据库：
      - `n8n_db`：n8n 核心数据
      - （可选）`ragflow_db`：如果 RagFlow 使用 Postgres

- **对象存储（MinIO）**
  - 容器：`ai-server-minio`
  - 数据卷：`ai-server-minio-data`
  - 通过 bucket / 前缀区分模块数据：
    - Dify：`dify-apps`、`dify-datasets-*` 等 bucket / 前缀
    - RagFlow：`ragflow-kb-*` 等 bucket / 前缀

- **搜索 / 向量引擎（ElasticSearch）**
  - 容器：`ai-server-es`
  - 数据卷：`ai-server-es-data`
  - 通过索引名前缀区分模块：
    - Dify：`dify-*`
    - RagFlow：`ragflow-*`

### 2.2 模块 → 数据资源映射

| 模块     | DB 引擎   | DB 名称     | MinIO 资源                     | ES 资源           |
|----------|-----------|-------------|--------------------------------|-------------------|
| n8n      | Postgres  | `n8n_db`    | 无（默认不使用 MinIO）        | 无                |
| OneAPI   | MySQL     | `oneapi_db` | 无（默认不使用 MinIO）        | 无                |
| Dify     | MySQL     | `dify_db`   | `dify-*` buckets / 前缀       | 索引 `dify-*`     |
| RagFlow  | MySQL/PG  | `ragflow_db`| `ragflow-*` buckets / 前缀    | 索引 `ragflow-*`  |

> 说明：RagFlow 使用 MySQL 还是 Postgres 可由最终部署方案决定，本方案在逻辑上同时兼容，具体在实现时需在配置中固定下来。

---

## 3. 备份与恢复总体设计

### 3.1 操作入口（前端 UI）

位置：**系统设置 → 模块设置（每个模块的卡片/折叠面板内）**。

- `备份数据` 按钮：
  - 点击后弹出说明对话框：
    - 描述将备份的内容（DB、MinIO、ES 等）；
    - 提醒可能包含敏感信息；
    - 提醒备份过程中的资源占用和时间（特别是 Dify/RagFlow 大数据场景）。
  - 用户点击「选择备份文件位置…」后：
    - 调用 `window.api.backupModuleData(moduleId)`；
    - 主进程弹出系统 `SaveDialog`，默认文件名：`<module>-backup-YYYYMMDD-HHMMSS.tar.gz`；
    - 用户可以修改路径和文件名；取消则不执行备份。

- `恢复备份` 按钮：
  - 点击后先弹出文件选择对话框：
    - `window.api.restoreModuleData(moduleId)` 内部调用 `OpenDialog`；
  - 选择文件后再弹出「二次确认对话框」：
    - 明确提示：该操作会覆盖当前模块的所有数据（列出 DB/MinIO/ES）；
    - 建议用户先执行一次备份；
    - 确认后才真正调用恢复逻辑。

### 3.2 备份文件格式

统一采用压缩包格式，例如：`<module>-backup-YYYYMMDD-HHMMSS.tar.gz`。

包内结构示例（以 Dify 为例）：

```text
metadata.json           # 基本元信息
/db/
  dify-db.sql           # MySQL dify_db 的逻辑导出
/minio/
  ...                   # 该模块所有对象存储数据
/es/
  dify-es.json          # 该模块所有 ES 索引导出（或 snapshot 目录）
```

`metadata.json` 字段建议：

```json
{
  "moduleId": "dify",
  "engine": "mysql",
  "dbName": "dify_db",
  "createdAt": "2025-11-30T02:30:00.000Z",
  "aiServerVersion": "0.1.0",
  "components": ["db", "minio", "es"],
  "notes": "optional notes for future use"
}
```

n8n / OneAPI 等不依赖 MinIO/ES 的模块，其备份包可以只包含 `db/` 和 `metadata.json`。

### 3.3 IPC 与类型设计（概念）

在 `src/shared/ipc-contract.ts` / `window-api.ts` 中新增：

- `backupModuleData`：

```ts
backupModuleData(moduleId: ModuleId): Promise<{
  success: boolean
  path?: string
  error?: string
  cancelled?: boolean
}>
```

- `restoreModuleData`：

```ts
restoreModuleData(moduleId: ModuleId): Promise<{
  success: boolean
  error?: string
  cancelled?: boolean
}>
```

在 `ipc-handlers` 中对应：

- `modules:backupData`
- `modules:restoreData`

主进程负责：

- 与 Electron `dialog` 交互（选择保存/打开路径）；
- 执行 Docker / DB / MinIO / ES 相关命令；
- 处理错误与日志输出。

---

## 4. 各模块备份与恢复细节

### 4.1 n8n

**目标**：完整备份与恢复 n8n 的所有业务数据（工作流、执行历史、用户、凭据等）。

#### 4.1.1 备份

- 组件：Postgres `n8n_db`。
- 步骤：
  1. 通过 Docker 获取 `ai-server-postgres` 容器。
  2. 在容器内执行 `pg_dump`：

     ```bash
     pg_dump -U $USER -d n8n_db -Fc > /backup/n8n-db.dump
     ```

  3. 将 `n8n-db.dump` 拷贝到宿主机临时目录，并打包进备份包的 `/db/` 目录。
  4. 写入 `metadata.json`（`moduleId = 'n8n'`，`engine = 'postgres'`，`dbName = 'n8n_db'`）。

#### 4.1.2 恢复

- 步骤：
  1. 停止 n8n 应用容器（Postgres 保持运行）。
  2. 解压备份包，读取 `metadata.json` 确认模块与 DB 信息。
  3. 在 Postgres 容器内执行：

     ```bash
     dropdb -U $USER n8n_db
     createdb -U $USER n8n_db
     pg_restore -U $USER -d n8n_db /backup/db/n8n-db.dump
     ```

  4. 重启 n8n 容器，进行健康检查。

> 注意：
> - 需要保证恢复前后使用的 `encryptionKey` 一致，否则凭据解密会失败。

---

### 4.2 OneAPI

**目标**：完整备份与恢复 OneAPI 的所有配置、额度与统计数据。

#### 4.2.1 备份

- 组件：MySQL `oneapi_db`。
- 步骤：
  1. 通过 Docker 获取 `ai-server-mysql` 容器。
  2. 在容器内执行 `mysqldump`：

     ```bash
     mysqldump --single-transaction --quick --routines \
       -u $USER -p$PASS oneapi_db > /backup/oneapi-db.sql
     ```

  3. 将 `oneapi-db.sql` 拷贝到宿主机临时目录，打包到 `/db/`。
  4. 写入 `metadata.json`（`moduleId = 'oneapi'`，`engine = 'mysql'`，`dbName = 'oneapi_db'`）。

#### 4.2.2 恢复

- 步骤：
  1. 停止 OneAPI 应用容器；
  2. 解压备份包，读取 `metadata.json` 确认信息；
  3. 在 MySQL 容器中执行：

     ```sql
     DROP DATABASE IF EXISTS oneapi_db;
     CREATE DATABASE oneapi_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
     ```

     然后：

     ```bash
     mysql -u $USER -p$PASS oneapi_db < /backup/db/oneapi-db.sql
     ```

  4. 重启 OneAPI 容器并进行健康检查。

---

### 4.3 Dify

**目标**：完整备份与恢复 Dify 的所有配置、数据集以及相关文件和索引。

#### 4.3.1 备份

- 组件：
  - MySQL `dify_db`；
  - MinIO 中以 Dify 为前缀的 buckets/objects；
  - ElasticSearch 中所有 `dify-*` 索引。

- 步骤概述：
  1. 备份 DB：

     ```bash
     mysqldump --single-transaction --quick --routines \
       -u $USER -p$PASS dify_db > /backup/dify-db.sql
     ```

  2. 备份 MinIO：
     - 使用 MinIO Client `mc`：

       ```bash
       mc alias set local http://ai-server-minio:9000 ACCESS_KEY SECRET_KEY
       mc mirror local/dify-* /backup/minio/
       ```

  3. 备份 ES：
     - 使用 snapshot 或 `elasticdump` 对 `dify-*` 索引导出为 JSON/snapshot：

       ```bash
       elasticdump --input=http://ai-server-es:9200/dify-* \
                   --output=/backup/es/dify-es.json \
                   --type=data
       ```

  4. 打包：
     - 目录结构：`metadata.json` + `/db/` + `/minio/` + `/es/`。

#### 4.3.2 恢复

- 步骤概述：
  1. 停止 Dify 应用容器（API / Web 等），保留 MySQL/MinIO/ES 运行；
  2. 解包备份文件，读取 `metadata.json`；
  3. 恢复 DB：删除并重建 `dify_db`，导入 `dify-db.sql`；
  4. 恢复 MinIO：
     - 清空 Dify 对应 buckets 内的对象；
     - 使用 `mc mirror` 将 `/backup/minio/` 内容同步回去；
  5. 恢复 ES：
     - 删除现有 `dify-*` 索引；
     - 使用 snapshot/elasticdump 导入 `/es/` 中的数据；
  6. 重启 Dify 模块，做健康检查。

---

### 4.4 RagFlow

**目标**：完整备份与恢复 RagFlow 的所有知识库配置、文件和向量索引。

#### 4.4.1 备份

- 组件：
  - RagFlow 主 DB：`ragflow_db`（MySQL 或 Postgres）；
  - MinIO 中 RagFlow 对应 buckets/前缀（如 `ragflow-*`）；
  - ES 中 RagFlow 所有索引（如 `ragflow-*`）。

- 步骤概述：
  1. DB：根据选择的引擎使用 `mysqldump` 或 `pg_dump` 导出 `ragflow_db`；
  2. MinIO：使用 `mc` mirror RagFlow 的 buckets 到备份目录；
  3. ES：导出 `ragflow-*` 索引；
  4. 打包成备份包（结构与 Dify 类似）。

#### 4.4.2 恢复

- 步骤概述：
  1. 停 RagFlow 应用容器，保留 DB/MinIO/ES；
  2. 解包备份文件并读取 `metadata.json`；
  3. 恢复 DB：删除并重建 `ragflow_db`，导入备份；
  4. 恢复 MinIO：清空 RagFlow 对应 buckets 后重新 mirror；
  5. 恢复 ES：删除 `ragflow-*` 索引并导入备份索引；
  6. 重启 RagFlow 并进行健康检查。

---

## 5. 开发分阶段计划

为降低风险，开发上按模块和层次分阶段推进：

### 阶段 A：IPC 与类型约定

- 在 `src/shared/ipc-contract.ts` 中新增：
  - `modules:backupData` / `modules:restoreData` 通道，定义请求/响应类型；
- 在 `src/shared/window-api.ts` 中新增：

```ts
backupModuleData(moduleId: ModuleId): Promise<{ success: boolean; path?: string; error?: string; cancelled?: boolean }>
restoreModuleData(moduleId: ModuleId): Promise<{ success: boolean; error?: string; cancelled?: boolean }>
```

- 在 `preload` 中实现对应的 `window.api` 方法；
- 在文档中补充使用示例与错误码约定（可选）。

### 阶段 B：n8n / OneAPI 备份恢复实现

- 在 `ipc-handlers.js` 中实现：
  - `modules:backupData` / `modules:restoreData` 对 `moduleId = 'n8n' | 'oneapi'` 的处理；
  - 封装 `pg_dump` / `pg_restore` / `mysqldump` / `mysql` 调用；
- 在设置页：
  - 为 n8n / OneAPI 模块增加「备份数据 / 恢复备份」按钮；
  - UI 层处理 loading 状态与错误提示。

### 阶段 C：Dify 完整备份恢复实现

- 在主进程增加对 Dify 的：
  - DB 备份恢复（`dify_db`）；
  - MinIO 数据的 mirror 备份与恢复；
  - ES 索引的导出与导入；
- 在设置页 Dify 卡片中启用按钮，并在文案中提醒时间与空间开销。

### 阶段 D：RagFlow 完整备份恢复实现

- 与 Dify 类似，针对 RagFlow 实现：
  - DB + MinIO + ES 三层的备份与恢复；
- 完成后整个 AI-Server 的四大模块均支持模块级一键备份/恢复。

---

## 6. 风险与注意事项

- 备份与恢复操作可能耗时较长（尤其是 Dify/RagFlow 大数据场景），需在 UI 上增加 loading/进度提示；
- 需要考虑 Windows 环境下 Docker CLI、路径映射与权限问题；
- MinIO 与 ES 的导入导出实现细节依赖具体镜像与版本，落地时需在测试环境中反复验证；
- 所有危险操作（`DROP DATABASE`、删除 ES 索引、清空 MinIO bucket）必须在用户二次确认后执行，并在日志中记录。

## 7. 当前开发进度

- n8n / OneAPI：
  - 已完成 IPC 契约（`modules:backupData` / `modules:restoreData`）、`window.api` 暴露以及主进程备份 / 恢复处理逻辑；
  - 系统设置页已接入「备份数据 / 恢复备份」按钮，并与上述 IPC 全量打通；
  - **数据库恢复功能在代码层面已实现且预期可用，但目前仅做了有限的人工验证，尚未经过系统性测试**（包括空库、已运行一段时间后的数据恢复等场景），后续需要补充完整测试用例。
- Dify / RagFlow：
  - 备份与恢复方案（包含 DB + MinIO + ES）已在本文中完成设计，尚未在代码中落地实现；
  - 预计在完成 n8n / OneAPI 功能验证后，按阶段 C / D 的规划逐步实现并补充测试.
