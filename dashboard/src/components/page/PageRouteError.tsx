"use client";
import { useEffect } from "react";
import { sendClientErrorReport } from "@/components/ClientErrorReporter";
import PageContainer from "./PageContainer";
import ErrorState from "./ErrorState";
import Button from "@/components/ui/Button";

export default function PageRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void sendClientErrorReport(error, "react-error-boundary");
  }, [error]);
  return <PageContainer label="Помилка розділу">
    <ErrorState title="Розділ тимчасово недоступний" description="Не вдалося завантажити дані. Повтори спробу."
      digest={error.digest} actions={<Button onClick={reset}>Повторити</Button>} />
  </PageContainer>;
}
