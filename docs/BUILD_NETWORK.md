# DNS і мережа під час Docker-збірки

Помилка `lookup auth.docker.io on 127.0.0.53:53: server misbehaving` означає, що DNS хоста не зміг дозволити адресу сервера токенів Docker Hub. Збірка зупинилася ще до встановлення npm-пакетів та перевірки коду. Рядок `target bot` не означає несправність логіки бота.

У 3.8.68 з обох Dockerfile прибрано `# syntax=docker/dockerfile:1.7`: використовується вбудований frontend BuildKit, тому окремий образ `docker/dockerfile` більше не потрібний. Кеші npm та Next збережено. Потрібний сучасний Docker Engine із BuildKit та Compose v2, який підтримує `RUN --mount=type=cache`.

Це не робить збірку автономною: базові образи Node/Postgres/nginx, npm та Debian-пакети все одно потребують робочої мережі, коли їх немає в кеші.

## Відновлення DNS на Ubuntu VPS

З кореня проєкту спочатку виконайте читання стану:

```bash
make network-check
resolvectl status
```

Якщо `auth.docker.io` не дозволяється через systemd-resolved, очистіть кеш і стан DNS-серверів, перезапустіть лише resolver, потім перевірте знову:

```bash
sudo resolvectl flush-caches
sudo resolvectl reset-server-features
sudo systemctl restart systemd-resolved
getent ahosts auth.docker.io
make network-check
```

Після успішної перевірки повторіть:

```bash
make up
```

`network-check` перевіряє DNS і HTTPS до Docker Hub, npm та Debian. Для `/v2/` Docker Registry відповідь `401` без токена є нормальною: HTTPS працює, а реєстр очікує авторизацію. Команда не змінює DNS, не перезапускає Docker і не видаляє кеш. Перевірка стосується хоста; окремий buildx builder може мати інші мережеві параметри. Успішна перевірка не гарантує завантаження всіх layers чи пакетів.

## Якщо resolver досі не працює

Перевірте доступність upstream DNS провайдера VPS та мережеві обмеження UDP/TCP 53. Для тимчасової перевірки можна задати DNS конкретного зовнішнього інтерфейсу. Спочатку переконайтеся, що `dns_iface` відповідає потрібному інтерфейсу з `resolvectl status`:

```bash
dns_iface=$(ip -4 route show default | awk '/default/ {print $5; exit}')
printf '%s\n' "$dns_iface"
sudo resolvectl dns "$dns_iface" 1.1.1.1 9.9.9.9
make network-check
```

Тимчасову зміну відкочує `sudo resolvectl revert "$dns_iface"`. Для постійного налаштування використовуйте наявний мережевий менеджер VPS/Netplan та DNS, сумісні з вашою мережею. Не замінюйте навмання `/etc/resolv.conf` і не перезапускайте всю мережу через SSH.

Параметр `dns:` у Compose налаштовує DNS сервісних контейнерів; він не ремонтує resolver хоста, який завантажує frontend і базові образи. Очищення BuildKit cache теж не ремонтує DNS й може збільшити кількість потрібних завантажень.

## Збірка та очищення

Усі керовані команди (`make up`, `make restart`, `make deploy`, перебудова одного сервісу) використовують `build-images.sh`: dashboard і bot збираються послідовно. Якщо команда build падає, скрипт показує мережеву діагностику, повертає початковий код помилки та не запускає наступну збірку. `make restart` зупиняє стек після успішної збірки.

Для обмеження невикористовуваного кешу є `make clean-cache`; він не чіпає volumes. Не використовуйте `docker system prune --volumes` для цієї помилки — Postgres зберігає дані у volume.

Джерела: [Dockerfile frontend](https://docs.docker.com/reference/dockerfile/#syntax), [systemd resolvectl](https://github.com/systemd/systemd/blob/main/man/resolvectl.xml), [Ubuntu DNS troubleshooting](https://ubuntu.com/server/docs/how-to/networking/dnssec-troubleshooting/).
