# Керування стеком Mistblossom Vanguard.
#
#   make start        перевірки + послідовний запуск
#   make up           те саме зі збіркою образів
#   make restart      повний перезапуск
#   make stop         зупинка
#   make check        тільки перевірки, нічого не запускати
#   make cert         випуск або поновлення сертифіката (Let's Encrypt)
#   make cert-origin  встановити Cloudflare Origin Certificate
#                     CERT=origin.pem KEY=origin.key
#   make backup       резервна копія бази
#   make rebuild-dashboard  зібрати/перезапустити тільки dashboard
#   make rebuild-bot        зібрати/перезапустити тільки bot
#   make resources    CPU/RAM/disk + docker stats
#   make discord-check  діагностика Discord-кнопок і backing data
#   make discord-endpoint-check  перевірити, куди Discord надсилає interaction
#   make discord-endpoint-fix    переключити Discord Interactions Endpoint на VPS
#   make guild-sync     вручну просунути фонову синхронізацію складу
#   make clean-cache  обмежити BuildKit cache й оновити snapshot
#   make docker-stats зняти Docker storage snapshot без очищення
#   make logs         логи всіх сервісів
#   make ps           стан контейнерів
#
# Makefile існує з однієї практичної причини: `make` не залежить від біта
# виконання. Цей біт регулярно губиться при перенесенні файлів через Windows
# або SFTP, і тоді `./deploy/scripts/start.sh` віддає `Permission denied`
# посеред розгортання. `make start` працює завжди.

SHELL := /bin/bash
SCRIPTS := deploy/scripts

# VPS preset: 2 vCPU / 4 GB RAM / 40 GB SSD.
# BuildKit cache is the biggest speed-up for repeated Next.js builds.  On a
# 4 GB host we intentionally keep Compose build concurrency at 1: two builds
# in parallel are faster only on paper and usually end up fighting for RAM/
# swap and becoming slower.
export DOCKER_BUILDKIT ?= 1
export COMPOSE_PARALLEL_LIMIT ?= 1
export NEXT_BUILD_CPUS ?= 2
export NODE_BUILD_MEMORY_MB ?= 2560
export BUILD_CACHE_KEEP_STORAGE ?= 6GB
export BUILD_CACHE_MAX_AGE ?= 168h
export AUTO_PRUNE_BUILD_CACHE ?= 1

.NOTPARALLEL:

.PHONY: help start up restart stop check cert cert-self cert-status cert-origin \
        backup restore deploy logs ps resources clean-cache docker-stats rebuild-dashboard rebuild-bot discord-check discord-endpoint-check discord-endpoint-fix guild-sync fix-perms

help:
	@sed -n '3,18p' Makefile | sed 's/^# \?//'

# Права відновлюються перед кожним викликом: дешевше, ніж діагностувати
# Permission denied на середині запуску.
fix-perms:
	@chmod +x $(SCRIPTS)/*.sh 2>/dev/null || true

start: fix-perms
	@$(SCRIPTS)/start.sh

up: fix-perms
	@$(SCRIPTS)/start.sh --build

restart: fix-perms
	@$(SCRIPTS)/start.sh --build --restart

stop: fix-perms
	@$(SCRIPTS)/stop.sh

check: fix-perms
	@$(SCRIPTS)/start.sh --check

cert: fix-perms
	@$(SCRIPTS)/cert.sh

cert-self: fix-perms
	@$(SCRIPTS)/cert.sh --self

cert-status: fix-perms
	@$(SCRIPTS)/cert.sh --status

# Cloudflare Origin Certificate: make cert-origin CERT=origin.pem KEY=origin.key
cert-origin: fix-perms
	@$(SCRIPTS)/cert.sh --origin $(CERT) $(KEY)

backup: fix-perms
	@$(SCRIPTS)/db-backup.sh

restore: fix-perms
	@$(SCRIPTS)/db-restore.sh $(DUMP)

deploy: fix-perms
	@$(SCRIPTS)/deploy.sh

logs:
	@docker compose logs -f --tail=100

ps:
	@docker compose ps

# Швидке перевстановлення тільки зміненого сервісу. Це значно дешевше за
# повний `make up`, коли правки були лише в dashboard або bot.
rebuild-dashboard: fix-perms
	@docker compose build dashboard
	@docker compose exec -T postgres sh -lc 'psql -v ON_ERROR_STOP=1 -q -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"' < dashboard/src/lib/db/schema.sql
	@BUILD_CACHE_KEEP_STORAGE=$(BUILD_CACHE_KEEP_STORAGE) BUILD_CACHE_MAX_AGE=$(BUILD_CACHE_MAX_AGE) $(SCRIPTS)/docker-cache-maintenance.sh
	@docker compose up -d --no-deps --no-build dashboard
	@$(SCRIPTS)/docker-stats-snapshot.sh || true
	@docker compose ps dashboard

rebuild-bot: fix-perms
	@docker compose build bot
	@BUILD_CACHE_KEEP_STORAGE=$(BUILD_CACHE_KEEP_STORAGE) BUILD_CACHE_MAX_AGE=$(BUILD_CACHE_MAX_AGE) $(SCRIPTS)/docker-cache-maintenance.sh
	@docker compose up -d --no-deps --no-build bot
	@$(SCRIPTS)/docker-stats-snapshot.sh || true
	@docker compose ps bot

discord-check: fix-perms
	@$(SCRIPTS)/discord-check.sh

discord-endpoint-check: fix-perms
	@$(SCRIPTS)/discord-endpoint.sh

discord-endpoint-fix: fix-perms
	@$(SCRIPTS)/discord-endpoint.sh --fix

# Один безпечний крок серверної синхронізації складу. Основний розклад усе
# одно виконує cron-контейнер; ця команда потрібна лише для ручної перевірки.
guild-sync:
	@docker compose exec -T cron sh -lc 'curl --silent --show-error --fail-with-body --max-time 55 --request POST --header "Authorization: Bearer $$INTERNAL_CRON_TOKEN" --header "Content-Type: application/json" --data "{\"source\":\"make-guild-sync\"}" "$$DASHBOARD_INTERNAL_URL/api/guild/sync"'
	@printf "\n"

# Одноразовий знімок ресурсів VPS + контейнерів.
resources: fix-perms
	@$(SCRIPTS)/docker-stats-snapshot.sh || true
	@printf "\n== Host ==\n"
	@printf "CPU: "; nproc
	@free -h
	@df -h /
	@printf "\n== Containers ==\n"
	@docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}' 2>/dev/null || true

# Для 40 GB VPS тримаємо BuildKit cache в розумній межі. Скрипт спочатку
# пробує `--keep-storage 6GB`; на старішому Docker переходить на age filter.
# Volumes ніколи не чіпаються. Після очищення оновлюється snapshot для UI.
clean-cache: fix-perms
	@BUILD_CACHE_KEEP_STORAGE=$(BUILD_CACHE_KEEP_STORAGE) BUILD_CACHE_MAX_AGE=$(BUILD_CACHE_MAX_AGE) $(SCRIPTS)/docker-cache-maintenance.sh

# Лише оновити інформацію Images/Containers/Volumes/Build Cache для сторінки
# /dashboard/server — без prune і без доступу dashboard до Docker socket.
docker-stats: fix-perms
	@$(SCRIPTS)/docker-stats-snapshot.sh
	@docker system df
