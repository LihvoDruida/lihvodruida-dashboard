# Mistblossom Dashboard Theme System

## Файли

- `src/app/design-tokens.css` — єдина точка керування кольорами, станами, поверхнями, бордерами, текстом і тінями.
- `src/app/theme.css` — фінальний theme-layer, який застосовує токени до глобальних компонентів і рейд-пулів.
- `src/app/globals.css` — legacy/global layout CSS. Старі alias-змінні (`--bg`, `--gold`, `--mist-*`) тепер привʼязані до токенів.

## Правило для нових стилів

Не додавати прямі `#hex`, `rgb()` або `rgba()` у компонентні стилі. Використовувати тільки semantic tokens:

```css
background: var(--color-surface);
border-color: var(--color-border);
color: var(--color-text);
```

Для прозорих відтінків використовувати `color-mix()` від базового токена:

```css
background: color-mix(in srgb, var(--color-accent) 14%, transparent);
```

## Основна палітра

- Canvas: `--color-canvas`
- Surface: `--color-surface`, `--color-surface-raised`, `--color-surface-strong`
- Text: `--color-text`, `--color-text-soft`, `--color-text-muted`
- Accent: `--color-accent`, `--color-accent-strong`
- States: `--color-success`, `--color-info`, `--color-danger`

## Legacy aliases

Старі змінні не видалені, щоб не ламати існуючі сторінки. Вони тепер є alias-шаром:

```css
--gold: var(--color-accent);
--emerald: var(--color-success);
--mist-border: var(--color-border);
```
