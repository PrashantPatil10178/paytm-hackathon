import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppProvider } from './store'
import Layout from './components/Layout'
import Home from './pages/Home'
import Analytics from './pages/Analytics'
import Campaigns from './pages/Campaigns'
import Audit from './pages/Audit'
import Tickets from './pages/Tickets'
import Approvals from './pages/Approvals'
import Board from './pages/Board'
import Channels from './pages/Channels'
import Connectors from './pages/Connectors'
import Settings from './pages/Settings'

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="audit" element={<Audit />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="board" element={<Board />} />
            <Route path="channels" element={<Channels />} />
            <Route path="connectors" element={<Connectors />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
