"use client";

import { useId, type InputHTMLAttributes } from "react";

export default function FormField({ label, hint, error, id, maxLength = 512, ...input }: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const generated = useId();
  const fieldId = id || generated;
  const describedBy = [input["aria-describedby"], hint && `${fieldId}-hint`, error && `${fieldId}-error`].filter(Boolean).join(" ") || undefined;
  return <div className="ui-field">
    <label htmlFor={fieldId}>{label}</label>
    <input {...input} maxLength={maxLength} id={fieldId} aria-invalid={error ? true : input["aria-invalid"]} aria-describedby={describedBy} />
    {hint ? <small id={`${fieldId}-hint`} className="text-muted">{hint}</small> : null}
    {error ? <small id={`${fieldId}-error`} className="error-note" role="alert">{error}</small> : null}
  </div>;
}
