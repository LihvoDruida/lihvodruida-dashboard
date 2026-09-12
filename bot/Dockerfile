# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Mistblossom Vanguard — Discord-бот.
#
# Контекст збірки — корінь репозиторію, бо образ несе і бота (bot/), і спільний
# контракт (shared/). Контракт має лишатись однією копією: якщо бот і панель
# почнуть по-різному розбирати custom_id, кнопки мовчки перестануть працювати.
#
# Зовнішніх залежностей немає — тільки локальний file:../shared. Тому в образі
# ні npm ci з реєстру, ні зайвих пакетів: лише вихідний код на runtime-базі.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=24-bookworm-slim
FROM node:${NODE_VERSION}

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    TZ=Europe/Kyiv

WORKDIR /app

COPY shared ./shared
COPY bot/package.json bot/package-lock.json ./bot/
COPY bot/src ./bot/src

WORKDIR /app/bot
# Єдина залежність — локальний пакет, тому це просто створення симлінка.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --no-audit --no-fund

# Не працюємо від root: у бота є вихідна мережа до Discord і до панелі,
# зайвих прав йому мати не треба.
USER node

EXPOSE 8080

# Перевірка живості локальна: контейнер має вважатись здоровим навіть тоді,
# коли Discord недоступний — інакше збій на їхньому боці класифікується як
# наш і перезапускає бота по колу.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
