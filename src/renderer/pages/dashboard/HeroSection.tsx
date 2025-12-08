import { useEffect, useState } from 'react'
import { Activity, ArrowRight, ChevronLeft, ChevronRight, Clock, Cpu } from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/StatusDot'
import { useTranslation } from 'react-i18next'

interface HeroSectionProps {
  runningCount: number
  totalServices: number
}

interface HeroSlide {
  id: 'overview' | 'workflow' | 'market'
}

const heroSlides: HeroSlide[] = [
  {
    id: 'overview',
  },
  {
    id: 'workflow',
  },
  {
    id: 'market',
  },
]

export function HeroSection({ runningCount, totalServices }: HeroSectionProps) {
  const { t } = useTranslation('dashboard')
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
                    <span className="text-slate-500">{t('hero.envPill')}</span>
                  </div>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-sky-900 md:text-3xl dark:text-slate-50">
                    {slide.id === 'overview'
                      ? t('hero.title')
                      : slide.id === 'workflow'
                      ? t('hero.slides.workflowTitle')
                      : t('hero.slides.marketTitle')}
                  </h1>
                  <p className="mt-1 text-xs text-slate-600 md:text-sm dark:text-slate-200/90">
                    {slide.id === 'overview'
                      ? t('hero.description')
                      : slide.id === 'workflow'
                      ? t('hero.slides.workflowDesc')
                      : t('hero.slides.marketDesc')}
                  </p>

                  <dl className="mt-3 grid grid-cols-3 gap-3 text-[11px] text-slate-700 md:text-xs dark:text-slate-100">
                    <div className="space-y-0.5">
                      <dt className="flex items-center gap-1 text-slate-600 dark:text-slate-200/80">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                          <Cpu className="h-3 w-3" />
                        </span>
                        {t('hero.metrics.running')}
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
                        {t('hero.metrics.status')}
                      </dt>
                      <dd className="text-sm font-semibold text-emerald-600 dark:text-emerald-200">
                        {runningCount === totalServices
                          ? t('hero.metrics.statusOk')
                          : t('hero.metrics.statusIssue')}
                      </dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="flex items-center gap-1 text-slate-600 dark:text-slate-200/80">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                          <Clock className="h-3 w-3" />
                        </span>
                        {t('hero.metrics.uptime')}
                      </dt>
                      <dd className="text-sm font-semibold text-sky-900 dark:text-slate-50">
                        {t('hero.metrics.uptimeDemo')}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="flex flex-col items-end gap-2 text-right text-[11px] text-slate-600 md:text-xs dark:text-slate-200">
                  <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
                    <span>
                      {slide.id === 'overview'
                        ? t('hero.pill')
                        : slide.id === 'workflow'
                        ? t('hero.slides.workflowPill')
                        : t('hero.slides.marketPill')}
                    </span>
                  </div>
                  <Button size="sm" shine className="bg-gradient-to-r from-sky-500 to-sky-400 text-white shadow-glass dark:from-sky-400 dark:to-sky-300 dark:text-slate-900 dark:shadow-md">
                    {slide.id === 'overview'
                      ? t('hero.action')
                      : slide.id === 'workflow'
                      ? t('hero.slides.workflowAction')
                      : t('hero.slides.marketAction')}
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
          aria-label={t('hero.carousel.prev')}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleNextHero}
          className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/55 p-1.5 text-slate-100 shadow-lg backdrop-blur-sm opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          aria-label={t('hero.carousel.next')}
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
            aria-label={
              slide.id === 'overview'
                ? t('hero.slides.overview')
                : slide.id === 'workflow'
                ? t('hero.slides.workflowTitle')
                : t('hero.slides.marketTitle')
            }
          />
        ))}
      </div>
    </GlassCard>
  )
}
