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
| [Змінні середовища](ua/ENVIRONMENT_VARIABLES.md) | Vercel/local env, Discord/Battle.net/Firebase/GitHub/Worker змінні та production-приклади. |
| [Інструкція розгортання](ua/DEPLOYMENT.md) | Vercel deploy, OAuth callback URLs, домени, Cloudflare Access і перевірка після релізу. |
| [Перехід `admin` → `dashboard`](ua/DASHBOARD_DOMAIN_AND_GITHUB_MOVE.md) | DNS, Vercel Domains, env, OAuth, Worker endpoints і заміна GitHub repo без створення нового Vercel project. |

## English

| Document | Description |
|---|---|
| [Functionality overview](en/FUNCTIONALITY.md) | Dashboard modules, access roles, profiles, raids, Discord, applications, rules, logs and system checks. |
| [API documentation](en/API.md) | Dashboard API routes, methods, tokens, integration contracts and expected responses. |
| [Environment variables](en/ENVIRONMENT_VARIABLES.md) | Vercel/local env, Discord/Battle.net/Firebase/GitHub/Worker variables and production examples. |
| [Deployment guide](en/DEPLOYMENT.md) | Vercel deploy, OAuth callback URLs, domains, Cloudflare Access and post-release checks. |

## Related Worker documentation

- [Worker UA docs](../../workers/guild-applications-worker/docs/ua/README.md)
- [Worker EN docs](../../workers/guild-applications-worker/docs/en/README.md)

## Raid image picker env

```env
RAID_IMAGES_BRANCH=live
RAID_IMAGES_DIRECTORY=assets/img/raids-img
RAID_IMAGES_PUBLIC_BASE_URL=https://lihvodruida.pp.ua
```
