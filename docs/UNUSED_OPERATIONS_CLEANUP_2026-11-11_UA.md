# Dashboard 3.20.0 — невикористані операції, 11.11.2026

Прибрано 74 експортованих функцій, псевдонімів і констант без зовнішніх посилань та без використання всередині власного модуля. Перевірка охоплювала Dashboard, Bot, shared, scripts, QA й deploy. Вилучення виконано за синтаксичним деревом TypeScript, без зміни тіл чинних обробників.

## Що очищено

- Старі обгортки прав (`resolveDashboardRole`, `assertAdmin`, `assertCanModerate`, частина застарілих permission helpers). Чинна авторизація через сесію, access groups і перевірки прав збережена.
- Альтернативний mapper старого формату заявок, read-only псевдоніми sanitizer-ів, невикористані способи запису Discord-посилань та статусу заявки. Активний `setIssueStatus`, транзакції модерації й черга доставки збережені.
- Повна невикористана вибірка профілів для старої синхронізації Discord, старий per-view wrapper зовнішнього оновлення й неактивні обгортки зв’язків персонажів. Чинні каталог, серверна пагінація, canonical character data та refresh API залишаються.
- Неактивні setter-и фонової API-політики й шаблону ніку. Читання збережених налаштувань, env-параметри та чинні сторінки налаштувань не видалені.
- Дубльовані обгортки розподілу рейду, bench, видалення чернеток, labels та календарних рекомендацій. Використовувані алгоритми й маршрути рейдів/пулів залишаються.
- Неактивний shortcut завершення onboarding та дрібні невикористані helpers брендингу, журналу, мережі, класів і персонажів.
- Залежні приватні parser-и старого тіла заявки, допоміжні оголошення й імпорти, які більше не читаються.

## Захист від повторного накопичення

У стандартний TypeScript typecheck додано `noUnusedLocals: true`. Він перевіряє невикористані локальні оголошення та імпорти. Зовнішньо невикористані exports цим прапорцем не виявляються автоматично: для них виконано окремий аналіз посилань.

Відеофон, Discord, Battle.net, Raider.IO, рейди, пули, заявки, профілі, права та робочі налаштування збережені. Джерела даних PostgreSQL і самі записи не очищалися. Нових залежностей не додано.

## Документи

Видалено 23 застарілі JSON-звіти `docs/roadmap/*VALIDATION*.json`. Текстові плани, початкові вимоги й невиконані задачі залишені; посилання на видалені JSON позначені як історичні. Список файлів — `REMOVED_UNUSED_FILES.txt` у корені. Це не видалення активних тестів: поточні scripts і Bot-тести збережені.

Під час оновлення поверх старого дерева фізично прибрати перелічені файли; просте розпакування ZIP цього не робить. Повний список від початкового комплекту міститься в `REMOVED_MEDIA_FILES.txt` і не включає відеофон.

Фактичні результати перевірок — `VALIDATION_UNUSED_CLEANUP_2026-11-11.md`. Зовнішні споживачі, які напряму імпортують внутрішні TypeScript-модулі цього приватного проєкту і не входять у наданий код, цим аудитом не охоплені. Публічні маршрути на цьому етапі не прибиралися.

## Повний список видалених експортів

| Модуль | Оголошення |
|---|---|
| `dashboard/src/lib/accessGroups.ts` | `listAdminAuditLogs` |
| `dashboard/src/lib/accountCleanupAutomation.ts` | `getAccountCleanupExecutionLock` |
| `dashboard/src/lib/applicationsStore.ts` | `mapApplicationIssue`, `sanitizeApplicationForReadOnlyViewer`, `sanitizeApplicationsForReadOnlyViewer`, `setApplicationDiscordMessageRef`, `updateApplicationStatus` |
| `dashboard/src/lib/auth.ts` | `resolveDashboardRole`, `assertCanModerate`, `assertAdmin` |
| `dashboard/src/lib/battlenet.ts` | `battleNetProfileUnavailableReason`, `BATTLE_NET_REGIONS` |
| `dashboard/src/lib/branding.ts` | `getGuildIconUrl`, `getGuildName` |
| `dashboard/src/lib/characterDataStore.ts` | `readCanonicalCharacterData` |
| `dashboard/src/lib/characterRaidProgress.ts` | `raidProgressBelongsToCurrentSeason` |
| `dashboard/src/lib/concurrency.ts` | `runConcurrent` |
| `dashboard/src/lib/dashboardApiSettings.ts` | `setDashboardApiSettings`, `dashboardApiSettingsSummary`, `dashboardApiSettingsMinBackgroundRefreshSeconds` |
| `dashboard/src/lib/dashboardBackgroundApi.ts` | `dashboardBackgroundApiVersion` |
| `dashboard/src/lib/db/documentValues.ts` | `documentStoreKind` |
| `dashboard/src/lib/db/pgPool.ts` | `closePgPool` |
| `dashboard/src/lib/discordAdmin.ts` | `buildRulesConfirmAcceptCustomId` |
| `dashboard/src/lib/discordAutoroles.ts` | `isAutoroleMessage` |
| `dashboard/src/lib/discordWelcomeCardSettings.ts` | `defaultDiscordWelcomeGreetings` |
| `dashboard/src/lib/guildNicknamePolicy.ts` | `setGuildNicknamePolicy` |
| `dashboard/src/lib/httpBody.ts` | `isJsonContainer` |
| `dashboard/src/lib/permissions.ts` | `canAccessDashboardRole`, `siteStatusDescription`, `canViewApplicationSensitiveFields`, `dashboardCapabilities`, `splitConfiguredRoleIds`, `configuredRoleIdsForDashboardRole`, `matchingDiscordRoleLabels`, `matchingDiscordRoleIds` |
| `dashboard/src/lib/profiles.ts` | `canManageProfiles`, `canManageOwnCharacters`, `listDashboardProfilesForDiscordSync`, `listCharacterProfileLinks`, `refreshProfileExternalDataOnView`, `getProfileDiscordName` |
| `dashboard/src/lib/raidPolls.ts` | `raidPollBestSlot`, `raidPollDayLabel` |
| `dashboard/src/lib/raiderIo.ts` | `RAIDERIO_CHARACTER_DETAIL_FIELDS` |
| `dashboard/src/lib/raids.ts` | `dashboardLoginUrl`, `raidDiscordDeleteAfterStartHoursFromSettings`, `raidCompositionLabel`, `deleteDraftRaid`, `raidGroupLayoutRoleCounts`, `buildRaidParties`, `buildRaidBench` |
| `dashboard/src/lib/rosterFormation.ts` | `rosterRoleCounts` |
| `dashboard/src/lib/rulesOnboarding.ts` | `rulesAcceptUrl`, `rulesLoginUrl`, `markRulesOnboardingCompleted`, `rulesAcceptPath`, `rulesLoginPath` |
| `dashboard/src/lib/security.ts` | `getForwardedHost` |
| `dashboard/src/lib/seo.ts` | `compactText` |
| `dashboard/src/lib/serverToasts.ts` | `clearDashboardToastCookie` |
| `dashboard/src/lib/staticRules.ts` | `listStaticState` |
| `dashboard/src/lib/storageAccess.ts` | `storageReadOnlyMode`, `clearStorageOperationCircuit`, `storageWriteFailureDetails`, `canAttemptStorageRead`, `canAttemptStorageWrite` |
| `dashboard/src/lib/wowCharacters.ts` | `isCharacterProfileRouteMatch`, `buildCharacterProfileSlug`, `normalizeCharacterProfileSlug` |
| `dashboard/src/lib/wowClassCatalog.ts` | `wowClassColorInt`, `roleLabelShort`, `roleEmoji` |
| `dashboard/src/lib/wowRoles.ts` | `wowSpecRoleLabel` |

Додатково прибрано 31 невикористане приватне оголошення/імпорт. Після повторного аналізу не залишилось експортованих значень, які водночас не мають зовнішніх посилань і не використовуються власним модулем.
