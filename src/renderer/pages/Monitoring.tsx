import { useEffect, useRef, useState } from 'react'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusDot } from '@/components/StatusDot'
import { Activity, AlignLeft, BarChart2, Cpu, Gauge, MemoryStick, Network, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type ServiceStatus = 'running' | 'stopped' | 'error'

interface SystemState {
  cpuUsage: number
  memoryUsage: number
  memoryTotal: number
  memoryUsed: number
  diskUsage: number
  diskTotal: number
  diskUsed: number
}

interface ModuleMetricViewModel {
  id: string
  name: string
  status: ServiceStatus
  cpu: number | null
  memory: number | null
}

export function MonitoringPage() {
  const { t } = useTranslation('monitoring')
  const [system, setSystem] = useState<SystemState | null>(null)
  const [modules, setModules] = useState<ModuleMetricViewModel[]>([])
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const timerRef = useRef<number | null>(null)

  const fetchMetrics = async () => {
    setLoading(true)
    try {
      const [sys, mod] = await Promise.all([
        window.api.getSystemMetrics(),
        window.api.getModuleMetrics(),
      ])

      setSystem(sys)

      const items: ModuleMetricViewModel[] = (mod.items || []).map((m) => ({
        id: m.moduleId,
        name: m.name,
        status: m.status as ServiceStatus,
        cpu: m.cpuUsage == null ? null : Math.round(m.cpuUsage),
        memory: m.memoryUsage == null ? null : Math.round(m.memoryUsage),
      }))

      setModules(items)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMetrics()
  }, [])

  useEffect(() => {
    const start = () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current)
      }
      timerRef.current = window.setInterval(() => {
        fetchMetrics()
      }, 5000)
    }

    const stop = () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    if (autoRefresh) {
      start()
    } else {
      stop()
    }

    return () => {
      stop()
    }
  }, [autoRefresh])

  const systemCards = system
    ? [
        { label: t('systemCard.metrics.cpu'), value: Math.round(system.cpuUsage), icon: <Cpu className="h-3 w-3" /> },
        {
          label: t('systemCard.metrics.memory'),
          value: Math.round(system.memoryUsage),
          icon: <MemoryStick className="h-3 w-3" />,
        },
        {
          label: t('systemCard.metrics.disk'),
          value: Math.round(system.diskUsage),
          icon: <Network className="h-3 w-3" />,
        },
      ]
    : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('header.title')}</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
            <StatusDot status={autoRefresh ? 'running' : 'stopped'} />
            <span>{autoRefresh ? t('header.badgeRunning') : t('header.badgePaused')}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            shine
            className="text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => {
              fetchMetrics()
            }}
            disabled={loading}
          >
            <Gauge className={`mr-1 h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> {t('actions.refresh')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            shine
            className="text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => setAutoRefresh((v) => !v)}
          >
            <Activity className={`mr-1 h-3 w-3 ${autoRefresh && !loading ? 'animate-pulse' : ''}`} />
            {autoRefresh ? t('actions.stopAuto') : t('actions.startAuto')}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <GlassCard className="rounded-2xl p-4">
          <CardHeader className="px-0 pt-0">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t('systemCard.title')}</CardTitle>
                <CardDescription>{t('systemCard.desc')}</CardDescription>
              </div>
              <Gauge className="h-5 w-5 text-sky-300" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-0 pb-0 pt-2 text-xs">
            {systemCards.length === 0 && (
              <div className="text-slate-400">{t('systemCard.empty')}</div>
            )}
            {systemCards.map((m) => (
              <div key={m.label} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-slate-300">
                    {m.icon}
                    <span>{m.label}</span>
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{m.value}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-900/80">
                  <div
                    className="h-full bg-gradient-to-r from-sky-400 via-emerald-400 to-amber-300"
                    style={{ width: `${Math.max(0, Math.min(100, m.value))}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </GlassCard>

        <GlassCard className="rounded-2xl p-4">
          <CardHeader className="px-0 pt-0">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t('modulesCard.title')}</CardTitle>
                <CardDescription>{t('modulesCard.desc')}</CardDescription>
              </div>
              <Activity className="h-5 w-5 text-emerald-300" />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 px-0 pb-0 pt-2 text-xs">
            {modules.length === 0 && (
              <div className="text-slate-400">{t('modulesCard.empty')}</div>
            )}
            {modules.map((m) => (
              <ServiceRow
                key={m.id}
                name={m.name}
                status={m.status}
                cpu={m.cpu ?? 0}
                memory={m.memory ?? 0}
                latency={m.status === 'running' ? '—' : t('service.latencyNotRunning')}
              />
            ))}
          </CardContent>
        </GlassCard>

        <GlassCard className="rounded-2xl p-4">
          <CardHeader className="px-0 pt-0">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t('charts.cpuTitle')}</CardTitle>
                <CardDescription>{t('charts.cpuDesc')}</CardDescription>
              </div>
              <BarChart2 className="h-5 w-5 text-sky-300" />
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-1 pt-3">
            <CssLineChart accent="from-sky-400 via-sky-300 to-sky-500" />
          </CardContent>
        </GlassCard>

        <GlassCard className="rounded-2xl p-4">
          <CardHeader className="px-0 pt-0">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t('charts.memoryTitle')}</CardTitle>
                <CardDescription>{t('charts.memoryDesc')}</CardDescription>
              </div>
              <AlignLeft className="h-5 w-5 text-violet-300" />
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-1 pt-3">
            <CssLineChart accent="from-violet-400 via-sky-300 to-emerald-400" />
          </CardContent>
        </GlassCard>
      </div>
    </div>
  )
}

interface ServiceRowProps {
  name: string
  status: 'running' | 'stopped' | 'error'
  cpu: number
  memory: number
  latency: string
}

function ServiceRow({ name, status, cpu, memory, latency }: ServiceRowProps) {
  const { t } = useTranslation('monitoring')
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-100 px-3 py-2 text-slate-800 dark:bg-slate-900/70 dark:text-slate-100">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-slate-700 dark:bg-slate-950/80 dark:text-slate-100">
          <Cpu className="h-3.5 w-3.5" />
        </span>
        <div className="text-xs">
          <div className="flex items-center gap-1 font-medium text-slate-900 dark:text-slate-100">
            {name}
            <StatusDot status={status} />
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            {t('modulesCard.rowStatus', { cpu, memory })}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-slate-700 dark:text-slate-300">
        <Timer className="h-3 w-3" />
        {latency}
      </div>
    </div>
  )
}

interface CssLineChartProps {
  accent: string
}

function CssLineChart({ accent }: CssLineChartProps) {
  const { t } = useTranslation('monitoring')
  return (
    <div className="space-y-2">
      <div className="relative h-28 overflow-hidden rounded-2xl bg-gradient-to-b from-slate-900/70 via-slate-950 to-slate-950/90">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.18),transparent_60%)]" />
        <div className="absolute inset-4 flex items-end gap-1">
          {[35, 62, 48, 72, 55, 80, 64, 90, 68, 54, 76].map((v, i) => (
            <div key={i} className="flex-1">
              <div className="relative mx-auto h-full w-[2px] overflow-hidden rounded-full bg-slate-800/70">
                <div
                  className={`absolute bottom-0 w-full bg-gradient-to-t ${accent}`}
                  style={{ height: `${v}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{t('charts.axisNow')}</span>
        <span>{t('charts.axis15m')}</span>
        <span>{t('charts.axis30m')}</span>
        <span>{t('charts.axis45m')}</span>
        <span>{t('charts.axis60m')}</span>
      </div>
    </div>
  )
}
