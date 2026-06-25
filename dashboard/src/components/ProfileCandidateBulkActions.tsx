"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  formId: string;
  count: number;
};

function getCandidateInputs(formId: string) {
  if (typeof document === "undefined") return [] as HTMLInputElement[];
  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-profile-candidate-checkbox="true"][form="${formId}"]`));
}

export default function ProfileCandidateBulkActions({ formId, count }: Props) {
  const [mounted, setMounted] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);

  const allSelected = useMemo(() => count > 0 && selectedCount === count, [count, selectedCount]);
  const someSelected = selectedCount > 0 && selectedCount < count;

  useEffect(() => {
    setMounted(true);
    const updateSelected = () => {
      setSelectedCount(getCandidateInputs(formId).filter((input) => input.checked).length);
    };

    const inputs = getCandidateInputs(formId);
    inputs.forEach((input) => input.addEventListener("change", updateSelected));
    updateSelected();

    return () => {
      inputs.forEach((input) => input.removeEventListener("change", updateSelected));
    };
  }, [formId, count]);

  function toggleAll(checked: boolean) {
    const inputs = getCandidateInputs(formId);
    inputs.forEach((input) => {
      input.checked = checked;
    });
    setSelectedCount(checked ? inputs.length : 0);
  }

  return (
    <div className="profile-candidate-bulk-actions" aria-label="Масове додавання персонажів">
      <label className="profile-candidate-toggle-all">
        <input
          id={`${formId}-toggle-all`}
          type="checkbox"
          checked={allSelected}
          ref={(input) => {
            if (input) input.indeterminate = someSelected;
          }}
          onChange={(event) => toggleAll(event.currentTarget.checked)}
        />
        <span>Позначити всі</span>
      </label>
      <div className="profile-candidate-bulk-buttons">
        <button
          className="btn btn-primary btn-sm"
          type="submit"
          form={formId}
          name="mode"
          value="selected"
          disabled={mounted && selectedCount === 0}
        >
          Додати вибрані{selectedCount ? ` (${selectedCount})` : ""}
        </button>
      </div>
    </div>
  );
}
