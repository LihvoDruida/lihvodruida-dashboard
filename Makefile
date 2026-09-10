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
#   make logs         логи всіх сервісів
#   make ps           стан контейнерів
#
# Makefile існує з однієї практичної причини: `make` не залежить від біта
# виконання. Цей біт регулярно губиться при перенесенні файлів через Windows
# або SFTP, і тоді `./deploy/scripts/start.sh` віддає `Permission denied`
# посеред розгортання. `make start` працює завжди.

SHELL := /bin/bash
SCRIPTS := deploy/scripts

.PHONY: help start up restart stop check cert cert-self cert-status cert-origin \
        backup restore deploy logs ps fix-perms

help:
	@sed -n '3,14p' Makefile | sed 's/^# \?//'

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
