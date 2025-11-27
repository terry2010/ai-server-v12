import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  MemoryStick,
  Network,
  Play,
  Server,
  Square,
} from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusDot, type ServiceStatus } from '@/components/StatusDot'
import type { DockerStatus, ModuleId, ModuleInfo } from '../../shared/types'

export type ServiceKey = ModuleId

export interface ServiceMetrics {
  cpu: number
  memory: number
  port: string
  uptime: string
}

export interface ServiceModule {
  key: ServiceKey
  name: string
  description: string
  status: ServiceStatus
  metrics: ServiceMetrics
  lastError?: string | null
}

const statusPillStyles: Record<ServiceStatus, string> = {
  running: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200',
  stopped: 'bg-slate-100 text-slate-600 dark:bg-slate-800/80 dark:text-slate-300',
  starting: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200',
  stopping: 'bg-slate-100 text-slate-700 dark:bg-slate-800/80 dark:text-slate-200',
  error: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200',
}

const mapModuleToService = (module: ModuleInfo): ServiceModule => {
  const status = module.status as ServiceStatus
  const isRunning = status === 'running'
  const uptime =
    status === 'running'
      ? '已启动'
      : status === 'starting'
      ? '启动中…'
      : status === 'stopping'
      ? '停止中…'
      : '—'

  return {
    key: module.id,
    name: module.name,
    description: module.description,
    status,
    metrics: {
      cpu: isRunning ? 18 : 0,
      memory: isRunning ? 32 : 0,
      port: module.port != null ? String(module.port) : '—',
      uptime,
    },
    lastError: null,
  }
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

export function DashboardPage() {
  const [services, setServices] = useState<ServiceModule[]>([])
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null)
  const [isStartingDocker, setIsStartingDocker] = useState(false)
  const [activeHeroIndex, setActiveHeroIndex] = useState(0)
  const navigate = useNavigate()

  const dockerInstalled = dockerStatus?.installed ?? false
  const dockerRunning = dockerStatus?.running ?? false

  const runningCount = useMemo(
    () => services.filter((s) => s.status === 'running').length,
    [services],
  )

  const reloadStatus = useCallback(async () => {
    try {
      const [dockerStatus, modules] = await Promise.all([
        window.api.getDockerStatus(),
        window.api.listModules(),
      ])

      setDockerStatus(dockerStatus)
      setServices(modules.map(mapModuleToService))
    } catch (_err) {
      setDockerStatus(null)
      setServices([])
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(
      () => setActiveHeroIndex((prev) => (prev + 1) % heroSlides.length),
      8000,
    )

    reloadStatus()

    return () => window.clearInterval(id)
  }, [reloadStatus])

  const handleToggleService = (key: ServiceKey, currentStatus: ServiceStatus) => {
    if (currentStatus === 'running') {
      setServices((prev) =>
        prev.map((s) =>
          s.key === key
            ? {
                ...s,
                status: 'stopping',
                metrics: { ...s.metrics, uptime: '停止中…' },
              }
            : s,
        ),
      )

      window.api
        .stopModule(key)
        .then((result) => {
          if (!result || !result.success) {
            const message = result?.error ?? '停止模块失败，请检查 Docker 状态。'
            setServices((prev) =>
              prev.map((s) =>
                s.key === key
                  ? {
                      ...s,
                      status: 'error',
                      lastError: message,
                    }
                  : s,
              ),
            )
            window.alert(message)
          } else {
            reloadStatus()
          }
        })
        .catch(() => {
          const message = '停止模块失败，请检查 Docker 状态。'
          setServices((prev) =>
            prev.map((s) =>
              s.key === key
                ? {
                    ...s,
                    status: 'error',
                    lastError: message,
                  }
                : s,
            ),
          )
          window.alert(message)
        })
    } else if (currentStatus === 'stopped' || currentStatus === 'error') {
      setServices((prev) =>
        prev.map((s) =>
          s.key === key
            ? {
                ...s,
                status: 'starting',
                metrics: { ...s.metrics, uptime: '启动中…' },
                lastError: null,
              }
            : s,
        ),
      )

      window.api
        .startModule(key)
        .then((result) => {
          if (!result || !result.success) {
            const message = result?.error ?? '启动模块失败，请检查 Docker 状态。'
            setServices((prev) =>
              prev.map((s) =>
                s.key === key
                  ? {
                      ...s,
                      status: 'error',
                      lastError: message,
                    }
                  : s,
              ),
            )
            window.alert(message)
          } else {
            reloadStatus()
          }
        })
        .catch(() => {
          const message = '启动模块失败，请检查 Docker 状态。'
          setServices((prev) =>
            prev.map((s) =>
              s.key === key
                ? {
                    ...s,
                    status: 'error',
                    lastError: message,
                  }
                : s,
            ),
          )
          window.alert(message)
        })
    }
  }

  const handleStartAll = () => {
    const toStart = services.filter(
      (s) => s.status === 'stopped' || s.status === 'error',
    )

    toStart.forEach((service) => {
      handleToggleService(service.key, service.status)
    })
  }

  const handleOpenModule = (key: ServiceKey) => {
    const routeMap: Record<ServiceKey, string> = {
      n8n: '/n8n',
      dify: '/dify',
      oneapi: '/oneapi',
      ragflow: '/ragflow',
    }

    const path = routeMap[key]
    if (!path) return
    navigate(path)
  }

  const handleDockerAction = async () => {
    if (!dockerInstalled) {
      window.open('https://www.docker.com/products/docker-desktop', '_blank')
      return
    }

    if (dockerRunning || isStartingDocker) {
      return
    }

    setIsStartingDocker(true)

    try {
      const result = await window.api.startDockerDesktop()
      if (!result || !result.success) {
        window.alert(result?.error ?? '无法启动 Docker 服务，请手动启动 Docker Desktop。')
        setIsStartingDocker(false)
        return
      }

      let errorCount = 0
      const maxErrorCount = 20
      const delayMs = 100
      const startTime = Date.now()

      const poll = async () => {
        try {
          const status = await window.api.getDockerStatus()
          setDockerStatus(status)

          if (!status.installed) {
            setIsStartingDocker(false)
            window.alert(status.error ?? '检测到本机未正确安装 Docker，请先安装 Docker Desktop。')
            return
          }

          if (status.running) {
            setIsStartingDocker(false)
            return
          }

          const elapsed = Date.now() - startTime
          if (elapsed >= 60_000) {
            setIsStartingDocker(false)
            window.alert(status.error ?? 'Docker 启动超时，请手动确认 Docker Desktop 状态。')
            return
          }
        } catch (_err) {
          errorCount += 1
          if (errorCount >= maxErrorCount) {
            setIsStartingDocker(false)
            window.alert('检测 Docker 状态失败，请手动确认 Docker Desktop 是否已启动。')
            return
          }
        }

        window.setTimeout(poll, delayMs)
      }

      window.setTimeout(poll, delayMs)
    } catch (_err) {
      setIsStartingDocker(false)
      window.alert('无法启动 Docker 服务，请手动启动 Docker Desktop。')
    }
  }

  const handlePrevHero = () => {
    setActiveHeroIndex((prev) => (prev - 1 + heroSlides.length) % heroSlides.length)
  }

  const handleNextHero = () => {
    setActiveHeroIndex((prev) => (prev + 1) % heroSlides.length)
  }

  return (
    <div className="space-y-3">
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
                          {runningCount} / {services.length}
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
                          {runningCount === services.length ? '正常' : '有异常服务'}
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

      <GlassCard className="flex items-center justify-between gap-2 rounded-2xl px-3 py-1.5">
        <div className="flex items-center gap-3 text-[10px] text-slate-700 dark:text-slate-200">
          <div className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-sky-50 px-3 py-[3px] border border-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(148,163,184,0.45)] dark:bg-slate-900/70 dark:border-sky-500/60 dark:text-slate-50 dark:shadow-[inset_0_1px_0_rgba(148,163,184,0.9),inset_0_-1px_0_rgba(15,23,42,0.95)]">
            <span className="uppercase tracking-wide text-slate-500 dark:text-slate-300">Docker 服务</span>
            <div className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-100">
              <div className="group relative inline-flex items-center">
                <StatusDot
                  status={dockerRunning ? 'running' : 'stopped'}
                  className="cursor-pointer"
                />
                <div className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 translate-x-2 whitespace-nowrap rounded-md bg-slate-900/90 px-2 py-1 text-[10px] text-slate-50 opacity-0 shadow-sm transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                  {dockerRunning
                    ? 'Docker 当前运行中，可以管理和监控容器'
                    : isStartingDocker && dockerInstalled
                    ? 'Docker 正在启动中，请稍候…'
                    : dockerInstalled
                    ? 'Docker 未运行，可以点击右侧按钮尝试启动 Docker Desktop'
                    : 'Docker 未安装，请先安装 Docker Desktop'}
                </div>
              </div>
              <span>{dockerRunning ? '运行中' : '未运行'}</span>
            </div>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <OverviewPill icon={Cpu} label="运行服务" value={`${runningCount} / ${services.length}`} />
            <OverviewPill icon={Clock} label="平台运行" value="02:15:32" />
            <div className="hidden lg:block">
              <OverviewPill icon={Network} label="网络" value="bridge" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            shine
            className="h-7 px-2 text-[10px] rounded-xl bg-sky-50 text-slate-700 border border-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(148,163,184,0.45)] dark:bg-slate-900/70 dark:border-sky-500/60 dark:text-slate-50 dark:shadow-[inset_0_1px_0_rgba(148,163,184,0.9),inset_0_-1px_0_rgba(15,23,42,0.95)]"
            onClick={reloadStatus}
          >
            刷新状态
          </Button>
          <Button
            size="sm"
            shine
            className="h-6 px-2 text-[10px] bg-gradient-to-r from-sky-500 to-sky-400 text-white shadow-lg shadow-sky-300/80 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={dockerRunning ? handleStartAll : handleDockerAction}
            disabled={
              dockerRunning
                ? !services.some((s) => s.status === 'stopped' || s.status === 'error')
                : isStartingDocker
            }
          >
            {dockerRunning
              ? '启动所有服务'
              : dockerInstalled
              ? isStartingDocker
                ? 'Docker 启动中…'
                : '启动 Docker 服务'
              : '安装 Docker 服务'}
          </Button>
        </div>
      </GlassCard>

      <div className="grid gap-4 md:grid-cols-2">
        {services.map((service) => (
          <Card
            key={service.key}
            className="relative transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:bg-slate-50/100 dark:hover:bg-slate-800/90"
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-700 shadow-sm">
                      <span className="text-xs font-semibold uppercase">{service.key}</span>
                    </span>
                    <div>
                      <CardTitle>{service.name}</CardTitle>
                      <CardDescription>{service.description}</CardDescription>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs">
                  <div
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${statusPillStyles[service.status]}`}
                  >
                    <div className="group relative inline-flex items-center">
                      <StatusDot
                        status={service.status}
                        className={
                          service.status === 'error' && service.lastError
                            ? 'cursor-help'
                            : undefined
                        }
                      />
                      {service.status === 'error' && service.lastError && (
                        <div className="pointer-events-none absolute right-full top-1/2 z-10 -translate-y-1/2 -translate-x-2 min-w-[12rem] max-w-xs rounded-md bg-slate-900/90 px-2 py-1 text-[10px] text-slate-50 text-left opacity-0 shadow-sm transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 dark:bg-slate-100 dark:text-slate-900 whitespace-normal break-words">
                          {service.lastError}
                        </div>
                      )}
                    </div>
                    <span>
                      {service.status === 'running'
                        ? '运行中'
                        : service.status === 'stopped'
                        ? '已停止'
                        : service.status === 'starting'
                        ? '启动中'
                        : service.status === 'stopping'
                        ? '停止中'
                        : '异常'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400">端口 {service.metrics.port}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-400">
                <MetricLine icon={Cpu} label="CPU" value={`${service.metrics.cpu}%`} accent="from-sky-400 to-emerald-400" />
                <MetricLine icon={MemoryStick} label="内存" value={`${service.metrics.memory}%`} accent="from-violet-400 to-sky-400" />
                <MetricLine icon={Database} label="端口" value={service.metrics.port} accent="from-amber-400 to-orange-400" />
                <MetricLine icon={Clock} label="运行时间" value={service.metrics.uptime} accent="from-slate-200/90 to-slate-50/90" />
              </div>

              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={
                      service.status === 'running'
                        ? 'outline'
                        : service.status === 'starting' || service.status === 'stopping'
                        ? 'outline'
                        : 'default'
                    }
                    disabled={service.status === 'starting' || service.status === 'stopping'}
                    className={`px-3 text-[11px] ${
                      service.status === 'running'
                        ? 'border-red-400/80 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-400/80 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20'
                        : service.status === 'starting' || service.status === 'stopping'
                        ? 'border-slate-300 bg-slate-200 text-slate-800 disabled:opacity-100 cursor-not-allowed dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100 dark:disabled:opacity-100 dark:cursor-not-allowed'
                        : ''
                    }`}
                    onClick={() => handleToggleService(service.key, service.status)}
                  >
                    {service.status === 'running' ? (
                      <>
                        <Square className="mr-1 h-3 w-3" />
                        停止
                      </>
                    ) : service.status === 'starting' ? (
                      <>
                        <Activity className="mr-1 h-3 w-3 animate-spin" />
                        启动中
                      </>
                    ) : service.status === 'stopping' ? (
                      <>
                        <Activity className="mr-1 h-3 w-3 animate-spin" />
                        停止中
                      </>
                    ) : (
                      <>
                        <Play className="mr-1 h-3 w-3" />
                        启动
                      </>
                    )}
                  </Button>
                  {service.status === 'running' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="px-2 text-[11px]"
                      onClick={() => handleOpenModule(service.key)}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      打开
                    </Button>
                  )}
                </div>
                <Button size="sm" variant="ghost" className="px-2 text-[11px] text-slate-500">
                  <FileText className="mr-1 h-3 w-3" />
                  查看日志
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

interface OverviewPillProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}

function OverviewPill({ icon: Icon, label, value }: OverviewPillProps) {
  return (
    <div className="flex items-center rounded-xl bg-sky-50 px-3 py-1 text-[11px] text-slate-700 border border-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(148,163,184,0.45)] dark:bg-slate-900/70 dark:border-sky-500/60 dark:text-slate-50 dark:shadow-[inset_0_1px_0_rgba(148,163,184,0.9),inset_0_-1px_0_rgba(15,23,42,0.95)]">
      <div className="flex items-baseline gap-1">
        <span className="text-[11px] text-slate-500 dark:text-slate-300">{label}</span>
        <span className="font-semibold text-slate-800 dark:text-slate-50">{value}</span>
      </div>
    </div>
  )
}

interface MetricLineProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  accent: string
}

function MetricLine({ icon: Icon, label, value, accent }: MetricLineProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="flex-1">
        <div className="flex items-center justify-between text-[11px]">
          <span>{label}</span>
          <span className="font-semibold text-slate-800 dark:text-slate-100">{value}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className={`h-full w-4/5 bg-gradient-to-r ${accent}`} />
        </div>
      </div>
    </div>
  )
}
