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

export type EmptyPayload = Record<string, never>

export interface IpcRequestMap {
  'docker:getStatus': EmptyPayload
  'docker:startDesktop': EmptyPayload
  'docker:pullImage': { image: string }
  'modules:list': EmptyPayload
  'modules:start': { moduleId: ModuleId }
  'modules:stop': { moduleId: ModuleId }
  'logs:list': {
    module?: LogModule | 'all'
    level?: LogLevel | 'all'
    page?: number
    pageSize?: number
    startTime?: string
    endTime?: string
  }
  'logs:export': {
    filename?: string
    module?: LogModule
    level?: LogLevel
    startTime?: string
    endTime?: string
  }
  'logs:clear': EmptyPayload
  'monitor:getSystem': EmptyPayload
  'monitor:getModules': EmptyPayload
  'settings:get': EmptyPayload
  'settings:update': Partial<AppSettings>
  'debug:dockerStopAll': EmptyPayload
  'debug:dockerRemoveAll': EmptyPayload
  'debug:dockerPruneVolumes': EmptyPayload
  'debug:dockerFullCleanup': EmptyPayload
}

export interface IpcResponseMap {
  'docker:getStatus': DockerStatus
  'docker:startDesktop': { success: boolean; error?: string }
  'docker:pullImage': DockerActionResult
  'modules:list': ModuleInfo[]
  'modules:start': { success: boolean; error?: string }
  'modules:stop': { success: boolean; error?: string }
  'logs:list': { items: LogItem[]; total: number }
  'logs:export': { success: boolean; path?: string; error?: string }
  'logs:clear': { success: boolean }
  'monitor:getSystem': SystemMetrics
  'monitor:getModules': { items: ModuleRuntimeMetrics[] }
  'settings:get': AppSettings
  'settings:update': AppSettings
  'debug:dockerStopAll': DockerActionResult
  'debug:dockerRemoveAll': DockerActionResult
  'debug:dockerPruneVolumes': DockerActionResult
  'debug:dockerFullCleanup': DockerActionResult
}

export type IpcChannels = keyof IpcRequestMap

export type IpcRequest<Channel extends IpcChannels> = IpcRequestMap[Channel]

export type IpcResponse<Channel extends IpcChannels> = IpcResponseMap[Channel]
