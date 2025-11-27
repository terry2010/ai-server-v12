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
}

export interface ModuleSettings {
  enabled: boolean
  port: number
  databaseUrl?: string
  env: Record<string, string>
}

export interface AppSettings {
  systemName: string
  language: LanguageSetting
  logLevel: LogLevel
  autoStartOnBoot: boolean
  docker: DockerSettings
  debug: DebugSettings
  modules: Record<ModuleId, ModuleSettings>
}
