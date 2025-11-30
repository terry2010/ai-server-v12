import type { AppSettings } from '../../../shared/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Field } from './Field'

interface BrowserAgentSettingsProps {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  onChange: (next: AppSettings) => void
  onSave: () => void
}

export function BrowserAgentSettings({ settings, loading, saving, onChange, onSave }: BrowserAgentSettingsProps) {
  if (loading || !settings) {
    return (
      <Card className="border-none bg-transparent shadow-none">
        <CardHeader className="px-0">
          <CardTitle>Agent 设置</CardTitle>
          <CardDescription>正在加载配置…</CardDescription>
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
        <CardTitle>Browser Agent 设置</CardTitle>
        <CardDescription>
          配置用于 n8n 等调用的本地 Browser Agent HTTP 服务。当前仅监听 127.0.0.1，建议为生产环境设置强随机 token。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Field label="启用 Browser Agent" description="开启后，在 127.0.0.1 上启动本地 Browser Agent HTTP 服务。">
            <Switch checked={browserAgent.enabled} onCheckedChange={handleEnabledChange} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="服务端口" description="Browser Agent HTTP 服务监听的本地端口，仅支持 1024-65535 范围。">
              <Input
                placeholder="26080"
                className="font-mono text-xs"
                value={browserAgent.port ? String(browserAgent.port) : ''}
                onChange={(e) => handlePortChange(e.target.value)}
              />
            </Field>
            <Field label="示例调用地址" description="用于在 n8n HTTP 节点等处参考配置 Browser Agent 地址。">
              <div className="break-all font-mono text-xs text-slate-700 dark:text-slate-200">
                {baseUrl}/health
              </div>
            </Field>
          </div>

          <Field
            label="访问 Token"
            description="可选。设置后，所有 HTTP 请求需要在 Header 中携带 X-Browser-Agent-Token 或 Authorization: Bearer &lt;token&gt;。留空则不校验。"
          >
            <Input
              placeholder="建议设置为一段足够随机的字符串，例如 32-64 位令牌。"
              className="font-mono text-xs"
              value={browserAgent.token || ''}
              onChange={(e) => handleTokenChange(e.target.value)}
            />
          </Field>

          <Field
            label="数据/日志目录（可选）"
            description="用于存放 Browser Agent 的文本日志、NDJSON 元数据以及截图/下载文件等。留空则使用应用默认 data 目录。"
          >
            <Input
              placeholder="例如：C:\\ai-server-data\\browser-agent"
              className="font-mono text-xs"
              value={browserAgent.dataRoot || ''}
              onChange={(e) => handleDataRootChange(e.target.value)}
            />
          </Field>

          <div className="flex items-center justify-between pt-2 text-[11px] text-slate-500 dark:text-slate-400">
            <div>
              端口修改后，当前版本建议重启应用以确保 Browser Agent 按新端口监听。
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-sky-600 disabled:opacity-60"
              disabled={saving}
            >
              {saving ? '保存中…' : '保存 Agent 设置'}
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
