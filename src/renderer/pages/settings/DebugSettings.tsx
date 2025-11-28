import { AlertTriangle } from 'lucide-react'
import type { AppSettings } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Field } from './Field'

interface DebugSettingsProps {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  onChange: (next: AppSettings) => void
  onSave: () => void
  onDangerClick: (action: string) => void
}

export function DebugSettings({ settings, loading, saving, onChange, onSave, onDangerClick }: DebugSettingsProps) {
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
