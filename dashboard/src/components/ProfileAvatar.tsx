"use client";

import { useEffect, useState } from "react";

type Props = {
  src?: string | null;
  className: string;
  fallbackClassName?: string;
  alt?: string;
  width?: number;
  height?: number;
  loading?: "eager" | "lazy";
};

export default function ProfileAvatar({
  src,
  className,
  fallbackClassName,
  alt = "",
  width,
  height,
  loading = "lazy",
}: Props) {
  const [failed, setFailed] = useState(!src);

  useEffect(() => {
    setFailed(!src);
  }, [src]);

  if (!src || failed) {
    return (
      <span
        className={`${className}${fallbackClassName ? ` ${fallbackClassName}` : ""}`}
        aria-hidden="true"
        style={{ width, height }}
        data-avatar-placeholder="true"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <circle cx="12" cy="8" r="4" fill="currentColor" opacity="0.9" />
          <path d="M4.5 21c.7-4.5 3.2-7 7.5-7s6.8 2.5 7.5 7" fill="currentColor" opacity="0.62" />
          <path d="M7.2 18.6c1.2-1 2.8-1.5 4.8-1.5s3.6.5 4.8 1.5" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
        </svg>
      </span>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
