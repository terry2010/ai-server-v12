import { useNavigate } from 'react-router-dom'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/StatusDot'
import { ArrowLeft, ArrowRight, Home, RotateCcw } from 'lucide-react'

export type ModuleId = 'n8n' | 'dify' | 'oneapi' | 'ragflow'

const moduleMeta: Record<ModuleId, { name: string; url: string | null }> = {
  n8n: { name: 'n8n 工作流引擎', url: 'http://localhost:5678' },
  dify: { name: 'Dify AI 应用平台', url: null },
  oneapi: { name: 'OneAPI 统一网关', url: 'http://localhost:3000' },
  ragflow: { name: 'RagFlow 知识库', url: null },
}

interface ModulePlaceholderProps {
  moduleId: ModuleId
}

export function ModulePlaceholder({ moduleId }: ModulePlaceholderProps) {
  const navigate = useNavigate()
  const meta = moduleMeta[moduleId]

  const urlText = meta.url ?? '模块未运行或端口未映射，请检查容器状态和端口配置。'

  return (
    <GlassCard className="space-y-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-200">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-900/80 dark:text-slate-100">
            <StatusDot status={meta.url ? 'running' : 'stopped'} />
          </span>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{meta.name}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">模块 Web 界面占位区</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            shine
            className="text-[11px]"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="mr-1 h-3 w-3" />
            后退
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-[11px]"
            onClick={() => navigate(1)}
          >
            <ArrowRight className="mr-1 h-3 w-3" />
            前进
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-[11px]"
            onClick={() => window.location.reload()}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            刷新
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-[11px]"
            onClick={() => navigate('/')}
          >
            <Home className="mr-1 h-3 w-3" />
            返回首页
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-[11px] font-mono text-slate-800 dark:border-slate-700/80 dark:bg-slate-950/80 dark:text-slate-200">
        {urlText}
      </div>

      <div className="mt-2 rounded-xl border border-dashed border-slate-200/80 bg-slate-50 px-4 py-6 text-xs text-slate-600 dark:border-slate-700/80 dark:bg-slate-900/60 dark:text-slate-300">
        这里未来可以通过 iframe 或 Electron BrowserView 嵌入模块自身的 Web 界面，实现无缝集成体验。
      </div>
    </GlassCard>
  )
}
