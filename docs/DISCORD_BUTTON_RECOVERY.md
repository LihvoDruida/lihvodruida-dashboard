# Discord button recovery

## Проблема

Discord приймає interaction і dashboard розпізнає `custom_id`, але ресурс
повертається як `null`. Раніше це одразу трактувалось як «рейд / пул / склад
видалено». Для user-triggered interaction це було неправильно: page cache і
спільний circuit-breaker могли повернути безпечний `null` після короткого збою
сховища, хоча документ існував.

## Поточна схема

Для Discord interaction backing data читаються авторитетно, без page-cache:

1. документ за ID із `custom_id` у поточному store;
2. документ за `channelId + messageId` публічного Discord-повідомлення;
3. якщо primary = PostgreSQL і лишились Firebase credentials — ID у legacy
   Firestore з автоматичним backfill у PostgreSQL;
4. `channelId + messageId` у legacy Firestore з таким самим backfill.

Такий самий authoritative path використовується для профілю Discord-користувача
під час рейдових interaction / підпису правил.

Interactive writes для рейду, рейд-пулу та формування складу можуть зробити
реальну спробу запису навіть якщо попередній transient failure ще тримає
write circuit відкритим. Explicit read-only/disabled/unconfigured режим це не
обходить.

## Діагностика на VPS

```bash
make discord-check
```

Команда read-only: показує стан контейнерів, кількість backing documents,
привʼязки `messageId/channelId`, наявність legacy Firestore credentials та
останні interaction/storage логи. Значення секретів не друкуються.

Якщо PostgreSQL порожній і legacy Firestore credentials відсутні, код не може
відновити повний стан ресурсу лише з Discord embed. У такому випадку потрібна
резервна копія / міграція старої БД або повторне створення ресурсу й Discord
повідомлення.
