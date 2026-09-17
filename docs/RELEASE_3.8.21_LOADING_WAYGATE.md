# v3.8.21 — Mistblossom Waygate loading experience

Оновлено глобальну сторінку завантаження Dashboard.

## Що змінилось

- нова WoW / Mistblossom-inspired композиція `Mistblossom Waygate`;
- окремі desktop / tablet / mobile / very-narrow mobile layouts;
- 4 послідовні візуальні фази з bounded delays: 0 / 420 / 980 / 1600 мс;
- determinate progress 18 → 43 → 72 → 94%;
- активний етап і завершені етапи змінюються динамічно;
- готовий маршрут не блокується штучно після завершення реальної серверної роботи;
- клієнтська telemetry показує реальний device mode, network state, viewport і route;
- route-specific loading copy додано для profile/profiles/raids/polls/applications/roster/discord/content/guild/dashboard/rules;
- виправлено конфлікт `/profiles`, який раніше потрапляв під `/profile`;
- прибрано застаріле слово Firebase з loading stages;
- портал зберігає обмежений DPR/FPS і зменшений particle budget на mobile/low-power;
- `prefers-reduced-motion` підтримується;
- `check:loading-experience` розширено до 21 інваріанта.
