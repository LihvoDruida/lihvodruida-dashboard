# Guild Applications Worker documentation

Cloudflare Worker handles guild applications, Discord interactions, rules/raid buttons, statistics, cache and scheduled dashboard calls.

Canonical dashboard domain for all Worker → Dashboard calls:

```text
https://dashboard.lihvodruida.pp.ua
```

| Document | Description |
|---|---|
| [Functionality overview](FUNCTIONALITY.md) | Worker feature map: applications, Discord buttons, rules stats, raid-rules signup, raid/poll proxy and scheduled jobs. |
| [API reference](API.md) | Worker routes, methods, payloads, tokens, CORS and expected responses. |
| [Environment variables and bindings](VARIABLES.md) | Cloudflare vars/secrets, KV bindings, production values and common configuration mistakes. |
| [Dashboard shared variables](DASHBOARD_SHARED_VARIABLES.md) | Values that must match between Worker and Dashboard: tokens, guild id, endpoints and origins. |
| [Deployment guide](DEPLOYMENT.md) | Wrangler deployment, KV namespaces, secrets, Cloudflare Access and post-release checks. |
