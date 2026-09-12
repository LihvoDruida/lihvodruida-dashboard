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
#   make clean-cache  прибрати старий (>7 днів) build cache
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

.NOTPARALLEL:

.PHONY: help start up restart stop check cert cert-self cert-status cert-origin \
        backup restore deploy logs ps resources clean-cache rebuild-dashboard rebuild-bot fix-perms

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
	@docker compose up -d --no-deps --no-build dashboard
	@docker compose ps dashboard

rebuild-bot: fix-perms
	@docker compose build bot
	@docker compose up -d --no-deps --no-build bot
	@docker compose ps bot

# Одноразовий знімок ресурсів VPS + контейнерів.
resources:
	@printf "\n== Host ==\n"
	@printf "CPU: "; nproc
	@free -h
	@df -h /
	@printf "\n== Containers ==\n"
	@docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}' 2>/dev/null || true

# 40 GB достатньо, але Docker build cache з часом росте. Видаляємо тільки
# старий (>7 днів) build-cache і dangling images; актуальний кеш лишається,
# тому наступна збірка не починається з нуля.
clean-cache:
	@docker builder prune -f --filter 'until=168h'
	@docker image prune -f
