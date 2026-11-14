import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Port 3004 sits next to the demo apps (Zendesk 3001, HubSpot 3002, ShopKart 3003).
const port = Number(process.env.PORT) || 3004
// Ask Aria's CopilotKit runtime (apps/copilot). Proxied so the browser stays same-origin.
const proxy = { '/api/copilotkit': process.env.COPILOT_URL || 'http://localhost:4100' }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port, strictPort: true, proxy },
  preview: { port, strictPort: true, proxy },
})
