import { AlertTriangle } from 'lucide-react'
import type { AppSettings } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Field } from './Field'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface DebugSettingsProps {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  onChange: (next: AppSettings) => void
  onSave: () => void
  onDangerClick: (action: 'stopAll' | 'removeAll' | 'pruneVolumes' | 'fullCleanup') => void
}

export function DebugSettings({ settings, loading, saving, onChange, onSave, onDangerClick }: DebugSettingsProps) {
  const { t } = useTranslation('settings')

  if (loading || !settings) {
    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{t('tabs.debug')}</CardTitle>
          <CardDescription>...</CardDescription>
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

  const handleBrowserViewIdleDestroyMinutesChange = (value: string) => {
    let minutes = parseInt(value, 10)
    if (!Number.isFinite(minutes) || minutes <= 0) minutes = 1
    if (minutes > 60) minutes = 60
    onChange({
      ...settings,
      debug: {
        ...settings.debug,
        browserViewIdleDestroyMinutes: minutes,
      },
    })
  }

  const handleClearLocalStorage = () => {
    const confirmed = window.confirm(t('debug.clearStorageConfirm'))
    if (!confirmed) return

    try {
      window.localStorage.clear()
      toast.success(t('debug.clearStorageSuccess'))
      window.setTimeout(() => {
        window.location.reload()
      }, 500)
    } catch {
      toast.error(t('debug.clearStorageFail'))
    }
  }

  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle>{t('tabs.debug')}</CardTitle>
        <CardDescription>{t('debugPage.cardDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={t('debugPage.showTools.label')}
            description={t('debugPage.showTools.desc')}
          >
            <Switch checked={settings.debug.showDebugTools} onCheckedChange={handleShowDebugToolsChange} />
          </Field>
          <Field
            label={t('debugPage.verboseLogging.label')}
            description={t('debugPage.verboseLogging.desc')}
          >
            <Switch
              checked={settings.debug.verboseLogging}
              onCheckedChange={handleVerboseLoggingChange}
            />
          </Field>
          <Field
            label={t('debugPage.showSystemName.label')}
            description={t('debugPage.showSystemName.desc')}
          >
            <Switch
              checked={settings.debug.showSystemNameSetting}
              onCheckedChange={handleShowSystemNameSettingChange}
            />
          </Field>
          <Field
            label={t('debugPage.browserViewIdleMinutes.label')}
            description={t('debugPage.browserViewIdleMinutes.desc')}
          >
            <Input
              type="number"
              min={1}
              max={60}
              className="h-9 w-24 text-xs"
              value={String(settings.debug.browserViewIdleDestroyMinutes ?? 1)}
              onChange={(e) => handleBrowserViewIdleDestroyMinutesChange(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-2 space-y-2 rounded-xl border border-red-400/40 bg-red-50/80 px-3 py-3 text-xs text-red-900 dark:border-red-500/50 dark:bg-red-950/40 dark:text-red-100">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500 dark:text-red-300" />
            {t('dangerDialog.title')}
          </div>
          <p className="text-[11px] text-red-800/90 dark:text-red-100/80">
            {t('dangerDialog.description', { action: '' })}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="destructive"
              shine
              size="sm"
              className="text-[11px]"
              onClick={() => onDangerClick('stopAll')}
            >
              {t('debugActions.stopAll')}
            </Button>
            <Button
              variant="destructive"
              shine
              size="sm"
              className="text-[11px]"
              onClick={() => onDangerClick('removeAll')}
            >
              {t('debugActions.removeAll')}
            </Button>
            <Button
              variant="destructive"
              shine
              size="sm"
              className="text-[11px]"
              onClick={() => onDangerClick('pruneVolumes')}
            >
              {t('debugActions.pruneVolumes')}
            </Button>
            <Button
              variant="destructive"
              shine
              size="sm"
              className="text-[11px]"
              onClick={() => onDangerClick('fullCleanup')}
            >
              {t('debugActions.fullCleanup')}
            </Button>
          </div>
        </div>

        <div className="mt-2 space-y-2 rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-3 text-xs text-slate-700 dark:border-slate-700/50 dark:bg-slate-900/40 dark:text-slate-100">
          <div className="mb-1 text-xs font-semibold">{t('debug.clearStorageTitle')}</div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            {t('debug.clearStorageDesc')}
          </p>
          <div className="mt-2">
            <Button size="sm" variant="outline" className="text-[11px]" onClick={handleClearLocalStorage}>
              {t('debug.clearStorageButton')}
            </Button>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button shine disabled={loading || saving} onClick={onSave}>
            {t('system.save')}
          </Button>
          <Button variant="outline" disabled>
            {t('system.reset')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
