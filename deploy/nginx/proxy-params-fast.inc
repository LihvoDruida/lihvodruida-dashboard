# Те саме, що proxy-params.inc, але з короткими таймаутами для Discord.
#
# Discord чекає ACK за 3 секунди. Якщо не вкластись, користувач бачить
# «Дія не вдалася», тому краще швидка помилка, ніж довге очікування.
# Бот відповідає одразу і пересилає роботу в панель уже після відповіді,
# тож у ці 3 секунди він вкладається незалежно від того, скільки думає панель.
#
# Це окремий файл, а не include + перевизначення: nginx вважає повторне
# оголошення proxy_read_timeout у тому самому location помилкою і відмовляється
# стартувати. Дублювання тут свідоме — воно коштує кілька рядків, але не дає
# зламати весь вхідний трафік однією директивою.

proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;

# Never pass browser-provided Cloudflare metadata through unchanged. The map
# variables are produced from the actual TCP peer in nginx.conf.
proxy_set_header CF-Connecting-IP $remote_addr;
proxy_set_header CF-IPCountry $mistblossom_cf_country;
proxy_set_header CF-Ray $mistblossom_cf_ray;
proxy_set_header X-Mistblossom-Trusted-Proxy $mistblossom_trusted_proxy;
proxy_set_header X-Mistblossom-Country $mistblossom_cf_country;
# Strip common client-spoofable geo headers. If GeoIP2 is enabled later, map
# its trusted value into X-Mistblossom-Country instead.
proxy_set_header X-GeoIP-Country "";
proxy_set_header X-Country-Code "";
proxy_set_header CloudFront-Viewer-Country "";

proxy_connect_timeout 5s;
proxy_send_timeout 5s;
proxy_read_timeout 5s;
proxy_buffering on;
proxy_buffer_size 16k;
proxy_buffers 8 16k;
