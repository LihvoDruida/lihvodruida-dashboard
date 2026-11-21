import { raidStatusLabel, raidStatusClass } from "@/lib/raidPresentation";

import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
import RaidRoleMentionPicker from "@/components/RaidRoleMentionPicker";
import RaidImagePicker from "@/components/RaidImagePicker";
import RaidEditorFormEnhancer from "@/components/RaidEditorFormEnhancer";
import type { DiscordRoleOption } from "@/components/DiscordEmbedEditor";

import type { DashboardSession } from "@/lib/auth";
import { hierarchyTitle } from "@/lib/permissions";

import { isInternalRaidThumbnail } from "@/lib/raidThumbnailAssets";
import { isRaidClosed, raidAutoCompositionLabel, type RaidItem } from "@/lib/raids";
import { todayIso } from "@/components/RaidSignupPresentation";

// Реекспорт для сумісності: раніше ці помічники жили тут.
export { formatRaidDateTime, todayIso } from "@/components/RaidSignupPresentation";

export type RaidChannelOption = { id: string; name: string };
export type RaidRoleOption = DiscordRoleOption;

export function StatusNotice({
  params: _params,
}: {
  params: Record<string, string | undefined>;
}) {
  return null;
}

export {default as RaidManageActions} from "@/components/raids/RaidManageActions";
export {default as RaidAnnouncementPreview} from "@/components/raids/RaidOverview";
export {default as RaidListCard} from "@/components/raids/RaidDirectoryCard";
export {RosterSideList, signupDisplayName} from "@/components/raids/RaidRoster";

export function RaidForm({
  raid,
  channels,
  voiceChannels = [],
  roles = [],
  discordEnabled = true,
  defaultChannelId = "",
  defaultVoiceChannelId = "",
  editorAccountName = "",
  publicationPending = false,
  publicationEventPending = false,
}: {
  raid?: RaidItem | null;
  channels: RaidChannelOption[];
  voiceChannels?: RaidChannelOption[];
  roles?: RaidRoleOption[];
  discordEnabled?: boolean;
  defaultChannelId?: string;
  defaultVoiceChannelId?: string;
  editorAccountName?: string;
  publicationPending?: boolean;
  publicationEventPending?: boolean;
}) {
  const defaultComposition = raid
    ? raidAutoCompositionLabel(raid).replace(/\s/g, "")
    : "0/0/0";
  const channelOptions =
    raid?.channelId &&
    !channels.some((channel) => channel.id === raid.channelId)
      ? [{ id: raid.channelId, name: "поточний канал" }, ...channels]
      : channels;
  const voiceChannelOptions =
    raid?.voiceChannelId &&
    !voiceChannels.some((channel) => channel.id === raid.voiceChannelId)
      ? [{ id: raid.voiceChannelId, name: "поточний голосовий канал" }, ...voiceChannels]
      : voiceChannels;
  const selectedChannelId = raid?.channelId || defaultChannelId || channelOptions[0]?.id || "";
  const selectedVoiceChannelId = raid?.voiceChannelId || defaultVoiceChannelId || voiceChannelOptions[0]?.id || "";
  const selectedMentionRoleIds = Array.from(
    new Set((raid?.mentionRoleIds || []).filter(Boolean)),
  );
  const activeSignupCount = raid
    ? raid.signups.filter(
        (signup) =>
          signup.status === "going" ||
          signup.status === "late" ||
          signup.status === "tentative",
      ).length
    : 0;
  const isExistingRaid = Boolean(raid?.id);
  const isDiscordPublished = Boolean(
    raid?.channelId && raid?.messageId && raid?.status !== "draft",
  );
  const canPublish = discordEnabled && (publicationPending || publicationEventPending || !(raid ? isRaidClosed(raid) : false));
  const saveLabel =
    isExistingRaid && raid?.status !== "draft"
      ? "Зберегти без публікації"
      : "Зберегти чернетку";
  const publishLabel = publicationPending || publicationEventPending ? "Перевірити Discord" : isDiscordPublished
    ? "Оновити Discord"
    : "Опублікувати в Discord";
  const initialSaveState = isExistingRaid
    ? "Усі завантажені зміни збережені"
    : "Новий рейд ще не збережено";

  return (
    <div className="raid-form-stack">
      <RaidEditorFormEnhancer />
      <form
        className="panel raid-form-panel raid-form-panel--modern"
        action="/api/raids"
        method="post"
        data-raid-editor-form="true"
        data-existing-raid={isExistingRaid ? "true" : "false"}
      >
        <input type="hidden" name="raidId" value={raid?.id || ""} />
        {!raid?.id ? <input type="hidden" name="creationToken" value={randomUUID()} /> : null}
        <input type="hidden" name="composition" value={defaultComposition} />

        <div className="raid-form-heading">
          <div>
            <div className="section-title">
              {raid?.id ? "Редагування рейду" : "Створення рейду"}
            </div>
            <p>
              Заповнюй форму зверху вниз. Чернетка змінює тільки сайт, а
              публікація створює або оновлює Discord-оголошення.
            </p>
            <nav className="raid-editor-jump-nav" aria-label="Розділи форми рейду">
              <a href="#raid-editor-main">Основне</a>
              <a href="#raid-editor-rules">Запис</a>
              <a href="#raid-editor-discord">Discord</a>
              <a href="#raid-editor-content">Оформлення</a>
              <a href="#raid-editor-publish">Публікація</a>
            </nav>
          </div>
          <div className="raid-form-heading-status">
            {raid ? (
              <em className={`raid-state raid-state--${raidStatusClass(raid)}`}>
                {raidStatusLabel(raid)}
              </em>
            ) : (
              <em className="raid-state raid-state--draft">Новий</em>
            )}
            <small>{defaultComposition} • склад формується автоматично</small>
          </div>
        </div>

        <section
          className="raid-form-section raid-form-section--core"
          id="raid-editor-main"
          aria-labelledby="raid-editor-main-title"
        >
          <div className="raid-form-section-heading">
            <span className="raid-form-step" aria-hidden="true">01</span>
            <div>
              <strong id="raid-editor-main-title">Основне</strong>
              <p>Назва, складність, дата, час і відповідальний рейд-лідер.</p>
            </div>
          </div>

          <label className="field-label">
            Назва рейду
            <input
              className="input"
              name="title"
              defaultValue={raid?.title || "Войдспайр"}
              maxLength={120}
              required
            />
          </label>
          <label className="field-label">
            Складність
            <select
              className="select"
              name="difficulty"
              defaultValue={raid?.difficulty || "heroic"}
            >
              <option value="normal">Нормал</option>
              <option value="heroic">Героїк</option>
              <option value="mythic">Міфік</option>
            </select>
          </label>
          <label className="field-label">
            Дата
            <input
              className="input"
              type="date"
              name="date"
              defaultValue={raid?.date || todayIso()}
              required
            />
          </label>
          <label className="field-label">
            Час
            <input
              className="input"
              type="time"
              name="time"
              defaultValue={raid?.time || "20:00"}
              required
            />
          </label>
          <label className="field-label raid-field--wide">
            Рейд-лідер / РЛ
            <input
              className="input"
              name="raidLeaderName"
              placeholder="Напр. Sebas"
              defaultValue={raid?.raidLeaderName || ""}
              maxLength={120}
            />
            <small>
              Необов’язково. Якщо залишити порожнім, блок РЛ у Discord не
              показуватиметься.
            </small>
          </label>
        </section>

        <section
          className="raid-form-section raid-form-section--rules"
          id="raid-editor-rules"
          aria-labelledby="raid-editor-rules-title"
        >
          <div className="raid-form-section-heading">
            <span className="raid-form-step" aria-hidden="true">02</span>
            <div>
              <strong id="raid-editor-rules-title">Правила запису</strong>
              <p>Ліміти, вимоги до спорядження та автоматичний дедлайн.</p>
            </div>
          </div>

          <div className="raid-setting-card">
            <div className="raid-setting-card__head">
              <strong>Item level</strong>
              <span>Фільтр спорядження</span>
            </div>
            <label className="field-label">
              Мінімальний item level
              <input
                className="input"
                type="number"
                name="minItemLevel"
                min="1"
                max="9999"
                step="1"
                placeholder="Напр. 675"
                defaultValue={raid?.minItemLevel || ""}
              />
              <small>Порожнє поле повністю вимикає перевірку ilvl.</small>
            </label>
            <label className="raid-checkbox-line raid-dependent-control">
              <input
                type="checkbox"
                name="minItemLevelRequired"
                value="1"
                defaultChecked={Boolean(raid?.minItemLevelRequired)}
              />
              <span>
                <strong>Блокувати нижчий ilvl</strong>
                <small>Без цього перемикача система лише попереджає.</small>
              </span>
            </label>
          </div>

          <div className="raid-setting-card">
            <div className="raid-setting-card__head">
              <strong>Місткість</strong>
              <span>Ліміт активних записів</span>
            </div>
            <label className="field-label">
              Максимум гравців
              <input
                className="input"
                type="number"
                name="maxPlayers"
                min={Math.max(1, activeSignupCount || 1)}
                max="80"
                step="1"
                placeholder="Напр. 20"
                defaultValue={raid?.maxPlayers || ""}
              />
              <small>
                {activeSignupCount > 0
                  ? `Зараз активних записів: ${activeSignupCount}. Менше цього значення зберегти не можна.`
                  : "Порожньо — без жорсткого ліміту, склад масштабується автоматично."}
              </small>
            </label>
          </div>

          <div className="raid-setting-card raid-setting-card--deadline">
            <div className="raid-setting-card__head">
              <strong>Дедлайн</strong>
              <span>Автоматичне закриття запису</span>
            </div>
            <label className="raid-checkbox-line raid-checkbox-line--primary">
              <input
                type="checkbox"
                name="registrationLockEnabled"
                value="1"
                defaultChecked={Boolean(raid?.registrationLockEnabled)}
              />
              <span>
                <strong>Закривати запис до старту</strong>
                <small>Після дедлайну кнопки запису в Discord стають неактивними.</small>
              </span>
            </label>
            <label className="field-label raid-dependent-field">
              Коли закрити запис
              <select
                className="select"
                name="registrationLockMinutesBefore"
                defaultValue={String(raid?.registrationLockMinutesBefore || 60)}
              >
                <option value="30">За 30 хв</option>
                <option value="60">За 1 год</option>
                <option value="120">За 2 год</option>
                <option value="180">За 3 год</option>
                <option value="1440">За 1 день</option>
              </select>
            </label>
            <span
              className="raid-setting-status"
              data-raid-registration-deadline
              aria-live="polite"
            >
              Дедлайн буде розраховано за датою та часом рейду.
            </span>
          </div>

          <div className="raid-auto-composition-note">
            <strong>Склад формується автоматично • {defaultComposition}</strong>
            <span>
              Максимум 2 танки на рейд, кількість хілів масштабується від паті,
              а ДД добираються з урахуванням критичних бафів та балансу
              мілі/рендж. Якщо задано максимум гравців, схема рахується від
              цього ліміту.
            </span>
          </div>
        </section>

        <section
          className="raid-form-section raid-form-section--discord"
          id="raid-editor-discord"
          aria-labelledby="raid-editor-discord-title"
        >
          <div className="raid-form-section-heading">
            <span className="raid-form-step" aria-hidden="true">03</span>
            <div>
              <strong id="raid-editor-discord-title">Discord і правила рейду</strong>
              <p>Канал публікації, лут, розхідники та ролі для згадки.</p>
            </div>
          </div>

          <label className="field-label raid-field--wide">
            Канал Discord
            {channelOptions.length ? (
              <select
                className="select"
                name="channelId"
                defaultValue={selectedChannelId}
                disabled={!discordEnabled}
              >
                {channelOptions.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                name="channelId"
                inputMode="numeric"
                pattern="[0-9]{16,25}"
                maxLength={25}
                autoComplete="off"
                placeholder="ID текстового каналу Discord"
                defaultValue={selectedChannelId}
                disabled={!discordEnabled}
                required={discordEnabled}
              />
            )}
            {!discordEnabled ? (
              <small>Discord зараз недоступний — дані можна зберегти як чернетку.</small>
            ) : !channelOptions.length ? (
              <small>
                Список каналів не прочитався автоматично. Встав ID каналу
                вручну або перевір Discord-конфігурацію сервера.
              </small>
            ) : (
              <small>Саме в цей канал піде нове або оновлене оголошення.</small>
            )}
          </label>

          <label className="field-label raid-field--wide">
            Голосовий канал рейду
            {voiceChannelOptions.length ? (
              <select
                className="select"
                name="voiceChannelId"
                defaultValue={selectedVoiceChannelId}
                disabled={!discordEnabled}
              >
                <option value="">Не вибрано</option>
                {voiceChannelOptions.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    🔊 {channel.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                name="voiceChannelId"
                inputMode="numeric"
                pattern="[0-9]{16,25}"
                maxLength={25}
                autoComplete="off"
                placeholder="ID голосового каналу Discord (необов’язково)"
                defaultValue={selectedVoiceChannelId}
                disabled={!discordEnabled}
              />
            )}
            <small>
              Використовується в нагадуванні за 15 хвилин і в приватних повідомленнях учасникам.
              {editorAccountName ? ` Останній вибір запам’ятовується для акаунта ${editorAccountName}.` : ""}
            </small>
          </label>

          <div className="raid-setting-card raid-field--wide">
            <div className="raid-setting-card__head">
              <strong>Discord-подія</strong>
              <span>Scheduled Event сервера</span>
            </div>
            <label className="raid-checkbox-line raid-checkbox-line--primary">
              <input
                type="checkbox"
                name="discordEventEnabled"
                value="1"
                defaultChecked={raid?.discordEventEnabled !== false}
              />
              <span>
                <strong>Створювати подію разом із рейдом</strong>
                <small>Під час публікації Dashboard створить або оновить Discord Scheduled Event за датою й часом рейду.</small>
              </span>
            </label>
            <label className="field-label raid-dependent-field">
              Тривалість події
              <select
                className="select"
                name="discordEventDurationMinutes"
                defaultValue={String(raid?.discordEventDurationMinutes || 180)}
              >
                <option value="120">2 години</option>
                <option value="180">3 години</option>
                <option value="240">4 години</option>
                <option value="300">5 годин</option>
                <option value="360">6 годин</option>
              </select>
              <small>External event автоматично стартує й завершується в Discord за цим інтервалом.</small>
            </label>
            {raid?.discordEventLastError ? (
              <span className="raid-setting-status is-warning">
                ⚠ Остання синхронізація події: {raid.discordEventLastError}
              </span>
            ) : raid?.discordEventUrl ? (
              <a className="raid-message-link" href={raid.discordEventUrl} target="_blank" rel="noreferrer">
                📅 Відкрити Discord-подію
              </a>
            ) : (
              <span className="raid-setting-status">Подія буде створена під час публікації рейду.</span>
            )}
          </div>

          <label className="field-label">
            Розхідники
            <select
              className="select"
              name="consumables"
              defaultValue={raid?.consumables || "own"}
            >
              <option value="own">Власні</option>
              <option value="guild">Гільдійні</option>
            </select>
          </label>
          <label className="field-label">
            Лут
            <select
              className="select"
              name="lootMode"
              defaultValue={raid?.lootMode || "ms-os"}
            >
              <option value="ms-os">MS &gt; OS</option>
              <option value="free-roll">Вільний рол</option>
              <option value="soft-reserve">Soft Reserve</option>
              <option value="loot-council">Loot Council</option>
            </select>
          </label>

          <div className="raid-discord-role-block">
            <div className="raid-discord-role-block__head">
              <strong>Кого тегнути</strong>
              <span>Ролі з’являться над Discord embed.</span>
            </div>
            <RaidRoleMentionPicker
              roles={roles}
              selectedRoleIds={selectedMentionRoleIds}
            />
          </div>
        </section>

        <section
          className="raid-form-section raid-form-section--content"
          id="raid-editor-content"
          aria-labelledby="raid-editor-content-title"
        >
          <div className="raid-form-section-heading">
            <span className="raid-form-step" aria-hidden="true">04</span>
            <div>
              <strong id="raid-editor-content-title">Опис і візуал</strong>
              <p>Текст оголошення, мініатюра та велике зображення рейду.</p>
            </div>
          </div>

          <label className="field-label raid-field--wide">
            Опис
            <textarea
              className="input textarea markdown-area raid-description-textarea"
              name="description"
              rows={8}
              maxLength={4096}
              defaultValue={
                raid?.description ||
                "Глибоко в серці темної цитаделі нас чекають давні таємниці та смертельні вороги.\n\nБудьте готові до суворого випробування!"
              }
            />
            <small>
              Підтримується Discord Markdown: жирний текст, курсив, списки,
              заголовки, цитати, посилання й код.
            </small>
          </label>
          <label className="field-label raid-field--wide">
            Мініатюра / іконка
            <input
              className="input"
              name="thumbnailUrl"
              type="url"
              inputMode="url"
              maxLength={2048}
              autoComplete="url"
              placeholder="https://..."
              defaultValue={
                raid?.thumbnailUrl && !isInternalRaidThumbnail(raid.thumbnailUrl)
                  ? raid.thumbnailUrl
                  : ""
              }
            />
            <small>
              Залиш порожнім для автоматичної мініатюри за складністю. Власний URL
              завжди має пріоритет.
            </small>
          </label>
          <RaidImagePicker defaultValue={raid?.imageUrl || ""} />
        </section>

        <section
          className="raid-publish-panel"
          id="raid-editor-publish"
          aria-labelledby="raid-editor-publish-title"
        >
          <div className="raid-publish-panel__copy">
            <span className="raid-form-step" aria-hidden="true">05</span>
            <div>
              <strong id="raid-editor-publish-title">Збереження і публікація</strong>
              <p>
                “Зберегти” не чіпає Discord. “{publishLabel}” зберігає форму й
                одразу синхронізує оголошення.
              </p>
              <span className="raid-save-state" data-raid-save-state aria-live="polite">
                {initialSaveState}
              </span>
            </div>
          </div>
          <div className="raid-form-actions">
            <button
              className="btn subtle"
              name="action"
              value="save"
              type="submit"
            >
              {saveLabel}
            </button>
            <button
              className="btn primary"
              formAction="/api/raids/publish"
              name="action"
              value="publish"
              type="submit"
              disabled={!canPublish}
            >
              {publishLabel}
            </button>
          </div>
          {publicationPending || publicationEventPending ? (
            <p className="notice warning-note raid-publication-recovery">Є незавершена публікація. <a href="#discord-publication">Перейди до стану й відновлення Discord</a>, щоб звірити її без надсилання форми.</p>
          ) : null}
          {!canPublish ? (
            <p className="raid-publish-panel__warning">
              Discord-публікація зараз недоступна. Чернетку та локальні зміни
              все одно можна зберегти.
            </p>
          ) : null}
          <div className="raid-form-links">
            {raid?.id ? (
              <a
                className="raid-message-link"
                href={`/raids/${encodeURIComponent(raid.id)}`}
              >
                Відкрити сторінку рейду
              </a>
            ) : null}
            {raid?.messageUrl ? (
              <a
                className="raid-message-link"
                href={raid.messageUrl}
                target="_blank"
                rel="noreferrer"
              >
                Відкрити Discord-повідомлення
              </a>
            ) : null}
            {raid?.discordEventUrl ? (
              <a
                className="raid-message-link"
                href={raid.discordEventUrl}
                target="_blank"
                rel="noreferrer"
              >
                Відкрити Discord-подію
              </a>
            ) : null}
          </div>
        </section>
      </form>

      {raid?.id ? (
        <form
          className="panel raid-form-danger-zone raid-form-danger-zone--separate"
          action={`/api/raids/${encodeURIComponent(raid.id)}/delete`}
          method="post"
          data-confirm-message={
            raid.status === "draft"
              ? "Видалити чернетку рейду?"
              : "Видалити рейд із панелі? Повʼязане Discord-повідомлення також буде прибране, якщо це можливо."
          }
        >
          <strong>
            {raid.status === "draft" ? "Видалення чернетки" : "Видалення рейду"}
          </strong>
          <p>
            {raid.status === "draft"
              ? "Чернетка зникне зі списку рейдів."
              : "З панелі рейд видаляється тільки вручну. Автоматично після старту прибирається лише Discord-повідомлення, а архів у панелі зберігається."}
          </p>
          <button className="btn danger" type="submit">
            {raid.status === "draft" ? "Видалити чернетку" : "Видалити рейд"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function RaidPageShell({
  user,
  title,
  description,
  children,
}: {
  user?: DashboardSession | null;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="container app-page raid-page raid-page--modern">
      <section
        className="dashboard-shell content-shell raid-shell app-page-stack"
        aria-label="Панель рейдів Mistblossom Vanguard"
      >
        <DashboardIdentity user={user || null} activeSection="raids" />
        <header className="hero panel dashboard-hero raid-dashboard-hero app-page-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Рейди</div>
            <div className="content-hero-status-row">
              <span className="content-mode-pill content-mode-pill--library">
                {user ? hierarchyTitle(user.role) : "Учасник"}
              </span>
              <span className="content-hero-path">
                Запис у Discord • склад паті • оновлення без перезавантаження
              </span>
            </div>
            <h1>{title}</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">{description}</p>
          </div>
          <HeroSidePanel
            ariaLabel="Огляд рейдів"
            summary={[
              {
                label: "РОЗДІЛ",
                value: "Рейди",
                note: "Запис, склад і публікація",
              },
              {
                label: "ДОСТУП",
                value: user ? hierarchyTitle(user.role) : "Учасник",
                note: user ? "Права з профілю" : "Публічний перегляд",
              },
            ]}
            stats={[
              { label: "DISCORD", value: "Так" },
              { label: "ПАТІ", value: "Авто" },
              { label: "ОНОВЛЕННЯ", value: "Так" },
            ]}
          />
        </header>
        {children}
      </section>
    </main>
  );
}

export function RaidUnavailableState({
  canManage = false,
}: {
  canManage?: boolean;
}) {
  return (
    <section className="panel raid-member-panel">
      <h2>Рейд недоступний</h2>
      <p>
        {canManage
          ? "Рейд не знайдено або був видалений."
          : "Цей рейд не знайдено, ще не опублікований або був видалений. Перевір посилання з Discord-повідомлення."}
      </p>
    </section>
  );
}

export function makePreviewRaid(
  user: DashboardSession,
  createdByName?: string,
): RaidItem {
  return {
    id: "previewraid",
    title: "Войдспайр",
    difficulty: "heroic",
    date: todayIso(),
    time: "20:00",
    description:
      "Глибоко в серці темної цитаделі Войдспайр нас чекають давні таємниці та смертельні вороги.\n\nБудьте готові до суворого випробування!",
    createdByDiscordId: user.provider === "discord" ? user.id : "",
    createdByName: createdByName || user.name || "@Sebas",
    createdByMain: null,
    raidLeaderName: null,
    consumables: "own",
    lootMode: "ms-os",
    composition: { tanks: 0, healers: 0, dps: 0 },
    maxPlayers: null,
    registrationLockEnabled: false,
    registrationLockMinutesBefore: null,
    mentionRoleIds: [],
    discordEventEnabled: true,
    discordEventDurationMinutes: 180,
    status: "draft",
    signups: [],
  };
}
