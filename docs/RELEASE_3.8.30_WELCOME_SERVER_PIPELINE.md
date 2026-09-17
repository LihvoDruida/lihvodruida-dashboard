# 3.8.30 — Welcome server pipeline

- Усі три сценарії welcome-картки (production onboarding, preview, test publish) використовують один серверний `createDiscordWelcomeArtifact` pipeline.
- Sharp renderer кешує підготовлений фон і круглі Discord-аватари, має таймаут/ліміт розміру аватарів і не перечитує великий фон на кожну картку.
- PNG отримує реальне прозоре закруглення кутів 16 px перед відправкою в Discord.
- Preview більше не робить дубльований Discord member lookup під час рендеру самої сторінки; реальний аватар читає тільки server renderer.
- Multipart Discord upload отримав timeout, retry та rate-limit handling.
- Onboarding більше не блокує публічну картку/стартову роль через недоступну роль кнопки правил.
- Перевірка ніку зберігається один раз на join-session; повторні retry картки/ролі її не запускають знову.
- Повторний вступ того самого Discord ID скидає per-join delivery state і знову запускає welcome-flow.
- Стартова роль має час активації та не робить випадковий backfill старих учасників після зміни налаштування.
- Канал і стартова роль валідовуються при збереженні; test publish також перевіряє канал перед відправкою.
