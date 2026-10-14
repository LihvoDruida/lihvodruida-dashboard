"use client";

import { useEffect, useState } from "react";
import { listMemoryKey, listReturnUrl, parseListMemory, type ListKind } from "@/lib/listViewState";
import styles from "./ListViewMemory.module.css";

export default function ListReturnLink({ kind, scope, className }: { kind: ListKind; scope: string; className?: string }) {
  const [href, setHref] = useState(`/${kind}`);
  useEffect(() => {
    try { setHref(listReturnUrl(kind, parseListMemory(kind, sessionStorage.getItem(listMemoryKey(kind, scope))))); }
    catch { setHref(`/${kind}`); }
  }, [kind, scope]);
  return <a className={className || styles.returnLink} href={href}>← Повернутися до списку {{ profiles: "профілів", applications: "заявок", raids: "рейдів", polls: "рейд-пулів" }[kind]}</a>;
}
