# 3.8.29 — Welcome test lab

- Welcome preview залишається повністю server-side: PNG збирається `sharp` у owner-only API route.
- Додано тестові дані картки: Discord User ID, display name, username, greeting та member number.
- Якщо вказаний Discord User ID належить учаснику сервера, тестовий renderer підтягує його live avatar/member snapshot без будь-яких mutation.
- Додано перевірку серверного ніку через спільний `explainNicknameValidation`, щоб test lab використовував ту саму логіку, що й production nickname flow.
- Додано незалежний тест текстового шаблону з плейсхолдерами `{mention}`, `{displayName}`, `{username}`, `{greeting}`, `{label}`.
- Додано owner-only кнопку тестової публікації PNG + тексту у вибраний Discord-канал.
- Тестова публікація не створює onboarding state, не видає стартову роль і не надсилає DM.
- Стартова роль перевіряється на manageability під час збереження налаштувань.
- Multipart Discord upload тепер зберігає переведення рядків у тексті повідомлення.
- Regression check для welcome-системи розширено до 17 інваріантів.
