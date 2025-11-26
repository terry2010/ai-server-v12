import { GlassCard } from '@/components/GlassCard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BookOpenText, ExternalLink, PlayCircle } from 'lucide-react'

export function TutorialPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-900/80 dark:text-slate-100">
          <BookOpenText className="h-3.5 w-3.5" />
        </span>
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">在线教程</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">快速了解如何使用 AI-Server 与各个 AI 模块。</div>
        </div>
      </div>

      <GlassCard className="grid gap-4 rounded-2xl p-4 md:grid-cols-3">
        <Card className="border-none bg-transparent shadow-none">
          <CardHeader className="px-0 pt-0">
            <CardTitle>基础入门</CardTitle>
            <CardDescription>从 0 搭建本地 AI-Server 开发环境。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 px-0 pb-0 text-xs text-slate-400">
            <p>了解如何启动 Docker、拉起 n8n / Dify / OneAPI / RagFlow 等核心服务。</p>
            <Button size="sm" shine className="inline-flex items-center gap-1 rounded-full px-3 text-[11px]">
              <PlayCircle className="h-3 w-3" />
              查看快速上手
            </Button>
          </CardContent>
        </Card>

        <Card className="border-none bg-transparent shadow-none">
          <CardHeader className="px-0 pt-0">
            <CardTitle>工作流实战</CardTitle>
            <CardDescription>使用 n8n + Dify 构建自动化 Agent 工作流。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 px-0 pb-0 text-xs text-slate-400">
            <p>通过图形化节点串联模型调用、知识库检索和外部 API。</p>
            <Button size="sm" shine className="inline-flex items-center gap-1 rounded-full px-3 text-[11px]">
              <ExternalLink className="h-3 w-3" />
              打开示例流程
            </Button>
          </CardContent>
        </Card>

        <Card className="border-none bg-transparent shadow-none">
          <CardHeader className="px-0 pt-0">
            <CardTitle>RAG 知识库</CardTitle>
            <CardDescription>用 RagFlow 为你的文档构建问答助手。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 px-0 pb-0 text-xs text-slate-400">
            <p>上传本地文档，配置向量索引，并接入到 OneAPI 统一网关。</p>
            <Button size="sm" shine className="inline-flex items-center gap-1 rounded-full px-3 text-[11px]">
              <ExternalLink className="h-3 w-3" />
              查看配置说明
            </Button>
          </CardContent>
        </Card>
      </GlassCard>
    </div>
  )
}
