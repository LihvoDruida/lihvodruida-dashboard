"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ProfilePublicNameMode } from "@/lib/profiles";

type IconName = "edit" | "check" | "x" | "copy" | "sync";

function ProfileActionIcon({ name }: { name: IconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
    focusable: false,
  } as const;

  if (name === "edit") {
    return (
      <svg {...common}>
        <path
          d="M4 20h4.6L19.1 9.5a2.2 2.2 0 0 0 0-3.1l-1.5-1.5a2.2 2.2 0 0 0-3.1 0L4 15.4V20Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m13.5 5.9 4.6 4.6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (name === "check") {
    return (
      <svg {...common}>
        <path
          d="M5 12.6 9.2 17 19 7"
          stroke="currentColor"
          strokeWidth="2.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (name === "x") {
    return (
      <svg {...common}>
        <path
          d="M7 7l10 10M17 7 7 17"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (name === "copy") {
    return (
      <svg {...common}>
        <rect
          x="8"
          y="8"
          width="11"
          height="11"
          rx="2.2"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M5 15.5V6.8C5 5.8 5.8 5 6.8 5h8.7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path
        d="M20 7v5h-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 17v-5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 10A7 7 0 0 0 6.6 6.6L4 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 14A7 7 0 0 0 17.4 17.4L20 15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Props = {
  preferredName?: string | null;
  publicNameMode?: ProfilePublicNameMode;
  discordName: string;
  publicNamePreview?: string | null;
  serverStyleNamePreview?: string | null;
  nicknamePreview?: string | null;
  lastSyncedNickname?: string | null;
  lastSyncedAt?: string | null;
  currentServerNickname?: string | null;
  serverNicknameChecked?: boolean;
  canManage: boolean;
  canSyncDiscord: boolean;
  discordOwnerLocked?: boolean;
  returnTo?: string;
};

export default function ProfileNameControls({
  preferredName,
  publicNameMode = "name",
  discordName,
  publicNamePreview,
  serverStyleNamePreview,
  nicknamePreview,
  lastSyncedNickname,
  lastSyncedAt,
  currentServerNickname,
  serverNicknameChecked = false,
  canManage,
  canSyncDiscord,
  discordOwnerLocked = false,
  returnTo = "",
}: Props) {
  const inputId = useId();
  const [value, setValue] = useState(preferredName || "");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setValue(preferredName || "");
  }, [preferredName]);

  useEffect(() => {
    if (!canManage || preferredName) return;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [canManage, preferredName]);

  useEffect(() => {
    setCopied(false);
  }, [nicknamePreview]);

  const savedName = (preferredName || "").trim();
  const draftName = value.trim();
  const hasName = Boolean(savedName);
  const synced = Boolean(
    nicknamePreview && lastSyncedNickname === nicknamePreview,
  );
  const serverNickname = (currentServerNickname || "").trim();
  const showServerNickname = Boolean(serverNicknameChecked || serverNickname);
  const canSubmitName = draftName.length >= 2 && draftName !== savedName;
  const nameTooShort = draftName.length > 0 && draftName.length < 2;
  const nameMissing = !savedName && !draftName;
  const nameHint = nameTooShort
    ? "Мінімум 2 символи. Скороти спецсимволи й залиш нормальне імʼя."
    : nameMissing
      ? "Це обовʼязкове поле для завершення реєстрації."
      : draftName !== savedName
        ? "Є незбережені зміни — натисни галочку."
        : "Імʼя збережене й готове для профілю та Discord-ніку.";
  const syncLabel = synced ? "Оновити" : "Застосувати";

  async function copyNickname() {
    if (!nicknamePreview) return;
    try {
      await navigator.clipboard.writeText(nicknamePreview);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="profile-name-panel">
      <section
        className="profile-name-section profile-name-section--personal"
        aria-labelledby={`${inputId}-name-title`}
      >
        <div className="profile-name-section__head profile-name-section__head--modern">
          <div>
            <span
              className="profile-name-panel__label"
              id={`${inputId}-name-title`}
            >
              Імʼя в панелі
            </span>
            <small>Основне імʼя для сайту, реєстрації та Discord-ніку.</small>
          </div>
          {canManage ? (
            <span
              className={`profile-name-status-pill${savedName ? "" : " is-warning"}`}
            >
              {savedName ? "Редагування" : "Обовʼязково"}
            </span>
          ) : null}
        </div>

        {canManage ? (
          <form
            className={`profile-name-edit-form profile-name-edit-form--always is-editing${nameTooShort || nameMissing ? " is-invalid" : ""}`}
            action="/api/profile/name"
            method="post"
          >
            {returnTo ? (
              <input type="hidden" name="returnTo" value={returnTo} />
            ) : null}
            <label className="sr-only" htmlFor={inputId}>
              Імʼя в профілі
            </label>
            <input
              ref={inputRef}
              id={inputId}
              name="preferredName"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Наприклад, Дмитро"
              minLength={2}
              maxLength={32}
              autoComplete="given-name"
              required
              aria-invalid={nameTooShort || nameMissing ? "true" : undefined}
              aria-describedby={`${inputId}-hint`}
            />
            <button
              className="profile-icon-action profile-icon-action--confirm"
              type="submit"
              disabled={!canSubmitName}
              data-preserve-label="true"
              aria-label="Зберегти імʼя"
              title="Зберегти імʼя"
            >
              <ProfileActionIcon name="check" />
            </button>
            <small
              className={`profile-field-hint${nameTooShort || nameMissing ? " is-warning" : draftName !== savedName ? " is-pending" : " is-ok"}`}
              id={`${inputId}-hint`}
            >
              {nameHint}
            </small>
          </form>
        ) : (
          <div
            className={`profile-name-display-row profile-name-display-row--modern${hasName ? "" : " is-empty"}`}
          >
            <span className="profile-name-display-row__value">
              <strong>{savedName || "Додай імʼя"}</strong>
              <small>
                {hasName
                  ? "Пріоритетне імʼя в панелі."
                  : "Буде основним у панелі."}
              </small>
            </span>
            {hasName ? (
              <span className="profile-name-status-pill">Активне</span>
            ) : null}
          </div>
        )}
      </section>

      <section
        className="profile-display-mode-section"
        aria-label="Формат імені у панелі"
      >
        <div className="profile-name-section__head profile-name-section__head--modern">
          <div>
            <span className="profile-name-panel__label">Відображення</span>
            <small>Формат показу в панелі й рейдах.</small>
          </div>
        </div>
        {canManage ? (
          <div
            className="profile-display-mode-form"
            role="group"
            aria-label="Вибір формату імені"
          >
            <form
              className="profile-display-mode-action"
              action="/api/profile/name-mode"
              method="post"
            >
              {returnTo ? (
                <input type="hidden" name="returnTo" value={returnTo} />
              ) : null}
              <input type="hidden" name="publicNameMode" value="name" />
              <button
                className={`profile-display-mode-option${publicNameMode !== "server_nickname" ? " is-selected" : ""}`}
                type="submit"
                disabled={publicNameMode !== "server_nickname"}
                data-preserve-label="true"
              >
                <span
                  className="profile-display-mode-option__radio"
                  aria-hidden="true"
                />
                <span>
                  <strong>Імʼя</strong>
                  <small>{savedName || discordName || "Discord"}</small>
                </span>
              </button>
            </form>
            <form
              className="profile-display-mode-action"
              action="/api/profile/name-mode"
              method="post"
            >
              {returnTo ? (
                <input type="hidden" name="returnTo" value={returnTo} />
              ) : null}
              <input
                type="hidden"
                name="publicNameMode"
                value="server_nickname"
              />
              <button
                className={`profile-display-mode-option${publicNameMode === "server_nickname" ? " is-selected" : ""}`}
                type="submit"
                disabled={publicNameMode === "server_nickname"}
                data-preserve-label="true"
              >
                <span
                  className="profile-display-mode-option__radio"
                  aria-hidden="true"
                />
                <span>
                  <strong>Імʼя + персонажі</strong>
                  <small>
                    {serverStyleNamePreview ||
                      nicknamePreview ||
                      publicNamePreview ||
                      savedName ||
                      discordName ||
                      "Учасник"}
                  </small>
                </span>
              </button>
            </form>
          </div>
        ) : null}
      </section>

      <section
        className="profile-discord-standard"
        aria-label="Discord nickname"
      >
        <div className="profile-discord-standard__head profile-discord-standard__head--modern">
          <div className="profile-discord-standard__identity">
            <span className="profile-name-panel__label">Discord</span>
            <strong title={discordName || "Discord"}>
              {discordName || "Discord"}
            </strong>
            <small>Оригінальне імʼя Discord.</small>
          </div>

          {canManage && canSyncDiscord && hasName && nicknamePreview ? (
            discordOwnerLocked ? (
              <button
                className="profile-nick-sync-button profile-nick-sync-button--copy"
                type="button"
                onClick={copyNickname}
                title={`Скопіювати: ${nicknamePreview}`}
                aria-label="Скопіювати Discord nickname"
              >
                <ProfileActionIcon name="copy" />
                <span>{copied ? "Скопійовано" : "Скопіювати"}</span>
              </button>
            ) : (
              <form
                className="profile-discord-nick-form"
                action="/api/profile/discord-nickname"
                method="post"
              >
                {returnTo ? (
                  <input type="hidden" name="returnTo" value={returnTo} />
                ) : null}
                <button
                  className={`profile-nick-sync-button${synced ? " is-synced" : ""}`}
                  type="submit"
                  data-preserve-label="true"
                  title={`Змінити серверне імʼя на: ${nicknamePreview}`}
                  aria-label="Стандартизувати серверне імʼя Discord"
                >
                  <ProfileActionIcon name="sync" />
                  <span>{syncLabel}</span>
                </button>
              </form>
            )
          ) : null}
        </div>

        {showServerNickname ? (
          <div
            className="profile-server-nickname"
            aria-label="Поточне імʼя на Discord-сервері"
          >
            <span className="profile-server-nickname__icon" aria-hidden="true">
              ⌁
            </span>
            <span className="profile-server-nickname__body">
              <small>Реальний серверний нік</small>
              <strong>{serverNickname || "Не встановлено"}</strong>
            </span>
          </div>
        ) : null}

        {canSyncDiscord &&
        hasName &&
        nicknamePreview &&
        (!synced || discordOwnerLocked) ? (
          <div
            className={`profile-nickname-preview${synced ? " is-synced" : ""}${discordOwnerLocked ? " is-owner-locked" : ""}`}
          >
            <span>Буде в Discord</span>
            <strong>{nicknamePreview}</strong>
            {discordOwnerLocked ? (
              <small>Власник сервера змінює вручну.</small>
            ) : synced ? (
              <small>Готово{lastSyncedAt ? ` • ${lastSyncedAt}` : ""}.</small>
            ) : (
              <small>Лише на цьому сервері.</small>
            )}
          </div>
        ) : canManage ? (
          <small className="profile-nickname-hint">
            {!hasName
              ? "Вкажи імʼя — формат збереться автоматично."
              : "Синхронізація доступна після входу через Discord."}
          </small>
        ) : null}
      </section>
    </div>
  );
}
