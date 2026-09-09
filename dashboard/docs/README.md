# Dashboard documentation index

Internal documentation for the **Lihvo Druida / Mistblossom Vanguard Dashboard**.

Canonical dashboard domain:

```text
https://dashboard.lihvodruida.pp.ua
```

## Українською

| Документ | Опис |
|---|---|
| [Опис функціоналу](ua/FUNCTIONALITY.md) | Модулі dashboard, ролі доступу, профілі, рейди, Discord, заявки, правила, логи й системні перевірки. |
| [API документація](ua/API.md) | Dashboard API routes, методи, токени, інтеграційні контракти й очікувані відповіді. |
| [Змінні середовища](ua/ENVIRONMENT_VARIABLES.md) | Локальні та продакшн-змінні, Discord/Battle.net/Firebase/GitHub/Worker і приклади для `.env.production`. |
| [Інструкція розгортання](ua/DEPLOYMENT.md) | Підготовка сервісів, OAuth callback URLs, домени, Cloudflare Access і перевірка після релізу. |
| [Власний сервер](ua/SELF_HOSTING.md) | Docker-стек, Nginx, TLS, планові задачі, оновлення, бекапи та відкат. |
| [Перехід `admin` → `dashboard`](ua/DASHBOARD_DOMAIN_AND_GITHUB_MOVE.md) | DNS, env, OAuth і Worker endpoints при зміні канонічного піддомену. |

## English

| Document | Description |
|---|---|
| [Functionality overview](en/FUNCTIONALITY.md) | Dashboard modules, access roles, profiles, raids, Discord, applications, rules, logs and system checks. |
| [API documentation](en/API.md) | Dashboard API routes, methods, tokens, integration contracts and expected responses. |
| [Environment variables](en/ENVIRONMENT_VARIABLES.md) | Local and production variables, Discord/Battle.net/Firebase/GitHub/Worker and `.env.production` examples. |
| [Deployment guide](en/DEPLOYMENT.md) | Service setup, OAuth callback URLs, domains, Cloudflare Access and post-release checks. |
| [Self-hosting](en/SELF_HOSTING.md) | Docker stack, Nginx, TLS, scheduled jobs, updates, backups and rollback. |

## Related Worker documentation


## Raid image picker env

```env
RAID_IMAGES_BRANCH=live
RAID_IMAGES_DIRECTORY=assets/img/raids-img
RAID_IMAGES_PUBLIC_BASE_URL=https://lihvodruida.pp.ua
```
