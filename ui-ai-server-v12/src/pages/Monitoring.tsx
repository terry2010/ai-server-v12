import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusDot } from '@/components/StatusDot'
import { Activity, AlignLeft, BarChart2, Cpu, Gauge, MemoryStick, Network, Timer } from 'lucide-react'

interface ResourceMetric {
  label: string
  value: number
}

const resourceMetrics: ResourceMetric[] = [
  { label: 'CPU', value: 46 },
  { label: '内存', value: 62 },
  { label: '磁盘', value: 38 },
  { label: '网络', value: 24 },
]

export function MonitoringPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">性能监控</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
            <StatusDot status="running" />
            实时
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
            <option>最近 1 小时</option>
            <option>最近 6 小时</option>
            <option>最近 24 小时</option>
            <option>最近 7 天</option>
          </select>
          <Button size="sm" variant="outline" shine className="text-[11px]">
            刷新
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <GlassCard className="rounded-2xl p-4">
          <CardHeader className="px-0 pt-0">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>系统资源使用率</CardTitle>
                <CardDescription>CPU / 内存 / 磁盘 / 网络 当前占用情况。</CardDescription>
              </div>
              <Gauge className="h-5 w-5 text-sky-300" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-0 pb-0 pt-2">
            {resourceMetrics.map((m) => (
              <div key={m.label} className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">{m.label}</span>
                  <span className="font-semibold text-slate-100">{m.value}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-900/80">
                  <div
                    className="h-full bg-gradient-to-r from-sky-400 via-emerald-400 to-amber-300"
                    style={{ width: `${m.value}%` }}
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
                <CardTitle>服务状态监控</CardTitle>
                <CardDescription>各核心服务的运行状态和轻量指标。</CardDescription>
              </div>
              <Activity className="h-5 w-5 text-emerald-300" />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 px-0 pb-0 pt-2 text-xs">
            <ServiceRow name="n8n" status="running" cpu={22} memory={41} latency="132ms" />
            <ServiceRow name="Dify" status="stopped" cpu={0} memory={0} latency="—" />
            <ServiceRow name="OneAPI" status="running" cpu={17} memory={28} latency="89ms" />
            <ServiceRow name="RagFlow" status="error" cpu={5} memory={12} latency="超时" />
          </CardContent>
        </GlassCard>

        <GlassCard className="rounded-2xl p-4">
          <CardHeader className="px-0 pt-0">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>CPU 使用趋势</CardTitle>
                <CardDescription>最近一段时间的 CPU 使用情况。</CardDescription>
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
                <CardTitle>内存使用趋势</CardTitle>
                <CardDescription>最近一段时间的内存占用变化。</CardDescription>
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
          <div className="text-[10px] text-slate-500 dark:text-slate-400">CPU {cpu}% · 内存 {memory}%</div>
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
        <span>现在</span>
        <span>+15min</span>
        <span>+30min</span>
        <span>+45min</span>
        <span>+60min</span>
      </div>
    </div>
  )
}
