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

# Країна для geo-політики. Cloudflare ставить CF-IPCountry сам; якщо
# Cloudflare немає, розкоментуй GeoIP2-варіант і підключи модуль.
proxy_set_header CF-IPCountry $http_cf_ipcountry;
# proxy_set_header X-GeoIP-Country $geoip2_data_country_code;

proxy_connect_timeout 5s;
proxy_send_timeout 5s;
proxy_read_timeout 5s;
proxy_buffering on;
proxy_buffer_size 16k;
proxy_buffers 8 16k;
