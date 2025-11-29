import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { AppSettings, ModuleStatus } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Field } from './Field'

interface ModuleSettingsProps {
  moduleKey: 'n8n' | 'dify' | 'oneapi' | 'ragflow'
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  moduleStatus?: ModuleStatus
  onChange: (next: AppSettings) => void
  onSave: () => void
}

export function ModuleSettings({
  moduleKey,
  settings,
  loading,
  saving,
  moduleStatus,
  onChange,
  onSave,
}: ModuleSettingsProps) {
  const titleMap: Record<ModuleSettingsProps['moduleKey'], string> = {
    n8n: 'n8n 设置',
    dify: 'Dify 设置',
    oneapi: 'OneAPI 设置',
    ragflow: 'RagFlow 设置',
  }

  const [visibleSecretKey, setVisibleSecretKey] = useState<string | null>(null)
  const [applyingRestart, setApplyingRestart] = useState(false)
  const [runtimeStatus, setRuntimeStatus] = useState<ModuleStatus | undefined>(moduleStatus)
  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)

  // 当父组件传入的状态变化时，先同步一份
  useEffect(() => {
    setRuntimeStatus(moduleStatus)
  }, [moduleStatus])

  useEffect(() => {
    setBackupLoading(false)
    setRestoreLoading(false)
  }, [moduleKey])

  // 每次打开某个模块设置页时，主动查询一次最新模块状态，避免使用陈旧的初始值
  useEffect(() => {
    let cancelled = false

    const loadStatus = async () => {
      try {
        const modules = await window.api.listModules()
        if (cancelled || !Array.isArray(modules)) return
        const target = modules.find((m) => m && m.id === moduleKey)
        if (target && target.status) {
          setRuntimeStatus(target.status as ModuleStatus)
        }
      } catch {
        // 忽略状态查询错误，保持现有状态
      }
    }

    loadStatus()

    return () => {
      cancelled = true
    }
  }, [moduleKey])

  const canRestart = runtimeStatus === 'running' || runtimeStatus === 'starting'

  if (loading || !settings) {
    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{titleMap[moduleKey]}</CardTitle>
          <CardDescription>正在加载配置…</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const moduleSettings = settings.modules[moduleKey]

  const updateModule = (patch: Partial<typeof moduleSettings>) => {
    onChange({
      ...settings,
      modules: {
        ...settings.modules,
        [moduleKey]: {
          ...moduleSettings,
          ...patch,
        },
      },
    })
  }

  // n8n 特殊配置
  if (moduleKey === 'n8n') {
    const envMap = moduleSettings.env || {}
    const secretEnv = {
      N8N_ENCRYPTION_KEY: envMap.N8N_ENCRYPTION_KEY || '',
      N8N_JWT_SECRET: envMap.N8N_JWT_SECRET || '',
      N8N_USER_MANAGEMENT_JWT_SECRET: envMap.N8N_USER_MANAGEMENT_JWT_SECRET || '',
    }

    const secretEnvKeys = [
      'N8N_ENCRYPTION_KEY',
      'N8N_JWT_SECRET',
      'N8N_USER_MANAGEMENT_JWT_SECRET',
    ] as const

    const reservedEnvKeys = [
      'N8N_LOG_LEVEL',
      'DB_TYPE',
      'DB_POSTGRESDB_HOST',
      'DB_POSTGRESDB_PORT',
      'DB_POSTGRESDB_DATABASE',
      'DB_POSTGRESDB_USER',
      'DB_POSTGRESDB_PASSWORD',
      ...secretEnvKeys,
    ]

    const hasExternalDbEnv = Boolean(
      envMap.DB_POSTGRESDB_HOST ||
        envMap.DB_POSTGRESDB_DATABASE ||
        envMap.DB_POSTGRESDB_USER ||
        envMap.DB_POSTGRESDB_PASSWORD,
    )
    const dbMode: 'managed' | 'external' = hasExternalDbEnv ? 'external' : 'managed'

    const effectiveLogLevel = (envMap.N8N_LOG_LEVEL as AppSettings['logLevel']) || settings.logLevel

    const otherEnvEntries = Object.entries(envMap).filter(([key]) => !reservedEnvKeys.includes(key))
    const otherEnvText = otherEnvEntries
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    const port = moduleSettings.port || 0
    const consoleUrl = port > 0 ? `http://localhost:${port}` : ''
    const webhookUrl = port > 0 ? `${consoleUrl}/webhook` : ''

    const dbHost = envMap.DB_POSTGRESDB_HOST || ''
    const dbPort = envMap.DB_POSTGRESDB_PORT || ''
    const dbName = envMap.DB_POSTGRESDB_DATABASE || ''
    const dbUser = envMap.DB_POSTGRESDB_USER || ''
    const dbPassword = envMap.DB_POSTGRESDB_PASSWORD || ''

    const setEnv = (nextEnv: Record<string, string>) => {
      updateModule({ env: nextEnv })
    }

    const handleEnvTextChange = (value: string) => {
      const lines = value.split('\n')
      const parsed: Record<string, string> = {}
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        const index = line.indexOf('=')
        if (index <= 0) continue
        const key = line.slice(0, index).trim()
        const val = line.slice(index + 1)
        if (!key) continue
        if (reservedEnvKeys.includes(key)) continue
        parsed[key] = val
      }

      const current = moduleSettings.env || {}
      const reservedSet = new Set(reservedEnvKeys)
      const nextEnv: Record<string, string> = {}

      for (const [key, val] of Object.entries(current)) {
        if (reservedSet.has(key)) {
          nextEnv[key] = val
        }
      }

      for (const [key, val] of Object.entries(parsed)) {
        if (!reservedSet.has(key)) {
          nextEnv[key] = val
        }
      }

      setEnv(nextEnv)
    }

    const handleLogLevelChange = (value: string) => {
      const level: AppSettings['logLevel'] =
        value === 'error' || value === 'warn' || value === 'debug' ? value : 'info'
      const current = moduleSettings.env || {}
      const nextEnv: Record<string, string> = {
        ...current,
        N8N_LOG_LEVEL: level,
      }
      setEnv(nextEnv)
    }

    const handleDbModeChange = (value: string) => {
      const current = moduleSettings.env || {}
      const nextEnv: Record<string, string> = {}

      for (const [key, val] of Object.entries(current)) {
        if (!reservedEnvKeys.includes(key) || key === 'N8N_LOG_LEVEL' || key === 'DB_TYPE') {
          nextEnv[key] = val
        }
      }

      if (value === 'external') {
        nextEnv.DB_POSTGRESDB_HOST = dbHost || 'localhost'
        nextEnv.DB_POSTGRESDB_PORT = dbPort || '5432'
        nextEnv.DB_POSTGRESDB_DATABASE = dbName || 'n8n'
        nextEnv.DB_POSTGRESDB_USER = dbUser || 'n8n'
        nextEnv.DB_POSTGRESDB_PASSWORD = dbPassword || ''
      }

      setEnv(nextEnv)
    }

    const handleExternalDbFieldChange = (
      field: 'host' | 'port' | 'database' | 'user' | 'password',
      value: string,
    ) => {
      const current = moduleSettings.env || {}
      const nextEnv: Record<string, string> = {
        ...current,
      }
      if (field === 'host') nextEnv.DB_POSTGRESDB_HOST = value
      if (field === 'port') nextEnv.DB_POSTGRESDB_PORT = value
      if (field === 'database') nextEnv.DB_POSTGRESDB_DATABASE = value
      if (field === 'user') nextEnv.DB_POSTGRESDB_USER = value
      if (field === 'password') nextEnv.DB_POSTGRESDB_PASSWORD = value
      setEnv(nextEnv)
    }

    const handleEnabledChange = async (checked: boolean) => {
      if (!checked) {
        try {
          const modules = await window.api.listModules()
          const target = modules.find((m) => m.id === 'n8n')
          if (target && (target.status === 'running' || target.status === 'starting')) {
            toast.warning('n8n 模块正在运行，无法禁用。请先在首页停止服务后再尝试禁用。')
            updateModule({ enabled: true })
            return
          }
        } catch {
          toast.error('检查 n8n 运行状态失败，暂时无法禁用。')
          updateModule({ enabled: true })
          return
        }
      }

      updateModule({ enabled: checked })
    }

    const handlePortChange = (value: string) => {
      const num = Number(value)
      const portValue = Number.isFinite(num) && num > 0 ? num : 0
      updateModule({ port: portValue })
    }

    const handleCopySecret = async (key: keyof typeof secretEnv) => {
      const value = secretEnv[key]
      if (!value) {
        toast.error('秘钥尚未生成，请先启动 n8n。')
        return
      }

      try {
        await navigator.clipboard.writeText(value)
        toast.success(`${String(key)} 已复制到剪贴板。`)
      } catch {
        toast.error('复制失败，请手动复制。')
      }
    }

    const handleApplyAndRestart = async () => {
      if (saving) return

      setApplyingRestart(true)
      try {
        await Promise.resolve(onSave() as any)

        const result = await window.api.restartN8n()
        if (!result || !result.success) {
          toast.error(result?.error ?? '应用并重启 n8n 失败，请稍后重试。')
        } else {
          toast.success('n8n 设置已应用并重启。')
        }
      } catch {
        toast.error('应用并重启 n8n 失败，请稍后重试。')
      } finally {
        setApplyingRestart(false)
      }
    }

    const handleBackupData = async () => {
      if (backupLoading) return
      setBackupLoading(true)
      try {
        const result = await window.api.backupModuleData('n8n')
        if (!result || (result as any).cancelled) {
          window.alert('已取消备份 n8n 数据。')
          return
        }
        if (!result.success) {
          window.alert(result.error ?? '备份 n8n 数据失败，请稍后重试。')
          return
        }
        if (result.path) {
          window.alert(`n8n 数据已备份到：${result.path}`)
        } else {
          window.alert('n8n 数据备份完成。')
        }
      } catch {
        window.alert('备份 n8n 数据失败，请稍后重试。')
      } finally {
        setBackupLoading(false)
      }
    }

    const handleRestoreData = async () => {
      if (restoreLoading) return
      const confirmed = window.confirm(
        '此操作会使用所选备份覆盖当前 n8n 数据库中的所有数据，可能导致现有数据不可恢复。确定要继续吗？',
      )
      if (!confirmed) return

      setRestoreLoading(true)
      try {
        const result = await window.api.restoreModuleData('n8n')
        if (!result || (result as any).cancelled) {
          window.alert('已取消恢复 n8n 数据。')
          return
        }
        if (!result.success) {
          window.alert(result.error ?? '恢复 n8n 数据失败，请稍后重试。')
          return
        }
        window.alert('n8n 数据恢复完成。')
      } catch {
        window.alert('恢复 n8n 数据失败，请稍后重试。')
      } finally {
        setRestoreLoading(false)
      }
    }

    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{titleMap[moduleKey]}</CardTitle>
          <CardDescription>配置 n8n 的端口、数据库和环境变量等参数。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          <Field label="启用 n8n 模块" description="关闭后将不在控制台中展示和管理 n8n 模块。">
            <Switch checked={moduleSettings.enabled} onCheckedChange={handleEnabledChange} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="服务端口" description="n8n 容器映射到本机的端口号。">
              <Input
                placeholder="5678"
                className="font-mono text-xs"
                value={moduleSettings.port ? String(moduleSettings.port) : ''}
                onChange={(e) => handlePortChange(e.target.value)}
              />
            </Field>
            <Field label="n8n 控制台 URL" description="基于 localhost 与端口推导，仅作为访问参考。">
              <div className="text-xs font-mono text-slate-700 dark:text-slate-200 break-all">
                {consoleUrl || '请先配置服务端口'}
              </div>
            </Field>
          </div>

          <Field label="Webhook 外网地址" description="n8n 生成 Webhook 时可参考的访问地址。">
            <div className="text-xs font-mono text-slate-700 dark:text-slate-200 break-all">
              {webhookUrl || '请先配置服务端口'}
            </div>
          </Field>

          <Field label="n8n 日志等级" description="仅影响 n8n 应用自身的日志输出级别。">
            <select
              className="h-9 w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={effectiveLogLevel}
              onChange={(e) => handleLogLevelChange(e.target.value)}
            >
              <option value="error">error</option>
              <option value="warn">warn</option>
              <option value="info">info</option>
              <option value="debug">debug</option>
            </select>
          </Field>

          <Field label="数据库模式（开发中）" description="选择使用内置托管 Postgres 或外部 PostgreSQL 数据库。">
            <select
              className="h-9 w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={dbMode}
              onChange={(e) => handleDbModeChange(e.target.value)}
            >
              <option value="managed">内置托管 Postgres</option>
              <option value="external">外部 PostgreSQL</option>
            </select>
          </Field>

          {dbMode === 'external' && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="外部数据库主机" description="外部 PostgreSQL 服务地址。">
                <Input
                  placeholder="localhost"
                  className="font-mono text-xs"
                  value={dbHost}
                  onChange={(e) => handleExternalDbFieldChange('host', e.target.value)}
                />
              </Field>
              <Field label="外部数据库端口" description="通常为 5432。">
                <Input
                  placeholder="5432"
                  className="font-mono text-xs"
                  value={dbPort}
                  onChange={(e) => handleExternalDbFieldChange('port', e.target.value)}
                />
              </Field>
              <Field label="数据库名称" description="n8n 使用的数据库名称。">
                <Input
                  placeholder="n8n"
                  className="font-mono text-xs"
                  value={dbName}
                  onChange={(e) => handleExternalDbFieldChange('database', e.target.value)}
                />
              </Field>
              <Field label="数据库用户" description="用于连接外部数据库的用户名。">
                <Input
                  placeholder="n8n"
                  className="font-mono text-xs"
                  value={dbUser}
                  onChange={(e) => handleExternalDbFieldChange('user', e.target.value)}
                />
              </Field>
              <Field label="数据库密码" description="用于连接外部数据库的密码。">
                <Input
                  placeholder="••••••••"
                  type="password"
                  className="font-mono text-xs"
                  value={dbPassword}
                  onChange={(e) => handleExternalDbFieldChange('password', e.target.value)}
                />
              </Field>
            </div>
          )}

          <Field label="环境变量" description="一行一个，支持 KEY=VALUE 格式（不含上方已经配置的字段）">
            <textarea
              rows={4}
              className="w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-mono text-slate-900 shadow-sm outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
              placeholder="OPENAI_API_KEY=sk-...&#10;HTTP_PROXY=http://127.0.0.1:7890"
              value={otherEnvText}
              onChange={(e) => handleEnvTextChange(e.target.value)}
            />
          </Field>

          <Field label="安全秘钥" description="首次启动 n8n 时自动生成，用于加密凭据等，暂不支持在此修改。">
            <div className="space-y-3 text-xs">
              {(
                [
                  {
                    key: 'N8N_ENCRYPTION_KEY' as const,
                    label: '凭据加密秘钥 N8N_ENCRYPTION_KEY',
                  },
                  {
                    key: 'N8N_JWT_SECRET' as const,
                    label: 'JWT 秘钥 N8N_JWT_SECRET',
                  },
                  {
                    key: 'N8N_USER_MANAGEMENT_JWT_SECRET' as const,
                    label: '用户管理 JWT 秘钥 N8N_USER_MANAGEMENT_JWT_SECRET',
                  },
                ]
              ).map((item) => {
                const value = secretEnv[item.key]
                const visible = visibleSecretKey === item.key
                const masked = value ? '•'.repeat(value.length) : ''
                return (
                  <div key={item.key} className="space-y-1">
                    <div className="text-[11px] text-slate-500 dark:text-slate-300">
                      {item.label}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-1.5 font-mono text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                        {value
                          ? visible
                            ? value
                            : masked
                          : '尚未生成（启动 n8n 后将自动生成）'}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => handleCopySecret(item.key)}
                      >
                        复制
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setVisibleSecretKey(visible ? null : item.key)}
                      >
                        {visible ? '隐藏' : '显示'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </Field>
          <Field
            label="数据备份与恢复"
            description="备份当前 n8n 模块的数据库数据，或从备份文件中恢复（请在操作前确认已了解风险）。"
          >
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={backupLoading}
                onClick={handleBackupData}
              >
                {backupLoading ? '备份中…' : '备份数据'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={restoreLoading}
                onClick={handleRestoreData}
              >
                {restoreLoading ? '恢复中…' : '恢复备份'}
              </Button>
            </div>
          </Field>

          <div className="flex gap-2 pt-2">
            <Button shine disabled={saving || applyingRestart} onClick={onSave}>
              保存 n8n 设置
            </Button>
            {canRestart && (
              <Button
                variant="outline"
                disabled={saving || applyingRestart}
                onClick={handleApplyAndRestart}
              >
                {applyingRestart ? '应用中…' : '应用并重启'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // Dify 配置
  if (moduleKey === 'dify') {
    const envMap = moduleSettings.env || {}

    const reservedEnvKeys = [
      'DB_DATABASE_URL',
      'DB_USERNAME',
      'DB_PASSWORD',
      'DB_HOST',
      'DB_PORT',
      'DB_DATABASE',
      'REDIS_HOST',
      'REDIS_PORT',
      'REDIS_PASSWORD',
    ] as const

    const otherEnvEntries = Object.entries(envMap).filter(
      ([key]) => !reservedEnvKeys.includes(key as (typeof reservedEnvKeys)[number]),
    )
    const otherEnvText = otherEnvEntries
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    const port = moduleSettings.port || 0
    const consoleUrl = port > 0 ? `http://localhost:${port}` : ''

    const setEnv = (nextEnv: Record<string, string>) => {
      updateModule({ env: nextEnv })
    }

    const handleEnvTextChange = (value: string) => {
      const lines = value.split('\n')
      const parsed: Record<string, string> = {}
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        const index = line.indexOf('=')
        if (index <= 0) continue
        const key = line.slice(0, index).trim()
        const val = line.slice(index + 1)
        if (!key) continue
        if (reservedEnvKeys.includes(key as (typeof reservedEnvKeys)[number])) continue
        parsed[key] = val
      }

      const current = moduleSettings.env || {}
      const reservedSet = new Set(reservedEnvKeys)
      const nextEnv: Record<string, string> = {}

      for (const [key, val] of Object.entries(current)) {
        if (reservedSet.has(key as (typeof reservedEnvKeys)[number])) {
          nextEnv[key] = val as string
        }
      }

      for (const [key, val] of Object.entries(parsed)) {
        if (!reservedSet.has(key as (typeof reservedEnvKeys)[number])) {
          nextEnv[key] = val
        }
      }

      setEnv(nextEnv)
    }

    const handleEnabledChange = async (checked: boolean) => {
      if (!checked) {
        try {
          const modules = await window.api.listModules()
          const target = modules.find((m) => m.id === 'dify')
          if (target && (target.status === 'running' || target.status === 'starting')) {
            toast.warning('Dify 模块正在运行，无法禁用。请先在首页停止服务后再尝试禁用。')
            updateModule({ enabled: true })
            return
          }
        } catch {
          toast.error('检查 Dify 运行状态失败，暂时无法禁用。')
          updateModule({ enabled: true })
          return
        }
      }

      updateModule({ enabled: checked })
    }

    const handlePortChange = (value: string) => {
      const num = Number(value)
      const portValue = Number.isFinite(num) && num > 0 ? num : 0
      updateModule({ port: portValue })
    }

    const handleApplyAndRestart = async () => {
      if (saving) return

      setApplyingRestart(true)
      try {
        await Promise.resolve(onSave() as any)

        const result = await window.api.restartDify()
        if (!result || !result.success) {
          toast.error(result?.error ?? '应用并重启 Dify 失败，请稍后重试。')
        } else {
          toast.success('Dify 设置已应用并重启。')
        }
      } catch {
        toast.error('应用并重启 Dify 失败，请稍后重试。')
      } finally {
        setApplyingRestart(false)
      }
    }

    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{titleMap[moduleKey]}</CardTitle>
          <CardDescription>配置 Dify 的端口、环境变量等参数（数据库与 Redis 复用现有实例）。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          <Field label="启用 Dify 模块" description="关闭后将不在控制台中展示和管理 Dify 模块。">
            <Switch checked={moduleSettings.enabled} onCheckedChange={handleEnabledChange} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="服务端口" description="Dify Web 映射到本机的端口号。">
              <Input
                placeholder="80"
                className="font-mono text-xs"
                value={moduleSettings.port ? String(moduleSettings.port) : ''}
                onChange={(e) => handlePortChange(e.target.value)}
              />
            </Field>
            <Field label="Dify 控制台 URL" description="基于 localhost 与端口推导，仅作为访问参考。">
              <div className="text-xs font-mono text-slate-700 dark:text-slate-200 break-all">
                {consoleUrl || '请先配置服务端口'}
              </div>
            </Field>
          </div>

          <Field label="环境变量" description="一行一个，支持 KEY=VALUE 格式（不含数据库与 Redis 连接字段）。">
            <textarea
              rows={4}
              className="w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-mono text-slate-900 shadow-sm outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
              placeholder="FILES_URL=http://localhost:5001\nVECTOR_STORE=weaviate"
              value={otherEnvText}
              onChange={(e) => handleEnvTextChange(e.target.value)}
            />
          </Field>

          <div className="flex gap-2 pt-2">
            <Button shine disabled={saving || applyingRestart} onClick={onSave}>
              保存 Dify 设置
            </Button>
            {canRestart && (
              <Button
                variant="outline"
                disabled={saving || applyingRestart}
                onClick={handleApplyAndRestart}
              >
                {applyingRestart ? '应用中…' : '应用并重启'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // OneAPI 配置
  if (moduleKey === 'oneapi') {
    const envMap = moduleSettings.env || {}
    const secretEnv = {
      SESSION_SECRET: envMap.SESSION_SECRET || '',
    }

    const secretEnvKeys = ['SESSION_SECRET'] as const
    const reservedEnvKeys = ['DEBUG', 'DEBUG_SQL', 'SQL_DSN', 'REDIS_CONN_STRING', ...secretEnvKeys]

    const debugEnabled = String(envMap.DEBUG || '').toLowerCase() === 'true'
    const debugSqlEnabled = String(envMap.DEBUG_SQL || '').toLowerCase() === 'true'

    const hasExternalDbEnv = Boolean(envMap.SQL_DSN || envMap.REDIS_CONN_STRING)
    const dbMode: 'managed' | 'external' = hasExternalDbEnv ? 'external' : 'managed'

    const port = moduleSettings.port || 0
    const apiUrl = port > 0 ? `http://localhost:${port}/v1` : ''

    const setEnv = (nextEnv: Record<string, string>) => {
      updateModule({ env: nextEnv })
    }

    const handleEnvTextChange = (value: string) => {
      const lines = value.split('\n')
      const parsed: Record<string, string> = {}
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        const index = line.indexOf('=')
        if (index <= 0) continue
        const key = line.slice(0, index).trim()
        const val = line.slice(index + 1)
        if (!key) continue
        if (reservedEnvKeys.includes(key as (typeof reservedEnvKeys)[number])) continue
        parsed[key] = val
      }

      const current = moduleSettings.env || {}
      const reservedSet = new Set(reservedEnvKeys)
      const nextEnv: Record<string, string> = {}

      for (const [key, val] of Object.entries(current)) {
        if (reservedSet.has(key as (typeof reservedEnvKeys)[number])) {
          nextEnv[key] = val as string
        }
      }

      for (const [key, val] of Object.entries(parsed)) {
        if (!reservedSet.has(key as (typeof reservedEnvKeys)[number])) {
          nextEnv[key] = val
        }
      }

      setEnv(nextEnv)
    }

    const handleDebugToggle = (key: 'DEBUG' | 'DEBUG_SQL', checked: boolean) => {
      const current = moduleSettings.env || {}
      const nextEnv: Record<string, string> = {
        ...current,
        [key]: checked ? 'true' : 'false',
      }
      setEnv(nextEnv)
    }

    const handleDbModeChange = (value: string) => {
      const current = moduleSettings.env || {}
      const nextEnv: Record<string, string> = { ...current }

      if (value === 'managed') {
        delete nextEnv.SQL_DSN
        delete nextEnv.REDIS_CONN_STRING
      } else {
        if (!nextEnv.SQL_DSN) {
          nextEnv.SQL_DSN = 'root:123456@tcp(localhost:3306)/oneapi'
        }
        if (!nextEnv.REDIS_CONN_STRING) {
          nextEnv.REDIS_CONN_STRING = 'redis://localhost:6379'
        }
      }

      setEnv(nextEnv)
    }

    const handleExternalDbFieldChange = (field: 'sqlDsn' | 'redis', value: string) => {
      const current = moduleSettings.env || {}
      const nextEnv: Record<string, string> = {
        ...current,
      }
      if (field === 'sqlDsn') nextEnv.SQL_DSN = value
      if (field === 'redis') nextEnv.REDIS_CONN_STRING = value
      setEnv(nextEnv)
    }

    const handleEnabledChange = async (checked: boolean) => {
      if (!checked) {
        try {
          const modules = await window.api.listModules()
          const target = modules.find((m) => m.id === 'oneapi')
          if (target && (target.status === 'running' || target.status === 'starting')) {
            toast.warning('OneAPI 模块正在运行，无法禁用。请先在首页停止服务后再尝试禁用。')
            updateModule({ enabled: true })
            return
          }
        } catch {
          toast.error('检查 OneAPI 运行状态失败，暂时无法禁用。')
          updateModule({ enabled: true })
          return
        }
      }

      updateModule({ enabled: checked })
    }

    const handlePortChange = (value: string) => {
      const num = Number(value)
      const portValue = Number.isFinite(num) && num > 0 ? num : 0
      updateModule({ port: portValue })
    }

    const otherEnvEntries = Object.entries(envMap).filter(
      ([key]) => !reservedEnvKeys.includes(key as (typeof reservedEnvKeys)[number]),
    )
    const otherEnvText = otherEnvEntries
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    const handleCopySecret = async (key: keyof typeof secretEnv) => {
      const value = secretEnv[key]
      if (!value) {
        toast.error('秘钥尚未生成，请先启动 OneAPI。')
        return
      }

      try {
        await navigator.clipboard.writeText(value)
        toast.success(`${String(key)} 已复制到剪贴板。`)
      } catch {
        toast.error('复制失败，请手动复制。')
      }
    }

    const handleApplyAndRestart = async () => {
      if (saving) return

      setApplyingRestart(true)
      try {
        await Promise.resolve(onSave() as any)

        const result = await window.api.restartOneApi()
        if (!result || !result.success) {
          toast.error(result?.error ?? '应用并重启 OneAPI 失败，请稍后重试。')
        } else {
          toast.success('OneAPI 设置已应用并重启。')
        }
      } catch {
        toast.error('应用并重启 OneAPI 失败，请稍后重试。')
      } finally {
        setApplyingRestart(false)
      }
    }

    const handleBackupData = async () => {
      if (backupLoading) return
      setBackupLoading(true)
      try {
        const result = await window.api.backupModuleData('oneapi')
        if (!result || (result as any).cancelled) {
          window.alert('已取消备份 OneAPI 数据。')
          return
        }
        if (!result.success) {
          window.alert(result.error ?? '备份 OneAPI 数据失败，请稍后重试。')
          return
        }
        if (result.path) {
          window.alert(`OneAPI 数据已备份到：${result.path}`)
        } else {
          window.alert('OneAPI 数据备份完成。')
        }
      } catch {
        window.alert('备份 OneAPI 数据失败，请稍后重试。')
      } finally {
        setBackupLoading(false)
      }
    }

    const handleRestoreData = async () => {
      if (restoreLoading) return
      const confirmed = window.confirm(
        '此操作会使用所选备份覆盖当前 OneAPI 数据库中的所有数据，可能导致现有数据不可恢复。确定要继续吗？',
      )
      if (!confirmed) return

      setRestoreLoading(true)
      try {
        const result = await window.api.restoreModuleData('oneapi')
        if (!result || (result as any).cancelled) {
          window.alert('已取消恢复 OneAPI 数据。')
          return
        }
        if (!result.success) {
          window.alert(result.error ?? '恢复 OneAPI 数据失败，请稍后重试。')
          return
        }
        window.alert('OneAPI 数据恢复完成。')
      } catch {
        window.alert('恢复 OneAPI 数据失败，请稍后重试。')
      } finally {
        setRestoreLoading(false)
      }
    }

    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{titleMap[moduleKey]}</CardTitle>
          <CardDescription>配置 OneAPI 的端口、日志和数据库等参数。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          <Field label="启用 OneAPI 模块" description="关闭后将不在控制台中展示和管理 OneAPI 模块。">
            <Switch checked={moduleSettings.enabled} onCheckedChange={handleEnabledChange} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="服务端口" description="OneAPI 容器映射到本机的端口号。">
              <Input
                placeholder="3000"
                className="font-mono text-xs"
                value={moduleSettings.port ? String(moduleSettings.port) : ''}
                onChange={(e) => handlePortChange(e.target.value)}
              />
            </Field>
            <Field label="OneAPI API 地址" description="基于 localhost 与端口推导，仅作为访问参考。">
              <div className="text-xs font-mono text-slate-700 dark:text-slate-200 break-all">
                {apiUrl || '请先配置服务端口'}
              </div>
            </Field>
          </div>

          <Field label="日志等级" description="控制是否启用 OneAPI 的调试日志（DEBUG / DEBUG_SQL）">
            <div className="flex flex-col gap-2 text-xs text-slate-600 dark:text-slate-200">
              <label className="flex items-center gap-3">
                <Switch
                  checked={debugEnabled}
                  onCheckedChange={(checked) => handleDebugToggle('DEBUG', checked)}
                />
                <span>启用 DEBUG 日志（DEBUG）</span>
              </label>
              <label className="flex items-center gap-3">
                <Switch
                  checked={debugSqlEnabled}
                  onCheckedChange={(checked) => handleDebugToggle('DEBUG_SQL', checked)}
                />
                <span>启用 SQL 调试日志（DEBUG_SQL）</span>
              </label>
            </div>
          </Field>

          <Field
            label="数据库模式（开发中）"
            description="选择使用内置托管 MySQL + Redis 或外部数据库与 Redis。"
          >
            <select
              className="h-9 w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={dbMode}
              onChange={(e) => handleDbModeChange(e.target.value)}
            >
              <option value="managed">内置托管 MySQL + Redis（推荐）</option>
              <option value="external">外部 MySQL / Redis</option>
            </select>
          </Field>

          {dbMode === 'external' && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="外部数据库 SQL_DSN" description="例如 root:123456@tcp(localhost:3306)/oneapi。">
                <Input
                  placeholder="root:123456@tcp(localhost:3306)/oneapi"
                  className="font-mono text-xs"
                  value={envMap.SQL_DSN || ''}
                  onChange={(e) => handleExternalDbFieldChange('sqlDsn', e.target.value)}
                />
              </Field>
              <Field label="外部 Redis 连接串" description="例如 redis://localhost:6379。">
                <Input
                  placeholder="redis://localhost:6379"
                  className="font-mono text-xs"
                  value={envMap.REDIS_CONN_STRING || ''}
                  onChange={(e) => handleExternalDbFieldChange('redis', e.target.value)}
                />
              </Field>
            </div>
          )}

          <Field label="环境变量" description="一行一个，支持 KEY=VALUE 格式（不含上方已经配置的字段）。">
            <textarea
              rows={4}
              className="w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-mono text-slate-900 shadow-sm outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
              placeholder="OPENAI_API_KEY=sk-...&#10;HTTP_PROXY=http://127.0.0.1:7890"
              value={otherEnvText}
              onChange={(e) => handleEnvTextChange(e.target.value)}
            />
          </Field>

          <Field label="安全秘钥" description="首次启动 OneAPI 时自动生成，用于会话加密等，暂不支持在此修改。">
            <div className="space-y-3 text-xs">
              {(
                [
                  {
                    key: 'SESSION_SECRET' as const,
                    label: '会话秘钥 SESSION_SECRET',
                  },
                ]
              ).map((item) => {
                const value = secretEnv[item.key]
                const visible = visibleSecretKey === item.key
                const masked = value ? '•'.repeat(value.length) : ''
                return (
                  <div key={item.key} className="space-y-1">
                    <div className="text-[11px] text-slate-500 dark:text-slate-300">
                      {item.label}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-1.5 font-mono text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                        {value
                          ? visible
                            ? value
                            : masked
                          : '尚未生成（启动 OneAPI 后将自动生成）'}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => handleCopySecret(item.key)}
                      >
                        复制
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setVisibleSecretKey(visible ? null : item.key)}
                      >
                        {visible ? '隐藏' : '显示'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </Field>
          <Field
            label="数据备份与恢复"
            description="备份当前 OneAPI 模块的数据库数据，或从备份文件中恢复（请在操作前确认已了解风险）。"
          >
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={backupLoading}
                onClick={handleBackupData}
              >
                {backupLoading ? '备份中…' : '备份数据'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={restoreLoading}
                onClick={handleRestoreData}
              >
                {restoreLoading ? '恢复中…' : '恢复备份'}
              </Button>
            </div>
          </Field>

          <div className="flex gap-2 pt-2">
            <Button shine disabled={saving || applyingRestart} onClick={onSave}>
              保存 OneAPI 设置
            </Button>
            {canRestart && (
              <Button
                variant="outline"
                disabled={saving || applyingRestart}
                onClick={handleApplyAndRestart}
              >
                {applyingRestart ? '应用中…' : '应用并重启'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // RagFlow 配置
  if (moduleKey === 'ragflow') {
    const envMap = moduleSettings.env || {}

    const debugEnabled = String(envMap.DEBUG || '').toLowerCase() === 'true'

    const reservedEnvKeys = [
      'MYSQL_DBNAME',
      'MYSQL_USER',
      'MYSQL_PASSWORD',
      'MYSQL_HOST',
      'MYSQL_PORT',
      'MINIO_USER',
      'MINIO_PASSWORD',
      'MINIO_HOST',
      'REDIS_HOST',
      'REDIS_PORT',
      'REDIS_PASSWORD',
      'LOG_LEVELS',
      'DEBUG',
    ] as const

    const otherEnvEntries = Object.entries(envMap).filter(
      ([key]) => !reservedEnvKeys.includes(key as (typeof reservedEnvKeys)[number]),
    )
    const otherEnvText = otherEnvEntries
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    const setEnv = (nextEnv: Record<string, string>) => {
      updateModule({ env: nextEnv })
    }

    const handleEnvTextChange = (value: string) => {
      const lines = value.split('\n')
      const parsed: Record<string, string> = {}
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        const index = line.indexOf('=')
        if (index <= 0) continue
        const key = line.slice(0, index).trim()
        const val = line.slice(index + 1)
        if (!key) continue
        if (reservedEnvKeys.includes(key as (typeof reservedEnvKeys)[number])) continue
        parsed[key] = val
      }

      const current = moduleSettings.env || {}
      const reservedSet = new Set(reservedEnvKeys)
      const nextEnv: Record<string, string> = {}

      for (const [key, val] of Object.entries(current)) {
        if (reservedSet.has(key as (typeof reservedEnvKeys)[number])) {
          nextEnv[key] = val as string
        }
      }

      for (const [key, val] of Object.entries(parsed)) {
        if (!reservedSet.has(key as (typeof reservedEnvKeys)[number])) {
          nextEnv[key] = val
        }
      }

      setEnv(nextEnv)
    }

    const handleEnabledChange = async (checked: boolean) => {
      if (!checked) {
        try {
          const modules = await window.api.listModules()
          const target = modules.find((m) => m.id === 'ragflow')
          if (target && (target.status === 'running' || target.status === 'starting')) {
            toast.warning('RagFlow 模块正在运行，无法禁用。请先在首页停止服务后再尝试禁用。')
            updateModule({ enabled: true })
            return
          }
        } catch {
          toast.error('检查 RagFlow 运行状态失败，暂时无法禁用。')
          updateModule({ enabled: true })
          return
        }
      }

      updateModule({ enabled: checked })
    }

    const handlePortChange = (value: string) => {
      const num = Number(value)
      const portValue = Number.isFinite(num) && num > 0 ? num : 0
      updateModule({ port: portValue })
    }

    const handleDebugToggle = (checked: boolean) => {
      const current = moduleSettings.env || {}
      const nextEnv: Record<string, string> = {
        ...current,
        DEBUG: checked ? 'true' : 'false',
      }
      setEnv(nextEnv)
    }

    const handleSaveAndRestart = async () => {
      if (saving) return

      setApplyingRestart(true)
      try {
        await Promise.resolve(onSave() as any)

        const result = await window.api.restartRagflow()
        if (!result || !result.success) {
          toast.error(result?.error ?? '应用并重启 RagFlow 失败，请稍后重试。')
        } else {
          toast.success('RagFlow 设置已应用并重启。')
        }
      } catch {
        toast.error('应用并重启 RagFlow 失败，请稍后重试。')
      } finally {
        setApplyingRestart(false)
      }
    }

    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{titleMap[moduleKey]}</CardTitle>
          <CardDescription>配置 RagFlow 的端口、数据库/存储与环境变量等参数。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          <Field label="启用 RagFlow 模块" description="关闭后将不在控制台中展示和管理 RagFlow 模块。">
            <Switch checked={moduleSettings.enabled} onCheckedChange={handleEnabledChange} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="服务端口" description="RagFlow HTTP 服务映射到本机的端口号（容器内为 80，经 nginx 反向代理到 9380）。">
              <Input
                placeholder="9380"
                className="font-mono text-xs"
                value={moduleSettings.port ? String(moduleSettings.port) : ''}
                onChange={(e) => handlePortChange(e.target.value)}
              />
            </Field>
            <Field label="RagFlow 控制台 URL" description="基于 localhost 与端口推导，仅作为访问参考。">
              <div className="text-xs font-mono text-slate-700 dark:text-slate-200 break-all">
                {moduleSettings.port ? `http://localhost:${moduleSettings.port}` : '请先配置服务端口'}
              </div>
            </Field>
          </div>

          <Field
            label="模型缓存目录（可选）"
            description="留空则使用容器内部默认缓存路径。如果填写，将把该目录挂载到容器 /root/.ragflow，用于存放 HuggingFace 等模型缓存。"
          >
            <Input
              placeholder="C:\\ragflow-cache\\.ragflow"
              className="font-mono text-xs"
              value={moduleSettings.modelCacheDir || ''}
              onChange={(e) => updateModule({ modelCacheDir: e.target.value })}
            />
          </Field>

          <Field
            label="数据库 / Redis / MinIO 连接（高级）"
            description="当前默认复用内置 MySQL / Redis / MinIO，通常无需修改。若需自定义，可在下方环境变量中覆盖相关连接设置。"
          >
            <div className="text-[11px] text-slate-500 dark:text-slate-300 space-y-1">
              <div>MySQL 相关：MYSQL_DBNAME / MYSQL_USER / MYSQL_PASSWORD / MYSQL_HOST / MYSQL_PORT</div>
              <div>Redis 相关：REDIS_HOST / REDIS_PORT / REDIS_PASSWORD</div>
              <div>MinIO 相关：MINIO_USER / MINIO_PASSWORD / MINIO_HOST</div>
            </div>
          </Field>

          <Field
            label="日志与调试"
            description="可通过 LOG_LEVELS 与 DEBUG 控制 RagFlow 内部日志行为。"
          >
            <div className="flex flex-col gap-2 text-xs text-slate-600 dark:text-slate-200">
              <label className="flex items-center gap-3">
                <Switch checked={debugEnabled} onCheckedChange={handleDebugToggle} />
                <span>启用调试模式（DEBUG=true）</span>
              </label>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                进阶：可在下方环境变量中配置 LOG_LEVELS（例如 root=INFO,peewee=WARNING）。
              </div>
            </div>
          </Field>

          <Field label="环境变量" description="一行一个，支持 KEY=VALUE 格式（不含上方已经列出的保留字段）。">
            <textarea
              rows={4}
              className="w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-mono text-slate-900 shadow-sm outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
              placeholder="RAGFLOW_EXTRA_OPTION=value&#10;HF_ENDPOINT=http://your-hf-mirror.example.com"
              value={otherEnvText}
              onChange={(e) => handleEnvTextChange(e.target.value)}
            />
          </Field>

          <div className="flex gap-2 pt-2">
            <Button shine disabled={saving || applyingRestart} onClick={onSave}>
              保存 RagFlow 设置
            </Button>
            {canRestart && (
              <Button
                variant="outline"
                disabled={saving || applyingRestart}
                onClick={handleSaveAndRestart}
              >
                {applyingRestart ? '应用中…' : '应用并重启'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // 通用模块配置（预留给未来其它模块）
  const genericEnvText = Object.entries(moduleSettings.env || {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const handleGenericEnvChange = (value: string) => {
    const lines = value.split('\n')
    const parsed: Record<string, string> = {}
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      const index = line.indexOf('=')
      if (index <= 0) continue
      const key = line.slice(0, index).trim()
      const val = line.slice(index + 1)
      if (!key) continue
      parsed[key] = val
    }
    updateModule({ env: parsed })
  }

  const handleGenericEnabledChange = (checked: boolean) => {
    updateModule({ enabled: checked })
  }

  const handleGenericPortChange = (value: string) => {
    const num = Number(value)
    const portValue = Number.isFinite(num) && num > 0 ? num : 0
    updateModule({ port: portValue })
  }

  const handleGenericDatabaseUrlChange = (value: string) => {
    updateModule({ databaseUrl: value })
  }

  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle>{titleMap[moduleKey]}</CardTitle>
        <CardDescription>配置模块的端口、数据库和环境变量等。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        <Field label="启用模块" description="关闭后将不在控制台中展示和管理该模块。">
          <Switch checked={moduleSettings.enabled} onCheckedChange={handleGenericEnabledChange} />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="服务端口" description="容器映射到本机的端口号。">
            <Input
              placeholder={moduleKey === 'ragflow' ? '9500' : '8080'}
              className="font-mono text-xs"
              value={moduleSettings.port ? String(moduleSettings.port) : ''}
              onChange={(e) => handleGenericPortChange(e.target.value)}
            />
          </Field>
          <Field label="数据库 URL" description="可选，留空则使用模块内置存储或默认配置。">
            <Input
              placeholder="postgres://user:pass@localhost:5432/dbname"
              className="font-mono text-xs"
              value={moduleSettings.databaseUrl || ''}
              onChange={(e) => handleGenericDatabaseUrlChange(e.target.value)}
            />
          </Field>
        </div>

        <Field label="环境变量" description="一行一个，支持 KEY=VALUE 格式。">
          <textarea
            rows={4}
            className="w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-mono text-slate-900 shadow-sm outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
            placeholder="OPENAI_API_KEY=sk-...&#10;HTTP_PROXY=http://127.0.0.1:7890"
            value={genericEnvText}
            onChange={(e) => handleGenericEnvChange(e.target.value)}
          />
        </Field>

        <div className="flex gap-2 pt-2">
          <Button shine disabled={saving} onClick={onSave}>
            保存模块设置
          </Button>
          {canRestart && (
            <Button variant="outline" disabled>
              应用并重启
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
