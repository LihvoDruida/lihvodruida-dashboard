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
Ключ `STREAMER_TOKEN_KEY` резервувати окремо з належним захистом.

У 3.15.2 нових таблиць немає. Пауза Raider.IO — `externalApiCooldowns/raiderio` з абсолютним
`retryAt`. `guildStreamerEvents` після retention може містити тільки локальну квитанцію і хеш
медіа. `discordPublications` зберігає nonce/стан/ID, а застарілі копії метаданих очищаються.
Ці записи не видаляти для примусового повторного надсилання.

[Чинна інструкція релізу](RELEASE_INSTALL_2026-10-19_UA.md).
[Історія старого перенесення](archive/DATABASE_before_3.15.2.md) не є інструкцією поточного runtime.
