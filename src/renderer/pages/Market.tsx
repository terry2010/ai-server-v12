import { GlassCard } from '@/components/GlassCard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Bot, Layers, Wand2 } from 'lucide-react'

const apps = [
  {
    id: 'chat-support',
    name: '客服对话助手',
    desc: '基于 OneAPI + Dify 的多轮对话客服机器人。',
    tags: ['对话', '工单', '多语言'],
  },
  {
    id: 'doc-assistant',
    name: '文档问答助手',
    desc: '接入 RagFlow 知识库，实现对内部文档的精准问答。',
    tags: ['RAG', '知识库'],
  },
  {
    id: 'workflow-orchestrator',
    name: '工作流编排模板',
    desc: '预置 n8n 节点，快速集成多模型与企业系统。',
    tags: ['n8n', '自动化'],
  },
]

export function MarketPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-900/80 dark:text-slate-100">
          <Bot className="h-3.5 w-3.5" />
        </span>
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI 市场</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">浏览可复用的 AI 应用和工作流模板。</div>
        </div>
      </div>

      <GlassCard className="grid gap-4 rounded-2xl p-4 md:grid-cols-3">
        {apps.map((app) => (
          <Card
            key={app.id}
            className="border border-slate-200/80 bg-white/95 text-slate-800 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg dark:border-white/15 dark:bg-slate-900/90 dark:text-slate-50"
          >
            <CardHeader className="px-4 pb-2 pt-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-900/80 dark:text-slate-100">
                  <Layers className="h-4 w-4" />
                </span>
                <div>
                  <CardTitle className="text-sm">{app.name}</CardTitle>
                  <CardDescription className="text-[11px]">{app.desc}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 text-xs">
              <div className="flex flex-wrap gap-1">
                {app.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-slate-100 px-2 py-[2px] text-[10px] text-slate-700 dark:bg-slate-900/70 dark:text-slate-200"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <Button size="sm" shine className="w-full text-[11px]">
                <Wand2 className="mr-1 h-3 w-3" />
                安装到工作区
              </Button>
            </CardContent>
          </Card>
        ))}
      </GlassCard>
    </div>
  )
}
