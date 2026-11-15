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
import Chats from './pages/Chats'
import Conversations from './pages/Conversations'
import Approvals from './pages/Approvals'
import Board from './pages/Board'
import Leads from './pages/Leads'
import Channels from './pages/Channels'
import Connectors from './pages/Connectors'
import PhoneLine from './pages/PhoneLine'
import RequestForms from './pages/RequestForms'
import Settings from './pages/Settings'
import Policies from './pages/Policies'

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
            <Route path="chats" element={<Chats />} />
            <Route path="conversations" element={<Conversations />} />
            <Route path="board" element={<Board />} />
            <Route path="leads" element={<Leads />} />
            <Route path="calls" element={<Calls purpose="sales" />} />
            <Route path="support/calls" element={<Calls purpose="support" />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="sales/analytics" element={<SalesAnalytics />} />
            <Route path="channels" element={<Channels />} />
            <Route path="phone" element={<PhoneLine />} />
            <Route path="forms" element={<RequestForms />} />
            <Route path="connectors" element={<Connectors />} />
            <Route path="settings" element={<Settings />} />
            <Route path="policies" element={<Policies />} />
            <Route path="audit" element={<Audit />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
