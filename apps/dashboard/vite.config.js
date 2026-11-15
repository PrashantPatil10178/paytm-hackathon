import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Port 3004 sits next to the demo apps (Zendesk 3001, HubSpot 3002, ShopKart 3003).
const port = Number(process.env.PORT) || 3004
// Proxied so the browser stays same-origin. Order matters: the first matching prefix wins.
const proxy = {
  // Ask Aria's CopilotKit runtime (apps/copilot)
  '/api/copilotkit': process.env.COPILOT_URL || 'http://localhost:4100',
  // The demo API (apps/api), like the demo apps' servers: /api/x → API_URL/x
  '/api': {
    target: process.env.API_URL || 'http://localhost:4000',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port, strictPort: true, proxy },
  // Deployed behind a proxy on its own domain: listen on every interface and accept any Host.
  preview: { port, strictPort: true, proxy, host: true, allowedHosts: true },
})
