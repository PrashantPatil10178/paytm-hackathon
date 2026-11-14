// Everything CopilotKit, in one lazily loaded chunk: the provider, the tools and cards Aria can
// use, and the panel. Layout mounts it on first open and keeps it mounted (hidden when closed),
// so the conversation survives closing the panel.
import { CopilotKitProvider } from '@copilotkit/react-core/v2'
import '@copilotkit/react-core/v2/styles.css'
import AriaTools from './tools'
import ChatPanel from './ChatPanel'

// Vite proxies /api/copilotkit to the runtime in apps/copilot (:4100), so the browser stays same-origin.
const RUNTIME_URL = new URL('/api/copilotkit', window.location.origin).href

export default function AskAria({ open, onClose }) {
  return (
    <CopilotKitProvider runtimeUrl={RUNTIME_URL} enableInspector={false} showDevConsole={false}>
      <AriaTools />
      <ChatPanel open={open} onClose={onClose} />
    </CopilotKitProvider>
  )
}
