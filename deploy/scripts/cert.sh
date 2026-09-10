#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Сертифікат для домену панелі.
#
#   ./deploy/scripts/cert.sh                     випустити або поновити (Let's Encrypt)
#   ./deploy/scripts/cert.sh --self              тимчасовий самопідписаний
#   ./deploy/scripts/cert.sh --origin cert key   встановити Cloudflare Origin Certificate
#   ./deploy/scripts/cert.sh --status            що зараз лежить у томі
#
# Домен НЕ передається аргументом і не береться зі змінної оточення: він
# читається з .env (DASHBOARD_PUBLIC_URL). Порожня змінна $DOMAIN у
# командному рядку — найчастіша помилка на цьому кроці; certbot тоді падає з
# «Requested domain is not a FQDN because it contains an empty label», і
# причину шукають у DNS.
# ---------------------------------------------------------------------------

set -euo pipefail
cd "$(dirname "$0")/../.."

GREEN=$'\033[1;32m'; RED=$'\033[1;31m'; YELLOW=$'\033[1;33m'
CYAN=$'\033[1;36m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
step() { printf '\n%s==>%s %s%s%s\n' "$CYAN" "$RESET" "$BOLD" "$*" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail() { printf '\n%s✖%s %s\n\n' "$RED" "$RESET" "$*" >&2; exit 1; }

[ -f .env ] || fail "немає .env — створіть його з DASHBOARD_PUBLIC_URL"

DOMAIN="$(sed -n 's/^[[:space:]]*DASHBOARD_PUBLIC_URL[[:space:]]*=[[:space:]]*//p' .env \
  | tail -n1 | sed 's/^"\(.*\)"$/\1/; s~^https\?://~~; s~/.*$~~')"

# Захист від того самого «empty label»: краще зупинитись тут із зрозумілим
# текстом, ніж отримати помилку certbot про FQDN.
[ -n "$DOMAIN" ] || fail "DASHBOARD_PUBLIC_URL не заданий у .env"
case "$DOMAIN" in
  *.*) ;;
  *) fail "домен '$DOMAIN' не схожий на FQDN. Перевірте DASHBOARD_PUBLIC_URL у .env" ;;
esac

EMAIL="$(sed -n 's/^[[:space:]]*LETSENCRYPT_EMAIL[[:space:]]*=[[:space:]]*//p' .env | tail -n1)"
VOLUME="mistblossom_letsencrypt"
LIVE="/etc/letsencrypt/live/$DOMAIN"

cert_info() {
  docker run --rm -v "$VOLUME:/etc/letsencrypt" alpine sh -c "
    if [ -f $LIVE/fullchain.pem ]; then
      apk add --no-cache openssl >/dev/null 2>&1
      openssl x509 -in $LIVE/fullchain.pem -noout -issuer -subject -enddate
    else
      echo 'НЕМАЄ'
    fi" 2>/dev/null
}

# Самопідписана заглушка від справжнього сертифіката відрізняється тим, що
# issuer збігається з subject. Це важливо розрізняти: Cloudflare у режимі
# Full (strict) заглушку не приймає й віддає відвідувачам помилку 526.
cert_is_self_signed() {
  docker run --rm -v "$VOLUME:/etc/letsencrypt" alpine sh -c "
    [ -f $LIVE/fullchain.pem ] || exit 1
    apk add --no-cache openssl >/dev/null 2>&1
    issuer=\$(openssl x509 -in $LIVE/fullchain.pem -noout -issuer)
    subject=\$(openssl x509 -in $LIVE/fullchain.pem -noout -subject)
    [ \"\${issuer#issuer=}\" = \"\${subject#subject=}\" ]" 2>/dev/null
}

case "${1:-}" in
  --status)
    step "Сертифікат для $DOMAIN"
    cert_info
    if cert_is_self_signed; then
      printf '\n'
      warn "це самопідписана заглушка, а не робочий сертифікат"
      warn "Cloudflare у режимі Full (strict) віддає на неї помилку 526"
      warn "випустіть робочий: ./deploy/scripts/cert.sh"
    fi
    exit 0
    ;;

  --origin)
    # Cloudflare Origin Certificate. Видається самим Cloudflare на 15 років і
    # дійсний ТІЛЬКИ для ділянки Cloudflare → origin. Браузер його не бачить:
    # відвідувачу TLS завершує Cloudflare своїм сертифікатом.
    #
    # Головна перевага перед Let's Encrypt у цій схемі: не треба щоразу
    # знімати проксі заради ACME-перевірки, і немає поновлення раз на 90 днів.
    CERT_FILE="${2:-}"; KEY_FILE="${3:-}"
    [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ] || fail "вкажіть файли: ./deploy/scripts/cert.sh --origin origin.pem origin.key
     Створити їх: Cloudflare → SSL/TLS → Origin Server → Create Certificate
     (Hostnames: $DOMAIN, формат PEM). Приватний ключ показується один раз."

    step "Встановлюю Cloudflare Origin Certificate для $DOMAIN"
    docker volume create "$VOLUME" >/dev/null
    docker run --rm -i -v "$VOLUME:/etc/letsencrypt" alpine sh -c "mkdir -p $LIVE && cat > $LIVE/fullchain.pem" < "$CERT_FILE"
    docker run --rm -i -v "$VOLUME:/etc/letsencrypt" alpine sh -c "cat > $LIVE/privkey.pem && chmod 600 $LIVE/privkey.pem" < "$KEY_FILE"
    ok "файли покладені у том"

    step "Перезавантажую nginx"
    docker compose exec nginx nginx -s reload
    ok "конфігурацію перечитано"

    step "Результат"
    cert_info
    printf '\n%s✓%s Готово. Проксі Cloudflare можна лишати увімкненим постійно.\n' "$GREEN" "$RESET"
    printf '   Режим SSL/TLS має бути %sFull (strict)%s.\n\n' "$BOLD" "$RESET"
    exit 0
    ;;

  --self)
    step "Створюю тимчасовий самопідписаний сертифікат для $DOMAIN"
    # Потрібен, щоб nginx узагалі стартував: без файлів сертифіката він
    # не піднімається, а без нього certbot не пройде перевірку. Це та сама
    # курка з яйцем, яку розриваємо заглушкою на добу.
    docker volume create "$VOLUME" >/dev/null
    docker run --rm -v "$VOLUME:/etc/letsencrypt" alpine sh -c "
      apk add --no-cache openssl >/dev/null &&
      mkdir -p $LIVE &&
      openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
        -keyout $LIVE/privkey.pem \
        -out $LIVE/fullchain.pem \
        -subj '/CN=$DOMAIN' 2>/dev/null"
    ok "заглушка створена (діє 1 добу)"
    warn "це НЕ справжній сертифікат — випустіть робочий: ./deploy/scripts/cert.sh"
    exit 0
    ;;
esac

step "Випуск сертифіката для $DOMAIN"

if [ -z "$EMAIL" ]; then
  fail "не заданий LETSENCRYPT_EMAIL у .env — Let's Encrypt вимагає адресу для сповіщень про закінчення"
fi
ok "email: $EMAIL"

# --- Передумова: nginx має віддавати ACME-челендж ---------------------------
step "Перевіряю, що челендж доступний ззовні"

if ! docker compose ps --status running nginx 2>/dev/null | grep -q nginx; then
  fail "nginx не запущений. Спершу: ./deploy/scripts/start.sh"
fi

PROBE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
  "http://$DOMAIN/.well-known/acme-challenge/probe" 2>/dev/null || echo "000")"

case "$PROBE" in
  404)
    ok "маршрут працює (404 — файлу немає, це очікувано)"
    ;;
  526)
    fail "Cloudflare повертає 526: origin відповідає, але його сертифікат не проходить перевірку.
     Зараз там, найімовірніше, самопідписана заглушка від --self.
     Два виходи:
       1) Зняти проксі з A і AAAA (DNS only), запустити цей скрипт ще раз,
          після випуску повернути Proxied.
       2) Поставити Cloudflare Origin Certificate і не знімати проксі взагалі:
          ./deploy/scripts/cert.sh --origin origin.pem origin.key
     Детально: docs/DEPLOYMENT.md, розділ 5."
    ;;
  521|522|523|525)
    fail "Cloudflare повертає $PROBE: до сервера не достукатись.
     Зніміть проксі з записів A і AAAA (DNS only, сіра хмара), дочекайтесь
     пари хвилин і запустіть знову. Після випуску проксі повертається.
     Детально: docs/DEPLOYMENT.md, розділ 4."
    ;;
  000)
    fail "домен $DOMAIN не відповідає по HTTP. Перевірте DNS: dig +short $DOMAIN"
    ;;
  *)
    warn "несподіваний код $PROBE — пробую випустити, але якщо впаде, дивіться docs/DEPLOYMENT.md, розділ 5"
    ;;
esac

# --- Випуск -----------------------------------------------------------------
step "Запитую сертифікат"
docker compose run --rm certbot certonly \
  --webroot --webroot-path=/var/www/certbot \
  -d "$DOMAIN" \
  --agree-tos --no-eff-email --non-interactive \
  -m "$EMAIL"

step "Перезавантажую nginx"
docker compose exec nginx nginx -s reload
ok "конфігурацію перечитано"

step "Результат"
cert_info

printf '\n%s✓%s Готово. Тепер можна повертати проксі Cloudflare (Proxied) на A і AAAA.\n\n' \
  "$GREEN" "$RESET"
