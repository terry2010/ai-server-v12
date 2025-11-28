import { useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from './Field'

interface NetworkSettingsProps {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  onChange: (next: AppSettings) => void
  onSave: () => void
}

export function NetworkSettings({ settings, loading, saving, onChange, onSave }: NetworkSettingsProps) {
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
                    index === 0 ? 'https://registry.docker-cn.com' : 'https://hub-mirror.example.com'
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
