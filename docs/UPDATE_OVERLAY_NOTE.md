# Оновлення поверх старої копії

ZIP-архів не видаляє файли, яких більше немає у новій версії. Якщо архів розпаковується поверх існуючого каталогу, старі компоненти можуть залишитися на диску.

Dashboard тепер запускає `npm run cleanup:legacy` на початку `build:ci` і `verify`. Він видаляє відомі legacy-шляхи, які були прибрані під час редизайну:

- `src/components/HomeDashboardLiveSync.tsx`
- `src/components/HomeLocalTime.tsx`
- `src/components/HomeUpcomingRaidList.tsx`
- `src/components/SectionIcon.tsx`
- `public/ui-icons/`

Для максимально чистого оновлення все одно краще розпаковувати реліз у чисту директорію або синхронізувати дерево з видаленням відсутніх файлів.
