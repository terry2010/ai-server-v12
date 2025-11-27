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
}
