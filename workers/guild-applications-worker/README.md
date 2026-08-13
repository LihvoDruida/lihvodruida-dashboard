# Документація Guild Applications Worker

Cloudflare Worker обслуговує заявки, Discord interactions, кнопки правил/рейдів, статистику, cache і scheduled виклики dashboard.

Canonical dashboard domain для всіх Worker → Dashboard викликів:

```text
https://dashboard.lihvodruida.pp.ua
```

| Документ | Опис |
|---|---|
| [Огляд функціоналу](FUNCTIONALITY.md) | Що робить Worker: заявки, Discord-кнопки, rules stats, raid-rules signup, raid/poll proxy і scheduled задачі. |
| [API reference](API.md) | Усі Worker routes, методи, payload-и, токени, CORS і очікувані відповіді. |
| [Environment variables і bindings](VARIABLES.md) | Cloudflare vars/secrets, KV bindings, production values і типові помилки налаштувань. |
| [Окремий список змінних для dashboard](DASHBOARD_SHARED_VARIABLES.md) | Значення, які мають збігатися між Worker і Dashboard: tokens, guild id, endpoints, origins. |
| [Інструкція розгортання](DEPLOYMENT.md) | Wrangler deploy, KV namespaces, secrets, Cloudflare Access і перевірка після релізу. |
