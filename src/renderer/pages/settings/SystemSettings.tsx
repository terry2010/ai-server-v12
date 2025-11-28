import type { AppSettings } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Field } from './Field'

interface SystemSettingsProps {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  onChange: (next: AppSettings) => void
  onSave: () => void
}

export function SystemSettings({ settings, loading, saving, onChange, onSave }: SystemSettingsProps) {
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
