import { useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from './Field'
import { useTranslation } from 'react-i18next'

interface NetworkSettingsProps {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  onChange: (next: AppSettings) => void
  onSave: () => void
}

export function NetworkSettings({ settings, loading, saving, onChange, onSave }: NetworkSettingsProps) {
  const { t } = useTranslation('settings')

  if (loading || !settings) {
    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{t('network.loadingTitle')}</CardTitle>
          <CardDescription>{t('network.loadingDesc')}</CardDescription>
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
        window.alert(result?.error ?? t('network.test.fail'))
      } else {
        window.alert(t('network.test.success'))
      }
    } catch (_err) {
      window.alert(t('network.test.fail'))
    }
  }

  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle>{t('network.cardTitle')}</CardTitle>
        <CardDescription>{t('network.cardDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        <Field label={t('network.mirrors.label')} description={t('network.mirrors.desc')}>
          <div className="space-y-2">
            {mirrorList.map((value, index) => (
              <div key={index} className="flex items-center gap-2">
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
                  placeholder={
                    index === 0
                      ? t('network.mirrors.primaryPlaceholder')
                      : t('network.mirrors.secondaryPlaceholder')
                  }
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
              {t('network.mirrors.add')}
            </Button>
          </div>
        </Field>

        <Field label={t('network.proxyMode.label')} description={t('network.proxyMode.desc')}>
          <select
            className="h-9 w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            value={proxy.proxyMode}
            onChange={(e) => handleProxyModeChange(e.target.value)}
          >
            <option value="direct">{t('network.proxyMode.options.direct')}</option>
            <option value="system">{t('network.proxyMode.options.system')}</option>
            <option value="manual">{t('network.proxyMode.options.manual')}</option>
          </select>
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('network.proxyHost.label')} description={t('network.proxyHost.desc')}>
            <Input
              placeholder={t('network.proxyHost.placeholder')}
              className="font-mono text-xs"
              value={proxy.proxyHost}
              onChange={(e) => handleProxyHostChange(e.target.value)}
            />
          </Field>
          <Field label={t('network.proxyPort.label')} description={t('network.proxyPort.desc')}>
            <Input
              placeholder={t('network.proxyPort.placeholder')}
              className="font-mono text-xs"
              value={proxy.proxyPort ? String(proxy.proxyPort) : ''}
              onChange={(e) => handleProxyPortChange(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex gap-2 pt-2">
          <Button shine disabled={loading || saving} onClick={onSave}>
            {t('network.buttons.save')}
          </Button>
          <Button variant="outline" onClick={handleTestConnection}>
            {t('network.buttons.test')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
