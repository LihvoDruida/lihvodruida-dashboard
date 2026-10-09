# Виправлення запиту Dockerfile frontend — 10.10.2026

У наданому журналі auth.docker.io повертає HTTP 500 під час отримання OAuth-токена для docker/dockerfile:1.7. Збірка не доходить до команд Dockerfile.

З dashboard/Dockerfile і bot/Dockerfile прибрано зовнішню директиву syntax. BuildKit використовуватиме вбудований Dockerfile frontend, без окремого завантаження docker/dockerfile:1.7. Усі інструкції збірки, кеші npm/Next.js, версії образів, security overlay та непривілейовані runtime-користувачі збережені. BuildKit залишається увімкненим.

Після оновлення файлів запусти з кореня проєкту:

```bash
make up
```

Для застосування цього ж виправлення без заміни всього проєкту:

```bash
sed -i '/^# syntax=docker\/dockerfile:1\.7$/d' dashboard/Dockerfile bot/Dockerfile
make up
```

Локально перевірено, що всі виконувані інструкції обох Dockerfile ідентичні попередній версії та директиву прибрано. Повну збірку контейнерів не запускали: Docker у середовищі перевірки недоступний. Це усуває окремий запит frontend; завантаження базових образів усе ще залежить від доступності їхнього реєстру.

Офіційна документація: https://docs.docker.com/reference/dockerfile/#syntax
