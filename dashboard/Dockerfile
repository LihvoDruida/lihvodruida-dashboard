# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Mistblossom Vanguard — образ панелі.
#
# КОНТЕКСТ ЗБІРКИ — КОРІНЬ РЕПОЗИТОРІЮ, бо панелі потрібен спільний пакет
# `shared/` з контрактом Discord custom_id. Тому в docker-compose стоїть
# `context: .` і `dockerfile: dashboard/Dockerfile`.
#
# Три стадії, щоб у фінальний образ не потрапили ні devDependencies, ні
# вихідний код: збирається `output: "standalone"`, і копіюється лише він.
# Готовий образ важить приблизно 250 МБ проти ~1.6 ГБ, якби ми несли
# все дерево node_modules.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=24-bookworm-slim
# Pinned security overlay. package-lock stays the reproducible baseline, then
# the production image replaces only Next.js with the currently approved
# patched release before build. CI below verifies that the overlay happened.
ARG NEXT_SECURITY_VERSION=16.3.5

# --- 1. Залежності -----------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
ARG NEXT_SECURITY_VERSION
WORKDIR /repo/dashboard

# Локальний vendor-пакет підміняє node-domexception (див. overrides у
# package.json), а `shared/` — це залежність file:../shared. Обидва потрібні
# ще до npm ci, інакше встановлення впаде на нерозвʼязаному посиланні.
COPY shared /repo/shared
COPY dashboard/package.json dashboard/package-lock.json ./
COPY dashboard/vendor ./vendor

# npm ci відтворює lock-файл байт у байт. `--ignore-scripts` не ставимо:
# sharp качає нативний бінарник саме в postinstall.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund \
    && npm install --no-save --package-lock=false --no-audit --no-fund "next@${NEXT_SECURITY_VERSION}" \
    && node -e "const v=require('next/package.json').version; const e=process.argv[1]; if(v!==e) throw new Error('Next security overlay failed: '+v+' != '+e)" "${NEXT_SECURITY_VERSION}"

# --- 2. Збірка ---------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
ARG NEXT_SECURITY_VERSION
WORKDIR /repo/dashboard

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV MISTBLOSSOM_EXPECTED_NEXT_VERSION=${NEXT_SECURITY_VERSION}

# Build preset for a 2-vCPU / 4-GB VPS.  The heap cap prevents a Next/Turbopack
# build from pushing the host into heavy swap, which is much slower than a
# slightly earlier GC cycle. Both values are overridable from compose/.env.
ARG NEXT_BUILD_CPUS=2
ARG NODE_BUILD_MEMORY_MB=2560
ENV NEXT_BUILD_CPUS=${NEXT_BUILD_CPUS}
ENV NODE_OPTIONS=--max-old-space-size=${NODE_BUILD_MEMORY_MB}

# shared/ приїжджає першим: на нього вказує символьне посилання всередині
# node_modules, і без нього резолвер Turbopack не знайде контракт.
COPY --from=deps /repo/shared /repo/shared
COPY --from=deps /repo/dashboard/node_modules ./node_modules
COPY dashboard/ ./

# CI scheduling audit also verifies the real VPS cron endpoint. The dashboard
# build context is the repository root, but files are not present in a stage
# until they are explicitly copied. Copy only this non-secret deployment
# script for build-time validation; it is not copied into the runtime image.
COPY deploy/cron/run-cron.sh /repo/deploy/cron/run-cron.sh
COPY deploy/nginx/nginx.conf /repo/deploy/nginx/nginx.conf
COPY deploy/nginx/dashboard.conf /repo/deploy/nginx/dashboard.conf
COPY deploy/nginx/proxy-params.inc /repo/deploy/nginx/proxy-params.inc
COPY deploy/nginx/proxy-params-fast.inc /repo/deploy/nginx/proxy-params-fast.inc

# Source-level security/performance audit reads a small set of root deployment
# manifests. They are explicit builder-only inputs; none is copied to runtime.
# Keeping the list explicit avoids sending secrets while making build:ci see the
# same compose/.dockerignore policy that is actually deployed on the VPS.
COPY docker-compose.yml /repo/docker-compose.yml
COPY .env.example /repo/.env.example
COPY .dockerignore /repo/.dockerignore

# The shared site footer shows the bot package version, and its CI invariant also
# checks that the bot health endpoint exposes the same package version. These two
# non-secret source files are therefore explicit build-time inputs of the dashboard.
# They are used only by TypeScript/CI/Next build and are not copied to runner.
COPY bot/package.json /repo/bot/package.json
COPY bot/src/server.mjs /repo/bot/src/server.mjs

# Змінні, які Next вшиває у клієнтський бандл на етапі збірки.
# Решта конфігурації читається під час старту з оточення контейнера.
ARG NEXT_PUBLIC_DASHBOARD_URL
ENV NEXT_PUBLIC_DASHBOARD_URL=${NEXT_PUBLIC_DASHBOARD_URL}

# Перед Next build проганяємо typecheck + перевірки API/page/button/import контрактів.
RUN --mount=type=cache,target=/repo/dashboard/.next/cache,sharing=locked \
    npm run build:ci

# --- 3. Runtime --------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Непривілейований користувач: контейнер не має причин працювати від root.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# public і .next/static standalone-збірка не копіює — їх треба покласти руками.
#
# Через outputFileTracingRoot = корінь репозиторію дерево standalone має
# зайвий рівень: усе лежить у .next/standalone/dashboard/, а не в корені
# standalone. Тому після копіювання структура в образі така:
#
#   /app/dashboard/server.js      ← точка входу
#   /app/dashboard/node_modules
#   /app/dashboard/.next
#   /app/dashboard/public         ← сервер шукає статику ПОРУЧ із server.js
#   /app/dashboard/.next/static
#
# Пакет shared/ окремо копіювати не треба: контракт інлайниться у серверний
# бандл на етапі збірки. У стадії deps він потрібен лише для npm ci, бо
# package.json посилається на нього як file:../shared.
#
# Саме тому public кладеться в ./dashboard/public, а не в ./public: у корінь
# сервер не заглядає, і всі зображення й іконки віддавали б 404.
COPY --from=builder --chown=nextjs:nodejs /repo/dashboard/.next/standalone/ ./
COPY --from=builder --chown=nextjs:nodejs /repo/dashboard/public ./dashboard/public
COPY --from=builder --chown=nextjs:nodejs /repo/dashboard/.next/static ./dashboard/.next/static

# Обслуговчі скрипти й схема бази. Standalone-збірка їх не тягне (вони не
# імпортуються з застосунку), а без них `docker compose exec dashboard node
# dashboard/scripts/db-init.mjs` падає з MODULE_NOT_FOUND. Кілька кілобайт,
# але позбавляє потреби мати чекаут репозиторію поруч із контейнером.
# Runtime gets only the maintenance entrypoints actually invoked on the VPS;
# CI/audit/build scripts stay in the builder stage and never reach production.
COPY --from=builder --chown=nextjs:nodejs /repo/dashboard/scripts/db-init.mjs ./dashboard/scripts/db-init.mjs
COPY --from=builder --chown=nextjs:nodejs /repo/dashboard/scripts/discord-storage-diagnose.mjs ./dashboard/scripts/discord-storage-diagnose.mjs
COPY --from=builder --chown=nextjs:nodejs /repo/dashboard/scripts/migrate-firestore-to-postgres.mjs ./dashboard/scripts/migrate-firestore-to-postgres.mjs
COPY --from=builder --chown=nextjs:nodejs /repo/dashboard/src/lib/db/schema.sql ./dashboard/src/lib/db/schema.sql

USER nextjs
EXPOSE 3000

# Перевірка живості: цей роут не ходить у базу і не потребує сесії.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Точка входу — dashboard/server.js, а не server.js: див. пояснення про
# зайвий рівень у дереві standalone вище.
CMD ["node", "dashboard/server.js"]
