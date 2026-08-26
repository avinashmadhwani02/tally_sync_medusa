# Build context is the repo root:
#   docker build -f apps/medusa/Dockerfile .
#
# The Medusa backend (`@tally-sync/medusa`) is an npm-workspace member, so we
# install at the repo root. `medusa build` compiles the server + admin into
# .medusa/. Prisma generate needs the schema present before/after install.

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

# Electron is a desktop workspace dep; skip its binary in this image.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN npm ci --include-workspace-root

COPY . .

RUN npm run prisma:generate -w @tally-sync/medusa \
    && npm run build -w @tally-sync/medusa

# ---- runtime: run the compiled Medusa server ----
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=9000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/apps/medusa ./apps/medusa

WORKDIR /app/apps/medusa
EXPOSE 9000
CMD ["sh", "-c", "npx medusa db:migrate && npm run start"]
