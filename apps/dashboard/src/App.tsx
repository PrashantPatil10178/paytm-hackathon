import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppProvider } from './store'
import Layout from './components/Layout'
import Home from './pages/Home'
import Analytics from './pages/Analytics'
import Campaigns from './pages/Campaigns'
import Calls from './pages/Calls'
import SalesAnalytics from './pages/SalesAnalytics'
import Audit from './pages/Audit'
import Tickets from './pages/Tickets'
import Conversations from './pages/Conversations'
import Approvals from './pages/Approvals'
import Board from './pages/Board'
import Leads from './pages/Leads'
import Channels from './pages/Channels'
import Connectors from './pages/Connectors'
import Settings from './pages/Settings'

// Routes are grouped into areas (Home, Support, Sales, Connect, Aria) in src/nav.ts.
export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="conversations" element={<Conversations />} />
            <Route path="board" element={<Board />} />
            <Route path="leads" element={<Leads />} />
            <Route path="calls" element={<Calls />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="sales/analytics" element={<SalesAnalytics />} />
            <Route path="channels" element={<Channels />} />
            <Route path="connectors" element={<Connectors />} />
            <Route path="settings" element={<Settings />} />
            <Route path="audit" element={<Audit />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
