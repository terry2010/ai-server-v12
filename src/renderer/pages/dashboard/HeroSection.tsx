import { useEffect, useState } from 'react'
import { Activity, ArrowRight, ChevronLeft, ChevronRight, Clock, Cpu } from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/StatusDot'

interface HeroSectionProps {
  runningCount: number
  totalServices: number
}

interface HeroSlide {
  id: string
  title: string
  description: string
  pillLabel: string
  actionLabel: string
}

const heroSlides: HeroSlide[] = [
  {
    id: 'overview',
    title: '欢迎使用 AI-Server 管理平台',
    description: '统一管理 n8n / Dify / OneAPI / RagFlow 等多种 AI 服务，一键查看运行状态、性能与日志。',
    pillLabel: '本地 Docker 正在运行',
    actionLabel: '快速开始',
  },
  {
    id: 'workflow',
    title: '一键启用常用自动化工作流',
    description: '使用 n8n 模板快速编排通知、报表、监控等自动化流程。',
    pillLabel: '推荐 · 工作流模板',
    actionLabel: '查看示例工作流',
  },
  {
    id: 'market',
    title: '安装开箱即用的 AI 应用',
    description: '从客服助手、文档问答到工作流模板，几分钟搭建你的 AI 场景。',
    pillLabel: '推荐 · AI 市场',
    actionLabel: '前往 AI 市场',
  },
]

export function HeroSection({ runningCount, totalServices }: HeroSectionProps) {
  const [activeHeroIndex, setActiveHeroIndex] = useState(0)

  useEffect(() => {
    const id = window.setInterval(
      () => setActiveHeroIndex((prev) => (prev + 1) % heroSlides.length),
      8000,
    )

    return () => window.clearInterval(id)
  }, [])

  const handlePrevHero = () => {
    setActiveHeroIndex((prev) => (prev - 1 + heroSlides.length) % heroSlides.length)
  }

  const handleNextHero = () => {
    setActiveHeroIndex((prev) => (prev + 1) % heroSlides.length)
  }

  return (
    <GlassCard className="group relative overflow-hidden rounded-2xl border border-sky-200/60 bg-gradient-to-r from-sky-100 via-sky-50 to-cyan-50 px-6 py-5 shadow-glass dark:border-slate-700/80 dark:bg-gradient-to-r dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.55),transparent_55%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.32),transparent_55%)]" />
      <div className="pointer-events-none absolute -right-10 top-[-40px] h-40 w-40 rounded-full bg-sky-300/20 blur-3xl dark:bg-sky-400/25" />
      <div className="pointer-events-none absolute bottom-[-60px] left-[15%] h-40 w-40 rounded-full bg-indigo-400/15 blur-3xl dark:bg-indigo-500/25" />

      <div className="relative overflow-hidden">
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${activeHeroIndex * 100}%)` }}
        >
          {heroSlides.map((slide) => (
            <div key={slide.id} className="w-full shrink-0">
              <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-sky-100 px-2 py-[3px] text-[11px] font-medium text-sky-700">
                    <StatusDot status="running" />
                    <span className="uppercase tracking-wide text-sky-700">AI-Server</span>
                    <span className="text-slate-500">本地开发环境</span>
                  </div>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-sky-900 md:text-3xl dark:text-slate-50">
                    {slide.title}
                  </h1>
                  <p className="mt-1 text-xs text-slate-600 md:text-sm dark:text-slate-200/90">
                    {slide.description}
                  </p>

                  <dl className="mt-3 grid grid-cols-3 gap-3 text-[11px] text-slate-700 md:text-xs dark:text-slate-100">
                    <div className="space-y-0.5">
                      <dt className="flex items-center gap-1 text-slate-600 dark:text-slate-200/80">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                          <Cpu className="h-3 w-3" />
                        </span>
                        运行服务
                      </dt>
                      <dd className="text-sm font-semibold text-sky-900 dark:text-slate-50">
                        {runningCount} / {totalServices}
                      </dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="flex items-center gap-1 text-slate-600 dark:text-slate-200/80">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                          <Activity className="h-3 w-3" />
                        </span>
                        系统状态
                      </dt>
                      <dd className="text-sm font-semibold text-emerald-600 dark:text-emerald-200">
                        {runningCount === totalServices ? '正常' : '有异常服务'}
                      </dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="flex items-center gap-1 text-slate-600 dark:text-slate-200/80">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                          <Clock className="h-3 w-3" />
                        </span>
                        已运行时间
                      </dt>
                      <dd className="text-sm font-semibold text-sky-900 dark:text-slate-50">2 小时 15 分钟</dd>
                    </div>
                  </dl>
                </div>

                <div className="flex flex-col items-end gap-2 text-right text-[11px] text-slate-600 md:text-xs dark:text-slate-200">
                  <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
                    <span>{slide.pillLabel}</span>
                  </div>
                  <Button size="sm" shine className="bg-gradient-to-r from-sky-500 to-sky-400 text-white shadow-glass dark:from-sky-400 dark:to-sky-300 dark:text-slate-900 dark:shadow-md">
                    {slide.actionLabel}
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handlePrevHero}
          className="absolute left-2 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/55 p-1.5 text-slate-100 shadow-lg backdrop-blur-sm opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          aria-label="上一张"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleNextHero}
          className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/55 p-1.5 text-slate-100 shadow-lg backdrop-blur-sm opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          aria-label="下一张"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex items-center justify-end gap-1">
        {heroSlides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => setActiveHeroIndex(index)}
            className={`h-1.5 rounded-full transition-colors ${
              index === activeHeroIndex ? 'w-5 bg-sky-500' : 'w-3 bg-sky-200 hover:bg-sky-300'
            }`}
            aria-label={slide.title}
          />
        ))}
      </div>
    </GlassCard>
  )
}
