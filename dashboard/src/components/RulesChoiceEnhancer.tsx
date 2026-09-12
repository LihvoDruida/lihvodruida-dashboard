"use client";

import { useEffect } from "react";

const RAID_ROLE_CLASSES = [
  "profile-raid-role-pill--auto",
  "profile-raid-role-pill--tank",
  "profile-raid-role-pill--healer",
  "profile-raid-role-pill--dps",
];

function sameValues(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function setOptionSelected(input: HTMLInputElement, selected: boolean) {
  const label = input.closest("label");
  if (!label) return;
  label.classList.toggle("is-selected", selected);
  label.classList.toggle("is-disabled-choice", input.disabled && !selected);
}

function enhanceRadioForm(form: HTMLFormElement) {
  const inputs = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  );
  if (!inputs.length) return () => undefined;

  const initialValue = form.dataset.initialValue || "";
  const block = form.closest<HTMLElement>(".rules-registration-block");
  const status = block?.querySelector<HTMLElement>("[data-rules-choice-status]") || null;
  const feedback = form.querySelector<HTMLElement>("[data-rules-choice-feedback]") || null;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]') || null;

  const update = () => {
    const checked = inputs.find((input) => input.checked) || null;
    inputs.forEach((input) => setOptionSelected(input, input === checked));

    const value = checked?.value || "";
    const label = checked?.dataset.choiceLabel || "Не вибрано";
    const dirty = Boolean(value && value !== initialValue);

    form.dataset.dirty = dirty ? "true" : "false";
    if (submit) submit.disabled = !value || !dirty;

    if (status) {
      status.textContent = label;
      status.classList.toggle("is-missing", !value);
      status.classList.toggle("is-selected", Boolean(value));

      if (form.dataset.rulesChoiceForm === "raid-role") {
        RAID_ROLE_CLASSES.forEach((className) => status.classList.remove(className));
        const role = checked?.dataset.choiceRole || checked?.value || "auto";
        status.classList.add(`profile-raid-role-pill--${role}`);
      }
    }

    if (feedback) {
      feedback.textContent = !value
        ? "Вибери один варіант."
        : dirty
          ? "Є незбережений вибір. Натисни «Зберегти»."
          : "Вибір збережено.";
      feedback.classList.toggle("is-pending", dirty);
      feedback.classList.toggle("is-ok", Boolean(value) && !dirty);
      feedback.classList.toggle("is-warning", !value);
    }
  };

  inputs.forEach((input) => input.addEventListener("change", update));
  update();

  return () => {
    inputs.forEach((input) => input.removeEventListener("change", update));
  };
}

function enhanceNicknameForm(form: HTMLFormElement) {
  const inputs = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="nicknameCharacterKeys"]'),
  );
  if (!inputs.length) return () => undefined;

  const maxSelected = Math.max(1, Number(form.dataset.maxSelected || 2));
  const initialValues = String(form.dataset.initialValues || "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
  const block = form.closest<HTMLElement>(".rules-registration-block");
  const counter = block?.querySelector<HTMLElement>("[data-rules-nickname-count]") || null;
  const feedback = form.querySelector<HTMLElement>("[data-rules-nickname-feedback]") || null;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]') || null;

  const update = () => {
    const checkedInputs = inputs.filter((input) => input.checked);
    const selectedValues = checkedInputs.map((input) => input.value);
    const atLimit = selectedValues.length >= maxSelected;

    inputs.forEach((input) => {
      input.disabled = atLimit && !input.checked;
      setOptionSelected(input, input.checked);
    });

    const dirty = !sameValues(selectedValues, initialValues);
    form.dataset.dirty = dirty ? "true" : "false";
    if (submit) submit.disabled = !dirty;

    if (counter) {
      counter.textContent = `${selectedValues.length} / ${maxSelected} альти`;
      counter.classList.toggle("is-warning", selectedValues.length > maxSelected);
      counter.classList.toggle("is-ok", selectedValues.length > 0 && selectedValues.length <= maxSelected);
    }

    if (feedback) {
      feedback.textContent = atLimit
        ? `Ліміт ${maxSelected}: щоб вибрати іншого альта, спочатку зніми один із вибраних.`
        : dirty
          ? "Є незбережені зміни у складі Discord-ніку."
          : "Мейн додається автоматично; альти необовʼязкові.";
      feedback.classList.toggle("is-pending", dirty);
      feedback.classList.toggle("is-ok", !dirty);
    }
  };

  const handleReset = () => {
    // The reset event fires before native form controls restore defaults.
    // Defer one frame so counters/disabled states reflect the actual reset values.
    window.requestAnimationFrame(update);
  };

  inputs.forEach((input) => input.addEventListener("change", update));
  form.addEventListener("reset", handleReset);
  update();

  return () => {
    inputs.forEach((input) => input.removeEventListener("change", update));
    form.removeEventListener("reset", handleReset);
  };
}

export default function RulesChoiceEnhancer() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    document
      .querySelectorAll<HTMLFormElement>("form[data-rules-choice-form]")
      .forEach((form) => cleanups.push(enhanceRadioForm(form)));

    document
      .querySelectorAll<HTMLFormElement>("form[data-rules-nickname-form]")
      .forEach((form) => cleanups.push(enhanceNicknameForm(form)));

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  return null;
}
