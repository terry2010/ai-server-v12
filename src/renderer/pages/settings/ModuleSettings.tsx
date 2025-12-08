import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { AppSettings, ModuleStatus } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Field } from './Field'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('settings')

  const titleMap: Record<ModuleSettingsProps['moduleKey'], string> = {
    n8n: 'modules.n8n.title',
    dify: 'modules.dify.title',
    oneapi: 'modules.oneapi.title',
    ragflow: 'modules.ragflow.title',
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
          <CardTitle>{t(titleMap[moduleKey])}</CardTitle>
          <CardDescription>{t(`modules.${moduleKey}.loadingDesc`)}</CardDescription>
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
            toast.warning(t('modules.n8n.toastDisableRunningWarn'))
            updateModule({ enabled: true })
            return
          }
        } catch {
          toast.error(t('modules.n8n.toastDisableStatusError'))
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
        toast.error(t('modules.n8n.toastSecretNotGenerated'))
        return
      }

      try {
        await navigator.clipboard.writeText(value)
        toast.success(
          t('modules.n8n.toastCopySuccess', {
            key: String(key),
          }),
        )
      } catch {
        toast.error(t('modules.n8n.toastCopyFail'))
      }
    }

    const handleApplyAndRestart = async () => {
      if (saving) return

      setApplyingRestart(true)
      try {
        await Promise.resolve(onSave() as any)

        const result = await window.api.restartN8n()
        if (!result || !result.success) {
          toast.error(result?.error ?? t('modules.n8n.toastApplyRestartFail'))
        } else {
          toast.success(t('modules.n8n.toastApplyRestartSuccess'))
        }
      } catch {
        toast.error(t('modules.n8n.toastApplyRestartFail'))
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
          window.alert(t('modules.n8n.backupCancelled'))
          return
        }
        if (!result.success) {
          window.alert(result.error ?? t('modules.n8n.backupFailed'))
          return
        }
        if (result.path) {
          window.alert(
            t('modules.n8n.backupCompletedWithPath', {
              path: result.path,
            }),
          )
        } else {
          window.alert(t('modules.n8n.backupCompleted'))
        }
      } catch {
        window.alert(t('modules.n8n.backupFailed'))
      } finally {
        setBackupLoading(false)
      }
    }

    const handleRestoreData = async () => {
      if (restoreLoading) return
      const confirmed = window.confirm(
        t('modules.n8n.restoreConfirm'),
      )
      if (!confirmed) return

      setRestoreLoading(true)
      try {
        const result = await window.api.restoreModuleData('n8n')
        if (!result || (result as any).cancelled) {
          window.alert(t('modules.n8n.restoreCancelled'))
          return
        }
        if (!result.success) {
          window.alert(result.error ?? t('modules.n8n.restoreFailed'))
          return
        }
        window.alert(t('modules.n8n.restoreCompleted'))
      } catch {
        window.alert(t('modules.n8n.restoreFailed'))
      } finally {
        setRestoreLoading(false)
      }
    }

    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{t('modules.n8n.title')}</CardTitle>
          <CardDescription>{t('modules.n8n.cardDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          <Field
            label={t('modules.n8n.fields.enabledLabel')}
            description={t('modules.n8n.fields.enabledDesc')}
          >
            <Switch checked={moduleSettings.enabled} onCheckedChange={handleEnabledChange} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={t('modules.n8n.fields.portLabel')}
              description={t('modules.n8n.fields.portDesc')}
            >
              <Input
                placeholder={t('modules.n8n.fields.portPlaceholder')}
                className="font-mono text-xs"
                value={moduleSettings.port ? String(moduleSettings.port) : ''}
                onChange={(e) => handlePortChange(e.target.value)}
              />
            </Field>
            <Field
              label={t('modules.n8n.fields.consoleLabel')}
              description={t('modules.n8n.fields.consoleDesc')}
            >
              <div className="text-xs font-mono text-slate-700 dark:text-slate-200 break-all">
                {consoleUrl || t('modules.n8n.fields.consoleEmpty')}
              </div>
            </Field>
          </div>

          <Field
            label={t('modules.n8n.fields.webhookLabel')}
            description={t('modules.n8n.fields.webhookDesc')}
          >
            <div className="text-xs font-mono text-slate-700 dark:text-slate-200 break-all">
              {webhookUrl || t('modules.n8n.fields.webhookEmpty')}
            </div>
          </Field>

          <Field
            label={t('modules.n8n.fields.logLevelLabel')}
            description={t('modules.n8n.fields.logLevelDesc')}
          >
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

          <Field
            label={t('modules.n8n.fields.dbModeLabel')}
            description={t('modules.n8n.fields.dbModeDesc')}
          >
            <select
              className="h-9 w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={dbMode}
              onChange={(e) => handleDbModeChange(e.target.value)}
            >
              <option value="managed">{t('modules.n8n.fields.dbModeManaged')}</option>
              <option value="external">{t('modules.n8n.fields.dbModeExternal')}</option>
            </select>
          </Field>

          {dbMode === 'external' && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label={t('modules.n8n.fields.extHostLabel')}
                description={t('modules.n8n.fields.extHostDesc')}
              >
                <Input
                  placeholder={t('modules.n8n.fields.extHostPlaceholder')}
                  className="font-mono text-xs"
                  value={dbHost}
                  onChange={(e) => handleExternalDbFieldChange('host', e.target.value)}
                />
              </Field>
              <Field
                label={t('modules.n8n.fields.extPortLabel')}
                description={t('modules.n8n.fields.extPortDesc')}
              >
                <Input
                  placeholder={t('modules.n8n.fields.extPortPlaceholder')}
                  className="font-mono text-xs"
                  value={dbPort}
                  onChange={(e) => handleExternalDbFieldChange('port', e.target.value)}
                />
              </Field>
              <Field
                label={t('modules.n8n.fields.extDbNameLabel')}
                description={t('modules.n8n.fields.extDbNameDesc')}
              >
                <Input
                  placeholder={t('modules.n8n.fields.extDbNamePlaceholder')}
                  className="font-mono text-xs"
                  value={dbName}
                  onChange={(e) => handleExternalDbFieldChange('database', e.target.value)}
                />
              </Field>
              <Field
                label={t('modules.n8n.fields.extUserLabel')}
                description={t('modules.n8n.fields.extUserDesc')}
              >
                <Input
                  placeholder={t('modules.n8n.fields.extUserPlaceholder')}
                  className="font-mono text-xs"
                  value={dbUser}
                  onChange={(e) => handleExternalDbFieldChange('user', e.target.value)}
                />
              </Field>
              <Field
                label={t('modules.n8n.fields.extPasswordLabel')}
                description={t('modules.n8n.fields.extPasswordDesc')}
              >
                <Input
                  placeholder={t('modules.n8n.fields.extPasswordPlaceholder')}
                  type="password"
                  className="font-mono text-xs"
                  value={dbPassword}
                  onChange={(e) => handleExternalDbFieldChange('password', e.target.value)}
                />
              </Field>
            </div>
          )}

          <Field
            label={t('modules.n8n.fields.envLabel')}
            description={t('modules.n8n.fields.envDesc')}
          >
            <textarea
              rows={4}
              className="w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-mono text-slate-900 shadow-sm outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
              placeholder={t('modules.n8n.fields.envPlaceholder')}
              value={otherEnvText}
              onChange={(e) => handleEnvTextChange(e.target.value)}
            />
          </Field>

          <Field
            label={t('modules.n8n.fields.secretsLabel')}
            description={t('modules.n8n.fields.secretsDesc')}
          >
            <div className="space-y-3 text-xs">
              {(
                [
                  {
                    key: 'N8N_ENCRYPTION_KEY' as const,
                    label: t('modules.n8n.fields.secretEncryptionLabel'),
                  },
                  {
                    key: 'N8N_JWT_SECRET' as const,
                    label: t('modules.n8n.fields.secretJwtLabel'),
                  },
                  {
                    key: 'N8N_USER_MANAGEMENT_JWT_SECRET' as const,
                    label: t('modules.n8n.fields.secretUserJwtLabel'),
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
                          : t('modules.n8n.fields.secretNotGenerated')}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => handleCopySecret(item.key)}
                      >
                        {t('modules.n8n.fields.copyButton')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setVisibleSecretKey(visible ? null : item.key)}
                      >
                        {visible
                          ? t('modules.n8n.fields.hideButton')
                          : t('modules.n8n.fields.showButton')}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </Field>
          <Field
            label={t('modules.n8n.fields.backupLabel')}
            description={t('modules.n8n.fields.backupDesc')}
          >
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={backupLoading}
                onClick={handleBackupData}
              >
                {backupLoading
                  ? t('modules.n8n.fields.backupLoading')
                  : t('modules.n8n.fields.backupButton')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={restoreLoading}
                onClick={handleRestoreData}
              >
                {restoreLoading
                  ? t('modules.n8n.fields.restoreLoading')
                  : t('modules.n8n.fields.restoreButton')}
              </Button>
            </div>
          </Field>

          <div className="flex gap-2 pt-2">
            <Button shine disabled={saving || applyingRestart} onClick={onSave}>
              {t('modules.n8n.fields.saveButton')}
            </Button>
            {canRestart && (
              <Button
                variant="outline"
                disabled={saving || applyingRestart}
                onClick={handleApplyAndRestart}
              >
                {applyingRestart
                  ? t('modules.n8n.fields.applying')
                  : t('modules.n8n.fields.applyRestartButton')}
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
            toast.warning(t('modules.dify.toastDisableRunningWarn'))
            updateModule({ enabled: true })
            return
          }
        } catch {
          toast.error(t('modules.dify.toastDisableStatusError'))
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
          toast.error(result?.error ?? t('modules.dify.toastApplyRestartFail'))
        } else {
          toast.success(t('modules.dify.toastApplyRestartSuccess'))
        }
      } catch {
        toast.error(t('modules.dify.toastApplyRestartFail'))
      } finally {
        setApplyingRestart(false)
      }
    }

    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{t('modules.dify.title')}</CardTitle>
          <CardDescription>{t('modules.dify.cardDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          <Field
            label={t('modules.dify.fields.enabledLabel')}
            description={t('modules.dify.fields.enabledDesc')}
          >
            <Switch checked={moduleSettings.enabled} onCheckedChange={handleEnabledChange} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={t('modules.dify.fields.portLabel')}
              description={t('modules.dify.fields.portDesc')}
            >
              <Input
                placeholder={t('modules.dify.fields.portPlaceholder')}
                className="font-mono text-xs"
                value={moduleSettings.port ? String(moduleSettings.port) : ''}
                onChange={(e) => handlePortChange(e.target.value)}
              />
            </Field>
            <Field
              label={t('modules.dify.fields.consoleLabel')}
              description={t('modules.dify.fields.consoleDesc')}
            >
              <div className="text-xs font-mono text-slate-700 dark:text-slate-200 break-all">
                {consoleUrl || t('modules.dify.fields.consoleEmpty')}
              </div>
            </Field>
          </div>

          <Field
            label={t('modules.dify.fields.envLabel')}
            description={t('modules.dify.fields.envDesc')}
          >
            <textarea
              rows={4}
              className="w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-mono text-slate-900 shadow-sm outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
              placeholder={t('modules.dify.fields.envPlaceholder')}
              value={otherEnvText}
              onChange={(e) => handleEnvTextChange(e.target.value)}
            />
          </Field>

          <div className="flex gap-2 pt-2">
            <Button shine disabled={saving || applyingRestart} onClick={onSave}>
              {t('modules.dify.fields.saveButton')}
            </Button>
            {canRestart && (
              <Button
                variant="outline"
                disabled={saving || applyingRestart}
                onClick={handleApplyAndRestart}
              >
                {applyingRestart
                  ? t('modules.dify.fields.applying')
                  : t('modules.dify.fields.applyRestartButton')}
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
            toast.warning(t('modules.oneapi.toastDisableRunningWarn'))
            updateModule({ enabled: true })
            return
          }
        } catch {
          toast.error(t('modules.oneapi.toastDisableStatusError'))
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
        toast.error(t('modules.oneapi.toastSecretNotGenerated'))
        return
      }

      try {
        await navigator.clipboard.writeText(value)
        toast.success(
          t('modules.oneapi.toastCopySuccess', {
            key: String(key),
          }),
        )
      } catch {
        toast.error(t('modules.oneapi.toastCopyFail'))
      }
    }

    const handleApplyAndRestart = async () => {
      if (saving) return

      setApplyingRestart(true)
      try {
        await Promise.resolve(onSave() as any)

        const result = await window.api.restartOneApi()
        if (!result || !result.success) {
          toast.error(result?.error ?? t('modules.oneapi.toastApplyRestartFail'))
        } else {
          toast.success(t('modules.oneapi.toastApplyRestartSuccess'))
        }
      } catch {
        toast.error(t('modules.oneapi.toastApplyRestartFail'))
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
          window.alert(t('modules.oneapi.backupCancelled'))
          return
        }
        if (!result.success) {
          window.alert(result.error ?? t('modules.oneapi.backupFailed'))
          return
        }
        if (result.path) {
          window.alert(
            t('modules.oneapi.backupCompletedWithPath', {
              path: result.path,
            }),
          )
        } else {
          window.alert(t('modules.oneapi.backupCompleted'))
        }
      } catch {
        window.alert(t('modules.oneapi.backupFailed'))
      } finally {
        setBackupLoading(false)
      }
    }

    const handleRestoreData = async () => {
      if (restoreLoading) return
      const confirmed = window.confirm(
        t('modules.oneapi.restoreConfirm'),
      )
      if (!confirmed) return

      setRestoreLoading(true)
      try {
        const result = await window.api.restoreModuleData('oneapi')
        if (!result || (result as any).cancelled) {
          window.alert(t('modules.oneapi.restoreCancelled'))
          return
        }
        if (!result.success) {
          window.alert(result.error ?? t('modules.oneapi.restoreFailed'))
          return
        }
        window.alert(t('modules.oneapi.restoreCompleted'))
      } catch {
        window.alert(t('modules.oneapi.restoreFailed'))
      } finally {
        setRestoreLoading(false)
      }
    }

    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{t('modules.oneapi.title')}</CardTitle>
          <CardDescription>{t('modules.oneapi.cardDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          <Field
            label={t('modules.oneapi.fields.enabledLabel')}
            description={t('modules.oneapi.fields.enabledDesc')}
          >
            <Switch checked={moduleSettings.enabled} onCheckedChange={handleEnabledChange} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={t('modules.oneapi.fields.portLabel')}
              description={t('modules.oneapi.fields.portDesc')}
            >
              <Input
                placeholder={t('modules.oneapi.fields.portPlaceholder')}
                className="font-mono text-xs"
                value={moduleSettings.port ? String(moduleSettings.port) : ''}
                onChange={(e) => handlePortChange(e.target.value)}
              />
            </Field>
            <Field
              label={t('modules.oneapi.fields.apiLabel')}
              description={t('modules.oneapi.fields.apiDesc')}
            >
              <div className="text-xs font-mono text-slate-700 dark:text-slate-200 break-all">
                {apiUrl || t('modules.oneapi.fields.apiEmpty')}
              </div>
            </Field>
          </div>

          <Field
            label={t('modules.oneapi.fields.logFieldLabel')}
            description={t('modules.oneapi.fields.logFieldDesc')}
          >
            <div className="flex flex-col gap-2 text-xs text-slate-600 dark:text-slate-200">
              <label className="flex items-center gap-3">
                <Switch
                  checked={debugEnabled}
                  onCheckedChange={(checked) => handleDebugToggle('DEBUG', checked)}
                />
                <span>{t('modules.oneapi.fields.logToggleDebug')}</span>
              </label>
              <label className="flex items-center gap-3">
                <Switch
                  checked={debugSqlEnabled}
                  onCheckedChange={(checked) => handleDebugToggle('DEBUG_SQL', checked)}
                />
                <span>{t('modules.oneapi.fields.logToggleSql')}</span>
              </label>
            </div>
          </Field>

          <Field
            label={t('modules.oneapi.fields.dbModeLabel')}
            description={t('modules.oneapi.fields.dbModeDesc')}
          >
            <select
              className="h-9 w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={dbMode}
              onChange={(e) => handleDbModeChange(e.target.value)}
            >
              <option value="managed">{t('modules.oneapi.fields.dbModeManaged')}</option>
              <option value="external">{t('modules.oneapi.fields.dbModeExternal')}</option>
            </select>
          </Field>

          {dbMode === 'external' && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label={t('modules.oneapi.fields.extSqlDsnLabel')}
                description={t('modules.oneapi.fields.extSqlDsnDesc')}
              >
                <Input
                  placeholder={t('modules.oneapi.fields.extSqlDsnPlaceholder')}
                  className="font-mono text-xs"
                  value={envMap.SQL_DSN || ''}
                  onChange={(e) => handleExternalDbFieldChange('sqlDsn', e.target.value)}
                />
              </Field>
              <Field
                label={t('modules.oneapi.fields.extRedisLabel')}
                description={t('modules.oneapi.fields.extRedisDesc')}
              >
                <Input
                  placeholder={t('modules.oneapi.fields.extRedisPlaceholder')}
                  className="font-mono text-xs"
                  value={envMap.REDIS_CONN_STRING || ''}
                  onChange={(e) => handleExternalDbFieldChange('redis', e.target.value)}
                />
              </Field>
            </div>
          )}

          <Field
            label={t('modules.oneapi.fields.envLabel')}
            description={t('modules.oneapi.fields.envDesc')}
          >
            <textarea
              rows={4}
              className="w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-mono text-slate-900 shadow-sm outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
              placeholder={t('modules.oneapi.fields.envPlaceholder')}
              value={otherEnvText}
              onChange={(e) => handleEnvTextChange(e.target.value)}
            />
          </Field>

          <Field
            label={t('modules.oneapi.fields.secretsLabel')}
            description={t('modules.oneapi.fields.secretsDesc')}
          >
            <div className="space-y-3 text-xs">
              {(
                [
                  {
                    key: 'SESSION_SECRET' as const,
                    label: t('modules.oneapi.fields.secretSessionLabel'),
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
                          : t('modules.oneapi.fields.secretNotGenerated')}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => handleCopySecret(item.key)}
                      >
                        {t('modules.oneapi.fields.copyButton')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setVisibleSecretKey(visible ? null : item.key)}
                      >
                        {visible
                          ? t('modules.oneapi.fields.hideButton')
                          : t('modules.oneapi.fields.showButton')}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </Field>
          <Field
            label={t('modules.oneapi.fields.backupLabel')}
            description={t('modules.oneapi.fields.backupDesc')}
          >
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={backupLoading}
                onClick={handleBackupData}
              >
                {backupLoading
                  ? t('modules.oneapi.fields.backupLoading')
                  : t('modules.oneapi.fields.backupButton')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={restoreLoading}
                onClick={handleRestoreData}
              >
                {restoreLoading
                  ? t('modules.oneapi.fields.restoreLoading')
                  : t('modules.oneapi.fields.restoreButton')}
              </Button>
            </div>
          </Field>

          <div className="flex gap-2 pt-2">
            <Button shine disabled={saving || applyingRestart} onClick={onSave}>
              {t('modules.oneapi.fields.saveButton')}
            </Button>
            {canRestart && (
              <Button
                variant="outline"
                disabled={saving || applyingRestart}
                onClick={handleApplyAndRestart}
              >
                {applyingRestart
                  ? t('modules.oneapi.fields.applying')
                  : t('modules.oneapi.fields.applyRestartButton')}
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
            toast.warning(t('modules.ragflow.toastDisableRunningWarn'))
            updateModule({ enabled: true })
            return
          }
        } catch {
          toast.error(t('modules.ragflow.toastDisableStatusError'))
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
          toast.error(result?.error ?? t('modules.ragflow.toastApplyRestartFail'))
        } else {
          toast.success(t('modules.ragflow.toastApplyRestartSuccess'))
        }
      } catch {
        toast.error(t('modules.ragflow.toastApplyRestartFail'))
      } finally {
        setApplyingRestart(false)
      }
    }

    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{t('modules.ragflow.title')}</CardTitle>
          <CardDescription>{t('modules.ragflow.cardDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          <Field
            label={t('modules.ragflow.fields.enabledLabel')}
            description={t('modules.ragflow.fields.enabledDesc')}
          >
            <Switch checked={moduleSettings.enabled} onCheckedChange={handleEnabledChange} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={t('modules.ragflow.fields.portLabel')}
              description={t('modules.ragflow.fields.portDesc')}
            >
              <Input
                placeholder={t('modules.ragflow.fields.portPlaceholder')}
                className="font-mono text-xs"
                value={moduleSettings.port ? String(moduleSettings.port) : ''}
                onChange={(e) => handlePortChange(e.target.value)}
              />
            </Field>
            <Field
              label={t('modules.ragflow.fields.consoleLabel')}
              description={t('modules.ragflow.fields.consoleDesc')}
            >
              <div className="text-xs font-mono text-slate-700 dark:text-slate-200 break-all">
                {moduleSettings.port
                  ? `http://localhost:${moduleSettings.port}`
                  : t('modules.ragflow.fields.consoleEmpty')}
              </div>
            </Field>
          </div>

          <Field
            label={t('modules.ragflow.fields.modelCacheLabel')}
            description={t('modules.ragflow.fields.modelCacheDesc')}
          >
            <Input
              placeholder={t('modules.ragflow.fields.modelCachePlaceholder')}
              className="font-mono text-xs"
              value={moduleSettings.modelCacheDir || ''}
              onChange={(e) => updateModule({ modelCacheDir: e.target.value })}
            />
          </Field>

          <Field
            label={t('modules.ragflow.fields.connectionsLabel')}
            description={t('modules.ragflow.fields.connectionsDesc')}
          >
            <div className="text-[11px] text-slate-500 dark:text-slate-300 space-y-1">
              <div>{t('modules.ragflow.fields.connectionsMysql')}</div>
              <div>{t('modules.ragflow.fields.connectionsRedis')}</div>
              <div>{t('modules.ragflow.fields.connectionsMinio')}</div>
            </div>
          </Field>

          <Field
            label={t('modules.ragflow.fields.logLabel')}
            description={t('modules.ragflow.fields.logDesc')}
          >
            <div className="flex flex-col gap-2 text-xs text-slate-600 dark:text-slate-200">
              <label className="flex items-center gap-3">
                <Switch checked={debugEnabled} onCheckedChange={handleDebugToggle} />
                <span>{t('modules.ragflow.fields.logToggleDebug')}</span>
              </label>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('modules.ragflow.fields.logAdvancedTip')}
              </div>
            </div>
          </Field>

          <Field
            label={t('modules.ragflow.fields.envLabel')}
            description={t('modules.ragflow.fields.envDesc')}
          >
            <textarea
              rows={4}
              className="w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-mono text-slate-900 shadow-sm outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
              placeholder={t('modules.ragflow.fields.envPlaceholder')}
              value={otherEnvText}
              onChange={(e) => handleEnvTextChange(e.target.value)}
            />
          </Field>

          <div className="flex gap-2 pt-2">
            <Button shine disabled={saving || applyingRestart} onClick={onSave}>
              {t('modules.ragflow.fields.saveButton')}
            </Button>
            {canRestart && (
              <Button
                variant="outline"
                disabled={saving || applyingRestart}
                onClick={handleSaveAndRestart}
              >
                {applyingRestart
                  ? t('modules.ragflow.fields.applying')
                  : t('modules.ragflow.fields.applyRestartButton')}
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
        <CardTitle>{t(titleMap[moduleKey])}</CardTitle>
        <CardDescription>{t('modules.generic.cardDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        <Field
          label={t('modules.generic.fields.enabledLabel')}
          description={t('modules.generic.fields.enabledDesc')}
        >
          <Switch checked={moduleSettings.enabled} onCheckedChange={handleGenericEnabledChange} />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={t('modules.generic.fields.portLabel')}
            description={t('modules.generic.fields.portDesc')}
          >
            <Input
              placeholder={
                moduleKey === 'ragflow'
                  ? t('modules.generic.fields.portPlaceholderRagflow')
                  : t('modules.generic.fields.portPlaceholderDefault')
              }
              className="font-mono text-xs"
              value={moduleSettings.port ? String(moduleSettings.port) : ''}
              onChange={(e) => handleGenericPortChange(e.target.value)}
            />
          </Field>
          <Field
            label={t('modules.generic.fields.dbUrlLabel')}
            description={t('modules.generic.fields.dbUrlDesc')}
          >
            <Input
              placeholder={t('modules.generic.fields.dbUrlPlaceholder')}
              className="font-mono text-xs"
              value={moduleSettings.databaseUrl || ''}
              onChange={(e) => handleGenericDatabaseUrlChange(e.target.value)}
            />
          </Field>
        </div>

        <Field
          label={t('modules.generic.fields.envLabel')}
          description={t('modules.generic.fields.envDesc')}
        >
          <textarea
            rows={4}
            className="w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-mono text-slate-900 shadow-sm outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
            placeholder={t('modules.generic.fields.envPlaceholder')}
            value={genericEnvText}
            onChange={(e) => handleGenericEnvChange(e.target.value)}
          />
        </Field>

        <div className="flex gap-2 pt-2">
          <Button shine disabled={saving} onClick={onSave}>
            {t('modules.generic.fields.saveButton')}
          </Button>
          {canRestart && (
            <Button variant="outline" disabled>
              {t('modules.generic.fields.applyRestartButton')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
