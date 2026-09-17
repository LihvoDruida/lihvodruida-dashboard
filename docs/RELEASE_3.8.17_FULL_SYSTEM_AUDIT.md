# v3.8.17 — розширений системний аудит

Цей реліз додає виправлення, знайдені не лише внутрішніми `check:*`, а й під час ручного/інтеграційного аудиту PostgreSQL-адаптера, Discord bridge, cron та UI semantics.

## Ключові виправлення

- PostgreSQL document store: range comparisons більше не приводять ISO-дати до `numeric`; `FieldPath.documentId()` працює через `doc_id`; `startAfter(DocumentSnapshot)` використовує реальний cursor id; numeric `*AtMs` сортуються як числа.
- Додано expression index по `data->>'date'` для рейдових date-range запитів.
- Discord component contract перевіряє не лише дублікати `custom_id`, а й максимум 5 кнопок у row та одиночний select/text-input row.
- Dashboard Discord interaction bridge тепер вимагає `INTERNAL_API_TOKEN`, має 256 KiB body limit і повторно відсікає підписані запити зі timestamp поза 5-хвилинним вікном.
- Cron більше не утворює `000000` при transport failure та очищає тимчасовий body перед кожним викликом.
- Role picker переведений з хибної listbox semantics на checkbox group semantics.
- Додано `check:platform-hardening` і вирівняно `verify` з production `build:ci`.

Dashboard: 3.8.17. Bot: 3.5.2. Shared Discord contract: 1.0.1.
