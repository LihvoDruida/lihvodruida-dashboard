"use client";

import type { AuthorNameSuggestion } from "@/lib/profiles";

type Props = {
  suggestions?: AuthorNameSuggestion[];
  targetId: string;
  onPick?: (value: string) => void;
};

export default function AuthorSuggestionChips({ suggestions = [], targetId, onPick }: Props) {
  const cleanSuggestions = suggestions.filter((item) => item.value.trim()).slice(0, 4);
  if (!cleanSuggestions.length) return null;

  function apply(value: string) {
    onPick?.(value);
    const input = document.getElementById(targetId);
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.focus();
    }
  }

  return (
    <div className="author-suggestion-chips" aria-label="Підставити автора">
      <small>Підставити:</small>
      <span>
        {cleanSuggestions.map((item) => (
          <button key={`${item.source}-${item.value}`} type="button" onClick={() => apply(item.value)} title={item.label}>
            <strong>{item.value}</strong>
            <em>{item.label}</em>
          </button>
        ))}
      </span>
    </div>
  );
}
