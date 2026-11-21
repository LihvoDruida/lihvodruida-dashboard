"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import Link from "next/link";
import Button from "./Button";
import styles from "../page/page-system.module.css";

type MenuBase = { id: string; label: string; disabled?: boolean; danger?: boolean };
export type DropdownMenuItem = MenuBase & (
  | { href: string; onSelect?: never }
  | { href?: never; onSelect: () => void }
);

/** Native disclosure, normal Tab order; no incomplete ARIA menu implementation. */
/** `accessibleLabel` names the menu in full for assistive tech when the visible `label` is short. */
export default function DropdownMenu({ label = "Інші дії", accessibleLabel, items = [], children, closeOnAction = true }: { label?: string; accessibleLabel?: string; items?: readonly DropdownMenuItem[]; children?: ReactNode; closeOnAction?: boolean }) {
  const root = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const panelId = useId();
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) root.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  if (!items.length && !children) return null;
  return <details className={styles.dropdown} ref={root} onKeyDown={event => {
    if (event.key === "Escape" && root.current?.open) {
      event.preventDefault(); root.current.open = false; trigger.current?.focus();
    }
  }}>
    <summary className={`btn subtle ${styles.dropdownTrigger}`} ref={trigger} aria-controls={panelId} aria-label={accessibleLabel}>{label}<span aria-hidden="true">⌄</span></summary>
    <div id={panelId} className={styles.dropdownPanel} aria-label={accessibleLabel || label} onClick={event => {
      if (!closeOnAction) return;
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button:not(:disabled)") : null;
      if (button) {
        root.current?.removeAttribute("open");
        // Native form submitters retain focus ownership for useActionFocus.
        // Moving focus to summary here would suppress the mutation result.
        if (button.type !== "submit") trigger.current?.focus();
      }
    }}>
      {children}
      {items.map(item => item.href !== undefined
        ? item.disabled
          ? <span key={item.id} className={styles.dropdownItem} aria-disabled="true">{item.label}</span>
          : <Link key={item.id} href={item.href} className={styles.dropdownItem} data-danger={item.danger || undefined}
              onClick={() => root.current?.removeAttribute("open")}>{item.label}</Link>
        : <Button key={item.id} disabled={item.disabled} tone={item.danger ? "danger" : "ghost"} onClick={() => {
            root.current?.removeAttribute("open"); trigger.current?.focus(); item.onSelect();
          }}>{item.label}</Button>)}
    </div>
  </details>;
}
