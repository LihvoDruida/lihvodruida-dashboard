"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { dispatchDashboardToast } from "@/lib/clientToasts";

type ContentImageFieldProps = {
  label: string;
  hint: string;
  currentImage?: string;
  previewBaseUrl?: string;
};

function readableFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  const units = ["B", "KB", "MB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function withPreviewBase(path: string, baseUrl?: string) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("data:") || value.startsWith("blob:")) return value;

  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return value;

  return `${base}/${value.replace(/^\/+/, "")}`;
}

export default function ContentImageField({ label, hint, currentImage, previewBaseUrl }: ContentImageFieldProps) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const hasCurrentImage = Boolean(currentImage);
  const currentPreviewSrc = withPreviewBase(currentImage || "", previewBaseUrl);
  const previewSrc = previewUrl || currentPreviewSrc || "";
  const previewLabel = useMemo(() => {
    if (file) return `${file.name} • ${readableFileSize(file.size)}`;
    if (currentImage) return currentImage;
    return "Картинку ще не вибрано";
  }, [currentImage, file]);

  return (
    <div className="content-field content-field--upload">
      <span>{label}</span>
      {hasCurrentImage ? <input type="hidden" name="existingImage" value={currentImage} /> : null}

      <div className="image-field-shell">
        <label className="image-upload-control" htmlFor={inputId}>
          <input
            id={inputId}
            type="file"
            name="image"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              setFile(nextFile);
              if (nextFile) {
                dispatchDashboardToast({
                  tone: "info",
                  title: "Картинку вибрано",
                  message: nextFile.name + " • " + readableFileSize(nextFile.size),
                  ttl: 3600,
                });
              }
            }}
          />
          <span className="image-upload-icon" aria-hidden="true">+</span>
          <span className="image-upload-text">
            <strong>{file || currentImage ? "Замінити картинку" : "Додати картинку"}</strong>
            <small>{hint}</small>
          </span>
        </label>

        <div className={`image-preview-card${previewSrc ? " has-image" : ""}`} aria-live="polite">
          {previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewSrc} alt="Превʼю обкладинки" />
          ) : (
            <div className="image-preview-placeholder" aria-hidden="true">IMG</div>
          )}
          <div className="image-preview-meta">
            <strong>Превʼю обкладинки</strong>
            <small>{previewLabel}</small>
          </div>
        </div>
      </div>
    </div>
  );
}
