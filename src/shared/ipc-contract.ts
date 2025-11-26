import type {
  AppSettings,
  DockerStatus,
  LogItem,
  LogLevel,
  LogModule,
  ModuleId,
  ModuleInfo,
} from './types'

export type EmptyPayload = Record<string, never>

export interface IpcRequestMap {
  'docker:getStatus': EmptyPayload
  'docker:startDesktop': EmptyPayload
  'modules:list': EmptyPayload
  'modules:start': { moduleId: ModuleId }
  'modules:stop': { moduleId: ModuleId }
  'logs:list': {
    module?: LogModule | 'all'
    level?: LogLevel | 'all'
    page?: number
    pageSize?: number
  }
  'logs:export': {
    filename?: string
    module?: LogModule
    level?: LogLevel
  }
  'settings:get': EmptyPayload
  'settings:update': Partial<AppSettings>
}

export interface IpcResponseMap {
  'docker:getStatus': DockerStatus
  'docker:startDesktop': { success: boolean; error?: string }
  'modules:list': ModuleInfo[]
  'modules:start': { success: boolean; error?: string }
  'modules:stop': { success: boolean; error?: string }
  'logs:list': { items: LogItem[]; total: number }
  'logs:export': { success: boolean; path?: string; error?: string }
  'settings:get': AppSettings
  'settings:update': AppSettings
}

export type IpcChannels = keyof IpcRequestMap

export type IpcRequest<Channel extends IpcChannels> = IpcRequestMap[Channel]

export type IpcResponse<Channel extends IpcChannels> = IpcResponseMap[Channel]
