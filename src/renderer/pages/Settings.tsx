import { useEffect, useState } from 'react'
import { AlertTriangle, Globe2, Network, SlidersHorizontal, Terminal } from 'lucide-react'
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
    } catch {
      // ignore for now, UI 可在后续阶段增加错误提示
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
          <ModuleSettings moduleKey={activeTab as 'n8n' | 'dify' | 'oneapi' | 'ragflow'} />
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

  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle>系统设置</CardTitle>
        <CardDescription>配置平台基础信息与运行策略。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="系统名称" description="显示在顶部栏和侧边栏的产品名称。">
            <Input
              placeholder="AI-Server 管理平台"
              value={settings.systemName}
              onChange={(e) => handleSystemNameChange(e.target.value)}
            />
          </Field>
          <Field label="界面语言" description="切换平台显示语言。">
            <select
              className="h-9 w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={languageValue}
              onChange={(e) => handleLanguageChange(e.target.value)}
            >
              <option value="zh">简体中文</option>
              <option value="en">English</option>
            </select>
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
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
        </div>

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
}

function ModuleSettings({ moduleKey }: ModuleSettingsProps) {
  const titleMap: Record<ModuleSettingsProps['moduleKey'], string> = {
    n8n: 'n8n 设置',
    dify: 'Dify 设置',
    oneapi: 'OneAPI 设置',
    ragflow: 'RagFlow 设置',
  }

  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle>{titleMap[moduleKey]}</CardTitle>
        <CardDescription>配置模块的端口、数据库和环境变量等。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="服务端口" description="容器映射到本机的端口号。">
            <Input placeholder={moduleKey === 'n8n' ? '5678' : moduleKey === 'dify' ? '8081' : '3000'} className="font-mono text-xs" />
          </Field>
          <Field label="数据库 URL" description="可选，留空则使用内置存储。">
            <Input placeholder="postgres://user:pass@localhost:5432/dbname" className="font-mono text-xs" />
          </Field>
        </div>

        <Field label="环境变量" description="一行一个，支持 KEY=VALUE 格式。">
          <textarea
            rows={4}
            className="w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-mono text-slate-900 shadow-sm outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
            placeholder="OPENAI_API_KEY=sk-...&#10;HTTP_PROXY=http://127.0.0.1:7890"
          />
        </Field>

        <div className="flex gap-2 pt-2">
          <Button shine>保存模块设置</Button>
          <Button variant="outline">应用并重启</Button>
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
