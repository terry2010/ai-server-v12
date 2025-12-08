import type { AppSettings } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Field } from './Field'
import { useTranslation } from 'react-i18next'
import { resolveSystemLanguage } from '../../i18n'

interface SystemSettingsProps {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  onChange: (next: AppSettings) => void
  onSave: () => void
}

export function SystemSettings({ settings, loading, saving, onChange, onSave }: SystemSettingsProps) {
  const { t, i18n } = useTranslation('settings')

  if (loading || !settings) {
    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>{t('system.cardTitle')}</CardTitle>
          <CardDescription>{t('system.cardDesc')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  const handleLanguageChange = (value: string) => {
    let lang: AppSettings['language']
    if (value === 'en') {
      lang = 'en'
    } else if (value === 'auto') {
      lang = 'auto'
    } else {
      lang = 'zh'
    }

    onChange({ ...settings, language: lang })

    try {
      if (lang === 'auto') {
        const sys = resolveSystemLanguage()
        window.localStorage.setItem('ai-server-language', 'auto')
        i18n.changeLanguage(sys).catch(() => {})
      } else {
        window.localStorage.setItem('ai-server-language', lang)
        i18n.changeLanguage(lang).catch(() => {})
      }
    } catch {
      // ignore
    }
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

  const languageValue =
    settings.language === 'en' ? 'en' : settings.language === 'zh' ? 'zh' : 'auto'
  const showSystemNameSetting =
    settings.debug && typeof (settings.debug as any).showSystemNameSetting === 'boolean'
      ? (settings.debug as any).showSystemNameSetting
      : true

  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle>{t('system.cardTitle')}</CardTitle>
        <CardDescription>{t('system.cardDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        {showSystemNameSetting && (
          <Field label={t('system.systemName')} description={t('system.systemNameDesc')}>
            <Input
              placeholder={t('system.systemNamePlaceholder')}
              value={settings.systemName}
              onChange={(e) => handleSystemNameChange(e.target.value)}
            />
          </Field>
        )}

        <Field label={t('system.language')} description={t('system.languageDesc')}>
          <select
            className="h-9 w-full rounded-lg border border-slate-200/80 bg-white/90 px-3 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            value={languageValue}
            onChange={(e) => handleLanguageChange(e.target.value)}
          >
            <option value="auto">{t('system.languageOptions.auto')}</option>
            <option value="zh">{t('system.languageOptions.zh')}</option>
            <option value="en">{t('system.languageOptions.en')}</option>
          </select>
        </Field>

        <Field label={t('system.logLevel')} description={t('system.logLevelDesc')}>
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

        <Field label={t('system.autoStart')} description={t('system.autoStartDesc')}>
          <div className="flex items-center gap-3">
            <Switch checked={settings.autoStartOnBoot} onCheckedChange={handleAutoStartChange} />
            <span className="text-xs text-slate-500">{t('system.autoStartDesc')}</span>
          </div>
        </Field>

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
