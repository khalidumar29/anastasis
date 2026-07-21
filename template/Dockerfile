# FROZEN — production image build. Codex may not edit this file. Built by
# Kaniko (orchestrator/lib/pipeline/deploy.ts), not a local Docker daemon.
#
# node:20-slim (glibc), not alpine, so better-sqlite3's prebuilt native
# binary matches without extra toolchain work in the common case; build
# tools are still installed in `deps` as a fallback for platforms without a
# prebuilt binary.

FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system anastasis && useradd --system --gid anastasis anastasis \
  && mkdir -p /app/data && chown -R anastasis:anastasis /app/data
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/db ./db
# The build already ran db:init + migrate (build.ts verifies this before the
# image is ever built), so the migrated data/app.db is baked in — but at
# ./seed-data, NOT ./data, because the k8s Deployment mounts an empty PVC
# over /app/data, silently shadowing anything baked there. Confirmed against
# the first real production deploy: the app came up 200 but every API call
# 500'd, because it was querying the empty volume instead of the migrated
# database. The CMD copies the seed into the volume on first start only, so
# runtime writes persist across restarts without being overwritten.
COPY --from=builder /app/data ./seed-data
RUN chown -R anastasis:anastasis /app/seed-data
USER anastasis
EXPOSE 3000
CMD ["sh", "-c", "[ -f /app/data/app.db ] || cp -r /app/seed-data/. /app/data/ 2>/dev/null; exec npx next start -p 3000"]
