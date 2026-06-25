"use client";

import AppProblemScreen from "@/components/AppProblemScreen";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppProblemScreen
      error={error}
      reset={reset}
      secondaryHref="/"
      secondaryLabel="До панелі"
      details={[
        "Повторити — спробує відкрити цей розділ ще раз.",
        "До панелі — повертає на безпечний маршрут без додаткових важких запитів.",
      ]}
    />
  );
}
