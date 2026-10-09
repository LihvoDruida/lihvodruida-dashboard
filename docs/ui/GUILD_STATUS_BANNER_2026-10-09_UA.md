# Глобальна інформаційна панель гільдії над навігацією

Дата: 09.10.2026 · Основа: Dashboard v3.8.68 style-audit build hotfix.

## Що реалізовано

- Додана панель `.guild-status-banner` над глобальною навігацією на авторизованих сторінках Dashboard.
- Зліва показується поточний рейд гільдії та Normal / Heroic / Mythic kill progress із **збереженої гільдійної статистики Raider.IO**, а не з персонажа/користувача. Рейд обирається через поточний сезон з `RaidSeasonSnapshot`; коли сезон відсутній, прогрес не підміняється історичним. Якщо дані мають timestamp старший за 72 години, замість них відображається повідомлення про оновлення. Читання cache-only, без додаткового live-запиту до Battle.net/Raider.IO при render сторінки.
- По центру — фактична назва Discord-гільдії з `getGuildBranding()`, з fallback Mistblossom Vanguard.
- Праворуч — динамічний відлік до наступного **EU Retail тижневого reset**: середа **04:00 UTC**. Відображається кількість днів, годин, хвилин і секунд та локалізована дата за Europe/Kyiv. Відлік вираховується з `Date.now()` раз на секунду, UTC-дата обчислюється кожного разу заново (правильно на DST/межі тижня). Джерело: https://wowreset.com/eu.html; за непередбаченої зміни розкладу Blizzard значення слід актуалізувати.
- Напрямок прокручування керує тільки новою панеллю: вниз сховати, вгору відновити, а біля початку сторінки відобразити завжди. Панель навігації завжди лишається закріпленою і зміщується між позиціями без стрибків layout; мобільна панель і sheet враховують висоту банера.
- Використані **вже наявні локальні шрифти** Spectral SC Bold (бренд) та Philosopher Bold (заголовки). Основний UI-звичайний текст лишився в читабельному системному sans-stack. Використано `next/font/local` без зовнішнього шрифтового CDN; оформлення засноване на наданому референсі ForeverChanges, це не копія їхніх файлів чи шрифтових стилів.
- Фон сайту та starfield не змінювались. Для панелі повторно використовується `public/assets/img/profile/profile-hero-bg.png`, окремі глобальні CSS у `styles/guild-banner.css` без змін інших сторінкових стилів.

## Файли

- `dashboard/src/components/GuildStatusBanner.tsx` — UI, таймер, scroll behavior.
- `dashboard/src/lib/wowWeeklyReset.ts` — UTC обчислення скидання.
- `dashboard/src/components/DashboardIdentity.tsx` — інтеграція з поточним сезоном і даними гільдії.
- `dashboard/src/app/styles/guild-banner.css` — геометрія, adaptive desktop/mobile, анімація й reduced-motion.
- `dashboard/src/app/styles/tokens.css` — глобальні font tokens.
- `dashboard/src/app/layout.tsx` — підключення шрифтів, CSS.
- `dashboard/scripts/check-guild-banner.cjs` — 21 перевірка поведінки / інваріантів.
- `dashboard/scripts/check-ui-standardization-performance.cjs` — оновлений контракт шрифтів.
- `dashboard/package.json` — `check:guild-banner` включено у `build:ci`.

## Локальні перевірки

- `check:guild-banner`: 21/21 PASS.
- `check-security-stage2-independent`: 13/13 PASS.
- `check-security-stage3-independent`: 20/20 PASS.
- `check-security-stage4-independent`: 18/18 PASS.
- `check-security-stage4-routes`: 10/10 PASS.
- `check:guild-mobile`: 14/14 PASS.
- `check:profile-mobile`: 24/24 PASS.
- `check:page-performance`: 13/13 PASS.
- `check:ui-standardization-performance`: 20/20 PASS.
- `check:role-picker`: 19/19 PASS.
- `check:platform-hardening`: 13/13 PASS.
- `check:live-refresh`: 13/13 PASS.
- `check:imports`: PASS.
- `audit:styles`: PASS.
- `audit:ui`: PASS.
- `inspect:ci`: PASS.
- TS/TSX transpile syntax: PASS; PostCSS syntax: PASS.

**Не перевірено в цьому середовищі:** повна інсталяція node_modules, TypeScript semantic typecheck, Next.js production build, Docker image build, живий VPS/Discord/Raider.IO та візуальні браузерні знімки всіх breakpoints. Ці кроки необхідні до production-релізу; наведені локальні перевірки не заміняють їх.

## Рекомендована перевірка після розгортання

1. `npm ci`, штатний security overlay (згідно Dockerfile), `npm run build:ci` у `dashboard`.
2. Відкрити `/guild`, `/raids` і `/profile` на desktop і mobile; переконатися, що банер не перекриває заголовки й мобільне меню.
3. Прокрутити сторінку вниз/вгору; меню має лишатися видимим, банер — змінювати видимість.
4. Перевірити актуальний рейд у Raider.IO cache і UTC reset після середи 04:00.
5. Виконати smoke test production Docker і HTTPS.
