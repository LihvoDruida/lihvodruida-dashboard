"use client";
import { useTransition, type ReactNode, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./page-system.module.css";

export default function FilterNavigationForm({ action, children }: { action: string; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value.trim()) params.set(key, value.trim());
    }
    const suffix = params.toString();
    startTransition(() => router.push(action + (suffix ? `?${suffix}` : ""), { scroll: false }));
  }
  return <form action={action} method="get" onSubmit={submit} aria-busy={pending || undefined}>
    <fieldset className={styles.filterFields} disabled={pending}>{children}</fieldset>
    {pending ? <p className={styles.metadata} role="status">Оновлюємо список. Попередні дані залишаються на екрані.</p> : null}
  </form>;
}
