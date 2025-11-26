import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, BookOpenText, Store, Settings2, Activity, TerminalSquare, Sun, Moon } from 'lucide-react'
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
  const navigate = useNavigate()

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

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
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">AI-Server</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">AI 服务管理平台</div>
              </div>
            </div>

            <nav className="hidden items-center lg:flex">
              <div className="flex items-center gap-1 rounded-full border border-white/60 bg-white/80 p-1 text-xs font-medium text-slate-600 shadow-sm shadow-black/5 backdrop-blur-xl dark:border-white/15 dark:bg-slate-900/70 dark:text-slate-200">
                {topTabs.map((tab) => {
                  const isActive = location.pathname === tab.path
                  return (
                    <NavLink
                      key={tab.key}
                      to={tab.path}
                      className={cn(
                        'group flex items-center gap-1 rounded-full px-3 py-1.5 transition-all duration-150',
                        isActive
                          ? 'bg-white text-slate-900 shadow-[0_1px_4px_rgba(15,23,42,0.22)] ring-1 ring-sky-200/80 dark:bg-slate-100 dark:text-slate-900 dark:ring-sky-300/70'
                          : 'text-slate-600/80 hover:bg-white/40 hover:text-slate-900 dark:text-slate-300/80 dark:hover:bg-slate-800/70 dark:hover:text-slate-50',
                      )}
                    >
                      {tab.status && <StatusDot status={tab.status} />}
                      <span>{tab.label}</span>
                    </NavLink>
                  )
                })}
              </div>
            </nav>

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
          <aside className="fixed bottom-4 left-4 top-20 z-20 hidden w-60 lg:block">
            <GlassCard className="flex h-full flex-col rounded-2xl p-3 text-sm text-slate-800 dark:text-slate-200">
              <div className="mb-2 flex items-center justify-between px-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">导航</div>
                  <div className="text-[11px] text-slate-500">AI-Server 控制中心</div>
                </div>
                <StatusDot status="running" />
              </div>
              <nav className="mt-3 text-xs">
                <div className="flex flex-col gap-1 rounded-2xl border border-white/15 bg-white/5 p-1 font-medium shadow-sm shadow-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-200">
                  <SideNavItem icon={LayoutDashboard} label="仪表盘" to="/" activePaths={["/"]} />
                  <SideNavItem icon={BookOpenText} label="在线教程" to="/tutorial" />
                  <SideNavItem icon={Store} label="AI 市场" to="/market" />
                  <SideNavItem icon={Settings2} label="系统设置" to="/settings" />
                  <SideNavItem icon={TerminalSquare} label="系统日志" to="/logs" />
                  <SideNavItem icon={Activity} label="性能监控" to="/monitoring" />
                </div>
              </nav>
            </GlassCard>
          </aside>

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

          <main className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-6 pt-4 lg:pl-72">
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
