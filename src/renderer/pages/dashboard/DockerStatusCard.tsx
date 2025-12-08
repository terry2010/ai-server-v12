import { Cpu, Clock, Network } from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/StatusDot'
import { useTranslation } from 'react-i18next'

interface DockerStatusCardProps {
  dockerRunning: boolean
  dockerInstalled: boolean
  isStartingDocker: boolean
  runningCount: number
  serviceCount: number
  canStartAll: boolean
  onReloadStatus: () => void
  onStartAll: () => void
  onDockerAction: () => void
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
        <Icon className="mr-1 h-3 w-3" />
        <span className="text-[11px] text-slate-500 dark:text-slate-300">{label}</span>
        <span className="font-semibold text-slate-800 dark:text-slate-50">{value}</span>
      </div>
    </div>
  )
}

export function DockerStatusCard({
  dockerRunning,
  dockerInstalled,
  isStartingDocker,
  runningCount,
  serviceCount,
  canStartAll,
  onReloadStatus,
  onStartAll,
  onDockerAction,
}: DockerStatusCardProps) {
  const { t } = useTranslation('dashboard')

  return (
    <GlassCard className="flex items-center justify-between gap-2 rounded-2xl pl-3 pr-1.5 py-1">
      <div className="flex items-center gap-3 text-[10px] text-slate-700 dark:text-slate-200">
        <div className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-sky-50 px-3 py-[3px] border border-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(148,163,184,0.45)] dark:bg-slate-900/70 dark:border-sky-500/60 dark:text-slate-50 dark:shadow-[inset_0_1px_0_rgba(148,163,184,0.9),inset_0_-1px_0_rgba(15,23,42,0.95)]">
          <span className="uppercase tracking-wide text-slate-500 dark:text-slate-300">{t('docker.title')}</span>
          <div className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-100">
            <div className="group relative inline-flex items-center">
              <StatusDot
                status={dockerRunning ? 'running' : 'stopped'}
                className="cursor-pointer"
              />
              <div className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 translate-x-2 whitespace-nowrap rounded-md bg-slate-900/90 px-2 py-1 text-[10px] text-slate-50 opacity-0 shadow-sm transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                {dockerRunning
                  ? t('docker.statusRunning')
                  : isStartingDocker && dockerInstalled
                  ? t('docker.statusStarting')
                  : dockerInstalled
                  ? t('docker.statusStoppedCanStart')
                  : t('docker.statusNotInstalled')}
              </div>
            </div>
            <span>{dockerRunning ? t('docker.running') : t('docker.stopped')}</span>
          </div>
        </div>

        <div className="hidden items-center gap-2 sm:flex">
          <OverviewPill
            icon={Cpu}
            label={t('docker.overviewRunningServices')}
            value={`${runningCount} / ${serviceCount}`}
          />
          <OverviewPill icon={Clock} label={t('docker.overviewUptime')} value="02:15:32" />
          <div className="hidden lg:block">
            <OverviewPill
              icon={Network}
              label={t('docker.overviewNetwork')}
              value={t('docker.overviewNetworkValue')}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          shine
          className="h-7 px-2 text-[10px] rounded-xl bg-sky-50 text-slate-700 border border-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(148,163,184,0.45)] dark:bg-slate-900/70 dark:border-sky-500/60 dark:text-slate-50 dark:shadow-[inset_0_1px_0_rgba(148,163,184,0.9),inset_0_-1px_0_rgba(15,23,42,0.95)]"
          onClick={onReloadStatus}
        >
          {t('docker.refresh')}
        </Button>
        <Button
          size="sm"
          shine
          className="h-6 px-2 text-[10px] bg-gradient-to-r from-sky-500 to-sky-400 text-white shadow-lg shadow-sky-300/80 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={dockerRunning ? onStartAll : onDockerAction}
          disabled={dockerRunning ? !canStartAll : isStartingDocker}
        >
          {dockerRunning
            ? t('docker.startAll')
            : dockerInstalled
            ? isStartingDocker
              ? t('docker.startingDocker')
              : t('docker.startDocker')
            : t('docker.installDocker')}
        </Button>
      </div>
    </GlassCard>
  )
}
