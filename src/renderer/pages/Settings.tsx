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
import type { AppSettings, ModuleId, ModuleStatus } from '../../shared/types'
import { SystemSettings as SystemSettingsPanel } from './settings/SystemSettings'
import { NetworkSettings as NetworkSettingsPanel } from './settings/NetworkSettings'
import { ModuleSettings as ModuleSettingsPanel } from './settings/ModuleSettings'
import { DebugSettings } from './settings/DebugSettings'
import { Field } from './settings/Field'

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
  const [dangerLoading, setDangerLoading] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [moduleStatusMap, setModuleStatusMap] = useState<Record<ModuleId, ModuleStatus> | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const [result, modules] = await Promise.all([
          window.api.getSettings(),
          window.api.listModules().catch(() => null),
        ])
        if (!cancelled) {
          setSettings(result)
          if (modules && Array.isArray(modules)) {
            const map: Record<ModuleId, ModuleStatus> = {
              n8n: 'stopped',
              dify: 'stopped',
              oneapi: 'stopped',
              ragflow: 'stopped',
            }
            for (const m of modules) {
              if (m && m.id && m.status) {
                map[m.id as ModuleId] = m.status as ModuleStatus
              }
            }
            setModuleStatusMap(map)
          }
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

    setDangerLoading(true)
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
        toast.error('未知的调试操作。')
      } else if (!result.success) {
        toast.error(result.error ?? '执行调试操作失败，请检查 Docker 状态。')
      } else {
        toast.success(successMessage)
      }
    } catch (_err) {
      toast.error('执行调试操作失败，请检查 Docker 状态。')
    } finally {
      setDangerLoading(false)
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
          <SystemSettingsPanel
            settings={settings}
            loading={loading}
            saving={saving}
            onChange={handleLocalChange}
            onSave={handleSave}
          />
        )}
        {activeTab === 'network' && (
          <NetworkSettingsPanel
            settings={settings}
            loading={loading}
            saving={saving}
            onChange={handleLocalChange}
            onSave={handleSave}
          />
        )}
        {['n8n', 'dify', 'oneapi', 'ragflow'].includes(activeTab) && (
          <ModuleSettingsPanel
            moduleKey={activeTab as 'n8n' | 'dify' | 'oneapi' | 'ragflow'}
            settings={settings}
            loading={loading}
            saving={saving}
            moduleStatus={
              moduleStatusMap ? moduleStatusMap[(activeTab as 'n8n' | 'dify' | 'oneapi' | 'ragflow') as ModuleId] : undefined
            }
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
              disabled={dangerLoading}
              onClick={handleConfirmDanger}
            >
              {dangerLoading ? '执行中…' : '确认执行'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GlassCard>
  )
}
