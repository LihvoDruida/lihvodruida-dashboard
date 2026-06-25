"use client";

import AppProblemScreen from "@/components/AppProblemScreen";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="uk">
      <body>
        <AppProblemScreen
          error={error}
          reset={reset}
          secondaryHref="/"
          secondaryLabel="До панелі"
          details={[
            "Це глобальний збій оболонки панелі.",
            "Повторити — перезапустить рендер сторінки.",
          ]}
        />
      </body>
    </html>
  );
}
