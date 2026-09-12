"use client";

import { useEffect } from "react";

const RAID_FORM_SELECTOR = 'form[data-raid-editor-form="true"]';

function numberValue(input: HTMLInputElement | null) {
  if (!input) return null;
  const value = Number(input.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function registrationMinutes(select: HTMLSelectElement | null) {
  const value = Number(select?.value || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 60;
}

function setDependentState(element: HTMLElement | null, enabled: boolean) {
  if (!element) return;
  element.dataset.enabled = enabled ? "true" : "false";
  element.setAttribute("aria-disabled", enabled ? "false" : "true");
}

function deadlineText(
  dateInput: HTMLInputElement | null,
  timeInput: HTMLInputElement | null,
  lockToggle: HTMLInputElement | null,
  lockSelect: HTMLSelectElement | null,
) {
  if (!lockToggle?.checked) return "Автозакриття запису вимкнено.";
  if (!dateInput?.value || !timeInput?.value)
    return "Вкажи дату й час — дедлайн буде розраховано автоматично.";

  const startsAt = new Date(`${dateInput.value}T${timeInput.value}:00`);
  if (!Number.isFinite(startsAt.getTime()))
    return "Не вдалося розрахувати дедлайн: перевір дату й час.";

  const deadline = new Date(
    startsAt.getTime() - registrationMinutes(lockSelect) * 60 * 1000,
  );
  const formatted = new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(deadline);

  if (deadline.getTime() <= Date.now())
    return `⚠ Дедлайн уже минув (${formatted}). Нові записи будуть заблоковані.`;
  return `Запис автоматично закриється ${formatted}.`;
}

export default function RaidEditorFormEnhancer() {
  useEffect(() => {
    const form = document.querySelector<HTMLFormElement>(RAID_FORM_SELECTOR);
    if (!form || form.dataset.raidUxReady === "true") return;
    form.dataset.raidUxReady = "true";

    const minItemLevel = form.elements.namedItem("minItemLevel") as HTMLInputElement | null;
    const minRequired = form.elements.namedItem("minItemLevelRequired") as HTMLInputElement | null;
    const minRequiredWrap = minRequired?.closest<HTMLElement>(".raid-dependent-control") || null;

    const lockToggle = form.elements.namedItem("registrationLockEnabled") as HTMLInputElement | null;
    const lockSelect = form.elements.namedItem("registrationLockMinutesBefore") as HTMLSelectElement | null;
    const lockField = lockSelect?.closest<HTMLElement>(".raid-dependent-field") || null;
    const deadline = form.querySelector<HTMLElement>("[data-raid-registration-deadline]");

    const dateInput = form.elements.namedItem("date") as HTMLInputElement | null;
    const timeInput = form.elements.namedItem("time") as HTMLInputElement | null;
    const saveState = form.querySelector<HTMLElement>("[data-raid-save-state]");

    let dirty = false;
    let submitting = false;

    const updateMinimumPolicy = () => {
      if (!minRequired) return;
      const enabled = numberValue(minItemLevel) !== null;
      if (!enabled) minRequired.checked = false;
      minRequired.disabled = !enabled;
      setDependentState(minRequiredWrap, enabled);
    };

    const updateRegistrationPolicy = () => {
      const enabled = Boolean(lockToggle?.checked);
      if (lockSelect) lockSelect.disabled = !enabled;
      setDependentState(lockField, enabled);
      if (deadline)
        deadline.textContent = deadlineText(
          dateInput,
          timeInput,
          lockToggle,
          lockSelect,
        );
    };

    const markDirty = () => {
      if (submitting || dirty) return;
      dirty = true;
      form.classList.add("is-dirty");
      if (saveState) saveState.textContent = "Є незбережені зміни";
    };

    const onInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
      markDirty();
      if (target === minItemLevel) updateMinimumPolicy();
      if (target === lockToggle || target === lockSelect || target === dateInput || target === timeInput)
        updateRegistrationPolicy();
    };

    const onSubmit = () => {
      submitting = true;
      dirty = false;
      form.classList.remove("is-dirty");
      if (saveState) saveState.textContent = "Зберігаємо зміни…";
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || submitting) return;
      event.preventDefault();
      event.returnValue = "";
    };

    updateMinimumPolicy();
    updateRegistrationPolicy();

    form.addEventListener("input", onInput);
    form.addEventListener("change", onInput);
    form.addEventListener("submit", onSubmit, { capture: true });
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      form.removeEventListener("input", onInput);
      form.removeEventListener("change", onInput);
      form.removeEventListener("submit", onSubmit, { capture: true });
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  return null;
}
