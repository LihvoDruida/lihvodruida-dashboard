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

# --- 1. Залежності -----------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /repo/dashboard

# Локальний vendor-пакет підміняє node-domexception (див. overrides у
# package.json), а `shared/` — це залежність file:../shared. Обидва потрібні
# ще до npm ci, інакше встановлення впаде на нерозвʼязаному посиланні.
COPY shared /repo/shared
COPY dashboard/package.json dashboard/package-lock.json ./
COPY dashboard/vendor ./vendor

# npm ci відтворює lock-файл байт у байт. `--ignore-scripts` не ставимо:
# sharp качає нативний бінарник саме в postinstall.
RUN npm ci --no-audit --no-fund

# --- 2. Збірка ---------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /repo/dashboard

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# shared/ приїжджає першим: на нього вказує символьне посилання всередині
# node_modules, і без нього резолвер Turbopack не знайде контракт.
COPY --from=deps /repo/shared /repo/shared
COPY --from=deps /repo/dashboard/node_modules ./node_modules
COPY dashboard/ ./

# Змінні, які Next вшиває у клієнтський бандл на етапі збірки.
# Решта конфігурації читається під час старту з оточення контейнера.
ARG NEXT_PUBLIC_DASHBOARD_URL
ENV NEXT_PUBLIC_DASHBOARD_URL=${NEXT_PUBLIC_DASHBOARD_URL}

RUN npm run build

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
# Через outputFileTracingRoot = корінь репозиторію standalone складається
# у .next/standalone/dashboard, а спільний пакет — у .next/standalone/shared.
COPY --from=builder --chown=nextjs:nodejs /repo/dashboard/public ./public
COPY --from=builder --chown=nextjs:nodejs /repo/dashboard/.next/standalone/ ./
COPY --from=builder --chown=nextjs:nodejs /repo/dashboard/.next/static ./dashboard/.next/static

USER nextjs
EXPOSE 3000

# Перевірка живості: цей роут не ходить у Firebase і не потребує сесії.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
