import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LucideProvider } from 'lucide-react'
import './index.css'
import App from './App'
import { ThemeProvider } from './theme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      {/* Thin 1.5 strokes across every icon, matching the reference dashboards. */}
      <LucideProvider strokeWidth={1.5}>
        <App />
      </LucideProvider>
    </ThemeProvider>
  </StrictMode>,
)
