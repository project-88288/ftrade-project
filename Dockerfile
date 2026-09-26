# --- Build stage: install all deps and compile TypeScript to dist/ ---
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage: production deps + compiled output only ---
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Writable data dir for the position state and trade log; run unprivileged.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

# Dashboard port (only used by the dashboard entrypoint).
EXPOSE 3000

# Default entrypoint is the trading bot; override for the dashboard, e.g.
#   docker run ... ftrade-project node dist/dashboard/run.js
CMD ["node", "dist/index.js"]
