import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ServiceStatus } from '@/components/StatusDot'
import type { DockerStatus, ModuleId, ModuleInfo, ModuleRuntimeMetrics } from '../../shared/types'
import { HeroSection } from './dashboard/HeroSection'
import { DockerStatusCard } from './dashboard/DockerStatusCard'
import { ServiceCard } from './dashboard/ServiceCard'

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
  status: ServiceStatus,
): string => {
  if (uptimeSeconds == null || uptimeSeconds < 0 || Number.isNaN(uptimeSeconds)) {
    if (status === 'running') return '已启动'
    if (status === 'starting') return '启动中…'
    if (status === 'stopping') return '停止中…'
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
  const [services, setServices] = useState<ServiceModule[]>([])
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null)
  const [isStartingDocker, setIsStartingDocker] = useState(false)
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
