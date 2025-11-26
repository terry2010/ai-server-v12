import type {
  AppSettings,
  DockerStatus,
  LogItem,
  LogLevel,
  LogModule,
  ModuleId,
  ModuleInfo,
} from './types'

export interface WindowApi {
  ping(): string
  getDockerStatus(): Promise<DockerStatus>
  listModules(): Promise<ModuleInfo[]>
  startModule(moduleId: ModuleId): Promise<{ success: boolean; error?: string }>
  stopModule(moduleId: ModuleId): Promise<{ success: boolean; error?: string }>
  getLogs(params: {
    module?: LogModule | 'all'
    level?: LogLevel | 'all'
    page?: number
    pageSize?: number
  }): Promise<{ items: LogItem[]; total: number }>
  exportLogs(params: {
    filename?: string
    module?: LogModule
    level?: LogLevel
  }): Promise<{ success: boolean; path?: string; error?: string }>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
}
