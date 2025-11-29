import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  BookOpenText,
  Store,
  Settings2,
  Activity,
  TerminalSquare,
  Sun,
  Moon,
  Home,
  RotateCw,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { GlassCard } from '@/components/GlassCard'
import { StatusDot, type ServiceStatus } from '@/components/StatusDot'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'

interface TopTab {
  key: string
  label: string
  path: string
  status?: ServiceStatus
}

const topTabs: TopTab[] = [
  { key: 'dashboard', label: '首页', path: '/' },
  { key: 'n8n', label: 'n8n', path: '/n8n', status: 'running' },
  { key: 'dify', label: 'Dify', path: '/dify', status: 'stopped' },
  { key: 'oneapi', label: 'OneAPI', path: '/oneapi', status: 'running' },
  { key: 'ragflow', label: 'RagFlow', path: '/ragflow', status: 'error' },
]

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const [theme, setTheme] = useTheme()
  const [systemName, setSystemName] = useState('AI-Server')
  const [n8nEnabled, setN8nEnabled] = useState(true)
  const [oneapiEnabled, setOneapiEnabled] = useState(true)
  const navigate = useNavigate()

  const [runningModules, setRunningModules] = useState({
    n8n: false,
    dify: false,
    oneapi: false,
    ragflow: false,
  })
  const runningModulesRef = useRef({
    n8n: false,
    dify: false,
    oneapi: false,
    ragflow: false,
  })
  const runningModulesInitializedRef = useRef(false)
  const [moduleTabOrder, setModuleTabOrder] = useState<('n8n' | 'dify' | 'oneapi' | 'ragflow')[]>([
    'n8n',
    'dify',
    'oneapi',
    'ragflow',
  ])
  const [draggingModuleKey, setDraggingModuleKey] = useState<string | null>(null)
  const [moduleTabsExpanded, setModuleTabsExpanded] = useState(false)
  const prevModuleTabsExpandedRef = useRef(moduleTabsExpanded)
  const [expandedModuleOrder, setExpandedModuleOrder] = useState<
    ('n8n' | 'dify' | 'oneapi' | 'ragflow')[] | null
  >(null)
  const [currentModuleMetrics, setCurrentModuleMetrics] = useState<
    | {
        cpuUsage: number | null
        memoryUsage: number | null
      }
    | null
  >(null)
  const [recentlyStartedModules, setRecentlyStartedModules] = useState<
    Record<'n8n' | 'dify' | 'oneapi' | 'ragflow', number>
  >({
    n8n: 0,
    dify: 0,
    oneapi: 0,
    ragflow: 0,
  })

  const isModuleRoute = ['/n8n', '/dify', '/oneapi', '/ragflow'].some((base) =>
    location.pathname.startsWith(base),
  )

  const currentModuleId: 'n8n' | 'dify' | 'oneapi' | 'ragflow' | null = isModuleRoute
    ? location.pathname.startsWith('/n8n')
      ? 'n8n'
      : location.pathname.startsWith('/dify')
      ? 'dify'
      : location.pathname.startsWith('/oneapi')
      ? 'oneapi'
      : 'ragflow'
    : null

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  const isModuleVisible = (id: 'n8n' | 'dify' | 'oneapi' | 'ragflow') => {
    if (id === 'n8n') return n8nEnabled && runningModules.n8n
    if (id === 'dify') return runningModules.dify
    if (id === 'oneapi') return oneapiEnabled && runningModules.oneapi
    if (id === 'ragflow') return runningModules.ragflow
    return false
  }

  const getModuleLabel = (id: 'n8n' | 'dify' | 'oneapi' | 'ragflow') => {
    if (id === 'n8n') return 'n8n'
    if (id === 'dify') return 'Dify'
    if (id === 'oneapi') return 'OneAPI'
    return 'RagFlow'
  }

  const formatPercent = (value: number | null | undefined) => {
    if (value == null || Number.isNaN(value)) return '—'
    const v = Math.max(0, Math.min(100, value))
    return `${v.toFixed(0)}%`
  }

  const handleModuleControlClick = (action: 'home' | 'reload' | 'back' | 'forward') => {
    if (!currentModuleId) return
    try {
      window.api.controlModuleView(currentModuleId, action).catch(() => {})
    } catch {
    }
  }

  const reorderModuleTabs = (fromKey: string, toKey: string) => {
    if (!fromKey || !toKey || fromKey === toKey) return
    setModuleTabOrder((prev) => {
      const fromIndex = prev.indexOf(fromKey as any)
      const toIndex = prev.indexOf(toKey as any)
      if (fromIndex === -1 || toIndex === -1) return prev
      const next = prev.slice()
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
    if (moduleTabsExpanded) {
      setExpandedModuleOrder((prev) => {
        if (!prev) return prev
        const fromIndex = prev.indexOf(fromKey as any)
        const toIndex = prev.indexOf(toKey as any)
        if (fromIndex === -1 || toIndex === -1) return prev
        const next = prev.slice()
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        return next
      })
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadSettings = async () => {
      try {
        const current = await window.api.getSettings()
        if (!cancelled && current) {
          if (typeof current.systemName === 'string') {
            setSystemName(current.systemName || 'AI-Server')
          }
          if (current.modules && current.modules.n8n && typeof current.modules.n8n.enabled === 'boolean') {
            setN8nEnabled(current.modules.n8n.enabled)
          }
          if (
            current.modules &&
            current.modules.oneapi &&
            typeof current.modules.oneapi.enabled === 'boolean'
          ) {
            setOneapiEnabled(current.modules.oneapi.enabled)
          }
        }
      } catch {
        // ignore
      }
    }

    loadSettings()

    const handler = (event: any) => {
      const detail = event && event.detail
      if (detail) {
        if (typeof detail.systemName === 'string') {
          setSystemName(detail.systemName || 'AI-Server')
        }
        if (detail.modules && detail.modules.n8n && typeof detail.modules.n8n.enabled === 'boolean') {
          setN8nEnabled(detail.modules.n8n.enabled)
        }
        if (
          detail.modules &&
          detail.modules.oneapi &&
          typeof detail.modules.oneapi.enabled === 'boolean'
        ) {
          setOneapiEnabled(detail.modules.oneapi.enabled)
        }
      } else {
        loadSettings()
      }
    }

    window.addEventListener('appSettingsUpdated', handler as EventListener)

    return () => {
      cancelled = true
      window.removeEventListener('appSettingsUpdated', handler as EventListener)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const modules = await window.api.listModules()
        if (cancelled || !Array.isArray(modules)) return
        const next = {
          n8n: false,
          dify: false,
          oneapi: false,
          ragflow: false,
        }
        for (const m of modules) {
          if (m && m.id && m.status === 'running') {
            next[m.id] = true
          }
        }
        const prevRunning = runningModulesRef.current
        runningModulesRef.current = next
        setRunningModules(next)

        if (!runningModulesInitializedRef.current) {
          // 第一次只记录基线状态，不触发 30 秒提示
          runningModulesInitializedRef.current = true
        } else {
          const startedNow: ('n8n' | 'dify' | 'oneapi' | 'ragflow')[] = []
          if (!prevRunning.n8n && next.n8n) startedNow.push('n8n')
          if (!prevRunning.dify && next.dify) startedNow.push('dify')
          if (!prevRunning.oneapi && next.oneapi) startedNow.push('oneapi')
          if (!prevRunning.ragflow && next.ragflow) startedNow.push('ragflow')

          if (startedNow.length > 0) {
            const now = Date.now()
            setRecentlyStartedModules((prev) => {
              const updated = { ...prev }
              for (const id of startedNow) {
                updated[id] = now
              }
              return updated
            })
          }
        }
      } catch {
        if (!cancelled) {
          setRunningModules({
            n8n: false,
            dify: false,
            oneapi: false,
            ragflow: false,
          })
        }
      }
    }

    load()
    const timer = window.setInterval(load, 10000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const TTL = 30_000
      setRecentlyStartedModules((prev) => {
        const now = Date.now()
        let changed = false
        const next = { ...prev }
        ;(['n8n', 'dify', 'oneapi', 'ragflow'] as const).forEach((id) => {
          const ts = prev[id]
          if (ts && now - ts > TTL) {
            next[id] = 0
            changed = true
          }
        })
        return changed ? next : prev
      })
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!currentModuleId) {
      setCurrentModuleMetrics(null)
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        const result = await window.api.getModuleMetrics()
        if (cancelled || !result || !Array.isArray(result.items)) return
        const item = result.items.find((m) => m && m.moduleId === currentModuleId)
        if (!item) {
          setCurrentModuleMetrics(null)
          return
        }
        setCurrentModuleMetrics({
          cpuUsage: item.cpuUsage ?? null,
          memoryUsage: item.memoryUsage ?? null,
        })
      } catch {
        if (!cancelled) {
          setCurrentModuleMetrics(null)
        }
      }
    }

    load()
    const timer = window.setInterval(load, 5000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [currentModuleId])

  useEffect(() => {
    const prevExpanded = prevModuleTabsExpandedRef.current
    const justExpanded = !prevExpanded && moduleTabsExpanded
    prevModuleTabsExpandedRef.current = moduleTabsExpanded

    if (justExpanded && currentModuleId) {
      // 仅在从收起 → 展开这一刻，根据当前可见模块生成一次展开态的顺序：严格按 moduleTabOrder 的既有顺序
      setExpandedModuleOrder((prev) => {
        if (prev) return prev
        const base = moduleTabOrder.filter((id) => isModuleVisible(id) || id === currentModuleId)
        if (!base.length) return prev
        return base
      })

      // 用户在展开态已经看到所有模块标签一次了，30 秒新启动提示可以视为已“读过”，收起后不再额外保留
      setRecentlyStartedModules((prev) => {
        const hasNonZero = prev.n8n || prev.dify || prev.oneapi || prev.ragflow
        if (!hasNonZero) return prev
        return {
          n8n: 0,
          dify: 0,
          oneapi: 0,
          ragflow: 0,
        }
      })
    } else if (!moduleTabsExpanded) {
      setExpandedModuleOrder(null)
    }
  }, [moduleTabsExpanded, currentModuleId, moduleTabOrder, n8nEnabled, oneapiEnabled, runningModules])

  return (
    <div
      className={cn(
        'min-h-screen bg-background text-foreground transition-colors duration-300',
        'dark:bg-slate-950 dark:text-slate-50',
      )}
    >
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),transparent_55%),radial-gradient(circle_at_bottom,_rgba(56,189,248,0.16),transparent_55%)] dark:hidden" />
      <div className="pointer-events-none fixed inset-0 hidden bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),transparent_55%),radial-gradient(circle_at_bottom,_rgba(59,130,246,0.32),transparent_55%)] dark:block" />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="fixed inset-x-0 top-0 z-30 h-14 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
          <div className="flex h-full w-full items-center gap-4 px-4">
            <button
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-sm font-semibold text-slate-50 shadow-sm lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-primary/80 text-xs font-bold">AI</span>
              <span>菜单</span>
            </button>

            <div className="hidden items-center gap-2 lg:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 via-sky-500 to-blue-600 text-white shadow-md shadow-sky-300/60 dark:from-sky-500 dark:via-sky-600 dark:to-blue-700">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">{systemName || 'AI-Server'}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">AI 服务管理平台</div>
              </div>
            </div>

            <div className="flex flex-1 items-center gap-3">
              <nav className="hidden items-center lg:flex">
                <div
                  className={cn(
                    'flex items-center gap-1 rounded-full border border-white/60 bg-white/80 p-1 text-xs font-medium text-slate-600 shadow-sm shadow-black/5 backdrop-blur-xl transition-all duration-150 dark:border-white/15 dark:bg-slate-900/70 dark:text-slate-200',
                    isModuleRoute && moduleTabsExpanded && 'shadow-[0_1px_6px_rgba(15,23,42,0.28)]',
                  )}
                  onMouseEnter={() => {
                    setModuleTabsExpanded(true)
                  }}
                  onMouseLeave={() => {
                    // 离开区域时一律收起，避免边界情况下不收起
                    setModuleTabsExpanded(false)
                  }}
                >
                  <NavLink
                    key="dashboard"
                    to="/"
                    className={cn(
                      'group flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150',
                      location.pathname === '/'
                        ? 'bg-white text-slate-900 shadow-[0_1px_4px_rgba(15,23,42,0.22)] ring-1 ring-sky-200/80 dark:bg-slate-100 dark:text-slate-900 dark:ring-sky-300/70'
                        : 'text-slate-600/80 hover:bg-white/40 hover:text-slate-900 dark:text-slate-300/80 dark:hover:bg-slate-800/70 dark:hover:text-slate-50',
                    )}
                  >
                    <span>首页</span>
                  </NavLink>

                  {(() => {
                    if (!isModuleRoute || !currentModuleId) {
                      const visible = moduleTabOrder.filter((id) => isModuleVisible(id))
                      return visible.map((id) => {
                        const path = `/${id}`
                        const isActive = location.pathname.startsWith(path)
                        const status: ServiceStatus = runningModules[id] ? 'running' : 'stopped'
                        return (
                          <NavLink
                            key={id}
                            to={path}
                            onClick={() => {
                              // 从首页点击模块标签时，提前将模块标签栏视为“展开”，避免跳转到模块路由首帧先渲染折叠态造成的闪烁
                              setModuleTabsExpanded(true)
                            }}
                            className={cn(
                              'group flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150',
                              isActive
                                ? 'bg-white text-slate-900 shadow-[0_1px_4px_rgba(15,23,42,0.22)] ring-1 ring-sky-200/80 dark:bg-slate-100 dark:text-slate-900 dark:ring-sky-300/70'
                                : 'text-slate-600/80 hover:bg-white/40 hover:text-slate-900 dark:text-slate-300/80 dark:hover:bg-slate-800/70 dark:hover:text-slate-50',
                            )}
                          >
                            <StatusDot status={status} />
                            <span>{getModuleLabel(id)}</span>
                          </NavLink>
                        )
                      })
                    }

                    // 模块模式
                    const baseVisible = moduleTabOrder.filter((id) => isModuleVisible(id) || id === currentModuleId)
                    const tipModules = moduleTabOrder.filter(
                      (id) =>
                        id !== currentModuleId &&
                        isModuleVisible(id) &&
                        recentlyStartedModules[id] &&
                        recentlyStartedModules[id] > 0,
                    )

                    if (!moduleTabsExpanded) {
                      const collapsedIds: ('n8n' | 'dify' | 'oneapi' | 'ragflow')[] = []
                      if (currentModuleId) {
                        collapsedIds.push(currentModuleId)
                      }
                      for (const id of tipModules) {
                        if (!collapsedIds.includes(id)) {
                          collapsedIds.push(id)
                        }
                      }
                      return collapsedIds.map((id) => {
                        const path = `/${id}`
                        const isActive = currentModuleId === id
                        const status: ServiceStatus = runningModules[id] ? 'running' : 'stopped'
                        return (
                          <button
                            key={id}
                            type="button"
                            className={cn(
                              'group flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150',
                              isActive
                                ? 'bg-white text-slate-900 shadow-[0_1px_4px_rgba(15,23,42,0.22)] ring-1 ring-sky-200/80 dark:bg-slate-100 dark:text-slate-900 dark:ring-sky-300/70'
                                : 'text-slate-600/80 hover:bg-white/40 hover:text-slate-900 dark:text-slate-300/80 dark:hover:bg-slate-800/70 dark:hover:text-slate-50',
                            )}
                            onClick={() => {
                              navigate(path)
                              try {
                                window.api.openModuleView(id).catch(() => {})
                              } catch {
                              }
                            }}
                          >
                            <StatusDot status={status} />
                            <span>{getModuleLabel(id)}</span>
                          </button>
                        )
                      })
                    }

                    const orderForExpanded =
                      expandedModuleOrder && expandedModuleOrder.length > 0
                        ? expandedModuleOrder
                        : baseVisible

                    return orderForExpanded.map((id) => {
                      if (!baseVisible.includes(id)) return null
                      const path = `/${id}`
                      const isActive = currentModuleId === id
                      const status: ServiceStatus = runningModules[id] ? 'running' : 'stopped'
                      return (
                        <button
                          key={id}
                          type="button"
                          draggable
                          onDragStart={() => setDraggingModuleKey(id)}
                          onDragOver={(e) => {
                            e.preventDefault()
                            if (draggingModuleKey) {
                              reorderModuleTabs(draggingModuleKey, id)
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            setDraggingModuleKey(null)
                          }}
                          onDragEnd={() => {
                            setDraggingModuleKey(null)
                          }}
                          className={cn(
                            'group flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150',
                            isActive
                              ? 'bg-white text-slate-900 shadow-[0_1px_4px_rgba(15,23,42,0.22)] ring-1 ring-sky-200/80 dark:bg-slate-100 dark:text-slate-900 dark:ring-sky-300/70'
                              : 'text-slate-600/80 hover:bg-white/40 hover:text-slate-900 dark:text-slate-300/80 dark:hover:bg-slate-800/70 dark:hover:text-slate-50',
                          )}
                          onClick={() => {
                            navigate(path)
                            try {
                              window.api.openModuleView(id).catch(() => {})
                            } catch {
                            }
                          }}
                        >
                          <StatusDot status={status} />
                          <span>{getModuleLabel(id)}</span>
                        </button>
                      )
                    })
                  })()}
                </div>
              </nav>

              {isModuleRoute && !moduleTabsExpanded && currentModuleId && (
                <div className="hidden items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-[11px] text-slate-600 shadow-sm shadow-black/5 backdrop-blur-md dark:bg-slate-900/80 dark:text-slate-200 lg:flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/80"
                    onClick={() => handleModuleControlClick('home')}
                  >
                    <Home className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/80"
                    onClick={() => handleModuleControlClick('reload')}
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/80"
                    onClick={() => handleModuleControlClick('back')}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/80"
                    onClick={() => handleModuleControlClick('forward')}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                  <span className="mx-1 whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">
                    {currentModuleMetrics
                      ? `CPU ${formatPercent(currentModuleMetrics.cpuUsage)} · 内存 ${formatPercent(
                          currentModuleMetrics.memoryUsage,
                        )}`
                      : 'CPU — · 内存 —'}
                  </span>
                  <span className="whitespace-nowrap text-[11px] text-slate-400 dark:text-slate-500">
                    xx 条任务运行中
                  </span>
                </div>
              )}
            </div>

            <div className="ml-auto flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="切换主题"
                onClick={toggleTheme}
              >
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4 text-amber-300" />
                ) : (
                  <Moon className="h-4 w-4 text-slate-700" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                shine
                aria-label="全局设置"
                onClick={() => {
                  setMobileOpen(false)
                  navigate('/settings')
                }}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
              <GlassCard className="flex items-center gap-2 rounded-full px-2 py-1.5">
                <Avatar className="h-7 w-7 text-[11px]">TS</Avatar>
                <div className="hidden flex-col leading-tight sm:flex">
                  <span className="text-xs font-medium text-slate-900">terry</span>
                  <span className="text-[10px] text-slate-500">本地工作区</span>
                </div>
              </GlassCard>
            </div>
          </div>
        </header>

        <div className="flex flex-1 pt-14">
          {!isModuleRoute && (
            <aside className="fixed bottom-4 left-4 top-20 z-20 hidden w-60 lg:block">
              <GlassCard className="flex h-full flex-col rounded-2xl p-3 text-sm text-slate-800 dark:text-slate-200">
                <div className="mb-2 flex items-center justify-between px-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">导航</div>
                    <div className="text-[11px] text-slate-500">{(systemName || 'AI-Server') + ' 控制中心'}</div>
                  </div>
                  <StatusDot status="running" />
                </div>
                <nav className="mt-3 text-xs">
                  <div className="flex flex-col gap-1 rounded-2xl border border-white/15 bg-white/5 p-1 font-medium shadow-sm shadow-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-200">
                    <SideNavItem icon={LayoutDashboard} label="仪表盘" to="/" activePaths={['/']} />
                    <SideNavItem icon={BookOpenText} label="在线教程" to="/tutorial" />
                    <SideNavItem icon={Store} label="AI 市场" to="/market" />
                    <SideNavItem icon={Settings2} label="系统设置" to="/settings" />
                    <SideNavItem icon={TerminalSquare} label="系统日志" to="/logs" />
                    <SideNavItem icon={Activity} label="性能监控" to="/monitoring" />
                  </div>
                </nav>
              </GlassCard>
            </aside>
          )}

          {mobileOpen && (
            <div className="fixed inset-0 z-20 flex lg:hidden">
              <div className="pointer-events-auto flex w-64 flex-col bg-white/95 px-3 pb-4 pt-20 text-slate-800 shadow-xl shadow-black/40 dark:bg-slate-900/95 dark:text-slate-200">
                <nav className="text-sm text-slate-800 dark:text-slate-200">
                  <div className="mt-2 flex flex-col gap-1 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-1 font-medium shadow-sm shadow-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/40">
                    <SideNavItem icon={LayoutDashboard} label="仪表盘" to="/" onClick={() => setMobileOpen(false)} />
                    <SideNavItem icon={BookOpenText} label="在线教程" to="/tutorial" onClick={() => setMobileOpen(false)} />
                    <SideNavItem icon={Store} label="AI 市场" to="/market" onClick={() => setMobileOpen(false)} />
                    <SideNavItem icon={Settings2} label="系统设置" to="/settings" onClick={() => setMobileOpen(false)} />
                    <SideNavItem icon={TerminalSquare} label="系统日志" to="/logs" onClick={() => setMobileOpen(false)} />
                    <SideNavItem icon={Activity} label="性能监控" to="/monitoring" onClick={() => setMobileOpen(false)} />
                  </div>
                </nav>
              </div>
              <div className="flex-1 bg-slate-900/20 dark:bg-slate-950/60" onClick={() => setMobileOpen(false)} />
            </div>
          )}

          <main
            className={cn(
              'relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-6 pt-4',
              !isModuleRoute && 'lg:pl-72',
            )}
          >
            <div className="space-y-4">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

interface SideNavItemProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  to: string
  activePaths?: string[]
  onClick?: () => void
}

function SideNavItem({ icon: Icon, label, to, activePaths, onClick }: SideNavItemProps) {
  const location = useLocation()
  const isActive = activePaths?.includes(location.pathname) ?? location.pathname === to

  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-150',
        isActive
          ? 'bg-white text-slate-900 shadow-[0_1px_4px_rgba(15,23,42,0.22)] ring-1 ring-sky-200/80 dark:bg-slate-100 dark:text-slate-900 dark:ring-sky-300/70'
          : 'text-slate-600/80 hover:bg-white/40 hover:text-slate-900 dark:text-slate-300/80 dark:hover:bg-slate-800/80 dark:hover:text-slate-50',
      )}
    >
      <span
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs transition-colors',
          isActive
            ? 'bg-sky-500 text-white dark:bg-sky-400 dark:text-slate-900'
            : 'bg-slate-100 text-slate-600 dark:bg-slate-900/70 dark:text-slate-300',
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span>{label}</span>
    </NavLink>
  )
}
