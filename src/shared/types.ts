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

export interface DockerStatus {
  installed: boolean
  running: boolean
  version?: string
  platform?: string
  error?: string
}

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

export interface DebugSettings {
  showDebugTools: boolean
  verboseLogging: boolean
  showSystemNameSetting: boolean
  browserViewIdleDestroyMinutes: number
}

export interface DockerActionResult {
  success: boolean
  error?: string
  exitCode?: number
  stderrSnippet?: string
}

export interface SystemMetrics {
  cpuUsage: number
  memoryUsage: number
  memoryTotal: number
  memoryUsed: number
  diskUsage: number
  diskTotal: number
  diskUsed: number
}

export interface ModuleRuntimeMetrics {
  moduleId: ModuleId
  name: string
  status: ModuleStatus
  cpuUsage: number | null
  memoryUsage: number | null
  startedAt?: string | null
  uptimeSeconds?: number | null
}

export interface ModuleSettings {
  enabled: boolean
  port: number
  databaseUrl?: string
  /** 可选：模型或数据缓存目录（例如 RagFlow 的 /root/.ragflow 挂载） */
  modelCacheDir?: string
  env: Record<string, string>
}

export interface BrowserAgentSettings {
  enabled: boolean
  port: number
  token?: string
  dataRoot?: string
  maxSessionDurationMinutes?: number
  maxIdleMinutes?: number
}

export type BrowserAgentSessionStatus = 'running' | 'closed' | 'error'

export interface BrowserAgentSessionSummary {
  sessionId: string
  profile: string | null
  clientId: string | null
  status: BrowserAgentSessionStatus
  createdAt: string | null
  finishedAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  actionsCount: number
  lastActionAt: string | null
  lastActionType: string | null
  domain: string | null
}

export type BrowserAgentActionStatus = 'ok' | 'error'

export interface BrowserAgentActionTimelineItem {
  id: string
  sessionId: string
  type: string
  params: any
  startAt: string | null
  endAt: string | null
  durationMs: number | null
  status: BrowserAgentActionStatus
  errorCode: string | null
  errorMessage: string | null
  snapshotId: string | null
  screenshot:
    | {
        snapshotId: string
        description: string | null
        path: string
        fileSize: number | null
        mimeType: string | null
      }
    | null
}

export interface BrowserAgentFileItem {
  fileId: string
  sessionId: string
  name: string | null
  size: number | null
  mimeType: string | null
  path: string | null
  createdAt: string | null
}

export interface BrowserAgentSessionDetail {
  session: BrowserAgentSessionSummary
  actions: BrowserAgentActionTimelineItem[]
  files?: BrowserAgentFileItem[]
}

export interface BrowserAgentRuntimeMetrics {
  cpuUsage: number | null
  memoryUsage: number | null
  runningSessions: number
  windowsCount: number
}

export interface AppSettings {
  systemName: string
  language: LanguageSetting
  logLevel: LogLevel
  autoStartOnBoot: boolean
  docker: DockerSettings
  debug: DebugSettings
  modules: Record<ModuleId, ModuleSettings>
  browserAgent?: BrowserAgentSettings
}
