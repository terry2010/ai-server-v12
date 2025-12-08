import { Activity, Cpu, ExternalLink, FileText, MemoryStick, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusDot, type ServiceStatus } from '@/components/StatusDot'
import type { ServiceKey, ServiceModule } from '../Dashboard'
import { useTranslation } from 'react-i18next'

interface ServiceCardProps {
  service: ServiceModule
  onToggle: (key: ServiceKey, currentStatus: ServiceStatus) => void
  onOpenModule: (key: ServiceKey) => void
  onViewLogs: (key: ServiceKey) => void
}

const statusPillStyles: Record<ServiceStatus, string> = {
  running: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200',
  stopped: 'bg-slate-100 text-slate-600 dark:bg-slate-800/80 dark:text-slate-300',
  starting: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200',
  stopping: 'bg-slate-100 text-slate-700 dark:bg-slate-800/80 dark:text-slate-200',
  error: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200',
}

interface MetricLineProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  accent: string
  percent?: number
}

function MetricLine({ icon: Icon, label, value, accent, percent }: MetricLineProps) {
  const clamped =
    percent == null || Number.isNaN(percent) ? 0 : Math.max(0, Math.min(100, percent))
  const barWidth = `${Math.max(4, clamped)}%`

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
          <div
            className={`h-full bg-gradient-to-r ${accent}`}
            style={{ width: barWidth }}
          />
        </div>
      </div>
    </div>
  )
}

export function ServiceCard({ service, onToggle, onOpenModule, onViewLogs }: ServiceCardProps) {
  const { t } = useTranslation(['dashboard', 'common'])

  const statusLabel =
    service.status === 'running'
      ? t('common:status.running')
      : service.status === 'stopped'
      ? t('common:status.stopped')
      : service.status === 'starting'
      ? t('common:status.starting')
      : service.status === 'stopping'
      ? t('common:status.stopping')
      : t('common:status.error')

  const description = t(`dashboard:modules.${service.key}.description`, {
    defaultValue: service.description,
  })

  return (
    <Card className="relative transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:bg-slate-50/100 dark:hover:bg-slate-800/90">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-700 shadow-sm">
                <span className="text-xs font-semibold uppercase">{service.key}</span>
              </span>
              <div>
                <CardTitle>{service.name}</CardTitle>
                <CardDescription>{description}</CardDescription>
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
                {statusLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <span>
                {t('dashboard:service.labels.uptime')} {service.metrics.uptime}
              </span>
              <span>
                {t('dashboard:service.labels.port')} {service.metrics.port}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 text-xs text-slate-400 md:grid-cols-2">
          <MetricLine
            icon={Cpu}
            label={t('dashboard:service.labels.cpu')}
            value={`${service.metrics.cpu}%`}
            percent={service.metrics.cpu}
            accent="from-sky-400 to-emerald-400"
          />
          <MetricLine
            icon={MemoryStick}
            label={t('dashboard:service.labels.memory')}
            value={`${service.metrics.memory}%`}
            percent={service.metrics.memory}
            accent="from-violet-400 to-sky-400"
          />
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
              onClick={() => onToggle(service.key, service.status)}
            >
              {service.status === 'running' ? (
                <>
                  <Square className="mr-1 h-3 w-3" />
                  {t('dashboard:service.buttons.stop')}
                </>
              ) : service.status === 'starting' ? (
                <>
                  <Activity className="mr-1 h-3 w-3 animate-spin" />
                  {t('dashboard:service.buttons.starting')}
                </>
              ) : service.status === 'stopping' ? (
                <>
                  <Activity className="mr-1 h-3 w-3 animate-spin" />
                  {t('dashboard:service.buttons.stopping')}
                </>
              ) : (
                <>
                  <Play className="mr-1 h-3 w-3" />
                  {t('dashboard:service.buttons.start')}
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="px-2 text-[11px] text-slate-500"
              onClick={() => onViewLogs(service.key)}
            >
              <FileText className="mr-1 h-3 w-3" />
              {t('dashboard:service.buttons.viewLogs')}
            </Button>
          </div>
          <Button
            size="sm"
            shine
            className="px-3 text-[11px] bg-gradient-to-r from-sky-500 to-sky-400 text-white shadow-md shadow-sky-300/70 hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-60"
            disabled={service.status !== 'running'}
            onClick={() => onOpenModule(service.key)}
          >
            <ExternalLink className="mr-1 h-3 w-3" />
            {t('common:action.open')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
