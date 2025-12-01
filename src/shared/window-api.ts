import type {
  AppSettings,
  DockerStatus,
  LogItem,
  LogLevel,
  LogModule,
  ModuleId,
  ModuleInfo,
  DockerActionResult,
  SystemMetrics,
  ModuleRuntimeMetrics,
  BrowserAgentSessionSummary,
  BrowserAgentSessionDetail,
  BrowserAgentRuntimeMetrics,
} from './types'

export interface WindowApi {
  ping(): string
  getDockerStatus(): Promise<DockerStatus>
  startDockerDesktop(): Promise<{ success: boolean; error?: string }>
  pullDockerImage(image: string): Promise<DockerActionResult>
  listModules(): Promise<ModuleInfo[]>
  startModule(moduleId: ModuleId): Promise<{ success: boolean; error?: string }>
  stopModule(moduleId: ModuleId): Promise<{ success: boolean; error?: string }>
  restartN8n(): Promise<{ success: boolean; error?: string }>
  restartOneApi(): Promise<{ success: boolean; error?: string }>
  restartDify(): Promise<{ success: boolean; error?: string }>
  restartRagflow(): Promise<{ success: boolean; error?: string }>
  getLogs(params: {
    module?: LogModule | 'all'
    level?: LogLevel | 'all'
    page?: number
    pageSize?: number
    startTime?: string
    endTime?: string
  }): Promise<{ items: LogItem[]; total: number }>
  exportLogs(params: {
    filename?: string
    module?: LogModule
    level?: LogLevel
    startTime?: string
    endTime?: string
  }): Promise<{ success: boolean; path?: string; error?: string }>
  clearLogs(): Promise<{ success: boolean }>
  getSystemMetrics(): Promise<SystemMetrics>
  getModuleMetrics(): Promise<{ items: ModuleRuntimeMetrics[] }>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  dockerStopAll(): Promise<DockerActionResult>
  dockerRemoveAll(): Promise<DockerActionResult>
  dockerPruneVolumes(): Promise<DockerActionResult>
  dockerFullCleanup(): Promise<DockerActionResult>
  openModuleView(moduleId: ModuleId): Promise<{ success: boolean; error?: string }>
  closeModuleView(): Promise<{ success: boolean; error?: string }>
  controlModuleView(
    moduleId: ModuleId,
    action: 'home' | 'reload' | 'back' | 'forward',
  ): Promise<{ success: boolean; error?: string }>
  backupModuleData(
    moduleId: ModuleId,
  ): Promise<{
    success: boolean
    path?: string
    error?: string
    cancelled?: boolean
  }>
  browserAgentGetRuntimeMetrics(): Promise<BrowserAgentRuntimeMetrics>
  restoreModuleData(
    moduleId: ModuleId,
  ): Promise<{
    success: boolean
    error?: string
    cancelled?: boolean
  }>
  browserAgentListSessions(params: {
    date?: string
    profile?: string
    clientId?: string
    status?: 'all' | 'running' | 'closed'
  }): Promise<{ items: BrowserAgentSessionSummary[] }>
  browserAgentGetSessionDetail(params: {
    sessionId: string
    date?: string
  }): Promise<BrowserAgentSessionDetail | null>
  browserAgentShowSessionWindow(sessionId: string): Promise<{
    success: boolean
    reason?: 'invalid_session_id' | 'session_not_found' | 'no_window_id' | 'window_closed' | 'error'
    error?: string
  }>
  browserAgentOpenSnapshot(params: {
    snapshotId: string
    date?: string
  }): Promise<{
    success: boolean
    error?: string
  }>
}
