# Вхід/вихід: діагностика та виправлення — v3.8.57

## Підтверджено на підставі журналу деплою

`make up` після оновлення Статика завершувався на TypeScript:

`src/lib/staticRules.ts(122,94|134): TS2339 Property 'createdAt' does not exist on type '{ id: string; }'`.

Це **блокер збірки**, а не доказ помилки Discord OAuth. Виправлено типізоване читання/сортування журналу в `listStaticState()`.

## Дефекти за інспекцією вихідного коду

- `LogoutButton` вважав успішним `fetch` із 303 та наступною HTML-сторінкою, без явної перевірки очищення сесії. Тепер AJAX POST повертає JSON `ok:true`, `signedOut:true` і `X-Dashboard-Session: cleared`; клієнт перевіряє обидва сигнали.
- GET `/api/auth/logout?fallback=1` завершував сесію (logout CSRF від стороннього посилання/попереднього завантаження). Тепер будь-який GET — **405**, резервний вихід виконується нативним POST форми.
- `/api/auth/session` перевіряв лише підписаний cookie через `getStoredSession()`, не оцінюючи актуальні Discord-ролі й чинну політику. Тепер `getSession({ live: true })`.
- `/login` автоматично перекидав із чинним *криптографічно* cookie, навіть якщо доступ змінився; тепер перевіряє актуальний доступ до редиректу.
- `createOAuthStateToken()` і `parseOAuthStateToken()` мали вузький перелік return paths (лише raids/profile/rules), тоді як `/login` і OAuth-start дозволяли адмінські маршрути. Тепер обидві сторони використовують `safeDashboardReturnPath(..., scope: 'discord-auth')`.
- `ClientAuthGuard` не охоплював `/dashboard`, `/polls`, `/roster`. Додано всі захищені групи з proxy.
- Незавершене Battle.net зв'язування не скидалося після загального logout. Стан Battle.net тепер очищується з обома cookie-іменами (secure + legacy).
- Вхідна сторінка перевіряла лише `DISCORD_OAUTH_CLIENT_ID`, а OAuth-код підтримував також `DISCORD_CLIENT_ID`. Перевірки уніфіковані.

## Контрольні перевірки

- `npm run check:auth-lifecycle` — поведінкові регресійні тести: підписаний state, дозволені/заборонені return paths, cookies у Discord OAuth, паралельні спроби, force-switch, 2 варіанти POST-logout, GET=405, охоплення захищених сторінок.
- `npm run check:login`, `check:rules-accept`, `check:static-rules`, `check:api-security`, `check:security-performance`, `check:imports` — статичні перевірки сумісності.
- `cd bot && npm test` — перевірка Discord bot; без залежностей налаштувати `npm ci`.

## Після деплою

1. `make up` — **обов'язково** перевірити завершення `npm run typecheck` та Next production build, `docker compose ps`, health status. В оточенні архівного аналізу повний Next build недоступний через неповні `node_modules`; результати CI на VPS будуть остаточними.
2. Анонімно `GET /api/auth/session` → **401**; `GET /api/auth/logout?fallback=1` → **405**, без зміни сесії.
3. Discord-вхід через `/login?next=/discord/static` → після підтвердження ролей повернення на `/discord/static` (або на сторінку обов'язкового заповнення профілю).
4. Два паралельні входи в різних вкладках → обидва nonce лишаються чинними, доки не завершені/прострочені.
5. У вже авторизованій вкладці натиснути **Вийти** → 200 JSON (XHR), очищення cookies, hard-navigation на `/login?loggedOut=1`, `/api/auth/session` → 401.
6. Відкрити іншу авторизовану вкладку і активувати її → перевірка сесії або storage-event поверне на вхід.
7. Відключити JS/імітувати збій `fetch` → звичайний POST форми повинен завершити сесію та відповісти 303 на `/login?loggedOut=1`.
8. Перевірити після зміни/видалення обов'язкової Discord-ролі: `/api/auth/session` не має вважати старий cookie самодостатнім дозволом (зважати на 90-секундний live access cache).
9. Перевірити зв'язування Battle.net після виходу: старий state не має відновити прив'язку до іншого акаунта.

**Обмеження:** cookie-сесія підписана і є stateless; це виправлення очищає її в браузері, але не є глобальним server-side відкликанням украденого раніше session token. Для миттєвого відкликання на всіх пристроях потрібен реєстр/denylist сесій.
