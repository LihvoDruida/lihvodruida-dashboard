# Обхід збою Docker Hub під час отримання Node — 10.10.2026

Новий журнал підтверджує: виправлення Dockerfile frontend застосовано, але auth.docker.io продовжує повертати HTTP 500 вже під час отримання базового node:24.21.0-bookworm-slim. До npm ci і компіляції застосунків збірка не доходить.

## Зміна

Базовий образ усіх трьох стадій dashboard і єдиної стадії bot тепер за замовчуванням:

```text
public.ecr.aws/docker/library/node:24.21.0-bookworm-slim
```

Це репозиторій Docker Official Images в Amazon ECR Public. Версія Node і Debian-варіант залишилися тими самими. Реєстр задається через NODE_IMAGE_REPOSITORY в обох Dockerfile та build args обох сервісів Compose. У старій .env додавати змінну не обов’язково: без неї використовується ECR Public.

Preflight показує вибраний репозиторій Node. Збережено pull: true, BuildKit і кеші, security overlay Next 16.3.5 / React 19.2.8 / Sharp 0.35.4 та всі обмеження runtime-контейнерів. Версії інших образів не змінено.

## Запуск

Після встановлення оновлених вихідних файлів із кореня проєкту:

```bash
make up
```

Для окремої перевірки доступу з VPS:

```bash
docker pull public.ecr.aws/docker/library/node:24.21.0-bookworm-slim
```

AWS-акаунт для анонімного отримання цього публічного образу не потрібний. Якщо раніше виконували docker login public.ecr.aws і Docker повідомляє про прострочений ECR-токен, лише тоді прибери збережений ECR login:

```bash
docker logout public.ecr.aws
```

Повернути джерело Node на Docker Hub можна, встановивши NODE_IMAGE_REPOSITORY=node у .env. У такому разі запит auth.docker.io знову буде потрібний.

## Перевірка

Перевірено HTTP 200 для маніфесту потрібного тегу в ECR Public, наявність linux/amd64, linux/arm64/v8 і linux/ppc64le. Додатково завантажено конфігурацію linux/amd64: NODE_VERSION=24.21.0. Маніфест amd64 на момент перевірки: sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd.

Compose YAML розібрано; bash -n для start.sh проходить. Перевірено однаковий репозиторій в обох сервісах і його використання в усіх FROM, збереження версії Node і pull: true. Security-performance перевіряється з тими самими Next/React/Sharp overlays, які встановлює Dockerfile.

Повну Docker-збірку й запуск стеку в цьому середовищі не виконували: Docker недоступний. Доступність ECR з конкретного VPS перевіряється командою docker pull вище. Інші образи Compose залишаються з їхніх попередніх реєстрів; якщо вони відсутні локально, їх отримання також потребує доступу до відповідного реєстру.

Офіційні джерела:

- https://gallery.ecr.aws/docker/
- https://docs.aws.amazon.com/AmazonECR/latest/public/docker-pull-ecr-image.html
