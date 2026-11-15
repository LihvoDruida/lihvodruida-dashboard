"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

export default function PageRefreshButton({ label = "Повторити" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <Button busy={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Оновлюємо…" : label}</Button>;
}
