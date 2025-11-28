import { useEffect, useState } from 'react'
import { AlertTriangle, Globe2, Network, SlidersHorizontal, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { AppSettings } from '../../shared/types'

const tabs = [
  { key: 'system', label: '系统设置', icon: SlidersHorizontal },
  { key: 'network', label: '网络设置', icon: Network },
  { key: 'n8n', label: 'n8n 设置', icon: Terminal },
  { key: 'dify', label: 'Dify 设置', icon: Terminal },
  { key: 'oneapi', label: 'OneAPI 设置', icon: Terminal },
  { key: 'ragflow', label: 'RagFlow 设置', icon: Terminal },
  { key: 'debug', label: '调试设置', icon: AlertTriangle },
] as const

export type SettingsTabKey = (typeof tabs)[number]['key']

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>('system')
  const [dangerOpen, setDangerOpen] = useState(false)
  const [dangerAction, setDangerAction] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const result = await window.api.getSettings()
        if (!cancelled) {
          setSettings(result)
          setLoading(false)
        }
      } catch (_err) {
        if (!cancelled) {
          setSettings(null)
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [])

  const handleLocalChange = (next: AppSettings) => {
    setSettings(next)
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const next = await window.api.updateSettings(settings)
      setSettings(next)
      toast.success('设置已保存')
      try {
        window.dispatchEvent(new CustomEvent('appSettingsUpdated', { detail: next }))
      } catch {
        // ignore
      }
    } catch {
      toast.error('保存设置失败，请稍后重试。')
    } finally {
      setSaving(false)
    }
  }

  const openDanger = (action: string) => {
    setDangerAction(action)
    setDangerOpen(true)
  }

  const handleConfirmDanger = async () => {
    if (!dangerAction) {
      setDangerOpen(false)
      return
    }

    try {
      let result: { success: boolean; error?: string; exitCode?: number; stderrSnippet?: string } | null = null
      let successMessage = '操作已完成。'

      if (dangerAction === '停止所有容器') {
        result = await window.api.dockerStopAll()
        successMessage = '所有容器已停止。'
      } else if (dangerAction === '删除所有容器') {
        result = await window.api.dockerRemoveAll()
        successMessage = '所有容器已删除。'
      } else if (dangerAction === '清空所有数据卷') {
        result = await window.api.dockerPruneVolumes()
        successMessage = '所有数据卷已清空。'
      } else if (dangerAction === '一键清理') {
        result = await window.api.dockerFullCleanup()
        successMessage = '一键清理已完成。'
      }

      if (!result) {
        window.alert('未知的调试操作。')
      } else if (!result.success) {
        window.alert(result.error ?? '执行调试操作失败，请检查 Docker 状态。')
      } else {
        window.alert(successMessage)
      }
    } catch (_err) {
      window.alert('执行调试操作失败，请检查 Docker 状态。')
    } finally {
      setDangerOpen(false)
    }
  }

  return (
    <GlassCard className="grid gap-4 rounded-2xl p-4 md:grid-cols-[220px_minmax(0,1fr)] md:p-6">
      <div className="space-y-3 border-b border-white/15 pb-3 md:border-b-0 md:border-r md:pb-0 md:pr-4">
        <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-900/80 dark:text-slate-200">
            <Globe2 className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">设置中心</div>
            <div className="text-xs font-medium text-slate-800 dark:text-slate-100">系统与模块配置</div>
          </div>
        </div>
        <nav className="mt-2 text-xs text-slate-700 dark:text-slate-200">
          <div className="flex flex-col gap-1 rounded-2xl border border-white/40 bg-white/60 p-1 font-medium shadow-sm shadow-black/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/40">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-all duration-150 ${
                  activeTab === tab.key
                    ? 'bg-white text-slate-900 shadow-[0_1px_4px_rgba(15,23,42,0.22)] ring-1 ring-sky-200/80 dark:bg-slate-100 dark:text-slate-900 dark:ring-sky-300/70'
                    : 'text-slate-600/80 hover:bg-white/50 hover:text-slate-900 dark:text-slate-300/80 dark:hover:bg-slate-800/80 dark:hover:text-slate-50'
                }`}
              >
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs transition-colors ${
                    activeTab === tab.key
                      ? 'bg-sky-500 text-white dark:bg-sky-400 dark:text-slate-900'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-900/75 dark:text-slate-200'
                  }`}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                </span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>

      <div className="space-y-4 pt-1 md:pl-2">
        {activeTab === 'system' && (
          <SystemSettings
            settings={settings}
            loading={loading}
            saving={saving}
            onChange={handleLocalChange}
            onSave={handleSave}
          />
        )}
        {activeTab === 'network' && (
          <NetworkSettings
            settings={settings}
            loading={loading}
            saving={saving}
            onChange={handleLocalChange}
            onSave={handleSave}
          />
        )}
        {['n8n', 'dify', 'oneapi', 'ragflow'].includes(activeTab) && (
          <ModuleSettings
            moduleKey={activeTab as 'n8n' | 'dify' | 'oneapi' | 'ragflow'}
            settings={settings}
            loading={loading}
            saving={saving}
            onChange={handleLocalChange}
            onSave={handleSave}
          />
        )}
        {activeTab === 'debug' && (
          <DebugSettings
            settings={settings}
            loading={loading}
            saving={saving}
            onChange={handleLocalChange}
            onSave={handleSave}
            onDangerClick={openDanger}
          />
        )}
      </div>

      <Dialog open={dangerOpen} onOpenChange={setDangerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认执行危险操作？</DialogTitle>
            <DialogDescription>
              {dangerAction ? `你正在尝试执行「${dangerAction}」操作，该操作可能会导致容器或数据被清理，请确认你已经备份重要数据。` : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDangerOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              shine
              onClick={handleConfirmDanger}
            >
              确认执行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GlassCard>
  )
}

interface SystemSettingsProps {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  onChange: (next: AppSettings) => void
  onSave: () => void
}

function SystemSettings({ settings, loading, saving, onChange, onSave }: SystemSettingsProps) {
  if (loading || !settings) {
    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>系统设置</CardTitle>
          <CardDescription>正在加载配置…</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  const handleLanguageChange = (value: string) => {
    const lang = value === 'en' ? 'en' : 'zh'
    onChange({ ...settings, language: lang as AppSettings['language'] })
  }

  const handleLogLevelChange = (value: string) => {
    onChange({ ...settings, logLevel: value as AppSettings['logLevel'] })
  }

  const handleAutoStartChange = (checked: boolean) => {
    onChange({ ...settings, autoStartOnBoot: checked })
  }

  const handleSystemNameChange = (value: string) => {
    onChange({ ...settings, systemName: value })
  }

  const languageValue = settings.language === 'en' ? 'en' : 'zh'
  const showSystemNameSetting =
    settings.debug && typeof (settings.debug as any).showSystemNameSetting === 'boolean'
      ? (settings.debug as any).showSystemNameSetting
      : true

  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle>系统设置</CardTitle>
        <CardDescription>配置平台基础信息与运行策略。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        {showSystemNameSetting && (
          <Field label="系统名称" description="显示在顶部栏和侧边栏的产品名称。">
            <Input
              placeholder="AI-Server 管理平台"
              value={settings.systemName}
              onChange={(e) => handleSystemNameChange(e.target.value)}
            />
          </Field>
        )}

        <Field label="界面语言" description="切换平台显示语言（部分文案将在后续版本支持多语言）。">
          <select
            className="h-9 w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            value={languageValue}
            onChange={(e) => handleLanguageChange(e.target.value)}
          >
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
        </Field>

        <Field label="日志等级" description="控制系统输出的日志详细程度。">
          <select
            className="h-9 w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            value={settings.logLevel}
            onChange={(e) => handleLogLevelChange(e.target.value)}
          >
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
            <option value="debug">debug</option>
          </select>
        </Field>

        <Field label="自动启动" description="系统启动时自动拉起核心容器。">
          <div className="flex items-center gap-3">
            <Switch checked={settings.autoStartOnBoot} onCheckedChange={handleAutoStartChange} />
            <span className="text-xs text-slate-500">开启后，主进程启动时会自动拉起 Docker 服务。</span>
          </div>
        </Field>

        <div className="flex gap-2 pt-2">
          <Button shine disabled={loading || saving} onClick={onSave}>
            保存设置
          </Button>
          <Button variant="outline" disabled>
            重置为默认
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

interface NetworkSettingsProps {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  onChange: (next: AppSettings) => void
  onSave: () => void
}

function NetworkSettings({ settings, loading, saving, onChange, onSave }: NetworkSettingsProps) {
  if (loading || !settings) {
    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>网络设置</CardTitle>
          <CardDescription>正在加载配置…</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const mirrors = settings.docker.mirrorUrls
  const proxy = settings.docker.proxy
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const updateMirrorUrls = (nextMirrors: string[]) => {
    onChange({
      ...settings,
      docker: {
        ...settings.docker,
        mirrorUrls: nextMirrors,
      },
    })
  }

  const handleMirrorChange = (index: number, value: string) => {
    const nextMirrors = [...mirrors]
    nextMirrors[index] = value
    updateMirrorUrls(nextMirrors)
  }

  const handleAddMirror = () => {
    const nextMirrors = [...mirrors, '']
    updateMirrorUrls(nextMirrors)
  }

  const handleRemoveMirror = (index: number) => {
    const nextMirrors = mirrors.filter((_, i) => i !== index)
    updateMirrorUrls(nextMirrors.length > 0 ? nextMirrors : [''])
  }

  const handleReorderMirrors = (from: number, to: number) => {
    if (from === to) return
    const nextMirrors = [...mirrors]
    const [moved] = nextMirrors.splice(from, 1)
    nextMirrors.splice(to, 0, moved)
    updateMirrorUrls(nextMirrors)
  }

  const mirrorList = mirrors.length > 0 ? mirrors : ['']

  const updateProxy = (patch: Partial<typeof proxy>) => {
    onChange({
      ...settings,
      docker: {
        ...settings.docker,
        proxy: {
          ...proxy,
          ...patch,
        },
      },
    })
  }

  const handleProxyModeChange = (value: string) => {
    const mode = value === 'system' || value === 'manual' ? value : 'direct'
    updateProxy({ proxyMode: mode as typeof proxy.proxyMode })
  }

  const handleProxyHostChange = (value: string) => {
    updateProxy({ proxyHost: value })
  }

  const handleProxyPortChange = (value: string) => {
    const num = Number(value)
    updateProxy({ proxyPort: Number.isFinite(num) && num > 0 ? num : null })
  }

  const handleTestConnection = async () => {
    try {
      const result = await window.api.pullDockerImage('hello-world:latest')
      if (!result || !result.success) {
        window.alert(result?.error ?? '测试连接失败，请检查 Docker 与代理配置。')
      } else {
        window.alert('测试连接成功，可以通过当前代理正常拉取镜像。')
      }
    } catch (_err) {
      window.alert('测试连接失败，请检查 Docker 与代理配置。')
    }
  }

  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle>网络设置</CardTitle>
        <CardDescription>配置镜像源、代理和网络访问策略。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        <Field label="镜像加速地址" description="为 Docker 配置多个镜像加速源。">
          <div className="space-y-2">
            {mirrorList.map((value, index) => (
              <div
                key={index}
                className="flex items-center gap-2"
              >
                <div
                  className="flex h-8 w-5 cursor-grab items-center justify-center text-[11px] text-slate-400"
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (dragIndex === null || dragIndex === index) return
                    handleReorderMirrors(dragIndex, index)
                    setDragIndex(index)
                  }}
                  onDragEnd={() => setDragIndex(null)}
                >
                  ≡
                </div>
                <Input
                  placeholder={index === 0 ? 'https://registry.docker-cn.com' : 'https://hub-mirror.example.com'}
                  className="font-mono text-xs flex-1"
                  value={value}
                  onChange={(e) => handleMirrorChange(index, e.target.value)}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 text-xs"
                  onClick={() => handleRemoveMirror(index)}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="text-xs" onClick={handleAddMirror}>
              添加一行
            </Button>
          </div>
        </Field>

        <Field label="代理模式" description="在受限网络环境下通过代理访问外部服务。">
          <select
            className="h-9 w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            value={proxy.proxyMode}
            onChange={(e) => handleProxyModeChange(e.target.value)}
          >
            <option value="direct">直连</option>
            <option value="system">系统代理</option>
            <option value="manual">手动配置</option>
          </select>
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="代理主机" description="当选择手动代理时生效。">
            <Input
              placeholder="127.0.0.1"
              className="font-mono text-xs"
              value={proxy.proxyHost}
              onChange={(e) => handleProxyHostChange(e.target.value)}
            />
          </Field>
          <Field label="代理端口" description="例如 7890 或 1080。">
            <Input
              placeholder="7890"
              className="font-mono text-xs"
              value={proxy.proxyPort ? String(proxy.proxyPort) : ''}
              onChange={(e) => handleProxyPortChange(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex gap-2 pt-2">
          <Button shine disabled={loading || saving} onClick={onSave}>
            保存网络设置
          </Button>
          <Button variant="outline" onClick={handleTestConnection}>
            测试连接
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

interface ModuleSettingsProps {
  moduleKey: 'n8n' | 'dify' | 'oneapi' | 'ragflow'
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  onChange: (next: AppSettings) => void
  onSave: () => void
}

function ModuleSettings({ moduleKey, settings, loading, saving, onChange, onSave }: ModuleSettingsProps) {
  const titleMap: Record<ModuleSettingsProps['moduleKey'], string> = {
    n8n: 'n8n 设置',
    dify: 'Dify 设置',
    oneapi: 'OneAPI 设置',
    ragflow: 'RagFlow 设置',
  }

  const [visibleSecretKey, setVisibleSecretKey] = useState<string | null>(null)
  const [applyingRestart, setApplyingRestart] = useState(false)

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
      const level: AppSettings['logLevel'] = value === 'error' || value === 'warn' || value === 'debug' ? value : 'info'
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

    const handleExternalDbFieldChange = (field: 'host' | 'port' | 'database' | 'user' | 'password', value: string) => {
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

          <div className="flex gap-2 pt-2">
            <Button shine disabled={saving || applyingRestart} onClick={onSave}>
              保存 n8n 设置
            </Button>
            <Button
              variant="outline"
              disabled={saving || applyingRestart}
              onClick={handleApplyAndRestart}
            >
              {applyingRestart ? '应用中…' : '应用并重启'}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

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
            <Button
              variant="outline"
              disabled={saving || applyingRestart}
              onClick={handleApplyAndRestart}
            >
              {applyingRestart ? '应用中…' : '应用并重启'}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

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

          <Field label="日志等级" description="控制是否启用 OneAPI 的调试日志（DEBUG / DEBUG_SQL）。">
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

          <div className="flex gap-2 pt-2">
            <Button shine disabled={saving || applyingRestart} onClick={onSave}>
              保存 OneAPI 设置
            </Button>
            <Button
              variant="outline"
              disabled={saving || applyingRestart}
              onClick={handleApplyAndRestart}
            >
              {applyingRestart ? '应用中…' : '应用并重启'}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

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
          <Button variant="outline" disabled>
            应用并重启
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

interface DebugSettingsProps {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  onChange: (next: AppSettings) => void
  onSave: () => void
  onDangerClick: (action: string) => void
}

function DebugSettings({ settings, loading, saving, onChange, onSave, onDangerClick }: DebugSettingsProps) {
  if (loading || !settings) {
    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>调试设置</CardTitle>
          <CardDescription>正在加载配置…</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const handleShowDebugToolsChange = (checked: boolean) => {
    onChange({
      ...settings,
      debug: {
        ...settings.debug,
        showDebugTools: checked,
      },
    })
  }

  const handleVerboseLoggingChange = (checked: boolean) => {
    onChange({
      ...settings,
      debug: {
        ...settings.debug,
        verboseLogging: checked,
      },
    })
  }

  const handleShowSystemNameSettingChange = (checked: boolean) => {
    onChange({
      ...settings,
      debug: {
        ...settings.debug,
        showSystemNameSetting: checked,
      },
    })
  }

  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle>调试设置</CardTitle>
        <CardDescription>用于问题排查和开发调试的高级选项。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="显示调试工具" description="在界面中展示额外的调试入口。">
            <Switch checked={settings.debug.showDebugTools} onCheckedChange={handleShowDebugToolsChange} />
          </Field>
          <Field label="输出详细日志" description="开启后将输出更多 debug 日志。">
            <Switch
              checked={settings.debug.verboseLogging}
              onCheckedChange={handleVerboseLoggingChange}
            />
          </Field>
          <Field label="展示系统名称设置项" description="关闭后，将在系统设置中隐藏“系统名称”配置。">
            <Switch
              checked={settings.debug.showSystemNameSetting}
              onCheckedChange={handleShowSystemNameSettingChange}
            />
          </Field>
        </div>

        <div className="mt-2 space-y-2 rounded-xl border border-red-400/40 bg-red-50/80 px-3 py-3 text-xs text-red-900 dark:border-red-500/50 dark:bg-red-950/40 dark:text-red-100">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500 dark:text-red-300" />
            危险操作
          </div>
          <p className="text-[11px] text-red-800/90 dark:text-red-100/80">
            以下操作会直接对容器和数据卷产生影响，请在确认已经备份数据后再执行。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="destructive"
              shine
              size="sm"
              className="text-[11px]"
              onClick={() => onDangerClick('停止所有容器')}
            >
              停止所有容器
            </Button>
            <Button
              variant="destructive"
              shine
              size="sm"
              className="text-[11px]"
              onClick={() => onDangerClick('删除所有容器')}
            >
              删除所有容器
            </Button>
            <Button
              variant="destructive"
              shine
              size="sm"
              className="text-[11px]"
              onClick={() => onDangerClick('清空所有数据卷')}
            >
              清空所有数据卷
            </Button>
            <Button
              variant="destructive"
              shine
              size="sm"
              className="text-[11px]"
              onClick={() => onDangerClick('一键清理')}
            >
              一键清理
            </Button>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button shine disabled={loading || saving} onClick={onSave}>
            保存调试设置
          </Button>
          <Button variant="outline" disabled>
            重置为默认
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

interface FieldProps {
  label: string
  description?: string
  children: React.ReactNode
}

function Field({ label, description, children }: FieldProps) {
  return (
    <div className="space-y-1 text-xs">
      <div className="text-[11px] font-medium text-slate-700 dark:text-slate-200">{label}</div>
      {description && <div className="text-[11px] text-slate-500 dark:text-slate-400">{description}</div>}
      <div className="pt-1">{children}</div>
    </div>
  )
}
