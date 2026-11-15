# One image for every service; docker-compose.yml picks the app with working_dir + command.
FROM oven/bun:1.4.4
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

# The Control Room links to the other apps; Vite bakes these in at build time.
ARG VITE_ZENDESK_URL
ARG VITE_HUBSPOT_URL
ARG VITE_SHOP_URL
ARG VITE_AGENT_URL
RUN cd apps/dashboard && bun --bun run build

ENV NODE_ENV=production
