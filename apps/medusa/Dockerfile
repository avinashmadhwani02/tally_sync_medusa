# Build context is the repo root:
#   docker build -f apps/medusa/Dockerfile .
#
# Medusa v2 production runs from `.medusa/server` after `medusa build`
# (admin lives in public/admin inside that directory).

# ---- base: deps required at runtime and for prisma (glibc + openssl) ----
FROM node:22-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---- builder: full install (dev deps needed for `medusa build`) ----
FROM base AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/medusa/package.json apps/medusa/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/sync/package.json apps/sync/package.json
COPY apps/medusa/prisma apps/medusa/prisma

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN npm ci --include-workspace-root

COPY . .

RUN npm run prisma:generate -w @tally-sync/medusa \
    && npm run build -w @tally-sync/medusa \
    && cp -r apps/medusa/src/generated apps/medusa/.medusa/server/src/generated \
    && cp -r apps/medusa/prisma apps/medusa/.medusa/server/prisma

# ---- runtime: serve the standalone Medusa build ----
FROM base AS runtime
WORKDIR /app

COPY --from=builder /app/apps/medusa/.medusa/server ./

RUN npm install --omit=dev

ENV NODE_ENV=production \
    PORT=9000 \
    DISABLE_MEDUSA_ADMIN=false

EXPOSE 9000
CMD ["sh", "-c", "npx medusa db:migrate && npm run start"]
