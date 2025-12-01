import { Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'

import { AppLayout } from '@/layouts/AppLayout'
import { DashboardPage } from '@/pages/Dashboard'
import { SettingsPage } from '@/pages/Settings'
import { LogsPage } from '@/pages/Logs'
import { MonitoringPage } from '@/pages/Monitoring'
import { TutorialPage } from '@/pages/Tutorial'
import { MarketPage } from '@/pages/Market'
import { N8nModulePage } from '@/pages/ModuleN8n'
import { DifyModulePage } from '@/pages/ModuleDify'
import { OneApiModulePage } from '@/pages/ModuleOneApi'
import { RagFlowModulePage } from '@/pages/ModuleRagFlow'
import { BrowserAgentPage } from '@/pages/BrowserAgent'

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="monitoring" element={<MonitoringPage />} />
          <Route path="tutorial" element={<TutorialPage />} />
          <Route path="market" element={<MarketPage />} />
          <Route path="n8n" element={<N8nModulePage />} />
          <Route path="dify" element={<DifyModulePage />} />
          <Route path="oneapi" element={<OneApiModulePage />} />
          <Route path="ragflow" element={<RagFlowModulePage />} />
          <Route path="browser-agent" element={<BrowserAgentPage />} />
        </Route>
      </Routes>
      <Toaster position="top-right" richColors closeButton />
    </>
  )
}

export default App
