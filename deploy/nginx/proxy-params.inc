# Спільні заголовки для проксі на Next.js.
#
# Host передається без змін: `getRequestHost` у security.ts бере саме його
# для перевірки same-origin, і якщо сюди підставити внутрішній хост
# апстріму, перестануть працювати всі POST-форми панелі.

proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;

# Країна для geo-політики. Cloudflare ставить CF-IPCountry сам; якщо
# Cloudflare немає, розкоментуй GeoIP2-варіант і підключи модуль.
proxy_set_header CF-IPCountry $http_cf_ipcountry;
# proxy_set_header X-GeoIP-Country $geoip2_data_country_code;

proxy_connect_timeout 5s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;
proxy_buffering on;
proxy_buffer_size 16k;
proxy_buffers 8 16k;
