import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StatusDot, type ServiceStatus } from '@/components/StatusDot'
import type {
  DockerStatus,
  ModuleId,
  ModuleInfo,
  ModuleRuntimeMetrics,
  BrowserAgentRuntimeMetrics,
} from '../../shared/types'
import { HeroSection } from './dashboard/HeroSection'
import { DockerStatusCard } from './dashboard/DockerStatusCard'
import { ServiceCard } from './dashboard/ServiceCard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Cpu, MemoryStick, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

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

const formatUptime = (
  uptimeSeconds: number | null | undefined,
  _status: ServiceStatus,
): string => {
  if (uptimeSeconds == null || uptimeSeconds < 0 || Number.isNaN(uptimeSeconds)) {
    return '—'
  }

  const total = Math.floor(uptimeSeconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

const mapModuleToService = (
  module: ModuleInfo,
  runtimeMetrics?: ModuleRuntimeMetrics | null,
): ServiceModule => {
  const status = module.status as ServiceStatus
  const isRunning = status === 'running'
  const uptime = formatUptime(runtimeMetrics?.uptimeSeconds ?? null, status)

  const cpu =
    runtimeMetrics && runtimeMetrics.cpuUsage != null
      ? Math.round(runtimeMetrics.cpuUsage)
      : isRunning
      ? 1
      : 0

  const memory =
    runtimeMetrics && runtimeMetrics.memoryUsage != null
      ? Math.round(runtimeMetrics.memoryUsage)
      : isRunning
      ? 1
      : 0

  return {
    key: module.id,
    name: module.name,
    description: module.description,
    status,
    metrics: {
      cpu,
      memory,
      port: module.port != null ? String(module.port) : '—',
      uptime,
    },
    lastError: null,
  }
}

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const [services, setServices] = useState<ServiceModule[]>([])
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null)
  const [isStartingDocker, setIsStartingDocker] = useState(false)
  const [browserAgentEnabled, setBrowserAgentEnabled] = useState<boolean | null>(null)
  const [browserAgentPort, setBrowserAgentPort] = useState<number | null>(null)
  const [browserAgentMetrics, setBrowserAgentMetrics] = useState<BrowserAgentRuntimeMetrics | null>(null)
  const navigate = useNavigate()

  const dockerInstalled = dockerStatus?.installed ?? false
  const dockerRunning = dockerStatus?.running ?? false

  const runningCount = useMemo(
    () => services.filter((s) => s.status === 'running').length,
    [services],
  )

  const reloadStatus = useCallback(async () => {
    try {
      const [dockerStatus, modules, appSettings] = await Promise.all([
        window.api.getDockerStatus(),
        window.api.listModules(),
        window.api.getSettings(),
      ])

      setDockerStatus(dockerStatus)
      const rawAgent = appSettings && appSettings.browserAgent
      const enabled = !!(rawAgent && typeof rawAgent.enabled === 'boolean' ? rawAgent.enabled : false)
      const port =
        rawAgent && typeof rawAgent.port === 'number' && rawAgent.port > 0 && rawAgent.port < 65536
          ? rawAgent.port
          : 26080
      setBrowserAgentEnabled(enabled)
      setBrowserAgentPort(port)
      const enabledModules = modules.filter((m) => {
        const moduleSettings = appSettings?.modules?.[m.id]
        if (!moduleSettings) return true
        return moduleSettings.enabled
      })

      // 先渲染基础模块信息（不带实时指标），保证首屏速度
      setServices(enabledModules.map((m) => mapModuleToService(m, null)))

      // 在后台异步获取运行时指标，只更新 CPU/内存，不阻塞页面
      window.api
        .getModuleMetrics()
        .then((moduleMetrics) => {
          if (!moduleMetrics || !Array.isArray(moduleMetrics.items)) return
          const metricsMap = new Map<ModuleId, ModuleRuntimeMetrics>()
          for (const m of moduleMetrics.items) {
            metricsMap.set(m.moduleId, m)
          }

          setServices((prev) =>
            prev.map((s) => {
              const runtime = metricsMap.get(s.key as ModuleId)
              if (!runtime) return s

              const cpu =
                runtime.cpuUsage != null
                  ? Math.round(runtime.cpuUsage)
                  : s.status === 'running'
                  ? 1
                  : 0

              const memory =
                runtime.memoryUsage != null
                  ? Math.round(runtime.memoryUsage)
                  : s.status === 'running'
                  ? 1
                  : 0

              const uptime = formatUptime(
                runtime.uptimeSeconds ?? null,
                (runtime.status as ServiceStatus) ?? s.status,
              )

              return {
                ...s,
                metrics: {
                  ...s.metrics,
                  cpu,
                  memory,
                  uptime,
                },
              }
            }),
          )
        })
        .catch(() => {
          // 忽略运行时指标错误，不影响首页加载
        })
    } catch (_err) {
      setDockerStatus(null)
      setServices([])
    }
  }, [])

  useEffect(() => {
    reloadStatus()
  }, [reloadStatus])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        // 运行时指标获取失败时不影响首页
        if (!window.api || typeof window.api.browserAgentGetRuntimeMetrics !== 'function') return
        const result = await window.api.browserAgentGetRuntimeMetrics()
        if (cancelled) return
        setBrowserAgentMetrics(result || null)
      } catch {
        if (!cancelled) {
          setBrowserAgentMetrics(null)
        }
      }
    }

    load()
    const timer = window.setInterval(load, 5000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const handler = () => {
      reloadStatus()
    }

    window.addEventListener('appSettingsUpdated', handler as EventListener)

    return () => {
      window.removeEventListener('appSettingsUpdated', handler as EventListener)
    }
  }, [reloadStatus])

  const handleToggleService = (key: ServiceKey, currentStatus: ServiceStatus) => {
    if (currentStatus === 'running') {
      setServices((prev) =>
        prev.map((s) =>
          s.key === key
            ? {
                ...s,
                status: 'stopping',
                metrics: { ...s.metrics, uptime: t('service.uptime.stopping') },
              }
            : s,
        ),
      )

      window.api
        .stopModule(key)
        .then((result) => {
          if (!result || !result.success) {
            const message = result?.error ?? t('errors.stopModuleFailed')
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
          const message = t('errors.stopModuleFailed')
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
                metrics: { ...s.metrics, uptime: t('service.uptime.starting') },
                lastError: null,
              }
            : s,
        ),
      )

      window.api
        .startModule(key)
        .then((result) => {
          if (!result || !result.success) {
            const message = result?.error ?? t('errors.startModuleFailed')
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
          const message = t('errors.startModuleFailed')
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
        window.alert(result?.error ?? t('errors.dockerStartFailed'))
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
            window.alert(status.error ?? t('errors.dockerNotInstalled'))
            return
          }

          if (status.running) {
            setIsStartingDocker(false)
            return
          }

          const elapsed = Date.now() - startTime
          if (elapsed >= 60_000) {
            setIsStartingDocker(false)
            window.alert(status.error ?? t('errors.dockerTimeout'))
            return
          }
        } catch (_err) {
          errorCount += 1
          if (errorCount >= maxErrorCount) {
            setIsStartingDocker(false)
            window.alert(t('errors.dockerStatusCheckFailed'))
            return
          }
        }

        window.setTimeout(poll, delayMs)
      }

      window.setTimeout(poll, delayMs)
    } catch (_err) {
      setIsStartingDocker(false)
      window.alert(t('errors.dockerStartFailed'))
    }
  }

  return (
    <div className="space-y-3">
      <HeroSection runningCount={runningCount} totalServices={services.length} />

      <DockerStatusCard
        dockerRunning={dockerRunning}
        dockerInstalled={dockerInstalled}
        isStartingDocker={isStartingDocker}
        runningCount={runningCount}
        serviceCount={services.length}
        canStartAll={services.some((s) => s.status === 'stopped' || s.status === 'error')}
        onReloadStatus={reloadStatus}
        onStartAll={handleStartAll}
        onDockerAction={handleDockerAction}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {browserAgentEnabled && (
          <BrowserAgentCard
            enabled={browserAgentEnabled}
            port={browserAgentPort}
            runtime={browserAgentMetrics}
            onOpen={() => navigate('/browser-agent')}
          />
        )}
        {services.map((service) => (
          <ServiceCard
            key={service.key}
            service={service}
            onToggle={handleToggleService}
            onOpenModule={handleOpenModule}
            onViewLogs={(key) => navigate(`/logs?module=${key}`)}
          />
        ))}
      </div>
    </div>
  )
}

interface BrowserAgentCardProps {
  enabled: boolean
  port: number | null
  runtime: BrowserAgentRuntimeMetrics | null
  onOpen: () => void
}

function BrowserAgentCard({ enabled, port, runtime, onOpen }: BrowserAgentCardProps) {
  const { t } = useTranslation('dashboard')
  const cpu = runtime && runtime.cpuUsage != null ? Math.round(runtime.cpuUsage) : 0
  const memory = runtime && runtime.memoryUsage != null ? Math.round(runtime.memoryUsage) : 0
  const runningSessions = runtime ? runtime.runningSessions : 0
  const clamp = (v: number) => {
    if (Number.isNaN(v)) return 0
    return Math.max(0, Math.min(100, v))
  }
  const cpuBar = clamp(cpu)
  const memBar = clamp(memory)

  return (
    <Card className="relative transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:bg-slate-50/100 dark:hover:bg-slate-800/90">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-700 shadow-sm">
                <span className="text-xs font-semibold uppercase">BA</span>
              </span>
              <div>
                <CardTitle>{t('browserAgent.title')}</CardTitle>
                <CardDescription>{t('browserAgent.description')}</CardDescription>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 text-xs">
            <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
              <StatusDot status={enabled ? 'running' : 'stopped'} />
              <span>{enabled ? t('browserAgent.enabled') : t('browserAgent.disabled')}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              {port != null && (
                <span>
                  {t('browserAgent.port')} {port}
                </span>
              )}
              <span>
                {t('browserAgent.sessions')} {runningSessions}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 text-xs text-slate-400 md:grid-cols-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
              <Cpu className="h-3.5 w-3.5" />
            </span>
            <div className="flex-1">
              <div className="flex items-center justify-between text-[11px]">
                <span>{t('browserAgent.cpu')}</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100">{cpu}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-gradient-to-r from-sky-400 to-emerald-400"
                  style={{ width: `${Math.max(4, cpuBar)}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
              <MemoryStick className="h-3.5 w-3.5" />
            </span>
            <div className="flex-1">
              <div className="flex items-center justify-between text-[11px]">
                <span>{t('browserAgent.memory')}</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100">{memory}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-gradient-to-r from-violet-400 to-sky-400"
                  style={{ width: `${Math.max(4, memBar)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-end gap-2 text-xs">
          <Button
            size="sm"
            shine
            className="px-3 text-[11px] bg-gradient-to-r from-sky-500 to-sky-400 text-white shadow-md shadow-sky-300/70 hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-60"
            disabled={!enabled}
            onClick={onOpen}
          >
            <ExternalLink className="mr-1 h-3 w-3" />
            {t('browserAgent.open')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
