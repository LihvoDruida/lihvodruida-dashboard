# v3.8.18 — Mobile guild roster

Оновлено `/guild` тільки для вузьких екранів; desktop layout і desktop grid не змінювались.

## Що виправлено

- усунуто mobile flex-basis bug, через який пошук ставав приблизно 340px заввишки;
- статистика складу на телефоні стала горизонтальною swipe-стрічкою;
- фільтри адаптуються 2 → 1 колонка;
- рядок персонажа на телефоні перетворено на окрему компактну картку;
- імʼя, realm, роль, клас і spec зібрано у mobile identity header;
- ILVL / RIO / raid / rank показуються компактними 2×2 tiles;
- посилання `Профіль` / `RIO` стали touch-friendly actions;
- footer і pagination адаптовані під вузькі екрани;
- додано `check:guild-mobile` для контролю ізоляції mobile/desktop стилів.

Desktop `tableHead`, desktop column grid та desktop identity cells залишені без змін.
