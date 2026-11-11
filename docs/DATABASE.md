# PostgreSQL

Єдине робоче сховище — PostgreSQL (Compose: major 17). Потрібен `DATABASE_URL`.
Відсутність налаштування зупиняє читання/запис; резервного зовнішнього сховища немає.

`dashboard/src/lib/db/documentStore.ts` реалізує JSONB document API над таблицею `documents`.
`documentValues.ts` експортує значення й типи адаптера. Схема: `dashboard/src/lib/db/schema.sql`.
`runTransaction` має повтори serialization failures; запити колекцій усередині нього не підтримуються.
Не утримувати SQL-транзакцію під час зовнішнього HTTP-запиту.

`make up` застосовує схему. Окремий локальний запуск: `npm run db:init` із каталогу `dashboard`.
Резервна копія: `make backup` із кореня стека. Відновлення на ізольованому стенді:
`make restore DUMP=/absolute/path/backup.dump`. Не відновлювати production БД без окремого плану.

У 3.21.0 нових таблиць немає. Старі записи модуля стрімерів видаляються окремою
транзакцією: [порядок очищення](MEDIA_REMOVAL_2026-11-10_UA.md).
`externalApiCooldowns/raiderio` та записи Battle.net зберігаються.
Квитанції `discordPublications` решти модулів не очищати для примусового повтору повідомлень.

[Чинна інструкція релізу](RELEASE_INSTALL_2026-10-19_UA.md).
