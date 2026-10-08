# Статик: виправлення TypeScript при Docker build (v3.8.64)

## Причина збою

У версії `3.8.62` команда `make up` зупинялася на `npm run typecheck`:

- `TS2339` (`dashboard/src/app/api/static/manage/route.ts`): `addStaticViolation()` повертає обʼєднання двох типів. Поле `warning` існує лише коли Discord не відповів під час зняття ролі після третього порушення.
- `TS2739` (`dashboard/src/lib/staticRules.ts`): курсор був оголошений як `firebase-admin/firestore.QueryDocumentSnapshot`, хоча `getFirebaseAdminDb()` зараз типізовано як `PgDocumentSnapshot` (адаптер PostgreSQL).

## Зміни

- В API використовується перевірка `"warning" in result`, а відповідне поле додається лише за його наявності.
- Замість снапшота для пагінації `orderBy("__name__")` використовується `string`-ID останнього запису; PostgreSQL adapter у `documentStore.ts` підтримує `startAfter(id)`. Обхід із лімітом 250 записів збережено.
- Новий незалежний поведінковий тест перевіряє 604 документи і переходи між сторінками, 5 активних блокувань, відсутність дублювання та обидва варіанти відповіді API.

## Результат локально

- `node scripts/check-static-types-independent.cjs`: 4/4 PASS.
- `node scripts/check-static-discipline-independent.cjs`: 12/12 PASS.
- `node scripts/check-static-discipline-routes.cjs`: 9/9 PASS.
- Повний `npm run typecheck` і production build **не підтверджені**: залежності не встановились у локальному середовищі (npm offline cache incomplete; звичайний `npm ci` повернув internal error).

## Застосування

Для серверної 3.8.62 без переходу на нову версію використати `lihvodruida-static-build-v3.8.62-hotfix.patch`. Для повного оновлення з версії 3.8.63 використати ZIP 3.8.64 або окремий `lihvodruida-static-build-v3.8.64.patch`.

Перед деплоєм рекомендовано запустити `npm run typecheck`, а потім `make up`.
