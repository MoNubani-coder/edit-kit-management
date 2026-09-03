# =============================================================================
# Edit Kit Management System - production image
# =============================================================================
# Multi-stage build producing a minimal, non-root runtime image from Next.js
# `output: 'standalone'`.
#
# Build from the repository root:
#   docker build -f docker/Dockerfile -t ekms:latest .
# =============================================================================

# --- Stage 1: dependencies ---------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app

# libc6-compat is required by some native Node addons on Alpine.
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci


# --- Stage 2: build ----------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The Prisma client must be generated before the Next.js build type-checks the
# code that imports it.
RUN npx prisma generate

# A build-time placeholder: env.ts validates at import time, and the build
# imports server modules. Real values are injected at runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV AUTH_SECRET="build-time-placeholder-secret-value-32chars-min"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build


# --- Stage 3: runtime --------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as an unprivileged user. `node` (uid 1000) already exists in the base image.
RUN mkdir -p /app/storage && chown -R node:node /app

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Prisma CLI + schema, so migrations can be applied from this image:
#   docker compose exec app npx prisma migrate deploy
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=node:node /app/node_modules/.bin ./node_modules/.bin

USER node

EXPOSE 3000

# Signature images and issue photos live here. MUST be a mounted volume -
# without one, every redeploy destroys signed handover evidence.
VOLUME ["/app/storage"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
