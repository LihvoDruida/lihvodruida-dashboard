"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type RaidImageAsset = {
  name: string;
  path: string;
  url: string;
  size?: number | null;
};

type RaidImagesResponse = {
  ok?: boolean;
  images?: RaidImageAsset[];
  error?: string;
};

type LoadState = "idle" | "loading" | "ready" | "error";

function readableName(name: string) {
  return name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || name;
}

function sameUrl(a?: string | null, b?: string | null) {
  return String(a || "").trim() === String(b || "").trim();
}

function normalizeAsset(value: unknown): RaidImageAsset | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<RaidImageAsset>;
  const name = String(item.name || "").trim();
  const path = String(item.path || name).trim();
  const url = String(item.url || "").trim();
  if (!name || !path || !/^https?:\/\//i.test(url)) return null;
  return {
    name,
    path,
    url,
    size: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : null,
  };
}

function normalizeAssets(values: unknown) {
  const seen = new Set<string>();
  const result: RaidImageAsset[] = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const asset = normalizeAsset(raw);
    if (!asset) continue;
    const key = asset.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(asset);
  }
  return result;
}

export default function RaidImagePicker({ defaultValue = "" }: { defaultValue?: string | null }) {
  const [value, setValue] = useState(String(defaultValue || ""));
  const [images, setImages] = useState<RaidImageAsset[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

  useEffect(() => {
    setValue(String(defaultValue || ""));
  }, [defaultValue]);

  const selected = useMemo(() => images.find((image) => sameUrl(image.url, value)), [images, value]);
  const isLoading = state === "loading";

  const loadImages = useCallback(async (signal?: AbortSignal) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState("loading");
    setError("");

    try {
      const response = await fetch("/api/raids/images", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal,
      });
      const contentType = response.headers.get("content-type") || "";
      const data = (contentType.includes("application/json")
        ? await response.json().catch(() => ({}))
        : {}) as RaidImagesResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Не вдалося отримати список зображень.");
      }
      if (requestIdRef.current !== requestId || signal?.aborted) return;
      setImages(normalizeAssets(data.images));
      setState("ready");
    } catch (loadError) {
      if (signal?.aborted || requestIdRef.current !== requestId) return;
      setImages([]);
      setError(loadError instanceof Error ? loadError.message : "Не вдалося отримати список зображень.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadImages(controller.signal);
    return () => controller.abort();
  }, [loadImages]);

  return (
    <div className="raid-image-picker field-label" data-state={state} aria-busy={isLoading ? "true" : undefined}>
      <span>Зображення оголошення</span>
      <div className="raid-image-picker__input-row">
        <input
          className="input"
          name="imageUrl"
          placeholder="https://..."
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          autoComplete="off"
          inputMode="url"
        />
        <button className="btn subtle raid-image-picker__refresh" type="button" onClick={() => void loadImages()} disabled={isLoading}>
          {isLoading ? "Оновлення…" : "Оновити"}
        </button>
      </div>
      <small>Можна вставити URL вручну або вибрати картинку з репозиторію.</small>
      {error ? <small className="raid-image-picker__error">{error}</small> : null}
      {state === "ready" && images.length === 0 ? <small className="raid-image-picker__empty">У папці зображень нічого не знайдено.</small> : null}
      {images.length ? (
        <div className="raid-image-picker__grid" aria-label="Зображення рейдів">
          {images.map((image) => {
            const active = sameUrl(image.url, value);
            return (
              <button
                key={image.path || image.url}
                type="button"
                className={`raid-image-picker__item${active ? " is-selected" : ""}`}
                onClick={() => setValue(image.url)}
                aria-pressed={active}
                title={image.name}
              >
                <span className="raid-image-picker__preview">
                  <img src={image.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                </span>
                <span className="raid-image-picker__meta">
                  <strong>{readableName(image.name)}</strong>
                  {active ? <em>Вибрано</em> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {selected ? <small className="raid-image-picker__selected">Вибрано: {selected.name}</small> : null}
    </div>
  );
}
