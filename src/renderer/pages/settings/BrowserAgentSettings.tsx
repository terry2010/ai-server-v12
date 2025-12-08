import type { AppSettings } from '../../../shared/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Field } from './Field'
import { useTranslation } from 'react-i18next'

interface BrowserAgentSettingsProps {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  onChange: (next: AppSettings) => void
  onSave: () => void
}

export function BrowserAgentSettings({ settings, loading, saving, onChange, onSave }: BrowserAgentSettingsProps) {
  const { t } = useTranslation('settings')

  if (loading || !settings) {
    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{t('agent.loadingTitle')}</CardTitle>
          <CardDescription>{t('agent.loadingDesc')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const browserAgent = settings.browserAgent || {
    enabled: false,
    port: 26080,
    token: '',
    dataRoot: '',
  }

  const updateBrowserAgent = (patch: Partial<typeof browserAgent>) => {
    onChange({
      ...settings,
      browserAgent: {
        ...browserAgent,
        ...patch,
      },
    })
  }

  const handleEnabledChange = (checked: boolean) => {
    updateBrowserAgent({ enabled: checked })
  }

  const handlePortChange = (value: string) => {
    const num = Number(value)
    const portValue = Number.isFinite(num) && num > 0 && num < 65536 ? num : 0
    updateBrowserAgent({ port: portValue })
  }

  const handleTokenChange = (value: string) => {
    updateBrowserAgent({ token: value })
  }

  const handleDataRootChange = (value: string) => {
    updateBrowserAgent({ dataRoot: value })
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    onSave()
  }

  const effectivePort = browserAgent.port && browserAgent.port > 0 ? browserAgent.port : 26080
  const baseUrl = `http://127.0.0.1:${effectivePort}`

  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle>{t('agent.cardTitle')}</CardTitle>
        <CardDescription>{t('agent.cardDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Field label={t('agent.enable.label')} description={t('agent.enable.desc')}>
            <Switch checked={browserAgent.enabled} onCheckedChange={handleEnabledChange} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('agent.port.label')} description={t('agent.port.desc')}>
              <Input
                placeholder={t('agent.port.placeholder')}
                className="font-mono text-xs"
                value={browserAgent.port ? String(browserAgent.port) : ''}
                onChange={(e) => handlePortChange(e.target.value)}
              />
            </Field>
            <Field label={t('agent.example.label')} description={t('agent.example.desc')}>
              <div className="break-all font-mono text-xs text-slate-700 dark:text-slate-200">
                {baseUrl}/health
              </div>
            </Field>
          </div>

          <Field
            label={t('agent.token.label')}
            description={t('agent.token.desc')}
          >
            <Input
              placeholder={t('agent.token.placeholder')}
              className="font-mono text-xs"
              value={browserAgent.token || ''}
              onChange={(e) => handleTokenChange(e.target.value)}
            />
          </Field>

          <Field
            label={t('agent.dataRoot.label')}
            description={t('agent.dataRoot.desc')}
          >
            <Input
              placeholder={t('agent.dataRoot.placeholder')}
              className="font-mono text-xs"
              value={browserAgent.dataRoot || ''}
              onChange={(e) => handleDataRootChange(e.target.value)}
            />
          </Field>

          <div className="flex items-center justify-between pt-2 text-[11px] text-slate-500 dark:text-slate-400">
            <div>
              {t('agent.footerTip')}
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-sky-600 disabled:opacity-60"
              disabled={saving}
            >
              {saving ? t('agent.saveButton.saving') : t('agent.saveButton.idle')}
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
