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
import { BrowserAgentSettings as BrowserAgentSettingsPanel } from './settings/BrowserAgentSettings'
import { Field } from './settings/Field'
import { useTranslation } from 'react-i18next'

const tabs = [
  { key: 'system', icon: SlidersHorizontal },
  { key: 'network', icon: Network },
  { key: 'agent', icon: Terminal },
  { key: 'n8n', icon: Terminal },
  { key: 'dify', icon: Terminal },
  { key: 'oneapi', icon: Terminal },
  { key: 'ragflow', icon: Terminal },
  { key: 'debug', icon: AlertTriangle },
] as const

export type SettingsTabKey = (typeof tabs)[number]['key']

export function SettingsPage() {
  const { t } = useTranslation('settings')
  const [activeTab, setActiveTab] = useState<SettingsTabKey>('system')
  const [dangerOpen, setDangerOpen] = useState(false)
  const [dangerAction, setDangerAction] = useState<
    'stopAll' | 'removeAll' | 'pruneVolumes' | 'fullCleanup' | null
  >(null)
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
      toast.success(t('toast.saveSuccess'))
      try {
        window.dispatchEvent(new CustomEvent('appSettingsUpdated', { detail: next }))
      } catch {
        // ignore
      }
    } catch {
      toast.error(t('toast.saveFail'))
    } finally {
      setSaving(false)
    }
  }

  const openDanger = (action: 'stopAll' | 'removeAll' | 'pruneVolumes' | 'fullCleanup') => {
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
      let successMessage = t('debugActions.successFull')

      if (dangerAction === 'stopAll') {
        result = await window.api.dockerStopAll()
        successMessage = t('debugActions.successStop')
      } else if (dangerAction === 'removeAll') {
        result = await window.api.dockerRemoveAll()
        successMessage = t('debugActions.successRemove')
      } else if (dangerAction === 'pruneVolumes') {
        result = await window.api.dockerPruneVolumes()
        successMessage = t('debugActions.successPrune')
      } else if (dangerAction === 'fullCleanup') {
        result = await window.api.dockerFullCleanup()
        successMessage = t('debugActions.successFull')
      }

      if (!result) {
        toast.error(t('debugActions.unknown'))
      } else if (!result.success) {
        toast.error(result.error ?? t('debugActions.fail'))
      } else {
        toast.success(successMessage)
      }
    } catch (_err) {
      toast.error(t('debugActions.fail'))
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
            <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('title')}</div>
            <div className="text-xs font-medium text-slate-800 dark:text-slate-100">{t('subtitle')}</div>
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
                <span>{t(`tabs.${tab.key}`)}</span>
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
        {activeTab === 'agent' && (
          <BrowserAgentSettingsPanel
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
            <DialogTitle>{t('dangerDialog.title')}</DialogTitle>
            <DialogDescription>
              {dangerAction
                ? t('dangerDialog.description', {
                    action: t(`debugActions.${dangerAction}`),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDangerOpen(false)}
            >
              {t('dangerDialog.cancel')}
            </Button>
            <Button
              variant="destructive"
              shine
              disabled={dangerLoading}
              onClick={handleConfirmDanger}
            >
              {dangerLoading ? t('dangerDialog.executing') : t('dangerDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GlassCard>
  )
}
