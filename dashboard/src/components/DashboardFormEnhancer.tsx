"use client";

import { useEffect } from "react";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import {
  notifyDashboardDataChanged,
  type DashboardDataMutationKind,
  type DashboardDataScope,
} from "@/lib/dashboardLiveRefresh";

type ToastPayload = {
  tone?: "info" | "success" | "warning" | "error";
  title?: string;
  message?: string;
  ttl?: number;
};

function formUsesApi(form: HTMLFormElement) {
  if (form.dataset.toastManaged === "true") return false;
  if (form.dataset.dashboardActionForm === "true") return true;
  const action = form.getAttribute("action") || "";
  return action.startsWith("/api/") || action.includes("/api/");
}

function formUsesLiveSubmit(form: HTMLFormElement) {
  return form.dataset.dashboardLiveSubmit === "true";
}

function submitterOverride(
  submitter: HTMLButtonElement | null,
  attribute: "formaction" | "formmethod",
) {
  if (!submitter || !submitter.hasAttribute(attribute)) return "";
  return submitter.getAttribute(attribute) || "";
}

function submitActionUrl(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | null,
) {
  // Do not read submitter.formAction as the primary value. In browsers it can
  // resolve to the current page URL when the button has no explicit formaction,
  // which posts /dashboard/discord and returns HTML instead of the API JSON result.
  return (
    submitterOverride(submitter, "formaction") ||
    form.getAttribute("action") ||
    form.action ||
    window.location.href
  );
}

function submitMethod(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | null,
) {
  return (
    submitterOverride(submitter, "formmethod") ||
    form.getAttribute("method") ||
    form.method ||
    "post"
  ).toUpperCase();
}

function actionText(action: string) {
  if (action === "access-groups-create")
    return {
      label: "Створюємо...",
      title: "Створюємо групу",
      message: "Перевіряємо ID, Discord role ID, іконку та права доступу.",
    };
  if (action === "access-groups-save")
    return {
      label: "Зберігаємо...",
      title: "Зберігаємо групу",
      message: "Оновлюємо назву, іконку, Discord role ID та права у базі даних.",
    };
  if (action === "access-groups-delete")
    return {
      label: "Видаляємо...",
      title: "Видаляємо групу",
      message: "Перевіряємо захист системних груп і оновлюємо список.",
    };
  if (action === "access-groups-impersonate")
    return {
      label: "Вмикаємо перегляд...",
      title: "Вмикаємо режим перегляду",
      message: "Перемикаємо тестовий доступ без зміни реальної ролі акаунта.",
    };
  if (action === "access-groups-impersonation-end")
    return {
      label: "Завершуємо...",
      title: "Завершуємо режим перегляду",
      message: "Повертаємо реальні права твого акаунта.",
    };
  if (action.includes("/applications/bulk-status"))
    return {
      label: "Синхронізуємо...",
      title: "Масова модерація",
      message: "Оновлюємо вибрані заявки та Discord-повідомлення.",
    };
  if (action.includes("/profile/characters/bulk-add"))
    return {
      label: "Додаємо...",
      title: "Додаємо персонажів",
      message: "Додаємо вибраних персонажів однією дією.",
    };
  if (action.includes("/profile/characters/add"))
    return {
      label: "Додаємо...",
      title: "Додаємо персонажа",
      message: "Перевіряємо Battle.net і додаємо персонажа до профілю.",
    };
  if (action.includes("/profile/characters/remove"))
    return {
      label: "Видаляємо...",
      title: "Видаляємо персонажа",
      message: "Оновлюємо список персонажів і мейна.",
    };
  if (action.includes("/profile/characters/main"))
    return {
      label: "Оновлюємо...",
      title: "Оновлюємо мейна",
      message:
        "Зберігаємо основного персонажа для профілю, рейдів і Discord-шаблону.",
    };
  if (action.includes("/profile/raid-role"))
    return {
      label: "Зберігаємо...",
      title: "Зберігаємо роль у рейді",
      message: "Оновлюємо пріоритет ролі для запису на рейди.",
    };
  if (action.includes("/profile/nickname-characters"))
    return {
      label: "Зберігаємо...",
      title: "Зберігаємо альтів для ніку",
      message: "Оновлюємо персонажів, які підставляються в Discord nickname.",
    };
  if (action.includes("/profile/name-mode"))
    return {
      label: "Зберігаємо...",
      title: "Зберігаємо формат імені",
      message: "Оновлюємо, як імʼя показується в панелі, рейдах і авторах.",
    };
  if (action.includes("/profile/name"))
    return {
      label: "Зберігаємо...",
      title: "Зберігаємо імʼя",
      message: "Оновлюємо імʼя в профілі.",
    };
  if (action.includes("/profile/discord-nickname"))
    return {
      label: "Синхронізуємо...",
      title: "Оновлюємо Discord імʼя",
      message:
        "Змінюємо серверний nickname у Discord за профільним стандартом.",
    };
  if (action.includes("/raids/") && action.includes("/attendance"))
    return {
      label: "Оновлюємо...",
      title: "Оновлюємо запис",
      message: "Записуємо дію та оновлюємо склад рейду без перезавантаження.",
    };
  if (action.includes("/delete"))
    return {
      label: "Видаляємо...",
      title: "Видаляємо",
      message: "Обробляємо запит і оновлюємо дані.",
    };
  if (action.includes("/logout"))
    return {
      label: "Виходимо...",
      title: "Вихід",
      message: "Завершуємо поточну сесію.",
    };
  if (action.includes("/auth/login"))
    return {
      label: "Перевіряємо...",
      title: "Перевіряємо доступ",
      message: "Перевіряємо доступ і відкриваємо панель.",
    };
  if (action.includes("/api/dashboard/logs/settings"))
    return {
      label: "Зберігаємо...",
      title: "Зберігаємо логування",
      message:
        "Оновлюємо Discord-канал і правила audit-log.",
    };
  if (action.includes("/api/dashboard/discord/settings"))
    return {
      label: "Зберігаємо...",
      title: "Зберігаємо Discord-налаштування",
      message: "Оновлюємо шаблон ніку та ліміти масових Discord-дій.",
    };
  if (action.includes("/api/dashboard/security/auth-access"))
    return {
      label: "Зберігаємо...",
      title: "Зберігаємо правила входу",
      message: "Оновлюємо серверну перевірку Discord-ролей і резервного входу.",
    };
  if (action.includes("/api/dashboard/security/geo-access"))
    return {
      label: "Зберігаємо...",
      title: "Зберігаємо геообмеження",
      message: "Оновлюємо правила доступу для заявок і авторизації.",
    };
  if (action.includes("/api/dashboard/discord/nickname"))
    return {
      label: "Змінюємо...",
      title: "Змінюємо нік у Discord",
      message: "Надсилаємо PATCH-запит до Discord і перевіряємо результат.",
    };
  if (action.includes("/api/dashboard/discord/profiles/cleanup"))
    return {
      label: "Перевіряємо...",
      title: "Перевіряємо акаунти",
      message:
        "Оновлюємо склад гільдії в базі, потім звіряємо профілі з roster, Discord-сервером і рейдовими записами.",
    };
  if (action.includes("/api/dashboard/discord/roles/add"))
    return {
      label: "Додаємо...",
      title: "Додаємо Discord-ролі",
      message: "Перевіряємо учасника, ієрархію ролей і результат у Discord.",
    };
  if (action.includes("/api/dashboard/discord/roles/remove"))
    return {
      label: "Знімаємо...",
      title: "Знімаємо Discord-ролі",
      message: "Перевіряємо учасника, ієрархію ролей і результат у Discord.",
    };
  if (action.includes("/api/dashboard/discord/officers/sync"))
    return {
      label: "Синхронізуємо...",
      title: "Синхронізуємо офіцерську роль",
      message:
        "Перевіряємо Battle.net статуси персонажів і видаємо вибрану Discord-роль офіцерам гільдії.",
    };
  if (action.includes("/api/dashboard/discord/nicknames/inspect"))
    return {
      label: "Перевіряємо...",
      title: "Перевіряємо ніки Discord",
      message: "Звіряємо серверні ніки з глобальним шаблоном.",
    };
  if (action.includes("/api/dashboard/discord/nicknames/cleanup"))
    return {
      label: "Застосовуємо...",
      title: "Застосовуємо ролі за неправильний серверний нік",
      message:
        "Перевіряємо серверні ніки за шаблоном, знімаємо вибрані ролі й видаємо ролі з правого списку.",
    };
  if (action.includes("/discord/embeds"))
    return {
      label: "Виконуємо...",
      title: "Дія в Discord виконується",
      message: "Передаємо зміни в Discord.",
    };
  if (action.includes("/api/rules/accept/complete"))
    return {
      label: "Видаємо роль...",
      title: "Приймаємо правила",
      message: "Перевіряємо підписаний Discord-токен або профіль і видаємо вибрану роль.",
    };
  if (action.includes("/api/raids/publish"))
    return {
      label: "Публікуємо...",
      title: "Публікуємо рейд",
      message: "Оновлюємо Discord-оголошення та кнопки запису.",
    };
  if (action.includes("/api/raids"))
    return {
      label: "Зберігаємо...",
      title: "Зберігаємо рейд",
      message: "Зберігаємо зміни в панелі.",
    };
  if (action.includes("/content/create"))
    return {
      label: "Публікуємо...",
      title: "Публікуємо матеріал",
      message: "Зберігаємо матеріал і готуємо оновлення сторінки.",
    };
  if (action.includes("/content/update"))
    return {
      label: "Зберігаємо...",
      title: "Зберігаємо зміни",
      message: "Оновлюємо матеріал.",
    };
  return {
    label: "Виконуємо...",
    title: "Обробка дії",
    message: "Запит виконується. Зачекай кілька секунд.",
  };
}

function pushToast(title: string, message?: string) {
  dispatchDashboardToast({ tone: "info", title, message, ttl: 3600 });
}

function clearFieldInvalid(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
) {
  field.removeAttribute("aria-invalid");
}

function lockNavigationLink(
  link: HTMLAnchorElement,
  title: string,
  message: string,
) {
  if (link.dataset.navigating === "true") return false;
  link.dataset.navigating = "true";
  link.classList.add("is-submitting");
  link.setAttribute("aria-busy", "true");
  link.setAttribute("aria-disabled", "true");
  pushToast(title, message);
  return true;
}

function unlockNavigationLinks() {
  document
    .querySelectorAll<HTMLAnchorElement>('a.is-submitting[aria-busy="true"]')
    .forEach((link) => {
      delete link.dataset.navigating;
      link.classList.remove("is-submitting");
      link.removeAttribute("aria-busy");
      link.removeAttribute("aria-disabled");
    });
}

function deleteConfirmText(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | null,
) {
  const action = submitActionUrl(form, submitter);
  const explicit =
    form.dataset.confirmMessage || submitter?.dataset.confirmMessage || "";
  if (explicit) return explicit;

  const dangerousButton =
    submitter?.classList.contains("danger") ||
    submitter?.classList.contains("btn-danger");
  if (action.includes("/delete") || dangerousButton) {
    return "Підтвердити видалення? Дію не можна швидко скасувати.";
  }
  return "";
}

function preserveSubmitterValue(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | null,
) {
  form
    .querySelectorAll<HTMLInputElement>('input[data-submitter-proxy="true"]')
    .forEach((input) => input.remove());
  if (!submitter?.name) return;

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = submitter.name;
  input.value = submitter.value;
  input.dataset.submitterProxy = "true";
  form.appendChild(input);
}

function preserveButtonState(buttons: HTMLButtonElement[]) {
  for (const button of buttons) {
    button.dataset.wasDisabled = button.disabled ? "true" : "false";
    button.dataset.originalText = button.textContent || "";
  }
}

function setWorking(
  form: HTMLFormElement,
  buttons: HTMLButtonElement[],
  submitter: HTMLButtonElement | null,
  label: string,
) {
  form.dataset.submitting = "true";
  form.classList.add("is-submitting");
  form.setAttribute("aria-busy", "true");

  for (const button of buttons) {
    button.disabled = true;
    if (button === submitter) {
      button.setAttribute("aria-busy", "true");
      button.classList.add("btn-working");
    } else {
      button.removeAttribute("aria-busy");
      button.classList.add("btn-waiting");
    }
  }

  if (submitter) {
    submitter.textContent = submitter.dataset.loadingLabel || label;
  }
}

function resetWorking(form: HTMLFormElement, buttons: HTMLButtonElement[]) {
  delete form.dataset.submitting;
  form.classList.remove("is-submitting");
  form.removeAttribute("aria-busy");
  form
    .querySelectorAll<HTMLInputElement>('input[data-submitter-proxy="true"]')
    .forEach((input) => input.remove());

  for (const button of buttons) {
    button.disabled = button.dataset.wasDisabled === "true";
    button.removeAttribute("aria-busy");
    button.classList.remove("btn-working", "btn-waiting");
    if (button.dataset.originalText)
      button.textContent = button.dataset.originalText;
    delete button.dataset.wasDisabled;
    delete button.dataset.originalText;
  }
}

function mutationScopeFromAction(action: string): DashboardDataScope {
  if (action.includes("/applications/")) return "applications";
  if (action.includes("/content/")) return "content";
  if (action.includes("/discord/")) return "discord";
  if (action.includes("/guild/")) return "guild";
  if (action.includes("/profile/")) return "profile";
  if (action.includes("/raids") || action.includes("/polls")) return "raids";
  if (action.includes("/auth/")) return "session";
  return "unknown";
}


function mutationKindFromAction(action: string): DashboardDataMutationKind {
  if (action.includes("/applications/")) return "application";
  if (action.includes("/content/")) return "content";
  if (action.includes("/discord/")) return "discord";
  if (action.includes("/guild/")) return "guild";
  if (action.includes("/profile/")) return "profile";
  if (action.includes("/polls") || action.includes("raid-poll")) return "raid-poll";
  if (action.includes("/raids")) return "raid";
  if (action.includes("/auth/")) return "session";
  return "unknown";
}

function cleanMutationId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function nestedRecord(record: Record<string, unknown>, key: string) {
  return objectRecord(record[key]);
}

function idFromActionPath(action: string, marker: "raids" | "polls") {
  try {
    const url = new URL(action, typeof window !== "undefined" ? window.location.href : "https://dashboard.local");
    const parts = url.pathname.split("/").filter(Boolean);
    const index = parts.indexOf(marker);
    if (index >= 0 && parts[index + 1]) return decodeURIComponent(parts[index + 1]);
  } catch {
    const match = action.match(new RegExp(`/${marker}/([^/?#]+)`));
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return undefined;
}

function mutationEntityIdsFromResponse(data: unknown, action: string) {
  const record = objectRecord(data);
  const raid = record ? nestedRecord(record, "raid") : null;
  const poll = record ? nestedRecord(record, "poll") : null;
  const kind = mutationKindFromAction(action);

  const raidId = cleanMutationId(record?.raidId)
    || cleanMutationId(raid?.id)
    || (kind === "raid" ? cleanMutationId(record?.resourceId) || cleanMutationId(record?.id) : undefined)
    || cleanMutationId(idFromActionPath(action, "raids"));

  const pollId = cleanMutationId(record?.pollId)
    || cleanMutationId(poll?.id)
    || (kind === "raid-poll" ? cleanMutationId(record?.resourceId) || cleanMutationId(record?.id) : undefined)
    || cleanMutationId(idFromActionPath(action, "polls"));

  const resourceId = cleanMutationId(record?.resourceId)
    || (kind === "raid" ? raidId : undefined)
    || (kind === "raid-poll" ? pollId : undefined)
    || cleanMutationId(record?.id)
    || raidId
    || pollId;

  return { resourceId, raidId, pollId };
}

function mutationRevisionFromResponse(data: unknown) {
  if (!data || typeof data !== "object") return undefined;
  const revision = (data as Record<string, unknown>).revision;
  return typeof revision === "string" && revision.trim() ? revision.trim() : undefined;
}

function toastFromResponse(data: unknown, responseOk: boolean): ToastPayload {
  if (data && typeof data === "object" && "toast" in data) {
    const toast = (data as { toast?: ToastPayload }).toast;
    if (toast?.title) return toast;
  }
  if (data && typeof data === "object" && "message" in data) {
    const message = String((data as { message?: unknown }).message || "");
    if (message)
      return {
        tone: responseOk ? "success" : "error",
        title: responseOk ? "Готово" : "Дію не виконано",
        message,
      };
  }
  return responseOk
    ? { tone: "success", title: "Готово", message: "Дані оновлено." }
    : {
        tone: "error",
        title: "Дію не виконано",
        message: "Сервер не повернув зрозумілу відповідь.",
      };
}

export default function DashboardFormEnhancer() {
  useEffect(() => {
    async function submitLiveForm(
      form: HTMLFormElement,
      submitter: HTMLButtonElement | null,
      buttons: HTMLButtonElement[],
      action: string,
    ) {
      let keepLocked = false;

      try {
        const response = await fetch(action || window.location.href, {
          method: submitMethod(form, submitter),
          body: new FormData(form),
          credentials: "same-origin",
          redirect: "manual",
          headers: {
            Accept: "application/json",
            "X-Dashboard-Action": "live",
          },
        });

        const contentType = response.headers.get("content-type") || "";
        const location = response.headers.get("location") || "";
        const isRedirect = response.status >= 300 && response.status < 400;

        if (isRedirect) {
          if (location) {
            keepLocked = true;
            window.location.assign(location);
            return;
          }
          throw new Error("redirect_without_location");
        }

        const isJson = contentType.toLowerCase().includes("application/json");
        const data = isJson ? await response.json().catch(() => null) : null;
        if (!isJson) {
          dispatchDashboardToast({
            tone: "error",
            title: "Сервер не повернув результат дії",
            message: `Запит пішов не в JSON API (${response.status}). Автооновлення сторінки вимкнено; дія має повертати JSON для живого UI.`,
            ttl: 7600,
          });
          return;
        }

        const toast = toastFromResponse(data, response.ok);
        dispatchDashboardToast({
          tone: toast.tone || (response.ok ? "success" : "error"),
          title: toast.title || (response.ok ? "Готово" : "Дію не виконано"),
          message: toast.message,
          ttl: toast.ttl || (response.ok ? 4200 : 7600),
        });

        const loginUrl =
          data && typeof data === "object" && "loginUrl" in data
            ? String((data as { loginUrl?: unknown }).loginUrl || "")
            : "";
        if (!response.ok && loginUrl) {
          keepLocked = true;
          window.setTimeout(() => window.location.assign(loginUrl), 650);
          return;
        }

        if (response.ok) {
          const mutationIds = mutationEntityIdsFromResponse(data, action);
          notifyDashboardDataChanged({
            scope: mutationScopeFromAction(action),
            kind: mutationKindFromAction(action),
            resourceId: mutationIds.resourceId,
            raidId: mutationIds.raidId,
            pollId: mutationIds.pollId,
            revision: mutationRevisionFromResponse(data),
            action,
            source: "form-enhancer",
          });
          const shouldRefresh = Boolean(
            data &&
            typeof data === "object" &&
            "refresh" in data &&
            (data as { refresh?: unknown }).refresh,
          );
          if (shouldRefresh) {
            dispatchDashboardToast({
              tone: "info",
              title: "Дані оновлюються у фоні",
              message:
                "Сторінка не перезавантажується — потрібні блоки отримають свіжі дані через фоновий API.",
              ttl: 3600,
            });
          }
        }
      } catch {
        dispatchDashboardToast({
          tone: "error",
          title: "Немає відповіді від сервера",
          message: "Перевір інтернет або повтори дію через кілька секунд.",
          ttl: 7600,
        });
      } finally {
        if (!keepLocked) {
          resetWorking(form, buttons);
          if (submitter) submitter.focus({ preventScroll: true });
        }
      }
    }

    function onSubmit(event: SubmitEvent) {
      const form =
        event.target instanceof HTMLFormElement ? event.target : null;
      if (!form || !formUsesApi(form)) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        event.preventDefault();
        event.stopPropagation();
        dispatchDashboardToast({
          tone: "warning",
          title: "Немає підключення",
          message:
            "Дія не відправлена. Перевір інтернет і повтори після відновлення мережі.",
          ttl: 6400,
        });
        return;
      }
      if (form.dataset.submitting === "true") {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function")
          event.stopImmediatePropagation();
        return;
      }

      const submitter =
        event.submitter instanceof HTMLButtonElement ? event.submitter : null;
      const confirmText = deleteConfirmText(form, submitter);
      if (confirmText && !window.confirm(confirmText)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const buttons = Array.from(
        form.querySelectorAll<HTMLButtonElement>(
          'button[type="submit"], button:not([type])',
        ),
      );
      const submitAction = submitActionUrl(form, submitter);
      const action =
        submitter?.dataset.dashboardAction ||
        form.dataset.dashboardAction ||
        submitAction;
      const copy = actionText(action);

      const liveSubmit = formUsesLiveSubmit(form);
      if (liveSubmit) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function")
          event.stopImmediatePropagation();
      }

      preserveSubmitterValue(form, submitter);
      preserveButtonState(buttons);
      setWorking(form, buttons, submitter, copy.label);
      pushToast(copy.title, copy.message);

      if (liveSubmit) {
        void submitLiveForm(form, submitter, buttons, submitAction);
      }
    }

    function onClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;

      const target = event.target instanceof Element ? event.target : null;
      const bnetLink = target?.closest<HTMLAnchorElement>(
        'a[href*="/api/auth/battlenet/start"]',
      );
      const discordLoginLink = target?.closest<HTMLAnchorElement>(
        'a[href*="/api/auth/discord/start"]',
      );

      if (bnetLink) {
        if (
          !lockNavigationLink(
            bnetLink,
            "Відкриваємо Battle.net",
            "Зараз буде справжня реавторизація акаунта для оновлення списку персонажів.",
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (
        discordLoginLink &&
        !lockNavigationLink(
          discordLoginLink,
          "Відкриваємо Discord",
          "Відкриваємо вхід через Discord і перевірку ролей доступу.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function onInvalid(event: Event) {
      const field =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
          ? event.target
          : null;
      if (!field) return;

      const form = field.form;
      if (
        !form ||
        !formUsesApi(form) ||
        form.dataset.invalidToastShown === "true"
      )
        return;

      form.dataset.invalidToastShown = "true";
      field.setAttribute("aria-invalid", "true");
      field.addEventListener("input", () => clearFieldInvalid(field), {
        once: true,
      });
      field.addEventListener("change", () => clearFieldInvalid(field), {
        once: true,
      });
      window.setTimeout(() => {
        delete form.dataset.invalidToastShown;
      }, 1800);

      dispatchDashboardToast({
        tone: "warning",
        title: "Заповни обов’язкові поля",
        message:
          field?.validationMessage ||
          "Перевір поля форми й заповни обов’язкові значення.",
        ttl: 4200,
      });
    }

    function resetStaleSubmittingState() {
      document
        .querySelectorAll<HTMLFormElement>('form[data-submitting="true"]')
        .forEach((form) => {
          const buttons = Array.from(
            form.querySelectorAll<HTMLButtonElement>(
              'button[type="submit"], button:not([type])',
            ),
          );
          resetWorking(form, buttons);
        });
      unlockNavigationLinks();
    }

    window.addEventListener("submit", onSubmit, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("invalid", onInvalid, true);
    window.addEventListener("pageshow", resetStaleSubmittingState);
    return () => {
      window.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("invalid", onInvalid, true);
      window.removeEventListener("pageshow", resetStaleSubmittingState);
    };
  }, []);

  return null;
}
